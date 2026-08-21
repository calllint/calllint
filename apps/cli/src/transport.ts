/**
 * Network transport for telemetry batches.
 * Best-effort delivery with strict timeout and failure isolation.
 */

import type { TelemetryBatch } from "./queue.js"

/**
 * Endpoint URL for telemetry ingestion.
 *
 * `telemetry.calllint.com` is a dedicated Worker (apps/usage-worker), not the
 * static website. The previous default — `calllint.com/v1/events/usage` — was
 * never routed: `apps/web/public/_routes.json` does not include that path, so
 * requests were served the static site instead of reaching a handler.
 */
const TELEMETRY_ENDPOINT =
  process.env.CALLLINT_TELEMETRY_ENDPOINT ??
  "https://telemetry.calllint.com/v1/events/usage"

/** Network timeout (milliseconds). */
const TIMEOUT_MS = 5000

/** Maximum events per flush. */
const MAX_BATCH_SIZE = 100

/**
 * Flush a batch to the telemetry endpoint.
 * Best-effort: swallows all errors, never throws.
 *
 * @param batch - The batch to send
 * @returns true if delivered successfully, false otherwise
 */
export async function deliverBatch(batch: TelemetryBatch): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const response = await fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "calllint-cli",
      },
      body: JSON.stringify(batch),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // 2xx = success
    return response.ok
  } catch {
    // Network error, timeout, or abort — swallow silently
    return false
  }
}

export { MAX_BATCH_SIZE }
