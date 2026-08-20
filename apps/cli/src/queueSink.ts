/**
 * The queue-backed CLI sink — the seam between the SYNC emitter and the ASYNC queue.
 *
 * `TelemetrySink.write` is synchronous by contract (a command must never await a
 * side-channel), while the queue is fs-backed and async. This sink therefore BUFFERS in
 * memory during the command and persists once, at the flush point, via `drainTo`.
 *
 * Why buffer instead of writing per event:
 *   - One fs write per run instead of one per event. A `scan-all` over 20 surfaces emits
 *     40 signals; per-event persistence would mean 40 read-modify-write cycles of the
 *     same file, each re-reading what the last one wrote.
 *   - `push()` re-loads and re-saves the whole queue, so per-event writes are O(n²) in
 *     bytes for a single run.
 *   - Nothing is lost by deferring: the flush point runs after the command completes and
 *     before the process exits, in the same `try` that already guards the flush.
 *
 * This sink lives in `apps/cli`, NOT in `packages/telemetry-emit`, on purpose:
 * `check-telemetry-boundary.mjs` asserts the telemetry packages import no fs/network
 * module, and that boundary is what keeps `@calllint/telemetry-emit` importable by
 * anything without dragging in a writer. The package defines the interface; the app
 * supplies the destination.
 */
import type { SanitizedEvent } from "@calllint/telemetry-contract"
import type { TelemetrySink } from "@calllint/telemetry-emit"
import { TelemetryQueue } from "./queue.js"

export interface QueueSink extends TelemetrySink {
  /** How many events are buffered and not yet persisted. */
  readonly pending: number
  /** Persist the buffer into `queue`, oldest first, then clear it. Never throws. */
  drainTo(queue: TelemetryQueue): Promise<void>
}

/**
 * A sink that accumulates sanitized events in memory for one CLI run.
 *
 * Holds only events the gate already ALLOWED and the sanitizer already shaped — it does
 * no filtering of its own, by design: a sink that re-decided consent would be a second
 * policy site, and two policy sites disagree eventually.
 */
export function queueSink(): QueueSink {
  const buffer: SanitizedEvent[] = []
  return {
    kind: "cli-queue",
    get pending(): number {
      return buffer.length
    },
    write(event: SanitizedEvent): void {
      buffer.push(event)
    },
    async drainTo(queue: TelemetryQueue): Promise<void> {
      if (buffer.length === 0) return
      // Splice first: the buffer is cleared even if a push fails, so a persistent fs
      // error cannot make the same events accumulate across a long-lived process.
      const events = buffer.splice(0, buffer.length)
      try {
        // ONE read-modify-write for the whole buffer. Pushing per event re-read and
        // re-wrote the entire file each time, which made persisting a run quadratic in the
        // queue length — the very cost this sink's buffering exists to avoid.
        await queue.pushMany(events)
      } catch {
        // Best-effort: a queue write failure must never surface to the caller.
      }
    },
  }
}
