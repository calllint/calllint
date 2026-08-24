/**
 * Ingest trust boundary (new18 §19). Every POST is treated as hostile.
 *
 * This module re-implements validation SERVER-SIDE against the same closed
 * vocabulary the client sanitizer uses. That duplication is the point: the
 * client's `sanitizeEvent` runs on the reporter's machine and an attacker
 * controls it completely, so client-side sanitization proves nothing about what
 * arrives here. Both sides import the vocabulary from
 * `@calllint/telemetry-contract`, so they cannot drift apart.
 *
 * Everything here is pure and synchronous — no I/O, no bindings — so it is
 * directly unit-testable without a Worker runtime.
 */
import {
  ALLOWED_EVENTS,
  DISCOVERY_SURFACES,
  FORBIDDEN_FIELDS,
  RESULTS,
  SOURCES,
} from "@calllint/telemetry-contract"

/** Hard cap on batch size, matching the CLI's MAX_BATCH_SIZE (new18 §19). */
export const MAX_EVENTS_PER_BATCH = 100

/**
 * Hard cap on request bytes (new18 §19: "bounded request bytes"). 100 events of
 * the contract shape run well under 32 KB; 64 KB leaves generous headroom while
 * keeping a single request from being used as a memory amplifier.
 */
export const MAX_REQUEST_BYTES = 64 * 1024

/** Longest accepted value for any free-text-ish dimension field. */
const MAX_FIELD_LENGTH = 64

/** The only batch envelope this ingress accepts (matches the CLI's TelemetryBatch). */
export const BATCH_SCHEMA = "calllint.telemetry-batch.v0"

/** `batchId` is a client-computed SHA-256 hex digest over the serialized events. */
const BATCH_ID_PATTERN = /^[0-9a-f]{64}$/

/**
 * Installation IDs are `cli-anon-<uuid v4-shaped>`. Duplicated from the
 * contract's `isValidInstallationIdFormat` rather than imported because this
 * must hold even if that helper is ever relaxed for client-side ergonomics.
 */
const INSTALLATION_ID_PATTERN =
  /^cli-anon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Dimension values must be short, plain tokens: `claude-desktop`, `config`,
 * `1.8.0`, `1.8.0-rc.1+build`.
 *
 * `/` and `@` are deliberately EXCLUDED. With `/` allowed, a filesystem path
 * (`/Users/alice/project/.cursor/mcp.json`) matched and would have been stored
 * as a `hostFamily` — and new18 §20 names "config path" in the never-persist
 * list. No dimension here is a path or a scoped package name, so neither
 * character has a legitimate use.
 */
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/

/** An event after server-side validation. Only these fields survive. */
export interface ValidatedEvent {
  eventName: string
  source: string
  timestamp: string
  hostFamily: string
  inputKind: string
  productVersion: string
  /**
   * Discovery provenance, "" when the client did not state one. A STORED dimension,
   * so it is enum-checked rather than token-checked — see the rejection below.
   */
  discoverySurface: string
  result?: string
  /** Raw ID — hashed and discarded by the caller; never persisted (new18 §20). */
  anonymousInstallationId?: string
}

export interface ValidatedBatch {
  batchId: string
  events: ValidatedEvent[]
}

export type ValidationResult =
  | { ok: true; batch: ValidatedBatch }
  | { ok: false; code: string; message: string }

const fail = (code: string, message: string): ValidationResult => ({
  ok: false,
  code,
  message,
})

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Accept an ISO-8601 timestamp and normalize it to whole seconds in UTC.
 * A malformed or absurd timestamp is rejected rather than silently replaced
 * with `now`: a client that cannot state when something happened should not
 * have that gap filled in by the server, because the day bucket is derived
 * from it. Bounds reject clock-skew garbage that would create bogus day rows.
 */
function normalizeTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 40) return null
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) return null
  const year = new Date(ms).getUTCFullYear()
  if (year < 2024 || year > 2100) return null
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
}

/** Coerce an optional dimension into a bounded safe token, or "" if absent. */
function normalizeDimension(raw: unknown): string | null {
  if (raw == null || raw === "") return ""
  if (typeof raw !== "string") return null
  if (raw.length > MAX_FIELD_LENGTH) return null
  if (!SAFE_TOKEN_PATTERN.test(raw)) return null
  return raw
}

/**
 * Validate a parsed request body into a batch that is safe to fold into D1.
 *
 * Rejects the whole batch on the first invalid event rather than dropping the
 * bad ones: a partially-accepted batch would be acknowledged, the client would
 * clear its queue, and the dropped events would vanish with no signal. All or
 * nothing keeps the client's retry semantics honest.
 */
