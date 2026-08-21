/**
 * Event capture and flush orchestration.
 * Bridges in-memory events → persistent queue → network delivery.
 */

import { TelemetryQueue, createBatch } from "./queue.js"
import { deliverBatch, MAX_BATCH_SIZE } from "./transport.js"
import { loadState } from "./state.js"
import { getQueuePath } from "./paths.js"

/**
 * Flush pending telemetry events to the backend.
 * Best-effort, non-blocking, never throws.
 *
 * Only flushes when:
 * - Telemetry is enabled
 * - Queue is non-empty
 *
 * Does NOT:
 * - Alter stdout/stderr
 * - Alter exit code
 * - Materially delay CLI execution
 */
export async function flushTelemetry(): Promise<void> {
  try {
    // Check consent
    const state = await loadState()
    if (!state.telemetryEnabled) return

    const queuePath = getQueuePath()
    const queue = new TelemetryQueue(queuePath)

    // PEEK, do not take: the events stay on disk until the server confirms receipt.
    // `peek` re-loads internally, so no separate load()/size() round-trip is needed.
    const events = await queue.peek(MAX_BATCH_SIZE)
    if (events.length === 0) return

    // The batch id is derived from these events, so a retry after an ambiguous failure
    // (timeout AFTER the server committed) presents the same id and can be de-duplicated
    // server-side instead of double-counted.
    const batch = createBatch(events)
    const success = await deliverBatch(batch)

    // Remove ONLY on a confirmed 2xx. On any failure — network error, timeout, 5xx — the
    // queue is untouched, so the events survive for the next run to retry. The previous
    // code removed them before delivery and its "restore" path re-read the file it had
    // already truncated, destroying the batch it claimed to be putting back.
    if (success) {
      await queue.removeDelivered(events.length)
    }
  } catch {
    // Any error in flush path is swallowed
  }
}
