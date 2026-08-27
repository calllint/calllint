/**
 * Local bounded telemetry queue — stores sanitized events for batched delivery.
 *
 * Requirements (U2):
 *   - Deterministic JSON/JSONL representation
 *   - Max bounded size (1000 events OR 256 KiB)
 *   - Oldest events dropped first if cap exceeded
 *   - No config/content/secret/prompt/evidence fields (sanitizer already enforces this)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import type { SanitizedEvent } from "@calllint/telemetry-contract"
import { createHash } from "node:crypto"

export interface TelemetryBatch {
  schema: "calllint.telemetry-batch.v0"
  batchId: string
  events: SanitizedEvent[]
}

const MAX_EVENTS = 1000
const MAX_BYTES = 256 * 1024 // 256 KiB

/**
 * The ONE on-disk representation of the queue.
 *
 * Both the byte-cap check and `save()` go through this, because a cap is only meaningful
 * if it measures the bytes that actually land on disk. Previously the cap measured
 * `JSON.stringify(events)` while `save()` wrote `JSON.stringify(events, null, 2)` — 1.22x
 * larger for realistic events — so a queue trimmed to "256 KiB" wrote a ~326 KiB file. The
 * indentation served no reader: nothing outside this class parses queue.json, so the
 * compact form is chosen and the two paths are now the same function by construction.
 */
function serialize(events: readonly SanitizedEvent[]): string {
  return JSON.stringify(events)
}

/**
 * A simple FIFO queue backed by a JSON file. Bounded by count and size.
 * Appends new events, dropping oldest if limits exceeded.
 */
export class TelemetryQueue {
  private path: string
  private events: SanitizedEvent[] = []

  constructor(queuePath: string) {
    this.path = queuePath
  }

  async load(): Promise<void> {
    try {
      if (!existsSync(this.path)) {
        this.events = []
        return
      }
      const raw = await readFile(this.path, "utf8")
      const parsed = JSON.parse(raw)
      this.events = Array.isArray(parsed) ? parsed : []
    } catch {
      this.events = []
    }
  }

  async save(): Promise<void> {
    try {
      const dir = dirname(this.path)
      await mkdir(dir, { recursive: true })
      await writeFile(this.path, serialize(this.events), "utf8")
    } catch {
      // Best-effort: queue save must never break caller
    }
  }

  /** Add one event to the queue, dropping oldest if limits exceeded. */
  async push(event: SanitizedEvent): Promise<void> {
    await this.pushMany([event])
  }

  /**
   * Append several events in ONE read-modify-write cycle.
   *
   * `push` per event costs a full file read, a whole-array serialize, and a full write
   * each time, so persisting a run's buffer was quadratic in the queue length: draining
   * ~400 buffered events took over five seconds and a 1000-event queue was worse. A
   * `scan-all` over a large repo emits two signals per surface, so this is the normal
   * path, not an edge case. Batching makes one drain one cycle.
   */
  async pushMany(events: readonly SanitizedEvent[]): Promise<void> {
    if (events.length === 0) return
    await this.load()
    this.events.push(...events)
    this.trim()
    await this.save()
  }

  /**
   * Drop oldest-first until the queue is inside BOTH caps.
   *
   * The byte cap is tracked incrementally rather than by re-serializing the whole array on
   * every shift, which turned each trim into O(n²) work over the queue. Two properties the
   * cheap version must not lose:
   *
   *   - The measured value must CHANGE as events are dropped. Computing the size once
   *     before the loop (the original bug) made the condition loop-invariant, so the loop
   *     drained the entire queue instead of trimming to the cap.
   *   - It must measure BYTES, not characters: a non-ASCII field costs more bytes than
   *     characters, so `String.length` under-counts and lets the file exceed 256 KiB.
   *
   * Per-event byte costs are summed, plus the array's own framing (brackets and the commas
   * between elements), so `total` tracks `serialize()`'s length exactly for the compact
   * form. `save()` and the cap therefore still measure the same bytes.
   */
  private trim(): void {
    while (this.events.length > MAX_EVENTS) {
      this.events.shift()
    }

    const sizes = this.events.map((e) => Buffer.byteLength(JSON.stringify(e), "utf8"))
    // `[` + `]`, plus one `,` per gap between elements.
    const framing = (n: number): number => 2 + Math.max(0, n - 1)
    let total = sizes.reduce((a, b) => a + b, 0) + framing(sizes.length)

    let dropped = 0
    while (dropped < sizes.length && total > MAX_BYTES) {
      total -= sizes[dropped]!
      // One fewer element means one fewer separating comma.
      if (sizes.length - dropped > 1) total -= 1
      dropped++
    }
    if (dropped > 0) this.events.splice(0, dropped)
  }

  /**
   * Read up to N events from the front WITHOUT removing them (ACK-safe delivery).
   *
   * This deliberately replaces the former `take()`, which spliced the events out and
   * SAVED the truncated file before the caller knew whether delivery succeeded. Its
   * failure path then called `load()` to "put them back" — but that re-read the file
   * `take()` had already truncated, so a network failure silently destroyed the batch
   * while the code claimed to restore it. Peek → deliver → `removeDelivered()` means a
   * failed flush leaves the queue exactly as it was, and events survive to retry.
   */
  async peek(count: number): Promise<SanitizedEvent[]> {
    await this.load()
    return this.events.slice(0, Math.min(count, this.events.length))
  }

  /**
   * Drop the first `count` events — call ONLY after delivery is confirmed.
   *
   * Re-loads first so a concurrent `push` (a second CLI process) is not clobbered, and
   * removes from the FRONT by count rather than by identity: the queue is FIFO and only
   * this method removes, so the first `count` entries are still the delivered ones. A
   * concurrent push appends to the tail and is therefore preserved.
   */
  async removeDelivered(count: number): Promise<void> {
    if (count <= 0) return
    await this.load()
    this.events.splice(0, Math.min(count, this.events.length))
    await this.save()
  }

  async size(): Promise<number> {
    await this.load()
    return this.events.length
  }

  async clear(): Promise<void> {
    this.events = []
    await this.save()
  }
}

/**
 * Create a batch envelope whose id is DERIVED from the events it carries.
 *
 * The id must be stable across retries or it cannot do its job. With a random id, a
 * flush that timed out after the server committed would retry under a NEW id and be
 * counted twice — the exact double-count the server's `batch_id` uniqueness is meant to
 * prevent. Hashing the event content instead makes the id a function of the payload, so
 * the same events always present the same id and a duplicate delivery is recognizable.
 *
 * Sent as the FULL 64-char digest, because that is what the receiving end requires:
 * `apps/usage-worker/src/validate.ts` matches `/^[0-9a-f]{64}$/` and rejects the whole
 * batch with `invalid_batch_id` otherwise. This previously truncated to 32 chars "to
 * match the previous id width" — a width nothing on the wire had ever accepted, so every
 * batch any published CLI ever sent was refused before a single event was read. Collision
 * risk was never the constraint; the server's contract is.
 */
export function createBatch(events: SanitizedEvent[]): TelemetryBatch {
  const digest = createHash("sha256").update(serialize(events), "utf8").digest("hex")
  return {
    schema: "calllint.telemetry-batch.v0",
    batchId: digest,
    events,
  }
}
