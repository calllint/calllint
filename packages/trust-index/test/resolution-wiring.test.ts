/**
 * R-10 wiring — the resolution block on the SERVED index, measured against committed bytes.
 *
 * The calculator's own suite (`resolution.test.ts`) proves the arithmetic. This proves the emit:
 * that the block reaches `index.json` and NOWHERE else, that `bakedAt` is not an axis, and that
 * `publishedAt` finally has a consumer. Both halves of each are asserted — a positive control that
 * the bytes DO move, and a zero-movement assertion over every page, digest and verdict — because a
 * parameter that changed nothing would be wiring in name only.
 */

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { emitAllCohorts } from "../src/emitCohort.js"
import { parseSnapshot } from "../src/snapshot.js"
import { parseEvidenceSnapshot } from "../src/evidenceSnapshot.js"
import { registryCohort } from "../src/registryCohort.js"
import { CADENCE_DAYS } from "../src/freshness.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAP = resolve(HERE, "..", "snapshots", "official-mcp-registry.json")
const EVIDENCE = resolve(HERE, "..", "snapshots", "evidence-snapshot.json")

const snapshot = parseSnapshot(readFileSync(SNAP, "utf8"))
const evidence = parseEvidenceSnapshot(readFileSync(EVIDENCE, "utf8"))
const NOW = "2026-08-30T00:00:00.000Z"

interface Entry {
  canonicalName: string
  status: string
  verdict: string | null
  resolution?: {
    status: string
    basis: Array<{ axis: string; at: string; ageDays: number }>
    lastSuccessfulResolution: string | null
    nextRequiredResolution: string | null
    blockingUnknowns: string[]
    cadenceDays: number
  }
  upstreamAgeDays?: number
}

function indexOf(now: string | null): { entries: Entry[]; doc: Record<string, unknown> } {
  const { files } = emitAllCohorts(snapshot, undefined, evidence, [], undefined, undefined, null, now)
  const raw = files.find((f) => f.path === "index.json")
  if (raw === undefined) throw new Error("emit produced no index.json")
  const doc = JSON.parse(raw.content) as Record<string, unknown> & { entries: Entry[] }
  return { entries: doc.entries, doc }
}

const registryEntries = (es: Entry[]): Entry[] => es.filter((e) => e.canonicalName.startsWith("mcp-registry/"))
const fixtureEntries = (es: Entry[]): Entry[] => es.filter((e) => e.canonicalName.startsWith("calllint-fixtures/"))

describe("the resolution block reaches index.json (positive control)", () => {
  const { entries, doc } = indexOf(NOW)

  it("lands on every BAKED entry and on no incomplete one", () => {
    const withBlock = entries.filter((e) => e.resolution !== undefined).map((e) => e.status)
    const bakedCount = entries.filter((e) => e.status === "baked").length
    expect(withBlock).toEqual(Array.from({ length: bakedCount }, () => "baked"))
    // Non-vacuous: a corpus that baked nothing would satisfy the line above trivially.
    expect(bakedCount).toBeGreaterThan(30)
  })

  it("decides a registry entry over BOTH axes, with the deadline set by the older one", () => {
    const e = registryEntries(entries)[0]
    expect(e?.resolution).toEqual({
      status: "AGING",
      basis: [
        { axis: "evidence-resolution", at: evidence.resolvedAt, ageDays: 20 },
        { axis: "source-observation", at: snapshot.fetchedAt, ageDays: 20 },
      ],
      // The NEWEST instant — when we last succeeded at anything.
      lastSuccessfulResolution: evidence.resolvedAt,
      // The OLDEST instant + cadence — the deadline the weakest axis sets. Note it is already in
      // the past relative to NOW, which is why the status is not FRESH.
      nextRequiredResolution: "2026-08-17T00:00:00.000Z",
      blockingUnknowns: [],
      cadenceDays: CADENCE_DAYS,
    })
  })

  it("reports UNKNOWN for a fixture, whose observation instant is a pinned constant", () => {
    const f = fixtureEntries(entries).filter((e) => e.status === "baked")
    const distinct = [...new Set(f.map((e) => JSON.stringify(e.resolution)))]
    expect(distinct).toEqual([
      JSON.stringify({
        status: "UNKNOWN",
        basis: [],
        lastSuccessfulResolution: null,
        nextRequiredResolution: null,
        blockingUnknowns: ["source-observation"],
        cadenceDays: CADENCE_DAYS,
      }),
    ])
    expect(f.length).toBeGreaterThan(15)
  })

  it("publishes the coverage limit once, at the document level", () => {
    expect(doc.resolutionPolicy).toEqual({
      cadenceDays: CADENCE_DAYS,
      agingMultiple: 3,
      measuredAxes: ["source-observation", "evidence-resolution"],
      unmeasuredAxes: expect.any(Array),
    })
    const policy = doc.resolutionPolicy as { unmeasuredAxes: unknown[] }
    expect(policy.unmeasuredAxes.length).toBe(7)
  })
})

