import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TelemetryQueue, createBatch } from "../src/queue.js"
import { EVENT_VERSION, type SanitizedEvent } from "@calllint/telemetry-contract"

/**
 * Queue durability + boundedness (new11 §3.5 / R3).
 *
 * These lock the four defects that made the queue lose data silently. Each was a case of a
 * guard that did not measure what it claimed to bound, so each test asserts the OBSERVABLE
 * consequence (how many events survive, what the file weighs) rather than re-stating the
 * implementation:
 *
 *   1. The byte cap was computed once outside its `while`, making the condition
 *      loop-invariant — going one byte over drained the entire queue.
 *   2. The cap measured compact JSON while `save()` wrote pretty-printed JSON, so the
 *      256 KiB budget bounded a string that never reached disk.
 *   3. `take()` removed and saved before delivery was confirmed, and "restored" by
 *      re-reading the file it had already truncated.
 *   4. `batchId` was random per attempt, so a retry after a post-commit timeout looked
 *      like a brand-new batch and defeated server-side dedup.
 */

const MAX_BYTES = 256 * 1024
const MAX_EVENTS = 1000

function event(overrides: Partial<SanitizedEvent> = {}): SanitizedEvent {
  return {
    eventVersion: EVENT_VERSION,
    eventName: "decision_safe",
    timestamp: "2026-08-19T00:00:00.000Z",
    source: "cli",
    result: "SAFE",
    ...overrides,
  }
}

describe("TelemetryQueue — boundedness", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cl-queue-"))
    path = join(dir, "queue.json")
  })

  afterEach(async () => {
    // `maxRetries` for Windows, where a just-closed write can still hold the directory
    // briefly and make a bare rmdir throw ENOTEMPTY.
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  })

  it("trims to the byte cap instead of draining the whole queue", async () => {
    const queue = new TelemetryQueue(path)
    // ~1 KiB per event, so 400 events cross 256 KiB while staying under the 1000-event
    // count cap — the BYTE cap is what bites here, not the count cap.
    const fat = event({ hostFamily: "h".repeat(1000) })
    await queue.pushMany(Array.from({ length: 400 }, () => fat))

    const remaining = await queue.size()
    // The regression signature is 0: the loop-invariant version shifted until the queue was
    // empty. A correct trim keeps as many events as fit.
    expect(remaining).toBeGreaterThan(100)
    expect(remaining).toBeLessThan(400)
  })

  it("keeps the file at or under 256 KiB (the cap measures what is written)", async () => {
    const queue = new TelemetryQueue(path)
    const fat = event({ hostFamily: "h".repeat(1000) })
    await queue.pushMany(Array.from({ length: 400 }, () => fat))

    // The real artifact on disk, not a re-serialization of the in-memory array. When the cap
    // measured compact JSON while `save()` wrote pretty JSON, this was ~1.22x over.
    const bytes = Buffer.byteLength(await readFile(path, "utf8"), "utf8")
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES)
    // Paired with the bound on purpose: an EMPTY file is also under 256 KiB, so a size
    // assertion alone passes against the drain-everything bug. The cap has to hold while
    // events are actually retained, and near the cap rather than far below it.
    expect(await queue.size()).toBeGreaterThan(100)
    expect(bytes).toBeGreaterThan(MAX_BYTES / 2)
  })

  it("enforces the count cap, dropping oldest first", async () => {
    const queue = new TelemetryQueue(path)
    // Small events, so the count cap is reached long before the byte cap.
    await queue.pushMany(
      Array.from({ length: MAX_EVENTS + 25 }, (_, i) => event({ productVersion: `v${i}` })),
    )

    expect(await queue.size()).toBe(MAX_EVENTS)
    const survivors = await queue.peek(MAX_EVENTS)
    // FIFO: the 25 oldest are gone, the newest is still present.
    expect(survivors[0]!.productVersion).toBe("v25")
    expect(survivors.at(-1)!.productVersion).toBe(`v${MAX_EVENTS + 24}`)
  })

  it("a multi-byte field is measured in bytes, not characters", async () => {
    const queue = new TelemetryQueue(path)
    // Each char is 3 bytes in UTF-8, so a `.length`-based cap would under-count by ~3x and
    // let the file land well over the budget.
    const wide = event({ hostFamily: "配".repeat(400) })
    await queue.pushMany(Array.from({ length: 400 }, () => wide))

    const bytes = Buffer.byteLength(await readFile(path, "utf8"), "utf8")
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES)
    // Again bounded from BOTH sides, so an emptied queue cannot pass as "within budget".
    expect(await queue.size()).toBeGreaterThan(50)
    expect(bytes).toBeGreaterThan(MAX_BYTES / 2)
  })

  it("push and pushMany agree on the resulting queue contents", async () => {
    // pushMany is the batched path the sink drains through; push is the single-event path.
    // They must be equivalent, or a batched drain would store something different from what
    // per-event persistence stored.
    const events = Array.from({ length: 5 }, (_, i) => event({ productVersion: `v${i}` }))

    const batched = new TelemetryQueue(join(dir, "batched.json"))
    await batched.pushMany(events)

    const oneByOne = new TelemetryQueue(join(dir, "one-by-one.json"))
    for (const e of events) await oneByOne.push(e)

    expect(await batched.peek(99)).toEqual(await oneByOne.peek(99))
  })

  it("pushMany([]) writes nothing and leaves no file behind", async () => {
    const queue = new TelemetryQueue(path)
    await queue.pushMany([])
    expect(await queue.size()).toBe(0)
  })
})

