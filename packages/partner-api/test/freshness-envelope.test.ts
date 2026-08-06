/**
 * S-3 — the partner API's freshness projection, and the THIRD plane's agreement.
 *
 * S-2 single-sourced the freshness label across two planes (the bake and the browser) by
 * asserting on the literals. This package is the third plane, and it reaches the value a
 * different way: it cannot import the calculator (`@calllint/trust-index` is in
 * `SCANNER_PKGS`), so `EnvelopeFreshness` is a structural MIRROR. A mirror with no
 * agreement assertion is a second source of truth, which is the thing S-2 spent its whole
 * design avoiding — so the key set is asserted against LIVE BAKED BYTES here.
 *
 * The other half of this suite pins the omission discipline. `toFreshness` must fail to
 * OMISSION rather than to a default, because a substituted default would report an
 * unmeasured age as FRESH — the same hazard the calculator refuses at its own boundary.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { toEnvelope, loadIndex, findByName, type IndexEntry } from "../src/lookup.js"
import { handleApiRequest } from "../src/router.js"
import { API_BASE, FRESHNESS_KEYS, FRESHNESS_STATES } from "../src/types.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..")
const TRUST = resolve(repoRoot, "apps", "web", "public", "trust")

/** The live committed index — the bytes the deployed API actually serves. */
function liveIndex(): { entries: IndexEntry[]; bakedAt?: string } {
  return JSON.parse(readFileSync(resolve(TRUST, "index.json"), "utf8")) as {
    entries: IndexEntry[]
    bakedAt?: string
  }
}

/** An AssetReader over the committed tree — the same shape the deployment injects. */
const readCommitted = async (rel: string): Promise<string | null> => {
  const p = resolve(repoRoot, "apps", "web", "public", rel)
  return existsSync(p) ? readFileSync(p, "utf8") : null
}

describe("the mirrored type agrees with the baked shape (third-plane agreement)", () => {
  it("mirrors exactly the keys the bake writes, no more and no fewer", () => {
    const baked = liveIndex().entries.filter((e) => e.status === "baked" && e.freshness)
    // Non-vacuity floor FIRST: with zero stamped entries every claim below is trivially
    // green, and the suite would pass a tree where S-2 had been reverted.
    expect(baked.length).toBeGreaterThan(20)

    // The observed key sets, as sorted strings, so a mismatch PRINTS what arrived rather
    // than collapsing to "expected false to be true". The expectation is DERIVED from the
    // exported runtime constant — restating it here would make this test a second source
    // of truth instead of a check on the mirror.
    const observed = [...new Set(baked.map((e) => Object.keys(e.freshness as object).sort().join(",")))]
    expect(observed).toEqual([[...FRESHNESS_KEYS].sort().join(",")])
  })

  it("mirrors every state the bake can emit, so no state arrives unmodelled", () => {
    const MIRRORED: readonly string[] = FRESHNESS_STATES
    const emitted = [
      ...new Set(
        liveIndex()
          .entries.filter((e) => e.freshness)
          .map((e) => (e.freshness as { state: string }).state),
      ),
    ]
    // Set-shaped, not `.every()`: an unmodelled state prints its own name.
    expect(emitted.filter((s) => !MIRRORED.includes(s))).toEqual([])
    // And the live corpus must actually exercise more than one, or the mirror is untested.
    expect(emitted.length).toBeGreaterThan(1)
  })

  it("carries `ageDays: null` exactly where the state is TIMELESS", () => {
    const rows = liveIndex()
      .entries.filter((e) => e.freshness)
      .map((e) => e.freshness as { state: string; ageDays: number | null })
    const contradictions = rows
      .filter((f) => (f.state === "TIMELESS") !== (f.ageDays === null))
      .map((f) => `${f.state}/${String(f.ageDays)}`)
    expect(contradictions).toEqual([])
    // Both sides must be populated, or the biconditional is vacuous on one leg.
    expect(rows.some((f) => f.state === "TIMELESS")).toBe(true)
    expect(rows.some((f) => f.state !== "TIMELESS")).toBe(true)
  })
})