describe("INV-R11 on the served plane — a re-bake does not make old evidence new", () => {
  /**
   * THE LOAD-BEARING ASSERTION OF THIS BATCH. `bakedAt` is not a resolution axis, so advancing the
   * bake clock by a year must make every entry WORSE, never better. An implementation that included
   * the bake instant would report FRESH forever and the field would measure our CI cadence instead
   * of our knowledge (§P4: 页面重新生成不能让旧 evidence 变新).
   *
   * Stated as a transition table rather than a count, so a red prints which entry moved which way.
   */
  it("degrades status as the bake clock advances, and never improves it", () => {
    const before = indexOf(NOW).entries
    const after = indexOf("2027-08-06T00:00:00.000Z").entries
    const rank: Record<string, number> = { FRESH: 3, AGING: 2, STALE: 1, UNKNOWN: 0 }
    const improved = before
      .map((b, i) => ({ name: b.canonicalName, from: b.resolution?.status, to: after[i]?.resolution?.status }))
      .filter((t) => t.from !== undefined && t.to !== undefined && rank[t.to ?? ""]! > rank[t.from ?? ""]!)
    expect(improved).toEqual([])
    // Non-vacuous: something must actually have moved, or the assertion above is satisfied by a
    // field that never responds to the clock at all.
    const moved = before.filter((b, i) => b.resolution?.status !== after[i]?.resolution?.status)
    expect(moved.map((m) => m.canonicalName).length).toBe(25)
  })

  it("leaves lastSuccessfulResolution untouched by the later bake", () => {
    const before = registryEntries(indexOf(NOW).entries)
    const after = registryEntries(indexOf("2027-08-06T00:00:00.000Z").entries)
    expect(new Set(after.map((e) => e.resolution?.lastSuccessfulResolution))).toEqual(
      new Set(before.map((e) => e.resolution?.lastSuccessfulResolution)),
    )
    expect(after[0]?.resolution?.lastSuccessfulResolution).toBe(evidence.resolvedAt)
  })
})

describe("zero movement outside index.json (the opposing half)", () => {
  it("moves no page, digest, verdict or any other file", () => {
    const withNow = emitAllCohorts(snapshot, undefined, evidence, [], undefined, undefined, null, NOW)
    const without = emitAllCohorts(snapshot, undefined, evidence, [], undefined, undefined, null, null)
    const differing = withNow.files
      .filter((f, i) => f.content !== without.files[i]?.content)
      .map((f) => f.path)
    expect(differing).toEqual(["index.json"])
  })

  it("emits no resolution key at all when no clock is injected (fail-inert)", () => {
    const { entries, doc } = indexOf(null)
    const keys = [...new Set(entries.flatMap((e) => Object.keys(e)))]
    expect(keys.filter((k) => k === "resolution" || k === "upstreamAgeDays")).toEqual([])
    expect("resolutionPolicy" in doc).toBe(false)
  })
})

