/**
 * CallLint private telemetry ingress — a dedicated Cloudflare Worker (new18 §17).
 *
 * ONE public endpoint: `POST /v1/events/usage`. No public usage API, no adoption
 * API, no dynamic admin surface, no dashboard (new18 §17). The private operator
 * report is a separate STATIC artifact and is not served from here.
 *
 * Why a Worker rather than Pages Functions: the website project `calllint-www`
 * serves a static site, and new18 §17 forbids converting it to dynamic or
 * touching deploy-web.yml to make telemetry work. Its Functions runtime does
 * execute (measured: POST /v1/events/trust returns 204 while POST /styles.css
 * returns Cloudflare's generic 405, and /v1/public/* returns partner-api JSON
 * rather than text/html), but the usage ingress belongs behind its own
 * deployment boundary with its own D1 binding and its own secret.
 *
 * Privacy posture (new18 §20): the request IP, User-Agent, and every other
 * connection attribute are read only for rate limiting and are never persisted.
 * Installation IDs are HMAC'd at ingestion and the raw value is discarded. No
 * raw event log is written — batches fold into daily counters.
 */
import { aggregate, type HashedEvent } from "./aggregate.js"
import { hashInstallationId } from "./hash.js"
import { enforceRetention } from "./retention.js"
import { MAX_REQUEST_BYTES, validateBatch } from "./validate.js"

export interface Env {
  USAGE_DB: D1Database
  /** Worker secret. Never committed, never logged, never rendered (new18 §20). */
  USAGE_HASH_KEY: string
  /** Optional: bound in production to rate limit by IP. */
  USAGE_RATE_LIMIT?: KVNamespace
}

const ERROR_SCHEMA = "calllint.usage-api.error.v0"

/** Requests per IP per minute. Generous — a CLI flushes rarely (new18 §19). */
const RATE_LIMIT_PER_MINUTE = 60

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      // No CORS headers: this ingress is for the CLI, not for browsers. Omitting
      // them means a page on another origin cannot read a response, so the
      // endpoint cannot be turned into a cross-origin oracle.
    },
  })

const errorResponse = (status: number, code: string, message: string): Response =>
  json(status, { schema: ERROR_SCHEMA, code, message })

/**
 * Fixed-window rate limit keyed on the hashed IP. The IP is hashed with the same
 * secret before it becomes a KV key so that the rate-limit namespace itself
 * cannot be mined for a list of addresses that talked to the endpoint.
 *
 * Fails OPEN: if KV is unavailable the request proceeds. A rate limiter that
 * takes the ingress down when its own dependency is degraded costs more than the
 * abuse it prevents, and no security decision rests on this counter.
 */
async function isRateLimited(request: Request, env: Env): Promise<boolean> {
  if (!env.USAGE_RATE_LIMIT) return false
  const ip = request.headers.get("CF-Connecting-IP")
  if (!ip) return false
  try {
    const minute = Math.floor(Date.now() / 60_000)
    const hashedIp = (await hashInstallationId(ip, env.USAGE_HASH_KEY)).slice(0, 32)
    const key = `rl:${minute}:${hashedIp}`
    const current = Number((await env.USAGE_RATE_LIMIT.get(key)) ?? "0")
    if (current >= RATE_LIMIT_PER_MINUTE) return true
    // expirationTtl floor is 60s; two minutes covers the window plus skew.
    await env.USAGE_RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 120 })
    return false
  } catch {
    return false
  }
}

/**
 * Read the body with a hard byte cap (new18 §19: bounded request bytes).
 * `Content-Length` is attacker-controlled, so it is used only as a cheap early
 * reject; the real enforcement counts the bytes actually read.
 */
async function readBoundedText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null

  const body = request.body
  if (!body) return ""

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

