/**
 * Event sanitization — the structural privacy guarantee (new11 §3.5).
 *
 * `sanitizeEvent` NEVER copies an input object through. It reads only the known
 * safe fields by name and BUILDS a fresh event from that allowlist, so a
 * forbidden or unknown field is structurally incapable of reaching output. If a
 * forbidden field is even PRESENT on the input it throws — fail closed, loud, so
 * a caller can't accidentally normalize away a leak (mirrors the engine's
 * "missing signal ≠ clean" stance). Aggregate-only: raw durations collapse to
 * buckets; no timestamps finer than ISO seconds are required.
 */
import {
  ALLOWED_EVENTS,
  EVENT_VERSION,
  FORBIDDEN_FIELDS,
  RESULTS,
  SOURCES,
  type TelemetryEventName,
  type TelemetryResult,
  type TelemetrySource,
} from "./events.js"

export interface RawEventInput {
  eventName: string
  source: string
  timestamp?: string
  hostFamily?: string
  result?: string
  durationMs?: number
  inputKind?: string
  anonymousInstallationId?: string
  productVersion?: string
  [k: string]: unknown
}

export interface SanitizedEvent {
  eventVersion: string
  eventName: TelemetryEventName
  timestamp: string
  source: TelemetrySource
  hostFamily?: string
  result?: TelemetryResult
  durationBucket?: string
  inputKind?: string
  anonymousInstallationId?: string
  productVersion?: string
}

/** Collapse a raw millisecond duration into a coarse, non-identifying bucket. */
export function bucketDuration(ms: number | undefined): string | undefined {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 100) return "<100ms"
  if (ms < 500) return "100-500ms"
  if (ms < 2000) return "500-2000ms"
  return ">2000ms"
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0

/**
 * Validate + sanitize a raw event into the closed contract shape.
 * @throws if a forbidden field is present, or event/source/result is off-vocabulary.
 */
export function sanitizeEvent(input: RawEventInput): SanitizedEvent {
  // Fail closed: a forbidden field must never be silently dropped.
  for (const f of FORBIDDEN_FIELDS) {
    if (f in input) {
      throw new Error(`telemetry: forbidden field "${f}" present on event — refusing to sanitize`)
    }
  }

  if (!(ALLOWED_EVENTS as readonly string[]).includes(input.eventName)) {
    throw new Error(`telemetry: unknown eventName "${input.eventName}"`)
  }
  if (!(SOURCES as readonly string[]).includes(input.source)) {
    throw new Error(`telemetry: unknown source "${input.source}"`)
  }
  if (input.result != null && !(RESULTS as readonly string[]).includes(input.result)) {
    throw new Error(`telemetry: unknown result "${input.result}"`)
  }

  // Allowlist construction: ONLY these fields can ever appear in output.
  const out: SanitizedEvent = {
    eventVersion: EVENT_VERSION,
    eventName: input.eventName as TelemetryEventName,
    timestamp: isNonEmptyString(input.timestamp) ? input.timestamp : "",
    source: input.source as TelemetrySource,
  }
  if (isNonEmptyString(input.hostFamily)) out.hostFamily = input.hostFamily
  if (input.result != null) out.result = input.result as TelemetryResult
  const bucket = bucketDuration(input.durationMs)
  if (bucket) out.durationBucket = bucket
  if (isNonEmptyString(input.inputKind)) out.inputKind = input.inputKind
  if (isNonEmptyString(input.anonymousInstallationId)) {
    out.anonymousInstallationId = input.anonymousInstallationId
  }
  if (isNonEmptyString(input.productVersion)) out.productVersion = input.productVersion
  return out
}
