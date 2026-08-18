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

    // Load queue
    const queuePath = getQueuePath()
    const queue = new TelemetryQueue(queuePath)
    await queue.load()

    const size = await queue.size()
    if (size === 0) return

    // Take up to MAX_BATCH_SIZE events
    const events = await queue.take(MAX_BATCH_SIZE)
    if (events.length === 0) return

    // Create batch and deliver
    const batch = createBatch(events)
    const success = await deliverBatch(batch)

    if (success) {
      // Events already removed by queue.take()
      // Save the queue to persist removal
      await queue.save()
    } else {
      // Delivery failed — put events back at the front
      // (They were already removed by take(), so we reload to restore)
      await queue.load()
    }
  } catch {
    // Any error in flush path is swallowed
  }
}
