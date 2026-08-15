/**
 * registryCollisions — a slug collision REPORTED, not silently elected (R-3).
 *
 * `registryCohort` has always resolved a slug collision by keeping the first entry and marking
 * the rest incomplete. That election answers "which file owns this path". It does NOT answer
 * "are these the same product", and reading it as though it did is exactly how one product's
 * evidence would reach another product's page. R-3 adds the second answer beside it as a plain
 * value, so identity resolution can refuse the merge instead of inheriting a silent winner.
 *
 * WHAT THIS FILE IS MOSTLY GUARDING IS THAT NOTHING MOVED. The election's outputs are served
 * bytes — `incompleteReason` reaches `markIncomplete` and from there the committed tree — so
 * the strongest assertions here are equalities against the pre-R-3 behaviour, not against the
 * new function. An observation that changed what bakes would have failed the byte gate anyway;
 * this file is where it fails with a name instead.
 *
 * SYNTHETIC BY NECESSITY (control #21). Measured on the committed corpus: 19 retained entries →
 * 19 distinct slugs → ZERO collisions. So `registryCollisions` returns `[]` on all real data,
 * and a suite that only replayed the snapshot would report green over a branch it never
 * entered. The corpus is still measured below, because "zero on real data" is a claim with an
 * expiry date: a future snapshot refresh could introduce a genuine collision, and this file
 * should be the thing that says so.
 *
 * Negative controls this file is the measurement for:
 *   #1  the slug is lossy ⇒ never an identity key — the collision is the proof
 *   #5  keep-the-first with no report — the silent election R-3 replaces
 *   #19 the decoupling rule: collisions flow OUTWARD as plain values
 *   #21 asserting the collision path on real data only, which cannot reach it
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  registryCohort,
  registryCollisions,
  registryCanonicalName,
  parseSnapshot,
  type RegistrySnapshot,
  type SnapshotEntry,
} from "../src/index.js"

const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "snapshots",
  "official-mcp-registry.json",
)

const entry = (over: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  name: "io.example/thing",
  description: "d",
  version: "1.0.0",
  repositoryUrl: null,
  packages: [],
  remotes: [],
  status: "active",
  publishedAt: null,
  ...over,
})

/** A snapshot carrying exactly the given names, each with something scannable. */
function snapshotOf(...names: string[]): RegistrySnapshot {
  return {
    schema: "calllint.trust-snapshot.v0",
    source: "official-mcp-registry",
    endpoint: "e",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    count: names.length,
    entries: names.map((name) => entry({ name, remotes: [{ type: "http", url: `https://${name}.dev` }] })),
  }
}

describe("the colliding witness, measured rather than assumed", () => {
  it("collides on `/` only — `.` and `-` are preserved, so `a-b-c` is NOT the pair", () => {
    // THE CORRECTION THIS FILE EXISTS DOWNSTREAM OF. The plan and three docblocks offered
    // `a.b/c` / `a-b-c` as the colliding pair. It is not one: `registryCanonicalName` preserves
    // `[a-z0-9._-]` and rewrites only the runs outside it, so `/` → `-` while `.` and `-` pass
    // through untouched. Asserted as an equality-and-inequality pair so the mechanism is
    // visible, not just the verdict.
    expect(registryCanonicalName("a.b/c")).toBe(registryCanonicalName("a.b-c"))
    expect(registryCanonicalName("a.b/c")).not.toBe(registryCanonicalName("a-b-c"))
    // The lowercase step is a second, independent path to one slug.
    expect(registryCanonicalName("A.B/C")).toBe(registryCanonicalName("a.b/c"))
  })
})

describe("registryCollisions", () => {
  it("reports the shared slug and every ORIGINAL name, sorted", () => {
    const found = registryCollisions(snapshotOf("a.b/c", "a.b-c", "x/y"))
    expect(found).toHaveLength(1)
    // The slug names the symptom; the original names are the evidence a human adjudicates from.
    // Reporting only the former would discard the only thing that distinguishes the two products.
    expect(found[0]!.canonicalName).toBe(registryCanonicalName("a.b/c"))
    expect(found[0]!.entryNames).toEqual(["a.b-c", "a.b/c"])
  })

  it("reports every distinct collision, sorted by slug, and never a group of one", () => {
    const found = registryCollisions(snapshotOf("x/y", "x-y", "a.b/c", "a.b-c", "io.lonely/one"))
    expect(found).toHaveLength(2)
    expect(found.map((c) => c.canonicalName)).toEqual([...found.map((c) => c.canonicalName)].sort())
    // `minItems: 2` in the same spirit as a conflict's participants: a group of one is not a
    // collision, and emitting it would make the report's length meaningless as a signal.
    expect(found.every((c) => c.entryNames.length >= 2)).toBe(true)
    expect(found.flatMap((c) => c.entryNames)).not.toContain("io.lonely/one")
  })

  it("groups all three when three names share one slug", () => {
    const found = registryCollisions(snapshotOf("a.b/c", "a.b-c", "A.B/C"))
    expect(found).toHaveLength(1)
    expect(found[0]!.entryNames).toEqual(["A.B/C", "a.b-c", "a.b/c"])
  })

  it("returns [] for a clean snapshot", () => {
    expect(registryCollisions(snapshotOf("io.a/x", "io.b/x", "io.c/x"))).toEqual([])
  })
})

