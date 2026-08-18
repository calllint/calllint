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
import { randomBytes } from "node:crypto"

export interface TelemetryBatch {
  schema: "calllint.telemetry-batch.v0"
  batchId: string
  events: SanitizedEvent[]
}

const MAX_EVENTS = 1000
const MAX_BYTES = 256 * 1024 // 256 KiB

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
      await writeFile(this.path, JSON.stringify(this.events, null, 2), "utf8")
    } catch {
      // Best-effort: queue save must never break caller
    }
  }

  /** Add event to queue, dropping oldest if limits exceeded. */
  async push(event: SanitizedEvent): Promise<void> {
    await this.load()
    this.events.push(event)

    // Enforce size limits: drop oldest first
    while (this.events.length > MAX_EVENTS) {
      this.events.shift()
    }

    const sizeBytes = JSON.stringify(this.events).length
    while (sizeBytes > MAX_BYTES && this.events.length > 0) {
      this.events.shift()
    }

    await this.save()
  }

  /** Take up to N events from the front, removing them from the queue. */
  async take(count: number): Promise<SanitizedEvent[]> {
    await this.load()
    const taken = this.events.splice(0, Math.min(count, this.events.length))
    await this.save()
    return taken
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

/** Generate a random batch ID for idempotent retries. */
export function generateBatchId(): string {
  return randomBytes(16).toString("hex")
}

/** Create a batch envelope with a fresh batch ID. */
export function createBatch(events: SanitizedEvent[]): TelemetryBatch {
  return {
    schema: "calllint.telemetry-batch.v0",
    batchId: generateBatchId(),
    events,
  }
}
