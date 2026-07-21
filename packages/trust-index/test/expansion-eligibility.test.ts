import { describe, it, expect } from "vitest"
import { emitAllCohorts, type ExpansionCandidate } from "../src/emitCohort.js"
import { resolveMaxEntries } from "../src/refreshSnapshot.js"
import { DEFAULT_MAX_ENTRIES } from "../src/fetchRegistry.js"
import { mergeResults, type EvidenceSubject, type ResolverResult } from "@calllint/evidence"

/**
 * Phase C — Trust Index scale-out, CODE-READY (I1).
 *
 * Two seams make future scale-out (37 → 100+) possible AND safe by construction,
 * without changing the committed seed:
 *   1. `resolveMaxEntries` parameterizes the ADR 0038 §6 cap (fail-safe fallback).
 *   2. `emitAllCohorts(..., expansion)` gates each expansion candidate through the
 *      §4.7 publish-eligibility check — eligible ⇒ baked, ineligible ⇒ incomplete
 *      with the failing criteria — while an EMPTY expansion list (today's reality)
 *      emits byte-identically to the seed (the reproducibility gate stays green).
 */

// ── §4.7 gate over expansion candidates ───────────────────────────────────────

const subject: EvidenceSubject = {
  schema: "calllint.evidence-subject.v0",
  subjectType: "npm-package",
  id: "npm:acme-mcp@2.0.0",
}

/** A fully-resolved bundle: identity name + exact version, no gaps → §4.7-eligible. */
function eligibleBundle() {
  const r: ResolverResult = {
    resolver: "R1:npm",
    status: "complete",
    items: [
      { field: "identity.name", value: "acme-mcp", tier: "registry", source: "R1:npm" },
      { field: "identity.version", value: "2.0.0", tier: "registry", source: "R1:npm" },
    ],
    gaps: [],
  }
  return mergeResults(subject, [r])
}

/** A partial bundle: name only, no version → fails `exact-version-or-digest`. */
function ineligibleBundle() {
  const r: ResolverResult = {
    resolver: "R1:npm",
    status: "partial",
    items: [{ field: "identity.name", value: "acme-mcp", tier: "registry", source: "R1:npm" }],
    gaps: [],
  }
  return mergeResults(subject, [r])
}

const CONFIG = JSON.stringify({ mcpServers: { acme: { command: "npx", args: ["-y", "acme-mcp@2.0.0"] } } })

function candidate(bundle: ReturnType<typeof eligibleBundle>, verdictBound: boolean): ExpansionCandidate {
  return {
    input: {
      canonicalName: "expansion/acme-mcp",
      configText: CONFIG,
      sourceLabel: "expansion:test",
      observedAt: "2026-07-21T00:00:00.000Z",
    },
    bundle,
    verdictBound,
  }
}

describe("expansion eligibility gate (§4.7)", () => {
  it("an eligible + verdict-bound candidate is BAKED as a page", () => {
    const out = emitAllCohorts(null, undefined, null, [candidate(eligibleBundle(), true)])
    expect(out.baked).toBeGreaterThan(0)
    // its page files exist
    expect(out.files.some((f) => f.path === "expansion/acme-mcp.json")).toBe(true)
    expect(out.files.some((f) => f.path === "expansion/acme-mcp.html")).toBe(true)
    // and the index records it baked under the expansion cohort
    const index = JSON.parse(out.files.find((f) => f.path === "index.json")!.content)
    expect(index.cohorts).toContain("expansion")
    const entry = index.entries.find((e: { canonicalName: string }) => e.canonicalName === "expansion/acme-mcp")
    expect(entry.status).toBe("baked")
  })

  it("an ineligible candidate is INCOMPLETE, never a page, with the failing criterion", () => {
    const out = emitAllCohorts(null, undefined, null, [candidate(ineligibleBundle(), true)])
    expect(out.files.some((f) => f.path.startsWith("expansion/acme-mcp."))).toBe(false)
    const index = JSON.parse(out.files.find((f) => f.path === "index.json")!.content)
    const entry = index.entries.find((e: { canonicalName: string }) => e.canonicalName === "expansion/acme-mcp")
    expect(entry.status).toBe("incomplete")
    expect(entry.reason).toContain("§4.7")
    expect(entry.reason).toContain("exact-version-or-digest")
  })

  it("fails CLOSED: an eligible bundle with NO bound verdict is withheld", () => {
    const out = emitAllCohorts(null, undefined, null, [candidate(eligibleBundle(), false)])
    const index = JSON.parse(out.files.find((f) => f.path === "index.json")!.content)
    const entry = index.entries.find((e: { canonicalName: string }) => e.canonicalName === "expansion/acme-mcp")
    expect(entry.status).toBe("incomplete")
    expect(entry.reason).toContain("verdict-bound")
  })
})

describe("no-expansion emit is byte-identical to the seed (reproducibility preserved)", () => {
  it("emitAllCohorts() with default (empty) expansion == the 3-arg call", () => {
    const withDefault = emitAllCohorts(null)
    const withEmptyExpansion = emitAllCohorts(null, undefined, null, [])
    expect(withEmptyExpansion.files.map((f) => f.path + "\0" + f.content)).toEqual(
      withDefault.files.map((f) => f.path + "\0" + f.content),
    )
    // and the cohorts label is unchanged (no "expansion" appended)
    const idx = JSON.parse(withEmptyExpansion.files.find((f) => f.path === "index.json")!.content)
    expect(idx.cohorts).toEqual(["fixtures"])
  })
})

// ── cap parameterization (ADR 0038 §6) ────────────────────────────────────────

describe("resolveMaxEntries — parameterized cap, fail-safe", () => {
  it("defaults to DEFAULT_MAX_ENTRIES when unset or empty", () => {
    expect(resolveMaxEntries({})).toBe(DEFAULT_MAX_ENTRIES)
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "" })).toBe(DEFAULT_MAX_ENTRIES)
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "   " })).toBe(DEFAULT_MAX_ENTRIES)
  })

  it("honors a valid positive integer override (scale-out)", () => {
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "100" })).toBe(100)
    expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: "1000" })).toBe(1000)
  })

  it("falls back to the default on invalid input (fail-safe, never unbounded/empty)", () => {
    for (const bad of ["0", "-5", "abc", "12.5", "NaN"]) {
      expect(resolveMaxEntries({ TRUST_INGEST_MAX_ENTRIES: bad })).toBe(DEFAULT_MAX_ENTRIES)
    }
  })
})
