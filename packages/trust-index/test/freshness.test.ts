/**
 * S-2 — the freshness calculator (gaps §1.4).
 *
 * Two things this suite is deliberately built to avoid:
 *
 *  1. `.every()` anywhere a value matters. A `.every()` failure prints only
 *     "expected false to be true" — no name on the offending entry. Where the claim is about
 *     a SET of observed states, the set is materialised and compared with `toEqual`, which
 *     prints what actually arrived AND is non-vacuous on an empty array (a `.every()` over
 *     zero entries is green).
 *  2. Asserting the thresholds by restating their literals. `21` appears nowhere below as a
 *     magic number — every boundary is written as `CADENCE_DAYS * AGING_MULTIPLE`, so a test
 *     cannot silently agree with a mutated constant.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { computeFreshness, CADENCE_DAYS, AGING_MULTIPLE, type FreshnessState } from "../src/freshness.js"
import { FIXTURE_OBSERVED_AT } from "../src/cohort.js"

const here = dirname(fileURLToPath(import.meta.url))
const INDEX_JSON = resolve(here, "..", "..", "..", "apps", "web", "public", "trust", "index.json")

/** Build an `observedAt` exactly `days` before a fixed reference `now`. */
const NOW = "2026-08-06T00:00:00.000Z"
function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString()
}

describe("computeFreshness — the thresholds are DERIVED from the ingest cadence", () => {
  it("derives its constants from the weekly cron, not from invented day counts", () => {
    // `.github/workflows/trust-ingest.yml` runs `cron: "17 6 * * 1"` — weekly. If that line
    // changes, this constant is the one place that must move with it.
    expect(CADENCE_DAYS).toBe(7)
    expect(AGING_MULTIPLE).toBe(3)
  })

  it("classifies each boundary on the cadence multiple, inclusive on the low side", () => {
    // Written as multiples, never as `7`/`21`, so a mutated constant cannot find agreement here.
    const cases: readonly { days: number; state: FreshnessState }[] = [
      { days: 0, state: "FRESH" },
      { days: CADENCE_DAYS - 1, state: "FRESH" },
      { days: CADENCE_DAYS, state: "FRESH" }, // exactly one period — still on schedule
      { days: CADENCE_DAYS + 1, state: "AGING" },
      { days: CADENCE_DAYS * AGING_MULTIPLE - 1, state: "AGING" },
      { days: CADENCE_DAYS * AGING_MULTIPLE, state: "AGING" }, // exactly three periods — still recoverable
      { days: CADENCE_DAYS * AGING_MULTIPLE + 1, state: "STALE" },
      { days: 365, state: "STALE" },
    ]
    // The observed pairs, materialised — so a mismatch prints the day count AND both states.
    const observed = cases.map((c) => `${c.days}d→${computeFreshness({ observedAt: daysAgo(c.days), now: NOW }).state}`)
    expect(observed).toEqual(cases.map((c) => `${c.days}d→${c.state}`))
  })

  it("reports the age in whole days and echoes the cadence it judged against", () => {
    const f = computeFreshness({ observedAt: daysAgo(20), now: NOW })
    expect(f).toEqual({ ageDays: 20, state: "AGING", cadenceDays: CADENCE_DAYS, basis: "snapshot-fetchedAt" })
  })

  it("honors an injected cadence, which is how the derivation is proven to be live", () => {
    // Same input, different cadence ⇒ different state. Without this, `cadenceDays` could be a
    // field that is echoed but never actually consulted.
    const at20 = daysAgo(20)
    expect(computeFreshness({ observedAt: at20, now: NOW, cadenceDays: 7 }).state).toBe("AGING")
    expect(computeFreshness({ observedAt: at20, now: NOW, cadenceDays: 30 }).state).toBe("FRESH")
    expect(computeFreshness({ observedAt: at20, now: NOW, cadenceDays: 1 }).state).toBe("STALE")
  })
})

