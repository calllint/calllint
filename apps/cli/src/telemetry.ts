/**
 * CLI telemetry seam (new11 §3.5 / M1) — consent-gated, and NOT YET RELEASED.
 *
 * This is the one place the CLI touches telemetry. Two states must be held apart here,
 * because this header previously described only the first and had silently expired:
 *
 *   AT HEAD: `index.ts` builds the emitter with `consented` read from the state file
 *   and a `queueSink()`, and `flushTelemetry()` POSTs to telemetry.calllint.com. The
 *   plumbing is real. It still fails closed — absent an explicit `telemetry enable`,
 *   `telemetryEnabled` is false, `emit()` returns `gated`, and nothing is written.
 *
 *   AS PUBLISHED: this converged with HEAD in **1.9.0** (2026-08-27). Until then it did
 *   not, and the gap is kept here because it is the reason O-1 exists: `calllint@1.8.0`
 *   (npm, 2026-08-18) contained NO network sink, no `telemetry` command, and no
 *   `telemetryEnabled` — measured against the real tarball on 2026-08-27 (0 hits for
 *   each, control `calllint` 312 hits). The wiring landed in a0076ff (#325, 2026-08-21),
 *   three days after that publish, and for nine days no release was cut, so for every
 *   user the seam was "wired, dark" and `no telemetry ingested yet` described the world
 *   correctly rather than reporting a fault. From 1.9.0 onward it no longer does: the
 *   delivery path ships, so a continued absence of ingest is a finding, not an
 *   explanation. Re-measure against the tarball before trusting this paragraph again —
 *   the previous version of it expired silently, which is why the split exists.
 *
 * Do not read either state off the other. "No network sink ships" is true of the
 * published artifact and false of this file's own directory at HEAD.
 *
 * Either way, scan/integrate/guard/trust output is **byte-for-byte identical** whether
 * or not telemetry is wired — the privacy/verdict-decoupling invariant (new11 §1.5).
 *
 * POLICY, DECIDED 2026-08-27: first-run consent on an interactive TTY (`consent.ts`).
 * The prompt runs after the command's output is written, asks once, and persists the
 * answer either way; only an explicit affirmative turns collection on. It is silent in
 * CI, when piped, under `CALLLINT_TELEMETRY=<disable>`, and in `--json`/`--sarif`.
 *
 * That keeps both constraints intact rather than trading one away: new11 §2.6 fixes
 * `local CLI = opt-in default-off`, and the Blueprint's non-goal #15 forbids "collecting
 * private local CLI telemetry by default". Silence is never consent here, so neither is
 * violated. A default-ON posture still is, and would need an ADR reversing that non-goal.
 *
 * Consent takes effect from the NEXT invocation: the emitter is built from the state file
 * before the prompt exists, so the run that asks emits nothing. Retroactively sending
 * events the user had not yet agreed to is the posture #15 names.
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

/**
 * Flatten the per-config telemetry signals out of an aggregate command's child results.
 *
 * The aggregate scan paths (`--auto` / `--changed` / `--agent` / `scan-all`) build an
 * array of single-config results, each already carrying its own signal, and then return
 * one combined result. Without this, every child signal is discarded and a 5-config
 * `--auto` run reports zero events — so observed usage would systematically under-count
 * exactly the multi-config runs the private usage page is meant to measure.
 */
export function collectSignals(
  results: readonly { telemetry?: TelemetrySignal | readonly TelemetrySignal[] }[],
): TelemetrySignal[] {
  const out: TelemetrySignal[] = []
  for (const r of results) {
    if (!r.telemetry) continue
    if (Array.isArray(r.telemetry)) out.push(...r.telemetry)
    else out.push(r.telemetry as TelemetrySignal)
  }
  return out
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
  opts: {
    sink?: Parameters<typeof createEmitter>[0]["sink"]
    consented?: boolean
    /**
     * The stored anonymous installation ID, stamped onto every event this emitter emits.
     * Read from state by the caller — never generated here, so scanning cannot mint an
     * identity as a side effect. Absent ⇒ events carry no id (the sanitizer allows that).
     */
    installationId?: string
    /**
     * The stored discovery surface TYPE (new19 §21), stamped onto every event alongside
     * the id. Read from state by the caller and already validated against the contract
     * vocabulary there — this is the last hop, not a validation point. Absent ⇒ events
     * carry no attribution, which is the common and honest case.
     */
    discoverySurface?: string
  } = {},
): Emitter {
  const base = createEmitter({
    source: "cli",
    env,
    sink: opts.sink,
    consented: opts.consented,
  })
  if (!opts.installationId && !opts.discoverySurface) return base
  // Wrap rather than thread these through every call site: one place decides identity and
  // provenance, and a new emit site cannot forget to attach them. Explicit values on the
  // input still win, so a test can override.
  const id = opts.installationId
  const surface = opts.discoverySurface
  return {
    source: base.source,
    emit(input) {
      return base.emit({
        ...(id ? { anonymousInstallationId: id } : {}),
        ...(surface ? { discoverySurface: surface } : {}),
        ...input,
      })
    },
  }
}

/**
 * Best-effort emit for one command outcome. NEVER throws and NEVER affects the
 * caller — `emit()` is already fail-closed, and this wraps the mapping too so a bad
 * signal can't surface. With the default gated-off emitter this is a no-op.
 */
export function emitCommandSignal(
  emitter: Emitter | undefined,
  signal: TelemetrySignal | readonly TelemetrySignal[] | undefined,
  productVersion: string | undefined,
): void {
  if (!emitter || !signal) return
  // One signal or many, emitted through the SAME path. A multi-config scan
  // (`--auto` / `--changed` / `--agent` / `scan-all`) reaches N verdicts, and the
  // aggregate commands previously returned none of them: their per-config results each
  // carried a `telemetry` field that the aggregate return dropped on the floor. Widening
  // the signal here (rather than adding a second emit site) keeps `run()`'s single
  // central emit point intact.
  const signals = Array.isArray(signal) ? signal : [signal as TelemetrySignal]
  for (const one of signals) {
    try {
      if (!one) continue
      const eventName = eventFor(one)
      if (!eventName) continue
      const input: RawEmitInput = {
        eventName,
        ...(one.verdict ? { result: one.verdict } : {}),
        ...(one.hostFamily ? { hostFamily: one.hostFamily } : {}),
        ...(one.inputKind ? { inputKind: one.inputKind } : {}),
        ...(productVersion ? { productVersion } : {}),
      }
      emitter.emit(input)
    } catch {
      // Telemetry is a side-channel: any fault here must never change CLI behavior.
      // Scoped INSIDE the loop on purpose — one bad signal must not silence the rest.
    }
  }
}

/** Exposed for a test that asserts the map covers exactly the verdict vocabulary. */
export const _VERDICT_EVENT = VERDICT_EVENT
export const _ALLOWED_EVENTS = ALLOWED_EVENTS
