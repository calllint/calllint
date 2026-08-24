/**
 * new11 PR-04 — sanitizer privacy guarantees.
 * The structural claim: forbidden/unknown fields cannot reach output, and a
 * present forbidden field fails closed rather than being silently dropped.
 */
import { describe, it, expect } from "vitest"
import {
  sanitizeEvent,
  bucketDuration,
  DISCOVERY_SURFACES,
  FORBIDDEN_FIELDS,
  SOURCES,
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

  /*
   * ─────────────────────────────────────────────────────────────────────────────────
   * `discoverySurface` (new19 §21) — positive + negative, per the repo rule that no
   * rule ships without both.
   * ─────────────────────────────────────────────────────────────────────────────────
   * The negative control is the load-bearing one. An optional dimension that is
   * silently DROPPED instead of rejected is invisible downstream: the aggregate
   * counter still increments, just under a narrower key, so a typo'd or stale value
   * reads as "that surface sent no traffic" — a number that looks healthy and means
   * nothing. Same fault class as a guard that cannot observe its subject.
   */
  it("carries a valid discoverySurface through, and every vocabulary member is accepted", () => {
    const out = sanitizeEvent({
      eventName: "install_completed",
      source: "install",
      discoverySurface: "mcp-registry",
    })
    expect(out.discoverySurface).toBe("mcp-registry")
    for (const surface of DISCOVERY_SURFACES) {
      expect(sanitizeEvent({ eventName: "install_completed", source: "install", discoverySurface: surface }).discoverySurface).toBe(surface)
    }
  })

  it("omits discoverySurface entirely when the caller states none", () => {
    // Absent must stay absent, not become "" — `additionalProperties:false` plus an
    // enum on the schema means an empty string would be a validation failure on the
    // wire, and the field is genuinely optional at the call site.
    const out = sanitizeEvent({ eventName: "install_completed", source: "install" })
    expect("discoverySurface" in out).toBe(false)
  })

  it("NEGATIVE: rejects an off-vocabulary discoverySurface rather than dropping it", () => {
    for (const bad of ["registry", "MCP-Registry", "agent-harness ", "../etc/passwd", "surfaceTypes"]) {
      expect(() =>
        sanitizeEvent({ eventName: "install_completed", source: "install", discoverySurface: bad }),
      ).toThrow(/discoverySurface/)
    }
  })

  it("NEGATIVE: a surface ID is not a surface TYPE — ids must not be accepted", () => {
    // The vocabulary is deliberately the six surface TYPES. An id like this one is
    // per-host, high-cardinality, and contains `/`, which the ingress's safe-token
    // rule excludes so a filesystem path can never be stored as a dimension.
    expect(() =>
      sanitizeEvent({
        eventName: "install_completed",
        source: "install",
        discoverySurface: "io.github.calllint/calllint",
      }),
    ).toThrow(/discoverySurface/)
  })

  it("discoverySurface and source stay SEPARATE vocabularies", () => {
    // Widening `source` to carry discovery provenance would have changed which gate
    // tier a run is judged under — a privacy control — to record an analytics fact.
    // These two enums must not overlap, or a call site could pass one for the other.
    const overlap = DISCOVERY_SURFACES.filter((s) => (SOURCES as readonly string[]).includes(s))
    expect(overlap).toEqual([])
    expect(() =>
      sanitizeEvent({ eventName: "install_completed", source: "mcp-registry" } as any),
    ).toThrow(/source/)
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
