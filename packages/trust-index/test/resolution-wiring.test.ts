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
const NOW = "2026-08-31T00:00:00.000Z"

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
    // Both `ageDays` and the deadline are pure functions of (NOW, the two instants, CADENCE_DAYS).
    // Derived here rather than pinned as literals, because a snapshot refresh moves `fetchedAt` and
    // would red this test over arithmetic it is not about. What the test IS about — that both axes
    // report, that the deadline follows the OLDER instant, and that the status is AGING — stays
    // asserted exactly, and each still reds if the wiring picks the wrong axis.
    const days = (from: string): number =>
      Math.floor((Date.parse(NOW) - Date.parse(from)) / 86_400_000)
    const older = Date.parse(evidence.resolvedAt) < Date.parse(snapshot.fetchedAt) ? evidence.resolvedAt : snapshot.fetchedAt
    const deadline = new Date(Date.parse(older) + CADENCE_DAYS * 86_400_000).toISOString()
    // The deadline must be in the PAST relative to NOW, or the status below could not be AGING —
    // asserted so the derivation cannot silently become a restatement of whatever emit produced.
    expect(Date.parse(deadline), "the deadline must already have passed for AGING to be correct").toBeLessThan(
      Date.parse(NOW),
    )
    const e = registryEntries(entries)[0]
    expect(e?.resolution).toEqual({
      status: "AGING",
      basis: [
        { axis: "evidence-resolution", at: evidence.resolvedAt, ageDays: days(evidence.resolvedAt) },
        { axis: "source-observation", at: snapshot.fetchedAt, ageDays: days(snapshot.fetchedAt) },
      ],
      // The NEWEST instant — when we last succeeded at anything.
      lastSuccessfulResolution: evidence.resolvedAt,
      // The OLDEST instant + cadence — the deadline the weakest axis sets. Note it is already in
      // the past relative to NOW, which is why the status is not FRESH.
      nextRequiredResolution: deadline,
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
    // Every REGISTRY entry must respond to the clock. Scoped to the registry rather than to
    // "everything with a resolution block", because fixtures carry one too and theirs is pinned:
    // their observation instant is a constant, so they report UNKNOWN at every bake clock and
    // correctly never move. Counting them would demand movement from the entries designed not to
    // move. Derived from the corpus, so a snapshot refresh does not red this.
    const clockDriven = registryEntries(before).filter((b) => b.resolution?.status !== undefined).length
    expect(clockDriven, "nothing is clock-driven, so 'never improves' is vacuous").toBeGreaterThan(0)
    expect(moved.map((m) => m.canonicalName).length).toBe(clockDriven)
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
    // SCOPED TO THE SCANNABLE PLANS, which is where the claim can hold at all. `publishedAt` is a
    // display field on a page, and `registryCohort` deliberately omits it on the incomplete
    // branches "for the same reason `identity` is: an entry with nothing to scan has no page to
    // carry a display field" (`registryCohort.ts`). Asserting over ALL plans conflated "the
    // instant was dropped" with "there is no page to put it on" — two different facts, and the
    // 2026-08-17 refresh produced the second: `ai.ankimcp/anki-mcp-server-addon` declares neither
    // a remote nor a package, so it plans as `input: null` and carries no instant, correctly. Its
    // snapshot entry HAS a `publishedAt` (measured: 0 of 100 snapshot entries lack one), so the
    // drop is the plan's design, not a lost field.
    const scannable = plans.filter((p) => p.input !== null)
    const carried = scannable.filter((p) => p.publishedAt !== undefined && p.publishedAt !== null).length
    // The relation, not a cohort literal — a refresh where a SCANNABLE entry loses its
    // `publishedAt` still reds here, and prints both numbers.
    expect(scannable.length, "an empty plan set carries everything trivially").toBeGreaterThan(0)
    expect({ carried, total: scannable.length }).toEqual({
      carried: scannable.length,
      total: scannable.length,
    })
    // And the omission is attributable: every plan that carries no instant must be one with
    // nothing to scan. This is the half that keeps the narrowing above honest — without it,
    // scoping to `input !== null` could hide a genuine drop behind a growing incomplete set.
    expect(
      plans.filter((p) => p.publishedAt === undefined || p.publishedAt === null).map((p) => p.input),
      "an instant may be missing ONLY where there is no page to carry it",
    ).toEqual(plans.filter((p) => p.publishedAt === undefined || p.publishedAt === null).map(() => null))
  })

  it("projects it as upstreamAgeDays on the served entry, distinct from the observation age", () => {
    const entries = registryEntries(indexOf(NOW).entries)
    // BAKED entries only — the same scoping the plan-level assertion above explains. An
    // `incomplete` entry reaches the index as a row but has no page, so it carries no display
    // field; `upstreamAgeDays` is absent there by the same rule that makes `resolution` absent
    // (asserted directly in "lands on every BAKED entry and on no incomplete one").
    const baked = entries.filter((e) => e.status === "baked")
    const withAge = baked.filter((e) => e.upstreamAgeDays !== undefined)
    // Full coverage again, against the baked count rather than a cohort literal: every registry
    // entry that got a page carries an upstream age.
    expect(baked.length, "no baked registry entries reached the served plane").toBeGreaterThan(0)
    expect(withAge.length).toBe(baked.length)
    // Attributable, exactly as above: the only entries without an age are the ones without a page.
    expect(
      entries.filter((e) => e.upstreamAgeDays === undefined).map((e) => e.status),
      "an upstream age may be absent ONLY on an entry that got no page",
    ).toEqual(entries.filter((e) => e.upstreamAgeDays === undefined).map(() => "incomplete"))
    // Distinct from the source axis by construction: the upstream ages span months while every
    // entry's observation age is the snapshot's single `fetchedAt`. If these agreed, `publishedAt`
    // would be a restatement of `observedAt` rather than a second fact.
    const spread = [...new Set(withAge.map((e) => e.upstreamAgeDays))]
    expect(spread.length).toBeGreaterThan(10)
    // The DISTINCTION, not the extremum. This used to pin the oldest release at 187 days, which
    // was true of the 25-entry cohort and became 354 at 100 — a literal that tracks whichever
    // entry happens to survive the cap, and says nothing about the two axes being different facts.
    // What is actually claimed: the upstream axis spans far more time than the observation axis,
    // which is a single instant (`fetchedAt`) shared by every entry. If `publishedAt` were a
    // restatement of `observedAt`, the spread would collapse to one value and this reds.
    const observationAgeDays = Math.floor((Date.parse(NOW) - Date.parse(snapshot.fetchedAt)) / 86_400_000)
    expect(
      Math.max(...withAge.map((e) => e.upstreamAgeDays ?? 0)),
      "the upstream axis must reach further back than the single observation instant",
    ).toBeGreaterThan(observationAgeDays)
  })

  /**
   * The measurement that rules `publishedAt` OUT as a status axis, asserted so a future batch
   * cannot quietly promote it. The oldest upstream release sits far past `cadenceDays *
   * agingMultiple` before the committed bake (187 days at cohort 25, 354 at cohort 100 — the
   * figure moves with whichever entry survives the cap, which is why the assertion below is an
   * inequality against the cadence rather than a pinned day count). Treating release age as
   * staleness would report a stable package nobody has needed to republish as permanently STALE.
   */
  it("does not let upstream age touch the status", () => {
    const entries = registryEntries(indexOf(NOW).entries)
    const oldest = [...entries].sort((a, b) => (b.upstreamAgeDays ?? 0) - (a.upstreamAgeDays ?? 0))[0]
    expect(oldest?.upstreamAgeDays).toBeGreaterThan(CADENCE_DAYS * 3)
    expect(oldest?.resolution?.status).toBe("AGING")
    expect(oldest?.resolution?.basis.map((b) => b.axis)).toEqual(["evidence-resolution", "source-observation"])
  })

  /**
   * Omission must never become a default — `upstreamAgeDays: 0` would read as "released
   * today" for an entry that declared no instant at all.
   *
   * At cohort 19 one committed entry lacked `publishedAt`, so the corpus itself was the
   * witness. The 19→25 refresh removed it: all 25 now carry one, measured. That makes the
   * corpus-based form of this test VACUOUS — `expect(missing.length).toBe(0)` asserts the
   * witness is gone and then proves nothing about the rule, and an `if (defined)` loop over
   * the remaining entries is a tautology (it checks that defined values are defined).
   *
   * So the rule is proven where it lives: over a SYNTHETIC snapshot fed through the SHIPPED
   * `emitAllCohorts`, with one entry stripped of `publishedAt` and one retaining it. The
   * corpus count is still pinned below, as a precondition that says WHY the synthetic branch
   * is load-bearing rather than leaving its absence unstated.
   */
  it("omits the key rather than defaulting when the registry declared no release instant", () => {
    const entries = registryEntries(indexOf(NOW).entries)
    // PRECONDITION, restated on 2026-08-17: no committed entry witnesses THIS rule. Every snapshot
    // entry declares a `publishedAt` (measured: 0 of 100 lack one), so the corpus cannot exhibit
    // the "declared no release instant" case at all, which is why the synthetic branch below is
    // load-bearing.
    //
    // The earlier form asserted `upstreamAgeDays === undefined` was empty. That became false
    // without the rule changing: `ai.ankimcp/anki-mcp-server-addon` has an instant and no page, so
    // it omits the field for the OTHER reason — nothing to scan. Counting those as witnesses would
    // have read a page-less entry as a no-instant entry and left this test looking satisfied by a
    // corpus that never contained its subject.
    expect(
      entries.filter((e) => e.upstreamAgeDays === undefined && e.status === "baked").length,
      "precondition: no baked entry may omit the age — an omission there would mean a lost instant",
    ).toBe(0)
    expect(
      (snapshot.entries as { publishedAt: string | null }[]).filter((e) => e.publishedAt === null).length,
      "precondition: the corpus declares an instant everywhere, so only the synthetic pair below can witness the omission rule",
    ).toBe(0)

    // The rule half. Two entries, identical but for `publishedAt`, through the shipped emit.
    const base = snapshot.entries[0]!
    const synthetic = {
      ...snapshot,
      count: 2,
      entries: [
        { ...base, name: "io.example/with-instant", publishedAt: base.publishedAt },
        // `null`, not `undefined`: `SnapshotEntry.publishedAt` is `string | null`, so null IS
        // the shape a registry entry takes when it declares no release instant. The emit site
        // treats both the same (`=== undefined || === null`); null is the reachable one.
        { ...base, name: "io.example/no-instant", publishedAt: null },
      ],
    }
    const { files } = emitAllCohorts(synthetic, undefined, evidence, [], undefined, undefined, null, NOW)
    const doc = JSON.parse(files.find((f) => f.path === "index.json")!.content) as { entries: Entry[] }
    const withInstant = doc.entries.find((e) => e.canonicalName.endsWith("with-instant"))
    const noInstant = doc.entries.find((e) => e.canonicalName.endsWith("no-instant"))

    expect(withInstant, "the synthetic corpus must bake the entry that HAS an instant").toBeDefined()
    expect(noInstant, "the synthetic corpus must bake the entry that lacks one").toBeDefined()
    // Non-vacuity: the positive twin proves the projection is live on this corpus, so the
    // negative twin's silence is attributable to the missing field and to nothing else.
    expect(typeof withInstant!.upstreamAgeDays, "the instant-bearing twin must project an age").toBe("number")
    expect(
      Object.keys(noInstant!).includes("upstreamAgeDays"),
      "an entry with no declared instant must OMIT the key, never default it to 0",
    ).toBe(false)
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
