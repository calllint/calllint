/**
 * Telemetry sinks — where a sanitized event GOES once the gate allows it.
 *
 * The sink is an injected abstraction so the emitter never hard-codes a destination.
 * TWO sinks ship, and NEITHER touches the network:
 *   - `noopSink` — the DEFAULT. Discards. Nothing leaves the process. This is what a
 *     surface gets unless it deliberately wires a real sink, so "wired but silent" is
 *     the safe resting state.
 *   - `jsonlFileSink` — appends one JSON line per event to a local file (e.g. under the
 *     project's `.calllint/`), so a user can SEE exactly what would be sent. Pure fs.
 *
 * A NETWORK sink is deliberately NOT provided here: phoning home is a separate,
 * explicitly-authorized decision, and `security-boundary.yml` asserts this package
 * imports no network module. A future transport must live behind this same interface.
 */
import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { SanitizedEvent } from "@calllint/telemetry-contract"

/** A destination for sanitized events. Implementations must never throw to the caller. */
export interface TelemetrySink {
  readonly kind: string
  write(event: SanitizedEvent): void
}

/** The default sink: discard. Nothing is stored, nothing is sent. */
export const noopSink: TelemetrySink = {
  kind: "noop",
  write() {
    /* intentionally empty — the safe default */
  },
}

/**
 * Append sanitized events as JSON Lines to a local file. Best-effort: a write failure
 * is swallowed (telemetry must never break the caller). Creates the parent dir once.
 */
export function jsonlFileSink(filePath: string): TelemetrySink {
  let dirEnsured = false
  return {
    kind: "jsonl-file",
    write(event: SanitizedEvent): void {
      try {
        if (!dirEnsured) {
          mkdirSync(dirname(filePath), { recursive: true })
          dirEnsured = true
        }
        appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8")
      } catch {
        /* best-effort: never surface a telemetry write error to the caller */
      }
    },
  }
}

/** A sink that records events in memory — for tests and previews. Never persists. */
export function memorySink(): TelemetrySink & { readonly events: SanitizedEvent[] } {
  const events: SanitizedEvent[] = []
  return {
    kind: "memory",
    events,
    write(event: SanitizedEvent): void {
      events.push(event)
    },
  }
}
