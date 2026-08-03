/**
 * refresh-from-mirror — the operation that makes the committed snapshot a PROJECTION, and
 * the two defects that arrangement introduces if nothing measures them.
 *
 * Negative controls this file is the measurement for:
 *   #8   the mirror changes the committed snapshot for unchanged upstream
 *   #12  a capped read is projected anyway, silently omitting servers
 *
 * `snapshot-projection.test.ts` already proves the PROJECTION reproduces the shipped
 * emitter's bytes. It does so by hand-persisting records through `persistSourceRecords`,
 * which means it never exercises the read the production path actually uses. Two defects
 * live in exactly that gap, and neither one throws:
 *
 *   1. HISTORY DUPLICATION. The mirror keeps every observation of a subject on purpose, so
 *      after any upstream version bump `listSourceRecordPayloads` returns the same server
 *      twice and a projection over it emits the server twice. Invisible to a fixture where
 *      every record is a first observation — which is every fixture in the sibling file.
 *   2. SILENT TRUNCATION. `paginate` returns at `yielded >= maxEntries` without saying so,
 *      and the snapshot's filter-then-sort-then-slice cannot be honoured from a prefix of
 *      the arrival order. The short snapshot that results is well-formed.
 *
 * So the assertions here run the WHOLE operation — real adapter, real store, real
 * transaction, real checkpoint — and each defect is measured with its precondition graded
 * first. A test that asserted "the projection emits the subject once" over a fixture with
 * no history would pass whether or not the fix exists.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { fetchRegistrySnapshot, DEFAULT_MAX_ENTRIES } from "../../trust-index/src/fetchRegistry.js"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  createOfficialRegistryAdapter,
  refreshFromMirror,
  syncSource,
  assertMirrorComplete,
  MirrorIncompleteError,
  DEFAULT_MIRROR_MAX_ENTRIES,
  DEFAULT_SOURCE_ID,
  OFFICIAL_REGISTRY_SOURCE_ID,
  MIGRATIONS_DIRNAME,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"
const T0 = "2026-08-01T00:00:00.000Z"
const T1 = "2026-08-02T00:00:00.000Z"
const T2 = "2026-08-03T00:00:00.000Z"

/** One raw registry item, in the shape both the mirror and the shipped emitter parse. */
function item(name: string, extra?: Record<string, unknown>, meta?: Record<string, unknown>): Record<string, unknown> {
  return {
    server: { name, ...(extra ?? {}) },
    _meta: { [OFFICIAL_META]: { status: "active", isLatest: true, ...(meta ?? {}) } },
  }
}