export function validateBatch(body: unknown): ValidationResult {
  if (!isRecord(body)) return fail("invalid_body", "Body must be a JSON object.")

  const { batchId, events } = body
  if (body.schema !== BATCH_SCHEMA) {
    return fail("invalid_schema", `schema must be "${BATCH_SCHEMA}".`)
  }
  if (typeof batchId !== "string" || !BATCH_ID_PATTERN.test(batchId)) {
    return fail("invalid_batch_id", "batchId must be a 64-character hex digest.")
  }
  if (!Array.isArray(events)) return fail("invalid_events", "events must be an array.")
  if (events.length === 0) return fail("empty_batch", "events must not be empty.")
  if (events.length > MAX_EVENTS_PER_BATCH) {
    return fail("batch_too_large", `events must contain at most ${MAX_EVENTS_PER_BATCH} items.`)
  }

  const validated: ValidatedEvent[] = []

  for (const [index, candidate] of events.entries()) {
    if (!isRecord(candidate)) {
      return fail("invalid_event", `events[${index}] must be an object.`)
    }

    // Fail closed on a forbidden field, exactly as the client sanitizer does.
    // Presence alone is fatal — never silently strip, or a leak becomes invisible.
    for (const forbidden of FORBIDDEN_FIELDS) {
      if (forbidden in candidate) {
        return fail("forbidden_field", `events[${index}] carries forbidden field "${forbidden}".`)
      }
    }

    const { eventName, source, result } = candidate
    if (typeof eventName !== "string" || !(ALLOWED_EVENTS as readonly string[]).includes(eventName)) {
      return fail("unknown_event_name", `events[${index}] has an off-vocabulary eventName.`)
    }
    if (typeof source !== "string" || !(SOURCES as readonly string[]).includes(source)) {
      return fail("unknown_source", `events[${index}] has an off-vocabulary source.`)
    }
    if (result != null && (typeof result !== "string" || !(RESULTS as readonly string[]).includes(result))) {
      return fail("unknown_result", `events[${index}] has an off-vocabulary result.`)
    }

    const timestamp = normalizeTimestamp(candidate.timestamp)
    if (timestamp === null) {
      return fail("invalid_timestamp", `events[${index}] has a missing or unparseable timestamp.`)
    }

    const hostFamily = normalizeDimension(candidate.hostFamily)
    const inputKind = normalizeDimension(candidate.inputKind)
    const productVersion = normalizeDimension(candidate.productVersion)
    if (hostFamily === null || inputKind === null || productVersion === null) {
      return fail("invalid_dimension", `events[${index}] has an invalid dimension value.`)
    }

    /*
     * ENUM-CHECKED, NOT TOKEN-CHECKED, and that difference is the point.
     *
     * `hostFamily` / `inputKind` / `productVersion` are open-ended by nature — a new
     * host or a new version string is legitimate and unknowable in advance — so a
     * bounded safe token is the strongest available check. `discoverySurface` has a
     * closed six-member vocabulary, so accepting any safe token would let a hostile
     * client mint unbounded distinct values, and every distinct value is a NEW PRIMARY
     * KEY in usage_daily_counts. That is row-count amplification on a table whose whole
     * privacy argument is that a row is a coarse aggregate: 100 events per batch could
     * become 100 one-count rows. Bounding the vocabulary bounds the key space.
     */
    const rawSurface = candidate.discoverySurface
    let discoverySurface = ""
    if (rawSurface != null && rawSurface !== "") {
      if (
        typeof rawSurface !== "string" ||
        !(DISCOVERY_SURFACES as readonly string[]).includes(rawSurface)
      ) {
        return fail("unknown_discovery_surface", `events[${index}] has an off-vocabulary discoverySurface.`)
      }
      discoverySurface = rawSurface
    }

    const rawId = candidate.anonymousInstallationId
    let installationId: string | undefined
    if (rawId != null && rawId !== "") {
      if (typeof rawId !== "string" || !INSTALLATION_ID_PATTERN.test(rawId)) {
        return fail("invalid_installation_id", `events[${index}] has a malformed installation ID.`)
      }
      installationId = rawId
    }

    validated.push({
      eventName,
      source,
      timestamp,
      hostFamily,
      inputKind,
      productVersion,
      discoverySurface,
      ...(result != null ? { result: result as string } : {}),
      ...(installationId ? { anonymousInstallationId: installationId } : {}),
    })
  }

  return { ok: true, batch: { batchId, events: validated } }
}

/** The day bucket (UTC) an event folds into. */
export const dayOf = (timestamp: string): string => timestamp.slice(0, 10)

/**
 * Events that count as "need attention" (new18 §23): REVIEW + BLOCK + UNKNOWN.
 * Deliberately NOT called "threats blocked" — these are verdicts requiring human
 * confirmation, not proof that an attack was stopped (new18 §23).
 */
const ATTENTION_RESULTS = new Set(["REVIEW", "BLOCK", "UNKNOWN"])
export const isAttention = (event: ValidatedEvent): boolean =>
  event.result != null && ATTENTION_RESULTS.has(event.result)

/** A preflight is the unit of observed usage (new18 §22). */
export const isPreflight = (event: ValidatedEvent): boolean =>
  event.eventName === "preflight_completed"