async function handleUsagePost(request: Request, env: Env): Promise<Response> {
  if (!env.USAGE_HASH_KEY) {
    // Fail closed rather than storing reversible or unkeyed hashes.
    return errorResponse(503, "not_configured", "Ingress is not configured.")
  }
  if (await isRateLimited(request, env)) {
    return errorResponse(429, "rate_limited", "Too many requests.")
  }

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse(415, "unsupported_media_type", "Content-Type must be application/json.")
  }

  const text = await readBoundedText(request)
  if (text === null) {
    return errorResponse(413, "payload_too_large", "Request body exceeds the size limit.")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return errorResponse(400, "invalid_json", "Body is not valid JSON.")
  }

  const result = validateBatch(parsed)
  if (!result.ok) {
    return errorResponse(400, result.code, result.message)
  }
  const { batchId, events } = result.batch

  // Idempotency: a replay is ACKed so the client clears its queue, but folded in
  // exactly once. The CLI derives batchId from content and only calls
  // removeDelivered() on a 2xx, so a retried batch after a lost response is the
  // ordinary case, not an attack.
  const seen = await env.USAGE_DB.prepare(
    "SELECT 1 FROM usage_ingested_batches WHERE batch_id = ?",
  )
    .bind(batchId)
    .first()
  if (seen) return new Response(null, { status: 204 })

  // Hash every installation ID, then drop the raw values (new18 §20). The map is
  // keyed by raw ID so repeated IDs in one batch hash once.
  const hashes = new Map<string, string>()
  for (const event of events) {
    const raw = event.anonymousInstallationId
    if (raw && !hashes.has(raw)) {
      hashes.set(raw, await hashInstallationId(raw, env.USAGE_HASH_KEY))
    }
  }
  const hashed: HashedEvent[] = events.map((event) => ({
    event,
    installationHash: event.anonymousInstallationId
      ? hashes.get(event.anonymousInstallationId)
      : undefined,
  }))

  const { counts, installations } = aggregate(hashed)
  const receivedDay = new Date().toISOString().slice(0, 10)

  // One transaction. The batch ledger insert is included, so a failure anywhere
  // leaves the batch un-ledgered and the client's retry folds it in cleanly —
  // rather than marking it delivered with its counters half-applied.
  const statements = [
    env.USAGE_DB.prepare(
      "INSERT INTO usage_ingested_batches (batch_id, received_day) VALUES (?, ?)",
    ).bind(batchId, receivedDay),

    ...counts.map((row) =>
      env.USAGE_DB.prepare(
        `INSERT INTO usage_daily_counts
           (day, event_name, source, host_family, input_kind, product_version, discovery_surface, count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, event_name, source, host_family, input_kind, product_version, discovery_surface)
         DO UPDATE SET count = count + excluded.count`,
      ).bind(
        row.day,
        row.eventName,
        row.source,
        row.hostFamily,
        row.inputKind,
        row.productVersion,
        row.discoverySurface,
        row.count,
      ),
    ),

    ...installations.map((row) =>
      env.USAGE_DB.prepare(
        `INSERT INTO usage_daily_installations
           (day, installation_hash, preflights, attention)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (day, installation_hash)
         DO UPDATE SET preflights = preflights + excluded.preflights,
                       attention  = attention  + excluded.attention`,
      ).bind(row.day, row.installationHash, row.preflights, row.attention),
    ),
  ]

  try {
    await env.USAGE_DB.batch(statements)
  } catch {
    // Never echo the database error: it can carry schema detail, and the client
    // has nothing to do with it but retry.
    return errorResponse(500, "ingest_failed", "Could not record the batch.")
  }

  return new Response(null, { status: 204 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname !== "/v1/events/usage") {
      return errorResponse(404, "not_found", "Unknown route.")
    }
    if (request.method === "OPTIONS" || request.method === "HEAD") {
      return new Response(null, { status: 405, headers: { allow: "POST" } })
    }
    if (request.method !== "POST") {
      return errorResponse(405, "method_not_allowed", "This endpoint accepts POST only.")
    }

    return handleUsagePost(request, env)
  },

  /**
   * Cron trigger — retention only (new18 §21). Deliberately does nothing else:
   * the report is generated by a GitHub workflow, so this Worker's scheduled
   * path has no reason to touch the network.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await enforceRetention(env, new Date())
  },
}
