/**
 * cohort-conservation — the reader ADR 0085 says the projection never had.
 *
 * The defect this file measures is not "a hash chose the wrong version". It is that **58 of 293
 * live subjects vanished and every gate stayed green**, because nothing compared the mirror's
 * live population against the cohort. The count ratchet cannot see it by construction: it reads
 * the cohort against its own previous value, and a projection that has always dropped a fifth
 * reports a stable number forever. `assertMirrorComplete` cannot either — it measures the READ,
 * and the read was complete.
 *
 * So the assertions here are keyed on the OBSERVABLE, never the mechanism. Every test asks "is a
 * live subject missing, and does something explain it?" and none of them mentions the window
 * function ADR 0085 D1 fixed. That is deliberate: a guard written against the `ORDER BY` would go
 * green the moment the same drop arrived through the filter, the cap, or the entry mapper
 * (`a-trigger-keyed-to-the-mechanism-misses-the-subject`).
 *
 * Two properties of the guard need their own measurement, because getting either wrong produces a
 * green that means nothing:
 *
 *   1. THE CAP MUST NOT RED. It is a designed exclusion — at cohort 100 against 293 live subjects
 *      193 are excluded by design, and a guard that treated that as a fault would refuse every
 *      real run. Tested with a cap that actually binds.
 *   2. `droppedByCap` MUST BE MEASURED, NOT DERIVED. Defining it as `currentLive - served` makes
 *      the partition arithmetically true no matter what the cap did, which is a guard that cannot
 *      fail. It is computed by re-projecting with a non-binding ceiling and diffing against the
 *      served names, so it is the shipped `selectCohortEntries` that decides — reserved names,
 *      clamp and all.
 *
 * The store-level fault (a live current row with no live row in the mirror) is asserted against a
 * HAND-BUILT conservation record, not a store. It is arithmetically unreachable through the real
 * reads — a current row IS one of the rows — so the only honest way to exercise the branch is to
 * construct the impossible input directly and check the guard says so. A test that tried to reach
 * it through a store would either be impossible to write or would prove the store broken.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  createOfficialRegistryAdapter,
  refreshFromMirror,
  measureCohortConservation,
  assertCohortConserved,
  CohortConservationError,
  projectSnapshot,
  toSourceRecord,
  MIGRATIONS_DIRNAME,
  type CohortConservation,
  type SourceRecordV1,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"
const T0 = "2026-08-01T00:00:00.000Z"
const T1 = "2026-08-02T00:00:00.000Z"

function item(name: string, extra?: Record<string, unknown>, meta?: Record<string, unknown>): Record<string, unknown> {
  return {
    server: { name, ...(extra ?? {}) },
    _meta: { [OFFICIAL_META]: { status: "active", isLatest: true, ...(meta ?? {}) } },
  }
}

function stubFetch(payload: unknown): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch
}

/** A domain record straight from the shipped parser — never a hand-built object literal. */
function record(raw: Record<string, unknown>, at = T0): SourceRecordV1 {
  const parsed = toSourceRecord(raw as never, at)
  if (parsed === null) throw new Error("fixture did not parse")
  return parsed
}

const dirs: string[] = []
const stores: AdoptionIndexStore[] = []
afterEach(() => {
  while (stores.length > 0) {
    try {
      stores.pop()!.close()
    } catch {
      // Already closed by the test; the temp dir removal below is what matters.
    }
  }
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function freshStore(now = T0): Promise<AdoptionIndexStore> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-conserve-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now })
  stores.push(store)
  return store
}

/** Project a set of current records the way the operation does, so a fixture has a real snapshot. */
function snapshotOf(records: readonly SourceRecordV1[], maxEntries: number) {
  return projectSnapshot({ records, endpoint: ENDPOINT, fetchedAt: T0, maxEntries })
}