describe("reporting a collision changes NOTHING that bakes", () => {
  const colliding = snapshotOf("a.b/c", "a.b-c")

  it("still elects the first and still marks the rest incomplete, byte for byte", () => {
    const plans = registryCohort(colliding)
    expect(plans).toHaveLength(2)
    const baked = plans.filter((p) => p.input !== null)
    const skipped = plans.filter((p) => p.input === null)
    expect(baked).toHaveLength(1)
    expect(skipped).toHaveLength(1)
    // The exact string, not a pattern. It reaches `markIncomplete` and from there the committed
    // tree, so it is a served byte: `toMatch(/duplicate/)` would pass while the bytes moved.
    expect(skipped[0]!.incompleteReason).toBe(
      `duplicate canonical name after slug — kept the first "${registryCanonicalName("a.b/c")}"`,
    )
  })

  it("the cohort is identical whether or not collisions were computed", () => {
    // The observation must be a pure read. Computing it first and comparing proves
    // `registryCollisions` shares no mutable state with the election — the two Maps are
    // independent, so an accidental `seen`-set reuse would show up here as a changed cohort.
    const before = registryCohort(colliding)
    registryCollisions(colliding)
    expect(registryCohort(colliding)).toEqual(before)
  })

  it("one path is claimed even when two names want it — the election's actual job", () => {
    const plans = registryCohort(colliding)
    const paths = plans.filter((p) => p.input !== null).map((p) => p.input!.canonicalName)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe("the committed corpus (control #21)", () => {
  const snapshot = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8"))

  it("has ZERO collisions — which is why every case above is synthetic", () => {
    // A vacuity guard, not a cohort size requirement: `registryCollisions([])` is trivially `[]`,
    // so the claim below needs a non-empty corpus to mean anything. The exact size belongs to
    // `gate-s0-claims`, which owns which snapshot is committed; pinning it here reds this test on
    // every refresh that changes nothing about collisions.
    expect(snapshot.entries.length, "zero collisions is vacuous on an empty corpus").toBeGreaterThan(0)
    expect(registryCollisions(snapshot)).toEqual([])
    // Stated as the mechanism too, so a future refresh that introduces a real collision fails
    // HERE with a name rather than somewhere downstream as a mysteriously merged page.
    const slugs = snapshot.entries.map((e) => registryCanonicalName(e.name))
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it("bakes no entry as a slug duplicate", () => {
    const reasons = registryCohort(snapshot)
      .map((p) => p.incompleteReason)
      .filter((r): r is string => r !== undefined)
    expect(reasons.filter((r) => r.includes("duplicate canonical name"))).toEqual([])
  })
})

describe("the decoupling rule (control #19)", () => {
  it("carries plain values only — no adoption-index type reaches this surface", () => {
    // `packages/trust-index` must gain no dependency on `@calllint/adoption-index`: the identity
    // layer consumes this shape, never the reverse.
    //
    // WHICH GATE ACTUALLY OWNS THAT, CORRECTED BY MEASUREMENT. This comment first pointed at the
    // module-graph gate (`tests/invariants/adoption-index-unreachable.invariants.test.ts`) as
    // "the real enforcement" for an import in `registryCohort.ts`. Measured: that import leaves
    // the gate at 11/11 GREEN. The gate walks from the two PUBLISHED bundle entry points, and no
    // shipped bundle reaches `emitCohort` — it is a bake-time module — so `registryCohort` is not
    // on the graph under test at all. The same import in `matchLexical.ts`, which IS on it, fails
    // three ways (15 modules bundled, the specifier named, `better-sqlite3` named). A control
    // that cannot go red where you aimed it is a finding about the harness (R-2 control #11);
    // this is the second one in R-3, after #16.
    //
    // So THIS assertion is the enforcement for this file: the collision must stay a plain
    // structural value, because a boundary that is one-directional by construction is what keeps
    // the store out — not a gate whose graph never reaches here.
    const [c] = registryCollisions(snapshotOf("a.b/c", "a.b-c"))
    expect(Object.keys(c!).sort()).toEqual(["canonicalName", "entryNames"])
    expect(typeof c!.canonicalName).toBe("string")
    expect(c!.entryNames.every((n) => typeof n === "string")).toBe(true)
  })
})