/** A fetch stub that serves one body forever — `fullSync` reads it until the cursor ends. */
function stubFetch(payload: unknown): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch
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
  const cwd = mkdtempSync(join(tmpdir(), "calllint-refresh-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now })
  stores.push(store)
  return store
}

/**
 * The bytes `refreshSnapshot.ts` commits, produced by the SHIPPED emitter.
 *
 * `now` is a parameter rather than a constant because `fetchedAt` is carried into the
 * document VERBATIM by both paths. Comparing a run stamped T2 against bytes stamped T0
 * measures the clock, not the projection.
 */
async function shippedBytes(payload: unknown, maxEntries = DEFAULT_MAX_ENTRIES, now = T0): Promise<string> {
  const snapshot = await fetchRegistrySnapshot({
    now,
    endpoint: ENDPOINT,
    maxEntries,
    fetchImpl: stubFetch(payload),
  })
  return JSON.stringify(snapshot, null, 2) + "\n"
}

/** Run the whole operation once against a body. */
async function refresh(
  store: AdoptionIndexStore,
  payload: unknown,
  over?: Partial<Parameters<typeof refreshFromMirror>[0]>,
): Promise<Awaited<ReturnType<typeof refreshFromMirror>>> {
  return refreshFromMirror({
    store,
    adapter: createOfficialRegistryAdapter(ENDPOINT),
    fetchImpl: stubFetch(payload),
    now: T0,
    endpoint: ENDPOINT,
    snapshotMaxEntries: DEFAULT_MAX_ENTRIES,
    ...over,
  })
}

describe("the operation reproduces the committed bytes end to end (control #8)", () => {
  it("mirrors, then projects the shipped emitter's bytes through a real sync", async () => {
    const payload = {
      servers: [
        item("io.example/zulu", { description: "last", version: "3.1.0" }, { publishedAt: T0 }),
        item("io.example/alpha", { description: "first", version: "1.0.0" }, { publishedAt: T0 }),
        item("io.example/mike"),
        item("io.example/gone", {}, { status: "deprecated" }),
      ],
    }
    const result = await refresh(await freshStore(), payload)

    // The sibling file compares the PROJECTION against the emitter. This compares the
    // operation's own committed bytes, so the sync, the checkpoint and the latest-read are
    // all inside the measurement rather than beside it.
    expect(result.snapshotText).toBe(await shippedBytes(payload))
    expect(result.snapshot.count).toBe(3)

    // The mirror is a superset: it stored the deprecated record the snapshot drops.
    expect(result.mirroredRecords).toBe(4)
    expect(result.currentSubjects).toBe(4)
    expect(result.sync.checkpoint.status).toBe("COMPLETED")
    expect(result.sync.capReached).toBe(false)
  })

  it("two runs over an unchanged upstream commit identical bytes", async () => {
    const payload = { servers: [item("io.example/alpha", { version: "1.0.0" }, { publishedAt: T0 })] }
    const store = await freshStore()
    const first = await refresh(store, payload)
    const second = await refresh(store, payload)

    // The reproducibility gate's actual question, asked against a store that ALREADY holds
    // the records: the second run must insert nothing and emit the same bytes.
    expect(second.snapshotText).toBe(first.snapshotText)
    expect(second.sync.persisted).toEqual({ inserted: 0, unchanged: 1 })
    expect(second.mirroredRecords).toBe(1)
  })

  it("defaults the source id to the official registry", () => {
    expect(DEFAULT_SOURCE_ID).toBe(OFFICIAL_REGISTRY_SOURCE_ID)
  })
})

describe("history duplication — the projection reads the CURRENT observation", () => {
  it("emits a version-bumped subject ONCE, carrying the newest payload", async () => {
    const store = await freshStore()
    await refresh(store, { servers: [item("io.example/alpha", { version: "1.0.0" })] }, { now: T0 })
    const result = await refresh(store, { servers: [item("io.example/alpha", { version: "2.0.0" })] }, { now: T1 })

    // PRECONDITION, graded rather than assumed: the mirror really does hold two rows for
    // one subject here. Without this the assertions below would pass on a fixture where the
    // defect cannot occur, which is how the sibling file misses it.
    expect(result.mirroredRecords).toBe(2)
    expect(store.listSourceRecordPayloads(OFFICIAL_REGISTRY_SOURCE_ID)).toHaveLength(2)
    // WITNESS that the two reads DIFFER on this fixture — the fix is a distinct read, so a
    // test that never observes the difference is not measuring the fix.
    expect(store.listLatestSourceRecordPayloads(OFFICIAL_REGISTRY_SOURCE_ID)).toHaveLength(1)

    expect(result.currentSubjects).toBe(1)
    expect(result.snapshot.count).toBe(1)
    expect(result.snapshot.entries.map((e) => e.name)).toEqual(["io.example/alpha"])
    // Newest observation wins: a projection off the history would emit 1.0.0 as a second
    // entry, and one off `first_seen_at` would emit 1.0.0 instead of 2.0.0.
    expect(result.snapshot.entries[0]?.version).toBe("2.0.0")
  })

  it("picks the re-served payload after an upstream REVERT, which first_seen_at cannot", async () => {
    const store = await freshStore()
    const a = { servers: [item("io.example/alpha", { version: "1.0.0" })] }
    const b = { servers: [item("io.example/alpha", { version: "2.0.0" })] }
    await refresh(store, a, { now: T0 })
    await refresh(store, b, { now: T1 })
    const reverted = await refresh(store, a, { now: T2 })

    // This fixture is what separates the two candidate discriminators, and the separation is
    // the reason the ordering is `last_seen_at DESC`:
    //   1.0.0  first_seen_at T0, last_seen_at T2   (re-served, so refreshed)
    //   2.0.0  first_seen_at T1, last_seen_at T1   (withdrawn upstream)
    // `last_seen_at DESC` → 1.0.0, what the source serves NOW.
    // `first_seen_at DESC` → 2.0.0, a payload upstream has withdrawn.
    const rows = store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)
    expect(rows).toHaveLength(2)
    const stamps = rows.map((r) => `${r.firstSeenAt}|${r.lastSeenAt}`).sort()
    expect(stamps).toEqual([`${T0}|${T2}`, `${T1}|${T1}`])

    expect(reverted.currentSubjects).toBe(1)
    expect(reverted.snapshot.entries[0]?.version).toBe("1.0.0")
    // A revert restores the ORIGINAL bytes, so the committed file must return to them too —
    // stamped at T2, because `fetchedAt` records WHEN the source was read, not when the
    // payload first appeared. Comparing against T0 bytes would measure the clock instead.
    expect(reverted.snapshotText).toBe(await shippedBytes(a, DEFAULT_MAX_ENTRIES, T2))
  })

  it("collapses history per subject, not across subjects", async () => {
    const store = await freshStore()
    await refresh(store, { servers: [item("io.a/one", { version: "1" }), item("io.b/two", { version: "1" })] }, { now: T0 })
    const result = await refresh(
      store,
      { servers: [item("io.a/one", { version: "2" }), item("io.b/two", { version: "1" })] },
      { now: T1 },
    )

    // One subject changed, one did not. A read that deduplicated globally — or that dropped
    // the unchanged subject because it produced no new row — would emit one entry.
    expect(result.mirroredRecords).toBe(3)
    expect(result.currentSubjects).toBe(2)
    expect(result.snapshot.entries.map((e) => `${e.name}@${e.version}`)).toEqual(["io.a/one@2", "io.b/two@1"])
  })
})