describe("the envelope serves the baked value VERBATIM", () => {
  it("reproduces the entry's freshness object exactly, not a recomputation", () => {
    const idx = liveIndex()
    const entry = idx.entries.find((e) => e.status === "baked" && e.freshness)!
    const sidecar = JSON.parse(readFileSync(resolve(TRUST, `${entry.canonicalName}.json`), "utf8"))
    const env = toEnvelope("resource", sidecar, sidecar, entry)
    // Deep-equal against the committed bytes. Any normalization, rounding, or re-derivation
    // shows up here — which is the point: this package must not compute.
    expect(env.freshness).toEqual(entry.freshness)
  })

  it("reaches every route, so no served surface silently drops the axis", async () => {
    const idx = liveIndex()
    const entry = idx.entries.find(
      (e) => e.status === "baked" && e.freshness && e.canonicalName.startsWith("mcp-registry/"),
    )!
    // All FOUR `toEnvelope` call sites in `router.ts`, one per kind. Anything less leaves a
    // site unmeasured, and an unmeasured site is one a later edit can silently unwire.
    const paths = [
      `${API_BASE}/resources/${entry.canonicalName}`,
      `${API_BASE}/resources/${entry.canonicalName}/authority`,
      `${API_BASE}/resources/${entry.canonicalName}/manifest`,
      `${API_BASE}/artifacts/${entry.artifactDigest}`,
    ]
    const missing: string[] = []
    for (const path of paths) {
      const res = await handleApiRequest({ method: "GET", path }, readCommitted)
      const body = JSON.parse(res.body) as { freshness?: unknown }
      if (JSON.stringify(body.freshness) !== JSON.stringify(entry.freshness)) {
        missing.push(`${path} → ${JSON.stringify(body.freshness)}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("never lets freshness reach the verdict — the axes stay independent", async () => {
    const idx = liveIndex()
    // A STALE (or AGING) entry must still serve whatever verdict the bake decided. If
    // freshness ever fed the verdict, the two would correlate; asserting equality with the
    // COMMITTED verdict is what makes that impossible to introduce unnoticed.
    const aged = idx.entries.filter(
      (e) => e.status === "baked" && (e.freshness as { state?: string } | undefined)?.state !== "TIMELESS",
    )
    expect(aged.length).toBeGreaterThan(0)
    const drifted: string[] = []
    for (const entry of aged.slice(0, 5)) {
      const res = await handleApiRequest(
        { method: "GET", path: `${API_BASE}/resources/${entry.canonicalName}` },
        readCommitted,
      )
      const body = JSON.parse(res.body) as { verdict: string }
      if (body.verdict !== entry.verdict) drifted.push(`${entry.canonicalName}: ${body.verdict} vs ${entry.verdict}`)
    }
    expect(drifted).toEqual([])
  })
})

describe("omission discipline — a value we cannot read is absent, never defaulted", () => {
  const sidecar = { canonicalName: "ns/x", verdict: "REVIEW", observedAt: "2026-08-01T00:00:00.000Z" }
  function envWith(freshness: unknown): Record<string, unknown> {
    return toEnvelope("resource", sidecar, sidecar, {
      canonicalName: "ns/x",
      status: "baked",
      freshness,
    }) as unknown as Record<string, unknown>
  }

  it("omits the key entirely when the entry has no freshness (pre-S-2 trees unchanged)", () => {
    // `Object.keys`, not a truthiness check — `JSON.stringify` hides an explicit undefined,
    // and "present but undefined" is a different served byte from "absent".
    expect(Object.keys(envWith(undefined))).not.toContain("freshness")
    expect(Object.keys(toEnvelope("resource", sidecar, sidecar) as unknown as object)).not.toContain("freshness")
  })

  it.each([
    ["an unknown state", { ageDays: 3, state: "PROBABLY_FINE", cadenceDays: 7, basis: "x" }],
    ["a missing state", { ageDays: 3, cadenceDays: 7, basis: "x" }],
    ["a non-numeric ageDays", { ageDays: "3", state: "FRESH", cadenceDays: 7, basis: "x" }],
    ["a NaN ageDays", { ageDays: Number.NaN, state: "FRESH", cadenceDays: 7, basis: "x" }],
    ["a missing cadence", { ageDays: 3, state: "FRESH", basis: "x" }],
    ["a non-object", "FRESH"],
  ])("omits rather than defaults given %s", (_label, malformed) => {
    // The hazard being pinned: substituting a plausible default would publish an
    // unmeasured age as FRESH, the most misleading value on this axis.
    expect(Object.keys(envWith(malformed))).not.toContain("freshness")
  })

  it("keeps a legitimate zero-day age and a legitimate null age", () => {
    // Both would be discarded by a truthiness test on `ageDays`.
    expect(envWith({ ageDays: 0, state: "FRESH", cadenceDays: 7, basis: "snapshot-fetchedAt" }).freshness).toEqual({
      ageDays: 0,
      state: "FRESH",
      cadenceDays: 7,
      basis: "snapshot-fetchedAt",
    })
    expect(envWith({ ageDays: null, state: "TIMELESS", cadenceDays: 7, basis: "fixture-anchor" }).freshness).toEqual({
      ageDays: null,
      state: "TIMELESS",
      cadenceDays: 7,
      basis: "fixture-anchor",
    })
  })
})

describe("the index accessor exposes what the envelope needs", () => {
  it("loadIndex + findByName hand back an entry carrying freshness", async () => {
    const idx = await loadIndex(readCommitted)
    expect(idx).not.toBeNull()
    const name = liveIndex().entries.find((e) => e.status === "baked" && e.freshness)!.canonicalName
    const entry = findByName(idx!, name)
    expect(entry).not.toBeNull()
    expect(entry!.freshness).toBeDefined()
  })
})
