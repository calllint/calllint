/**
 * The emitter — the one wired path from a call site to a sink (new11 §3.5).
 *
 * Every event is forced through the contract's `sanitizeEvent` (allowlist output +
 * fail-closed on a forbidden field) BEFORE it can reach a sink, so a call site can
 * never emit an off-contract or leaky event even by mistake. The gate decides IF;
 * the sanitizer decides WHAT SHAPE; the sink decides WHERE.
 *
 * Best-effort by contract (mirrors the drift-notice + guard): emitting is a
 * side-channel that must NEVER change or break the caller. `emit()` returns a small
 * result describing what happened (emitted / gated / dropped) and NEVER throws — a
 * sanitizer rejection is caught and reported as `dropped`, not propagated. This keeps
 * the privacy invariant intact: with telemetry off (or a bad event), the caller's
 * behavior and output are byte-for-byte identical.
 */
import {
  sanitizeEvent,
  type RawEventInput,
  type SanitizedEvent,
  type TelemetrySource,
} from "@calllint/telemetry-contract"
import { shouldEmit, type GateState } from "./gate.js"
import { noopSink, type TelemetrySink } from "./sink.js"

export interface EmitterConfig {
  /** The emitting surface — selects the tier default (gate.ts). */
  source: TelemetrySource
  /** Where allowed events go. Defaults to `noopSink` (wired but silent). */
  sink?: TelemetrySink
  /** Explicit consent (required for the local `cli` tier). */
  consented?: boolean
  /** Environment for the kill-switch; injected for testability. */
  env?: Record<string, string | undefined>
}

/** What happened to one `emit()` call — for callers/tests that want to assert. */
export type EmitOutcome =
  | { status: "emitted"; event: SanitizedEvent }
  | { status: "gated"; reason: "disabled-or-no-consent" }
  | { status: "dropped"; reason: string }

/**
 * A raw event as a call site supplies it — everything `RawEventInput` allows EXCEPT
 * `source`, which the emitter injects from its config. Declared explicitly (not via
 * `Omit`) because `RawEventInput`'s index signature makes `Omit` drop the required
 * `eventName`.
 */
export interface RawEmitInput {
  eventName: string
  timestamp?: string
  hostFamily?: string
  result?: string
  durationMs?: number
  inputKind?: string
  anonymousInstallationId?: string
  productVersion?: string
  [k: string]: unknown
}

export interface Emitter {
  readonly source: TelemetrySource
  emit(input: RawEmitInput): EmitOutcome
}

/**
 * Build an emitter bound to one source + sink. The sink defaults to `noopSink`, so
 * calling `emit` on a freshly-built emitter stores/sends nothing until a real sink is
 * deliberately injected — the safe resting state.
 */
export function createEmitter(config: EmitterConfig): Emitter {
  const sink = config.sink ?? noopSink
  const gate: GateState = { consented: config.consented, env: config.env }
  return {
    source: config.source,
    emit(input): EmitOutcome {
      if (!shouldEmit(config.source, gate)) {
        return { status: "gated", reason: "disabled-or-no-consent" }
      }
      let event: SanitizedEvent
      try {
        event = sanitizeEvent({ ...input, source: config.source })
      } catch (err) {
        // A forbidden/off-vocabulary field: DROP, never throw to the caller.
        return { status: "dropped", reason: err instanceof Error ? err.message : String(err) }
      }
      sink.write(event)
      return { status: "emitted", event }
    },
  }
}