describe("the measurement partitions the mirror's live population (ADR 0085)", () => {
  it("accounts for every live subject: served + capped, with nothing left over", () => {
    const raws = [item("io.example/alpha"), item("io.example/bravo"), item("io.example/charlie")]
    const records = raws.map((r) => record(r))
    const conservation = measureCohortConservation({
      allRecords: records,
      currentRecords: records,
      snapshot: snapshotOf(records, 100),
    })

    expect(conservation.liveInMirror).toBe(3)
    expect(conservation.currentLive).toBe(3)
    expect(conservation.served).toBe(3)
    expect(conservation.droppedByCap).toEqual([])
    expect(conservation.droppedByStaleCurrentRow).toEqual([])
    expect(() => assertCohortConserved(conservation)).not.toThrow()
  })

  it("attributes a BINDING cap to the cap and does not red — the exclusion is designed", () => {
    // The precondition graded first: 3 live subjects against a ceiling of 1, so the cap
    // genuinely binds. With a non-binding cap this test would pass whether or not the guard
    // distinguished the two exclusion classes at all.
    const raws = [item("io.example/alpha"), item("io.example/bravo"), item("io.example/charlie")]
    const records = raws.map((r) => record(r))
    const conservation = measureCohortConservation({
      allRecords: records,
      currentRecords: records,
      snapshot: snapshotOf(records, 1),
    })

    expect(conservation.liveInMirror).toBe(3)
    expect(conservation.served).toBe(1)
    // Named, not counted — an operator cannot act on "2 dropped". Alphabetical, so the cap kept
    // `alpha` and excluded the other two.
    expect(conservation.droppedByCap).toEqual(["io.example/bravo", "io.example/charlie"])
    expect(conservation.droppedByStaleCurrentRow).toEqual([])
    // THE LOAD-BEARING ASSERTION OF THIS FILE. A guard that red on a bound cap would refuse
    // every production run: the real cohort is 100 against 293 live subjects.
    expect(() => assertCohortConserved(conservation)).not.toThrow()
  })

  it("does not count a deprecated subject as live in either population", () => {
    // `isLiveCohort` is the projection's own predicate, imported rather than restated, so the
    // guard cannot drift into comparing the cohort against a different definition of "live".
    // A deprecated subject is absent from BOTH sides and is therefore not a drop.
    const live = record(item("io.example/alpha"))
    const dead = record(item("io.example/gone", {}, { status: "deprecated" }))
    const records = [live, dead]
    const conservation = measureCohortConservation({
      allRecords: records,
      currentRecords: records,
      snapshot: snapshotOf(records, 100),
    })

    expect(conservation.liveInMirror).toBe(1)
    expect(conservation.served).toBe(1)
    expect(conservation.droppedByCap).toEqual([])
    expect(conservation.droppedByStaleCurrentRow).toEqual([])
    expect(() => assertCohortConserved(conservation)).not.toThrow()
  })

  it("counts a subject live when ANY row of its history is, not only its current one", () => {
    // The distinction the whole guard rests on. History holds a live 1.0.1 row; the row chosen to
    // represent the subject is the stale 1.0.0. `liveInMirror` must see the subject through its
    // history, or the drop is invisible — which is precisely how 58 subjects went unnoticed.
    const stale = record(item("io.example/bumped", { version: "1.0.0" }, { isLatest: false, publishedAt: T0 }))
    const live = record(item("io.example/bumped", { version: "1.0.1" }, { isLatest: true, publishedAt: T1 }))
    const conservation = measureCohortConservation({
      allRecords: [stale, live],
      currentRecords: [stale],
      snapshot: snapshotOf([stale], 100),
    })

    expect(conservation.liveInMirror).toBe(1)
    expect(conservation.currentLive).toBe(0)
    expect(conservation.served).toBe(0)
    expect(conservation.droppedByStaleCurrentRow).toEqual(["io.example/bumped"])
  })
})