describe("publishedAt finally has a consumer (gaps §1.4)", () => {
  /**
   * The inverse of R-2's finding that "a column with no producer is not a feature". Here the
   * producer existed — `fetchRegistry` has written `publishedAt` since I1a and 18 of the 19
   * committed entries carry one — and `registryCohort` structurally dropped it when building its
   * plan, so no consumer could ever see it.
   */
  it("carries the upstream instant through the cohort plan", () => {
    const plans = registryCohort(snapshot)
    const carried = plans.filter((p) => p.publishedAt !== undefined && p.publishedAt !== null).length
    expect({ carried, total: plans.length }).toEqual({ carried: 25, total: 25 })
  })

  it("projects it as upstreamAgeDays on the served entry, distinct from the observation age", () => {
    const entries = registryEntries(indexOf(NOW).entries)
    const withAge = entries.filter((e) => e.upstreamAgeDays !== undefined)
    expect(withAge.length).toBe(25)
    // Distinct from the source axis by construction: the upstream ages span months while every
    // entry's observation age is the snapshot's single `fetchedAt`. If these agreed, `publishedAt`
    // would be a restatement of `observedAt` rather than a second fact.
    const spread = [...new Set(withAge.map((e) => e.upstreamAgeDays))]
    expect(spread.length).toBeGreaterThan(10)
    expect(Math.max(...(withAge.map((e) => e.upstreamAgeDays ?? 0)))).toBe(162)
  })

  /**
   * The measurement that rules `publishedAt` OUT as a status axis, asserted so a future batch
   * cannot quietly promote it. The oldest upstream release is 162 days before the committed bake —
   * far past `cadenceDays * agingMultiple` — so treating release age as staleness would report a
   * stable package nobody has needed to republish as permanently STALE.
   */
  it("does not let upstream age touch the status", () => {
    const entries = registryEntries(indexOf(NOW).entries)
    const oldest = [...entries].sort((a, b) => (b.upstreamAgeDays ?? 0) - (a.upstreamAgeDays ?? 0))[0]
    expect(oldest?.upstreamAgeDays).toBeGreaterThan(CADENCE_DAYS * 3)
    expect(oldest?.resolution?.status).toBe("AGING")
    expect(oldest?.resolution?.basis.map((b) => b.axis)).toEqual(["evidence-resolution", "source-observation"])
  })

  it("omits the key rather than defaulting when the registry declared no release instant", () => {
    const entries = registryEntries(indexOf(NOW).entries)
    const missing = entries.filter((e) => e.upstreamAgeDays === undefined)
    expect(missing.length).toBe(1)
    expect(Object.keys(missing[0] ?? {}).includes("upstreamAgeDays")).toBe(false)
  })
})

describe("INV-R11 second half — freshness never modifies a verdict", () => {
  /**
   * The zero-movement test above proves no verdict MOVED on this corpus. That is necessary but not
   * sufficient: a corpus where every entry happens to land on the same verdict either way would
   * satisfy it. This is the structural half — the verdict engine cannot reach this calculator at
   * all, so no future corpus can make it matter (ADR 0053 §5, ADR 0061 §4).
   *
   * Reads CODE, not prose: the docblocks in `resolution.ts` argue at length ABOUT verdicts, so a
   * bare grep for `computeVerdict` matches the argument for the rule and the gate would pass (or
   * fail) for the wrong reason. Comments are stripped first.
   */
  function codeOf(rel: string): string {
    return readFileSync(resolve(HERE, "..", "src", rel), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
  }

  it("imports nothing that decides a verdict", () => {
    const code = codeOf("resolution.ts")
    // Positive control on the stripper: if it ate the file, every absence below is vacuous.
    expect(code.length).toBeGreaterThan(400)
    expect(code).toContain("export function computeResolution")
    const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1])
    expect(imports).toEqual(["./freshness.js"])
  })

  it("names no verdict token in its logic", () => {
    const code = codeOf("resolution.ts")
    const forbidden = ["computeVerdict", "risk-engine", "BLOCK", "SAFE", "REVIEW", "score", "policyDigest"]
    expect(forbidden.filter((t) => code.includes(t))).toEqual([])
  })
})