describe("a capped read is refused, never projected (control #12)", () => {
  it("throws MirrorIncompleteError when the read stopped at the cap", async () => {
    const payload = { servers: [item("io.a/one"), item("io.b/two"), item("io.c/three")] }
    await expect(refresh(await freshStore(), payload, { mirrorMaxEntries: 2 })).rejects.toThrow(MirrorIncompleteError)

    // The message has to name the numbers: an operator's only fix is to raise the cap, and
    // a bare "mirror incomplete" does not say to what.
    await expect(refresh(await freshStore(), payload, { mirrorMaxEntries: 2 })).rejects.toThrow(
      /stopped at the record cap \(2\/2\)/,
    )
  })

  it("refuses the AMBIGUOUS case where the source holds exactly maxEntries", async () => {
    // Two records, cap two. Indistinguishable from truncation without one more request, so
    // it is reported as capped. Over-reporting costs a raised cap; under-reporting ships a
    // snapshot that is quietly missing servers.
    const payload = { servers: [item("io.a/one"), item("io.b/two")] }
    await expect(refresh(await freshStore(), payload, { mirrorMaxEntries: 2 })).rejects.toThrow(MirrorIncompleteError)
  })

  it("keeps what it mirrored — only the PROJECTION is refused", async () => {
    const store = await freshStore()
    const payload = { servers: [item("io.a/one"), item("io.b/two"), item("io.c/three")] }
    await expect(refresh(store, payload, { mirrorMaxEntries: 2 })).rejects.toThrow(MirrorIncompleteError)

    // `assertMirrorComplete` runs AFTER `syncSource`, so the records and the checkpoint are
    // already durably committed. That is deliberate: refusing to emit is recoverable, and
    // discarding a completed read would make the retry re-fetch what it already has.
    expect(store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)).toHaveLength(2)
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).status).toBe("COMPLETED")
    expect(store.allRunsTerminal()).toBe(true)
  })

  it("does not fire when the read reached the end of the source", async () => {
    // The positive half. A fail-closed assertion that fired on every run would be caught by
    // the tests above only if they were the whole story; this is the control that shows the
    // guard is conditional rather than constant.
    const result = await refresh(await freshStore(), { servers: [item("io.a/one"), item("io.b/two")] }, {
      mirrorMaxEntries: 10,
    })
    expect(result.sync.capReached).toBe(false)
    expect(result.snapshot.count).toBe(2)
  })

  it("capReached is derived from the record count, and assertMirrorComplete reads only it", async () => {
    const store = await freshStore()
    const sync = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: {
        retrievedAt: T0,
        fetchImpl: stubFetch({ servers: [item("io.a/one"), item("io.b/two"), item("io.c/three")] }),
        maxEntries: 2,
      },
      mode: "full",
      completedAt: T0,
    })
    // `paginate` returns as soon as `yielded >= maxEntries`, so the count can never exceed
    // the cap and equality is the whole condition.
    expect(sync.records).toBe(2)
    expect(sync.capReached).toBe(true)
    expect(() => assertMirrorComplete(sync, 2)).toThrow(MirrorIncompleteError)
    try {
      assertMirrorComplete(sync, 2)
      expect.unreachable("assertMirrorComplete must throw for a capped read")
    } catch (err) {
      expect(err).toBeInstanceOf(MirrorIncompleteError)
      expect((err as MirrorIncompleteError).records).toBe(2)
      expect((err as MirrorIncompleteError).maxEntries).toBe(2)
      expect((err as Error).name).toBe("MirrorIncompleteError")
    }
    expect(() => assertMirrorComplete({ ...sync, capReached: false }, 2)).not.toThrow()
  })
})

