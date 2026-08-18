/**
 * Event capture — record CLI operations into telemetry events.
 * All capture functions are best-effort and never throw.
 */

import { TelemetryQueue } from "./queue.js"
import { loadState } from "./state.js"
import { getQueuePath } from "./paths.js"
import type { SanitizedEvent } from "@calllint/telemetry-contract"

/**
 * Capture a scan-complete event.
 * Maps to existing telemetry contract's "preflight_completed" event.
 */
export async function captureScanComplete(payload: {
  configSource: "file" | "inline" | "env" | "unknown"
  serverCount: number
  verdictDistribution: Record<string, number>
  hadPolicyFile: boolean
  scanDurationMs: number
}): Promise<void> {
  try {
    const state = await loadState()
    if (!state.telemetryEnabled || !state.anonymousInstallationId) return

    // Map to existing contract event shape
    const event: SanitizedEvent = {
      eventVersion: "1.0.0",
      eventName: "preflight_completed",
      timestamp: new Date().toISOString(),
      source: "cli",
      anonymousInstallationId: state.anonymousInstallationId,
      // Store verdict distribution in inputKind as JSON (aggregate-only)
      inputKind: `servers:${payload.serverCount}`,
      durationBucket: bucketDuration(payload.scanDurationMs),
    }

    const queue = new TelemetryQueue(getQueuePath())
    await queue.load()
    await queue.push(event)
    await queue.save()
  } catch {
    // Best-effort, never throw
  }
}

/** Collapse duration into existing contract buckets. */
function bucketDuration(ms: number): string {
  if (ms < 100) return "<100ms"
  if (ms < 500) return "100-500ms"
  if (ms < 2000) return "500-2000ms"
  return ">2000ms"
}
