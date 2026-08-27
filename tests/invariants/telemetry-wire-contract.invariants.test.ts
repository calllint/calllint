/**
 * The crossing guard: does what the CLI SENDS pass what the worker ACCEPTS?
 *
 * Both sides were fully tested and both were green while no published CLI could deliver a
 * single event. Each suite pinned its own belief and neither could observe the other:
 *
 *   apps/cli/test/telemetry-queue.test.ts   asserted batchId matches /^[0-9a-f]{32}$/
 *   apps/usage-worker/test/validate.test.ts required /^[0-9a-f]{64}$/
 *
 *   client fixtures used `timestamp: ""`   (blessing the sanitizer's default)
 *   worker fixtures used a real ISO instant (never seeing "")
 *
 * Two contradictions, both invisible, because nothing imported both halves. This file is
 * the only test that does. It must import the REAL producer and the REAL validator — never
 * a restatement of either constant, or it rejoins the class of guard it exists to replace.
 */
import { describe, it, expect } from "vitest"
import { createBatch } from "../../apps/cli/src/queue.js"
import { validateBatch } from "../../apps/usage-worker/src/validate.js"
import { sanitizeEvent } from "../../packages/telemetry-contract/src/index.js"
import { buildCliEmitter } from "../../apps/cli/src/telemetry.js"
import type { SanitizedEvent } from "../../packages/telemetry-contract/src/index.js"

const RUN_AT = "2026-08-27T09:30:00Z"

describe("telemetry wire contract: CLI producer → worker validator", () => {
  it("accepts a batch built from a sanitized event the CLI actually emits", () => {
    const event = sanitizeEvent({
      eventName: "preflight_completed",
      source: "cli",
      timestamp: RUN_AT,
      anonymousInstallationId: "cli-anon-12345678-1234-1234-1234-123456789abc",
      productVersion: "9.9.9",
    })
    const result = validateBatch(createBatch([event]))
    expect(result.ok, `worker rejected the CLI's own batch: ${JSON.stringify(result)}`).toBe(
      true,
    )
  })

  it("accepts the batch the emitter produces end to end, timestamp included", () => {
    const written: SanitizedEvent[] = []
    const emitter = buildCliEmitter(
      {},
      {
        consented: true,
        sink: {
          kind: "test-capture",
          write: (e: SanitizedEvent) => {
            written.push(e)
          },
        },
        installationId: "cli-anon-12345678-1234-1234-1234-123456789abc",
        generatedAt: RUN_AT,
      },
    )
    // No `timestamp` on the input — exactly how `emitCommandSignal` calls it. The stamp
    // must come from the emitter, which is the defect this asserts against.
    emitter.emit({ eventName: "decision_safe", result: "SAFE", productVersion: "9.9.9" })

    expect(written).toHaveLength(1)
    expect(written[0]?.timestamp, "emitter left the timestamp empty").not.toBe("")

    const result = validateBatch(createBatch(written))
    expect(result.ok, `worker rejected an emitted event: ${JSON.stringify(result)}`).toBe(true)
  })

  it("fails loudly on an unstamped event — the negative control", () => {
    // Proof this file can fail: an event with the sanitizer's default timestamp is exactly
    // what every published CLI sent, and the worker must refuse it. If this ever passes,
    // the validator stopped checking and the guard above became decorative.
    const unstamped = sanitizeEvent({ eventName: "preflight_completed", source: "cli" })
    expect(unstamped.timestamp).toBe("")
    const result = validateBatch(createBatch([unstamped]))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe("invalid_timestamp")
  })

  it("fails loudly on a truncated batchId — the other negative control", () => {
    const event = sanitizeEvent({
      eventName: "preflight_completed",
      source: "cli",
      timestamp: RUN_AT,
    })
    const good = createBatch([event])
    const truncated = { ...good, batchId: good.batchId.slice(0, 32) }
    const result = validateBatch(truncated)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe("invalid_batch_id")
  })
})