describe("the two caps count different populations", () => {
  it("the mirror ceiling is strictly above the snapshot cap", () => {
    // The inequality is the invariant, not the literals. The mirror stores the records the
    // snapshot drops, so it must read strictly more than the snapshot emits to fill it —
    // setting them equal would look correct and be wrong precisely when the source grows.
    expect(DEFAULT_MIRROR_MAX_ENTRIES).toBeGreaterThan(DEFAULT_MAX_ENTRIES)
  })

  it("the snapshot cap slices AFTER the filter and the sort, from a complete read", async () => {
    const payload = {
      servers: [
        item("io.example/zulu", { version: "1" }, { publishedAt: T2 }),
        item("io.example/alpha", { version: "1" }, { publishedAt: T0 }),
        item("io.example/mike", { version: "1" }, { publishedAt: T1 }),
        item("io.example/gone", {}, { status: "deprecated" }),
      ],
    }
    const result = await refresh(await freshStore(), payload, { snapshotMaxEntries: 2, mirrorMaxEntries: 100 })

    // `zulu` has the NEWEST publishedAt and is alphabetically last, so a cap that took the
    // most recent would retain it. The shipped emitter does not, and which entries survive
    // decides which pages the bake emits.
    expect(result.snapshot.entries.map((e) => e.name)).toEqual(["io.example/alpha", "io.example/mike"])
    expect(result.snapshotText).toBe(await shippedBytes(payload, 2))
    // The mirror still holds everything, including what the snapshot capped away.
    expect(result.mirroredRecords).toBe(4)
  })

  it("a mirror cap above the read is not a snapshot cap — 4 stored, 2 served", async () => {
    const payload = {
      servers: [item("io.a/one"), item("io.b/two"), item("io.c/three"), item("io.d/four")],
    }
    const result = await refresh(await freshStore(), payload, { snapshotMaxEntries: 2, mirrorMaxEntries: 100 })
    expect(result.sync.records).toBe(4)
    expect(result.sync.capReached).toBe(false)
    expect(result.snapshot.count).toBe(2)
    // The snapshot cap binding is NOT an incomplete mirror: only the read's own ceiling
    // fails closed. Conflating them would refuse every capped snapshot, which is every one.
    expect(result.mirroredRecords).toBe(4)
  })
})