describe("the assertion fails CLOSED on an unexplained drop (ADR 0085)", () => {
  it("throws, naming the subject, when a live subject's current row is stale", () => {
    const stale = record(item("io.example/bumped", { version: "1.0.0" }, { isLatest: false, publishedAt: T0 }))
    const live = record(item("io.example/bumped", { version: "1.0.1" }, { isLatest: true, publishedAt: T1 }))
    const conservation = measureCohortConservation({
      allRecords: [stale, live],
      currentRecords: [stale],
      snapshot: snapshotOf([stale], 100),
    })

    expect(() => assertCohortConserved(conservation)).toThrow(CohortConservationError)
    // The subject is IN the message. A guard that reported only a count would hand the operator
    // the one number the artifact already shows them.
    expect(() => assertCohortConserved(conservation)).toThrow(/io\.example\/bumped/)
    expect(() => assertCohortConserved(conservation)).toThrow(/dropped before the cap was applied/)
  })

  it("reds on the ADR 0085 shape the fix did not remove: a NEWER deprecated latest row", () => {
    // Measured on the real 1200-row store: 0 subjects are in this state today, and 4
    // `deprecated`/`isLatest=true` rows exist, so the shape is REACHABLE and the guard must not be
    // written as if it were impossible. D1 orders `isLatest` first, so a subject holding an active
    // latest row AND a newer deprecated latest row resolves to the deprecated one.
    //
    // Whether such a subject belongs in a trust cohort is a product judgement, and this system was
    // just shown answering a product question by accident and getting it backwards (ADR 0085). So
    // it refuses rather than deciding.
    const active = record(item("io.example/twolatest", { version: "1.0.0" }, { publishedAt: T0 }))
    const deprecatedNewer = record(
      item("io.example/twolatest", { version: "2.0.0" }, { status: "deprecated", publishedAt: T1 }),
    )
    const conservation = measureCohortConservation({
      allRecords: [active, deprecatedNewer],
      currentRecords: [deprecatedNewer],
      snapshot: snapshotOf([deprecatedNewer], 100),
    })

    expect(conservation.liveInMirror).toBe(1)
    expect(conservation.served).toBe(0)
    expect(() => assertCohortConserved(conservation)).toThrow(/io\.example\/twolatest/)
  })

  it("reds when a live subject is dropped and the cap is NOT binding — the two are distinguished", () => {
    // Both classes at once, with the cap deliberately wide open. If the guard attributed the stale
    // drop to the cap, this would pass; the cap excluded nothing.
    const alpha = record(item("io.example/alpha"))
    const stale = record(item("io.example/bumped", { version: "1.0.0" }, { isLatest: false, publishedAt: T0 }))
    const live = record(item("io.example/bumped", { version: "1.0.1" }, { isLatest: true, publishedAt: T1 }))
    const conservation = measureCohortConservation({
      allRecords: [alpha, stale, live],
      currentRecords: [alpha, stale],
      snapshot: snapshotOf([alpha, stale], 100),
    })

    expect(conservation.droppedByCap).toEqual([])
    expect(conservation.droppedByStaleCurrentRow).toEqual(["io.example/bumped"])
    expect(() => assertCohortConserved(conservation)).toThrow(CohortConservationError)
  })

  it("indicts the STORE when a live current row has no live row in the mirror", () => {
    // Arithmetically unreachable through the real reads — the current row is one of the rows — so
    // the impossible input is constructed directly. Asserting through a store would need a store
    // whose two reads disagree, which is the very thing this branch exists to report.
    const impossible: CohortConservation = {
      liveInMirror: 1,
      currentLive: 2,
      served: 2,
      droppedByCap: [],
      droppedByStaleCurrentRow: [],
    }
    expect(() => assertCohortConserved(impossible)).toThrow(/cannot happen/)
    expect(() => assertCohortConserved(impossible)).toThrow(/two reads disagree/)
  })

  it("reds when the sets balance but the TOTALS do not — a miscount is still a fault", () => {
    // Every subject accounted for individually (both drop sets empty) and the arithmetic still
    // wrong. A guard that checked only the sets would pass here while reporting a cohort size the
    // artifact contradicts, which is the shape of `derived-bound-reports-where-the-interval-stopped`.
    const miscounted: CohortConservation = {
      liveInMirror: 10,
      currentLive: 10,
      served: 7,
      droppedByCap: [],
      droppedByStaleCurrentRow: [],
    }
    expect(() => assertCohortConserved(miscounted)).toThrow(/partition does not add up/)
  })
})

