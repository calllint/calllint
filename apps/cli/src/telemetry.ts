/**
 * CLI telemetry seam (new11 §3.5 / M1) — wired, DARK by default.
 *
 * This is the one place the CLI touches telemetry. It is deliberately gated OFF
 * for the local `cli` tier: the emitter is built with `consented: false` and the
 * default `noopSink`, so `emit()` returns `gated` and writes nothing. The result is
 * that scan/integrate/guard/trust output is **byte-for-byte identical** whether or
 * not telemetry is wired — the privacy/verdict-decoupling invariant (new11 §1.5).
 *
 * "Wired, dark" means: the plumbing exists and is exercised by tests (with an
 * injected sink), but no real local emission and NO network sink ships. Turning the
 * local tier on requires an explicit first-run consent decision, which is a separate
 * product change deliberately NOT made here.
 *
 * Accuracy note: a command's process exit code does not carry its verdict outside
 * `--ci` (a plain `scan` exits 0 regardless of SAFE/REVIEW/BLOCK/UNKNOWN). So the
 * mapping is driven by an explicit, additive `TelemetrySignal` a command attaches to
 * its own result — never re-derived from the exit code — keeping every event correct.
 */
import {
  createEmitter,
  type Emitter,
  type RawEmitInput,
} from "@calllint/telemetry-emit"
import {
  ALLOWED_EVENTS,
  type TelemetryEventName,
  type TelemetryResult,
} from "@calllint/telemetry-contract"

/**
 * What a command reports about its own outcome, in telemetry-safe terms only.
 * Carries no config, path, command, or evidence text — just an event name (or a
 * verdict to map to a `decision_*` event) plus optional aggregate dimensions.
 * Everything here is on the contract allowlist; the sanitizer is the backstop.
 */
export interface TelemetrySignal {
  /** An explicit allowed event, OR a verdict that maps to `decision_<verdict>`. */
  event?: TelemetryEventName
  verdict?: TelemetryResult
  /** Optional aggregate dimensions (all allowlisted, no free text). */
  hostFamily?: string
  inputKind?: string
}

const VERDICT_EVENT: Record<TelemetryResult, TelemetryEventName> = {
  SAFE: "decision_safe",
  REVIEW: "decision_review",
  BLOCK: "decision_block",
  UNKNOWN: "decision_unknown",
}

/** Resolve a signal to a concrete allowed event name, or null if it maps to none. */
function eventFor(signal: TelemetrySignal): TelemetryEventName | null {
  if (signal.event) return signal.event
  if (signal.verdict) return VERDICT_EVENT[signal.verdict]
  return null
}

/**
 * Build the CLI's telemetry emitter. Local `cli` tier, gated off (no consent), no
 * sink (defaults to noopSink) — the safe resting state. `env` is injected so the
 * universal `CALLLINT_TELEMETRY` kill-switch is honored. A caller may pass a sink
 * (tests) or explicit consent, but production wires neither.
 */
export function buildCliEmitter(
  env: Record<string, string | undefined>,
  opts: { sink?: Parameters<typeof createEmitter>[0]["sink"]; consented?: boolean } = {},
): Emitter {
  return createEmitter({ source: "cli", env, sink: opts.sink, consented: opts.consented })
}

/**
 * Best-effort emit for one command outcome. NEVER throws and NEVER affects the
 * caller — `emit()` is already fail-closed, and this wraps the mapping too so a bad
 * signal can't surface. With the default gated-off emitter this is a no-op.
 */
export function emitCommandSignal(
  emitter: Emitter | undefined,
  signal: TelemetrySignal | undefined,
  productVersion: string | undefined,
): void {
  if (!emitter || !signal) return
  try {
    const eventName = eventFor(signal)
    if (!eventName) return
    const input: RawEmitInput = {
      eventName,
      ...(signal.verdict ? { result: signal.verdict } : {}),
      ...(signal.hostFamily ? { hostFamily: signal.hostFamily } : {}),
      ...(signal.inputKind ? { inputKind: signal.inputKind } : {}),
      ...(productVersion ? { productVersion } : {}),
    }
    emitter.emit(input)
  } catch {
    // Telemetry is a side-channel: any fault here must never change CLI behavior.
  }
}

/** Exposed for a test that asserts the map covers exactly the verdict vocabulary. */
export const _VERDICT_EVENT = VERDICT_EVENT
export const _ALLOWED_EVENTS = ALLOWED_EVENTS
