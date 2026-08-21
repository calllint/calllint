/**
 * Aggregation tests (new18 §21). The central property: N events collapse into
 * per-day counters, never into N rows. The withdrawn Pages implementation wrote
 * one row per event against a `batch_id TEXT UNIQUE` column, so any batch with
 * two events aborted — these tests exist so that cannot recur silently.
 */
import { describe, expect, it } from "vitest"
import { aggregate, type HashedEvent } from "../src/aggregate.js"
import type { ValidatedEvent } from "../src/validate.js"

const ev = (over: Partial<ValidatedEvent> = {}): ValidatedEvent => ({
  eventName: "preflight_completed",
  source: "cli",
  timestamp: "2026-08-20T10:00:00Z",
  hostFamily: "claude-desktop",
  inputKind: "config",
  productVersion: "1.8.0",
  ...over,
})

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)

describe("aggregate — counts", () => {
  it("collapses identical events into one row with a summed count", () => {
    const hashed: HashedEvent[] = Array.from({ length: 5 }, () => ({ event: ev() }))
    const { counts } = aggregate(hashed)
    expect(counts).toHaveLength(1)
    expect(counts[0]?.count).toBe(5)
  })

  it("keeps events on different days in separate rows", () => {
    const { counts } = aggregate([
      { event: ev({ timestamp: "2026-08-19T23:00:00Z" }) },
      { event: ev({ timestamp: "2026-08-20T01:00:00Z" }) },
    ])
    expect(counts).toHaveLength(2)
    expect(counts.map((r) => r.day).sort()).toEqual(["2026-08-19", "2026-08-20"])
  })

  it.each([
    ["eventName", { eventName: "decision_block" }],
    ["source", { source: "ci" }],
    ["hostFamily", { hostFamily: "cursor" }],
    ["inputKind", { inputKind: "inline" }],
    ["productVersion", { productVersion: "1.7.1" }],
  ])("does not merge rows that differ in %s", (_label, over) => {
    // If the grouping key omitted any stored dimension, two distinct
    // combinations would collapse and the report would understate cardinality.
    const { counts } = aggregate([{ event: ev() }, { event: ev(over as Partial<ValidatedEvent>) }])
    expect(counts).toHaveLength(2)
  })

  it("produces one row per distinct combination across a mixed batch", () => {
    const { counts } = aggregate([
      { event: ev() },
      { event: ev() },
      { event: ev({ eventName: "decision_safe" }) },
      { event: ev({ source: "ci" }) },
    ])
    expect(counts).toHaveLength(3)
    expect(counts.reduce((sum, r) => sum + r.count, 0)).toBe(4)
  })

  it("returns empty aggregates for an empty batch", () => {
    expect(aggregate([])).toEqual({ counts: [], installations: [] })
  })
})

describe("aggregate — installations", () => {
  it("emits no installation row when no event carries a hash", () => {
    const { counts, installations } = aggregate([{ event: ev() }, { event: ev() }])
    expect(counts[0]?.count).toBe(2)
    expect(installations).toHaveLength(0)
  })

  it("counts preflights and attention per installation per day", () => {
    const { installations } = aggregate([
      { event: ev(), installationHash: HASH_A },
      { event: ev({ result: "REVIEW" }), installationHash: HASH_A },
      { event: ev({ eventName: "decision_block", result: "BLOCK" }), installationHash: HASH_A },
    ])
    expect(installations).toHaveLength(1)
    // Two preflight_completed events; the third is decision_block.
    expect(installations[0]?.preflights).toBe(2)
    // REVIEW and BLOCK both need attention; the bare preflight does not.
    expect(installations[0]?.attention).toBe(2)
  })

  it("separates distinct installations and distinct days", () => {
    const { installations } = aggregate([
      { event: ev(), installationHash: HASH_A },
      { event: ev(), installationHash: HASH_B },
      { event: ev({ timestamp: "2026-08-21T10:00:00Z" }), installationHash: HASH_A },
    ])
    expect(installations).toHaveLength(3)
  })

  it("counts an event toward totals even when it has no installation hash", () => {
    const { counts, installations } = aggregate([
      { event: ev(), installationHash: HASH_A },
      { event: ev() },
    ])
    expect(counts[0]?.count).toBe(2)
    expect(installations).toHaveLength(1)
    expect(installations[0]?.preflights).toBe(1)
  })

  it("does not count a SAFE verdict as attention", () => {
    const { installations } = aggregate([
      { event: ev({ result: "SAFE" }), installationHash: HASH_A },
    ])
    expect(installations[0]?.attention).toBe(0)
  })

  it("counts UNKNOWN as attention — UNKNOWN is not SAFE", () => {
    const { installations } = aggregate([
      { event: ev({ result: "UNKNOWN" }), installationHash: HASH_A },
    ])
    expect(installations[0]?.attention).toBe(1)
  })
})