describe("the guard runs inside the operation, before anything is written (ADR 0085)", () => {
  const payload = {
    servers: [
      item("io.example/alpha", { description: "first", version: "1.0.0" }, { publishedAt: T0 }),
      item("io.example/bravo", { description: "second", version: "2.0.0" }, { publishedAt: T0 }),
      item("io.example/gone", {}, { status: "deprecated" }),
    ],
  }

  async function refresh(store: AdoptionIndexStore, over?: Partial<Parameters<typeof refreshFromMirror>[0]>) {
    return refreshFromMirror({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      fetchImpl: stubFetch(payload),
      now: T0,
      endpoint: ENDPOINT,
      snapshotMaxEntries: 100,
      ...over,
    })
  }

  it("reports the partition on the result so a run's log can state WHY the number moved", async () => {
    const result = await refresh(await freshStore())

    // ADR 0085's consequence section requires this: the next full ingest recovers 58 subjects, and
    // a log printing only the new cohort size is indistinguishable from adoption growth. The
    // numbers have to be on the result for a caller to say "2 live = 2 served + 0 capped".
    expect(result.conservation.liveInMirror).toBe(2)
    expect(result.conservation.served).toBe(2)
    expect(result.conservation.droppedByCap).toEqual([])
    expect(result.conservation.droppedByStaleCurrentRow).toEqual([])
    // The deprecated subject is mirrored but not live, so it is in neither population — the guard
    // measures the LIVE relation, not the row count.
    expect(result.mirroredRecords).toBe(3)
    expect(result.currentSubjects).toBe(3)
  })

  it("still balances when a version bump puts history in the mirror", async () => {
    // The end-to-end shape of ADR 0085's defect: two rows for one subject, the stale one hashing
    // above the live one. Post-D1 the cohort keeps the subject, so the guard balances — and this
    // test is what notices if a future change re-breaks the pick, without naming the mechanism.
    const bumped = {
      servers: [
        item("io.example/bumped", { version: "1.0.0" }, { isLatest: false, publishedAt: T0 }),
        item("io.example/bumped", { version: "1.0.1" }, { isLatest: true, publishedAt: T1 }),
        item("io.example/alpha", { version: "1.0.0" }, { publishedAt: T0 }),
      ],
    }
    const result = await refresh(await freshStore(), { fetchImpl: stubFetch(bumped) })

    expect(result.mirroredRecords).toBe(3)
    expect(result.currentSubjects).toBe(2)
    expect(result.conservation.liveInMirror).toBe(2)
    expect(result.conservation.served).toBe(2)
    expect(result.conservation.droppedByStaleCurrentRow).toEqual([])
    expect(result.snapshot.entries.map((e) => e.version)).toEqual(["1.0.0", "1.0.1"])
  })

  it("attributes a bound cap inside the operation without refusing the run", async () => {
    const result = await refresh(await freshStore(), { snapshotMaxEntries: 1 })

    expect(result.conservation.served).toBe(1)
    expect(result.conservation.droppedByCap).toEqual(["io.example/bravo"])
    // The run COMPLETED — checkpoint advanced, identity persisted. A guard that refused here would
    // refuse every real run, since the production cohort is a ceiling far below the live count.
    expect(result.snapshot.count).toBe(1)
    expect(result.identity.persisted.subjects).toBeGreaterThan(0)
  })

  it("advances NOTHING when the guard refuses — the failure is retried, not latched", async () => {
    // Placement is the guarantee, so it is measured rather than trusted. The guard runs before the
    // checkpoint advance and the identity commit; a guard placed after would still throw, but the
    // digest would be on disk and the NEXT run would read "no change" against a cohort this run
    // refused to certify.
    const store = await freshStore()
    // A subject whose current row resolves to a newer deprecated latest row. Reachable per the
    // real store's 4 `deprecated`/`isLatest=true` rows, and the guard's own refusal class.
    const poisoned = {
      servers: [
        item("io.example/twolatest", { version: "1.0.0" }, { publishedAt: T0 }),
        item("io.example/twolatest", { version: "2.0.0" }, { status: "deprecated", publishedAt: T1 }),
      ],
    }

    await expect(refresh(store, { fetchImpl: stubFetch(poisoned) })).rejects.toThrow(CohortConservationError)

    // The rows ARE mirrored — `syncSource` commits before the projection, and refusing to project
    // is not a reason to lose the evidence. What must not have advanced is the cohort's key.
    expect(store.listSourceRecords("official-mcp-registry")).toHaveLength(2)
    expect(store.readCheckpoint("official-mcp-registry").snapshotDigest).toBeNull()
    expect(store.listSubjects()).toHaveLength(0)
  })
})