describe("TIMELESS — the fixture anchor is never reported as stale", () => {
  it("recognises the anchor by exact equality with the shared constant", () => {
    const f = computeFreshness({ observedAt: FIXTURE_OBSERVED_AT, now: NOW })
    expect(f).toEqual({ ageDays: null, state: "TIMELESS", cadenceDays: CADENCE_DAYS, basis: "fixture-anchor" })
  })

  it("does NOT use a magnitude heuristic — a genuinely ancient real entry stays STALE", () => {
    // The failure mode this guards: "anything before 2000 is a fixture" would silently convert a
    // real, badly-stale observation into TIMELESS, hiding exactly the signal freshness exists for.
    // One millisecond off the anchor is a real timestamp again.
    const offByOneMs = new Date(Date.parse(FIXTURE_OBSERVED_AT) + 1).toISOString()
    expect(offByOneMs).not.toBe(FIXTURE_OBSERVED_AT)
    const f = computeFreshness({ observedAt: offByOneMs, now: NOW })
    expect(f.state).toBe("STALE")
    expect(f.basis).toBe("snapshot-fetchedAt")
    expect(f.ageDays).toBeGreaterThan(20_000)
  })
})

describe("fails CLOSED on a degenerate input", () => {
  it("throws on an unparseable observedAt or now, naming the field", () => {
    // A silently-zero age renders as FRESH — the most misleading value this function could
    // return — so the refusal is the safe branch (`compileEvidence`'s precedent).
    expect(() => computeFreshness({ observedAt: "", now: NOW })).toThrow(/observedAt/)
    expect(() => computeFreshness({ observedAt: "not-a-date", now: NOW })).toThrow(/observedAt/)
    expect(() => computeFreshness({ observedAt: daysAgo(1), now: "" })).toThrow(/`now`/)
    expect(() => computeFreshness({ observedAt: "", now: NOW })).toThrow(/FRESH/)
  })

  it("throws on a non-positive cadence", () => {
    expect(() => computeFreshness({ observedAt: daysAgo(1), now: NOW, cadenceDays: 0 })).toThrow(/cadenceDays/)
    expect(() => computeFreshness({ observedAt: daysAgo(1), now: NOW, cadenceDays: -7 })).toThrow(/cadenceDays/)
  })

  it("clamps a future observedAt to zero rather than reporting a negative age", () => {
    const f = computeFreshness({ observedAt: "2027-01-01T00:00:00.000Z", now: NOW })
    expect(f.ageDays).toBe(0)
    expect(f.state).toBe("FRESH")
  })
})

describe("the SERVED index carries the projection (non-vacuous over live bytes)", () => {
  const doc = JSON.parse(readFileSync(INDEX_JSON, "utf8")) as {
    bakedAt?: string
    entries: readonly { canonicalName: string; status: string; observedAt: string; freshness?: unknown }[]
  }

  it("records the clock it was baked against, which is what makes the bake replayable", () => {
    expect(typeof doc.bakedAt).toBe("string")
    expect(doc.bakedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it("stamps every BAKED entry and no incomplete one", () => {
    // Counted, not `.every()`-ed: the two tallies print, and a corpus that lost its baked
    // entries would fail the floor instead of passing vacuously.
    const baked = doc.entries.filter((e) => e.status === "baked")
    const incomplete = doc.entries.filter((e) => e.status !== "baked")
    expect(baked.length).toBeGreaterThan(20)
    expect(baked.filter((e) => e.freshness !== undefined).length).toBe(baked.length)
    // The KEY must be absent, not present-holding-undefined — `Object.keys` sees the difference
    // that `JSON.stringify` hides.
    expect(incomplete.filter((e) => Object.keys(e).includes("freshness"))).toEqual([])
  })

  it("yields exactly the two bases the corpus actually has, printed as a set", () => {
    const bases = [
      ...new Set(
        doc.entries
          .filter((e) => e.status === "baked")
          .map((e) => (e.freshness as { basis: string } | undefined)?.basis),
      ),
    ].sort()
    // Both must appear: fixtures anchored, registry entries real. A single-basis result means
    // either the anchor branch or the real branch stopped being exercised by the live corpus.
    expect(bases).toEqual(["fixture-anchor", "snapshot-fetchedAt"])
  })

  it("agrees with a fresh computation over the committed observedAt + bakedAt", () => {
    // The end-to-end tie: recompute every entry from committed bytes and compare the whole
    // projection. This is what makes a hand-edited `freshness` block in `index.json` fail.
    const now = doc.bakedAt as string
    const mismatches = doc.entries
      .filter((e) => e.status === "baked")
      .map((e) => ({ name: e.canonicalName, got: e.freshness, want: computeFreshness({ observedAt: e.observedAt, now }) }))
      .filter((r) => JSON.stringify(r.got) !== JSON.stringify(r.want))
    expect(mismatches).toEqual([])
  })
})
