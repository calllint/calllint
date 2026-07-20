/**
 * new11 PR-04 — sanitizer privacy guarantees.
 * The structural claim: forbidden/unknown fields cannot reach output, and a
 * present forbidden field fails closed rather than being silently dropped.
 */
import { describe, it, expect } from "vitest"
import {
  sanitizeEvent,
  bucketDuration,
  FORBIDDEN_FIELDS,
} from "../src/index.js"

describe("sanitizeEvent — allowlist output", () => {
  it("keeps only contract fields and drops unknown ones", () => {
    const out = sanitizeEvent({
      eventName: "preflight_completed",
      source: "cli",
      result: "REVIEW",
      durationMs: 250,
      hostFamily: "cursor",
      // unknown, must NOT survive:
      internalNote: "drop me",
      requestId: "abc",
    } as any)
    expect(out).toEqual({
      eventVersion: "1.0.0",
      eventName: "preflight_completed",
      timestamp: "",
      source: "cli",
      hostFamily: "cursor",
      result: "REVIEW",
      durationBucket: "100-500ms",
    })
    expect(Object.keys(out)).not.toContain("internalNote")
    expect(Object.keys(out)).not.toContain("requestId")
  })

  it("fails CLOSED when any forbidden field is present", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(() =>
        sanitizeEvent({ eventName: "decision_safe", source: "ci", [f]: "leak" } as any),
      ).toThrow(/forbidden field/)
    }
  })

  it("rejects off-vocabulary eventName / source / result", () => {
    expect(() => sanitizeEvent({ eventName: "nope", source: "cli" } as any)).toThrow(/eventName/)
    expect(() => sanitizeEvent({ eventName: "decision_safe", source: "phone" } as any)).toThrow(/source/)
    expect(() =>
      sanitizeEvent({ eventName: "decision_safe", source: "cli", result: "MAYBE" } as any),
    ).toThrow(/result/)
  })

  it("buckets durations coarsely (no raw ms leaks)", () => {
    expect(bucketDuration(50)).toBe("<100ms")
    expect(bucketDuration(250)).toBe("100-500ms")
    expect(bucketDuration(1500)).toBe("500-2000ms")
    expect(bucketDuration(9000)).toBe(">2000ms")
    expect(bucketDuration(undefined)).toBeUndefined()
    expect(bucketDuration(-5)).toBeUndefined()
    const out = sanitizeEvent({ eventName: "apply_completed", source: "ci", durationMs: 1234 })
    expect(out.durationBucket).toBe("500-2000ms")
    expect(JSON.stringify(out)).not.toContain("1234")
  })
})