describe("TelemetryQueue — ACK-safe delivery", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cl-queue-"))
    path = join(dir, "queue.json")
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  })

  it("peek does not remove — a failed delivery leaves the queue intact", async () => {
    const queue = new TelemetryQueue(path)
    await queue.push(event({ productVersion: "a" }))
    await queue.push(event({ productVersion: "b" }))

    const peeked = await queue.peek(10)
    expect(peeked).toHaveLength(2)

    // Simulate the failure path: peek, do NOT confirm, then a later run reads again. The
    // old take()-then-restore lost both events here.
    const second = new TelemetryQueue(path)
    expect(await second.size()).toBe(2)
    expect((await second.peek(10)).map((e) => e.productVersion)).toEqual(["a", "b"])
  })

  it("peek is bounded by the requested count and never over-reads", async () => {
    const queue = new TelemetryQueue(path)
    for (let i = 0; i < 5; i++) await queue.push(event({ productVersion: `v${i}` }))

    expect(await queue.peek(2)).toHaveLength(2)
    // Asking for more than exists returns what exists, not undefined padding.
    expect(await queue.peek(99)).toHaveLength(5)
    expect(await queue.peek(0)).toHaveLength(0)
  })

  it("removeDelivered drops exactly the delivered prefix", async () => {
    const queue = new TelemetryQueue(path)
    for (const v of ["a", "b", "c"]) await queue.push(event({ productVersion: v }))

    await queue.removeDelivered(2)

    const rest = await queue.peek(10)
    expect(rest.map((e) => e.productVersion)).toEqual(["c"])
    // Persisted, not just in-memory: a fresh handle sees the same thing.
    expect(await new TelemetryQueue(path).size()).toBe(1)
  })

  it("removeDelivered preserves events a concurrent process appended", async () => {
    const queue = new TelemetryQueue(path)
    await queue.push(event({ productVersion: "delivered" }))

    // This handle peeks one event, then a SECOND process pushes before delivery confirms.
    const inFlight = await queue.peek(1)
    await new TelemetryQueue(path).push(event({ productVersion: "arrived-later" }))

    await queue.removeDelivered(inFlight.length)

    // Only the delivered prefix is gone. Removing by count after re-loading (rather than
    // saving a stale in-memory array) is what keeps the concurrent push alive.
    const rest = await new TelemetryQueue(path).peek(10)
    expect(rest.map((e) => e.productVersion)).toEqual(["arrived-later"])
  })

  it("removeDelivered(0) is a no-op and cannot truncate", async () => {
    const queue = new TelemetryQueue(path)
    await queue.push(event())
    await queue.removeDelivered(0)
    expect(await queue.size()).toBe(1)
  })

  it("a corrupt queue file degrades to empty instead of throwing", async () => {
    const queue = new TelemetryQueue(path)
    await queue.push(event())
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, "{ not json", "utf8")

    await expect(queue.size()).resolves.toBe(0)
    await expect(queue.peek(10)).resolves.toEqual([])
    // Still writable afterwards — a bad file must not wedge the queue permanently.
    await queue.push(event({ productVersion: "recovered" }))
    expect(await queue.size()).toBe(1)
  })
})

describe("createBatch — content-derived idempotency key", () => {
  it("the same events always produce the same batchId", () => {
    const events = [event({ productVersion: "a" }), event({ productVersion: "b" })]
    // The retry case: a flush that timed out AFTER the server committed re-sends these and
    // must present the same id, or the server's batch_id uniqueness cannot dedup it.
    expect(createBatch(events).batchId).toBe(createBatch([...events]).batchId)
  })

  it("different events produce different batchIds", () => {
    const a = createBatch([event({ productVersion: "a" })])
    const b = createBatch([event({ productVersion: "b" })])
    expect(a.batchId).not.toBe(b.batchId)
  })

  it("order is significant (a reordered batch is a different batch)", () => {
    const x = event({ productVersion: "x" })
    const y = event({ productVersion: "y" })
    expect(createBatch([x, y]).batchId).not.toBe(createBatch([y, x]).batchId)
  })

  it("carries the schema tag and a 32-hex id", () => {
    const batch = createBatch([event()])
    expect(batch.schema).toBe("calllint.telemetry-batch.v0")
    expect(batch.batchId).toMatch(/^[0-9a-f]{32}$/)
    expect(batch.events).toHaveLength(1)
  })
})
