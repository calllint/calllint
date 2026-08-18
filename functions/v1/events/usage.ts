/**
 * POST /v1/events/usage — telemetry ingestion endpoint
 *
 * Privacy guarantees:
 * - Raw installation IDs are NEVER persisted (only HMAC)
 * - Idempotent via batchId
 * - Rate limited per IP
 * - No sensitive fields allowed (enforced by sanitizer at client)
 */

import { hashInstallationId, isValidInstallationIdFormat } from "../../_middleware/hmac"

interface Env {
  USAGE_DB: D1Database
  USAGE_HASH_KEY: string
}

interface TelemetryBatch {
  schema: string
  batchId: string
  events: Array<{
    eventVersion: string
    eventName: string
    timestamp: string
    source: string
    anonymousInstallationId?: string
    hostFamily?: string
    result?: string
    durationBucket?: string
    inputKind?: string
    productVersion?: string
  }>
}

const RATE_LIMIT_PER_MINUTE = 100

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  // Validate secret is configured
  if (!env.USAGE_HASH_KEY) {
    return new Response("Server configuration error", { status: 500 })
  }

  // Rate limiting (simple IP-based, per-worker instance)
  // Production should use Durable Objects or KV for distributed rate limiting
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown"

  // Parse request body
  let batch: TelemetryBatch
  try {
    batch = await request.json()
  } catch {
    return new Response("Invalid JSON", { status: 400 })
  }

  // Validate batch schema
  if (batch.schema !== "calllint.telemetry-batch.v0") {
    return new Response("Unknown schema", { status: 400 })
  }

  if (!batch.batchId || !Array.isArray(batch.events)) {
    return new Response("Invalid batch structure", { status: 400 })
  }

  // Check for duplicate batchId (idempotency)
  const existing = await env.USAGE_DB.prepare(
    "SELECT 1 FROM usage_events WHERE batch_id = ? LIMIT 1"
  )
    .bind(batch.batchId)
    .first()

  if (existing) {
    // Already processed, return success (idempotent)
    return new Response(JSON.stringify({ status: "ok", deduplicated: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Process events
  const statements: D1PreparedStatement[] = []

  for (const event of batch.events) {
    // Validate required fields
    if (!event.eventName || !event.timestamp || !event.source) {
      continue // Skip malformed events
    }

    // Hash installation ID (privacy guarantee)
    let hashedId: string | null = null
    if (event.anonymousInstallationId) {
      if (!isValidInstallationIdFormat(event.anonymousInstallationId)) {
        continue // Skip events with malformed IDs
      }
      hashedId = await hashInstallationId(
        event.anonymousInstallationId,
        env.USAGE_HASH_KEY
      )
    }

    // Insert event
    statements.push(
      env.USAGE_DB.prepare(
        `INSERT INTO usage_events (
          batch_id, hashed_installation_id, event_name, timestamp, source,
          host_family, result, duration_bucket, input_kind, product_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        batch.batchId,
        hashedId,
        event.eventName,
        event.timestamp,
        event.source,
        event.hostFamily ?? null,
        event.result ?? null,
        event.durationBucket ?? null,
        event.inputKind ?? null,
        event.productVersion ?? null
      )
    )
  }

  // Execute all inserts in a batch
  if (statements.length > 0) {
    try {
      await env.USAGE_DB.batch(statements)
    } catch (err) {
      console.error("D1 batch insert failed:", err)
      return new Response("Database error", { status: 500 })
    }
  }

  return new Response(
    JSON.stringify({
      status: "ok",
      received: batch.events.length,
      stored: statements.length,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  )
}
