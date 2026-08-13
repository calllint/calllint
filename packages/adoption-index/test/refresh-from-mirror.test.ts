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
  describeSourceChange,
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
    //
    // UPDATED, not weakened: this asserted `/stopped at the record cap \(2\/2\)/`, a shape that
    // said WHICH numbers but not WHICH EXIT — and the read now has three, only one of which the
    // record cap fixes. So the assertion gains what the message gained: the exit is named, and
    // the remedy is asserted to name the knob for THAT exit rather than any knob.
    await expect(refresh(await freshStore(), payload, { mirrorMaxEntries: 2 })).rejects.toThrow(
      /stopped at the record-cap limit \(2 records read, cap 2\)/,
    )
    await expect(refresh(await freshStore(), payload, { mirrorMaxEntries: 2 })).rejects.toThrow(
      /TRUST_INGEST_MIRROR_MAX_ENTRIES/,
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

  it("capReached is REPORTED by the adapter, with the count as a conservative fallback", async () => {
    // RETITLED, because the old title ("capReached is derived from the record count") became
    // false and a false title is worse than a missing one — it describes the very derivation
    // that made the page-cap and cursor-repeat exits invisible. `capReached` is now the
    // adapter's report OR the count test, and this case is the one where BOTH are true.
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
    expect(sync.truncationReason).toBe("record-cap")
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

  it("refuses a read truncated by the PAGE ceiling, whose record count is nowhere near the cap", async () => {
    // The control the old derivation could not pass, stated as an end-to-end refusal rather than
    // a unit assertion on `capReached`.
    //
    // MEASURED, and this is why the workflow's fail-closed guard was worth fixing before raising
    // any number: 5 pages x 1 record against a 1000-record cap yields 5 records, and
    // `records.length >= maxEntries` is 5 >= 1000 — FALSE. So the read reported itself complete,
    // `assertMirrorComplete` let it through, and `projectSnapshot` filtered-sorted-sliced a cohort
    // out of 5 records of an unbounded source. A short snapshot is well-formed, passes every
    // schema check, and is undetectable without the source.
    const store = await freshStore()
    let n = 0
    const fetchImpl = (async () => {
      n += 1
      // A fresh cursor forever: the record cap can never bind, only the page ceiling can.
      return {
        ok: true,
        status: 200,
        json: async () => ({ servers: [item(`io.page/s${n}`)], metadata: { nextCursor: `c${n}` } }),
      }
    }) as unknown as typeof fetch

    await expect(
      refreshFromMirror({
        store,
        adapter: createOfficialRegistryAdapter(ENDPOINT),
        fetchImpl,
        now: T0,
        endpoint: ENDPOINT,
        snapshotMaxEntries: 25,
        mirrorMaxEntries: 1000,
        maxPages: 5,
        mode: "full",
      }),
    ).rejects.toThrow(MirrorIncompleteError)

    expect(n).toBe(5)

    // The remedy must name the PAGE knob. "Raise the record cap" is actively misleading here —
    // the record cap was not what bound the read, and raising it changes nothing.
    await expect(
      refreshFromMirror({
        store: await freshStore(),
        adapter: createOfficialRegistryAdapter(ENDPOINT),
        fetchImpl,
        now: T0,
        endpoint: ENDPOINT,
        snapshotMaxEntries: 25,
        mirrorMaxEntries: 1000,
        maxPages: 5,
        mode: "full",
      }),
    ).rejects.toThrow(/TRUST_INGEST_MIRROR_MAX_PAGES/)
  })
})

describe("the change key is persisted, and read back from DURABLE state (controls #2, #3)", () => {
  it("writes the cohort digest to the checkpoint the run leaves on disk", async () => {
    const store = await freshStore()
    const result = await refresh(store, { servers: [item("io.example/alpha", { version: "1.0.0" })] })

    // #3: the column existed before this batch and nothing produced a value for it. If it
    // stays producerless, run 2 reads `null` forever, the reason is permanently
    // NO_PRIOR_DIGEST, and the skip path is structurally unreachable.
    expect(result.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).snapshotDigest).toBe(result.snapshotDigest)

    // The RETURNED checkpoint must match disk. `syncSource` writes its checkpoint mid-run,
    // before the digest exists, so returning that one verbatim would report a checkpoint the
    // store no longer holds — true of the value, false of the system.
    expect(result.sync.checkpoint.snapshotDigest).toBe(result.snapshotDigest)
    expect(result.sync.checkpoint.status).toBe("COMPLETED")
  })

  it("digests the projected ENTRIES, not the snapshot envelope (controls #5, #6)", async () => {
    // Same upstream, two DIFFERENT clock reads. `fetchedAt` moves, so a digest over the
    // envelope — or over raw mirror rows, whose `last_seen_at` is refreshed on every
    // observation — changes here and the detector never skips. A detector that never skips
    // delivers nothing, and the batch would look finished while doing nothing.
    const payload = { servers: [item("io.example/alpha", { version: "1.0.0" })] }
    const store = await freshStore()
    const first = await refresh(store, payload, { now: T0 })
    const second = await refresh(store, payload, { now: T1 })

    // WITNESS that the envelope really did move on this fixture — without it the assertion
    // below would pass on a fixture where the defect cannot occur.
    expect(second.snapshot.fetchedAt).not.toBe(first.snapshot.fetchedAt)
    expect(second.snapshotText).not.toBe(first.snapshotText)
    // And the KEY did not.
    expect(second.snapshotDigest).toBe(first.snapshotDigest)
    expect(second.change).toMatchObject({ changed: false, reason: "NO_CHANGE" })
  })

  it("the first run is NO_PRIOR_DIGEST, the second is NO_CHANGE", async () => {
    const payload = { servers: [item("io.example/alpha", { version: "1.0.0" })] }
    const store = await freshStore()
    const first = await refresh(store, payload)

    // A first run has nothing to compare against and must not be reported as unchanged: an
    // empty store with a full source is the one case where skipping loses the whole tree.
    expect(first.change).toMatchObject({ changed: true, reason: "NO_PRIOR_DIGEST" })
    expect((await refresh(store, payload)).change).toMatchObject({ changed: false, reason: "NO_CHANGE" })
  })

  it("a moved cohort is COHORT_DIGEST_MOVED, and the digest advances on disk", async () => {
    const store = await freshStore()
    const first = await refresh(store, { servers: [item("io.example/alpha", { version: "1.0.0" })] }, { now: T0 })
    const second = await refresh(store, { servers: [item("io.example/alpha", { version: "2.0.0" })] }, { now: T1 })

    expect(second.change).toMatchObject({ changed: true, reason: "COHORT_DIGEST_MOVED" })
    expect(second.snapshotDigest).not.toBe(first.snapshotDigest)
    // The NEW digest is what run 3 compares against. Persisting the prior one — or nothing —
    // would make every later run report a move.
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).snapshotDigest).toBe(second.snapshotDigest)
  })

  it("an ADDED server moves the digest even though nothing was removed", async () => {
    const store = await freshStore()
    await refresh(store, { servers: [item("io.a/one")] }, { now: T0 })
    const grown = await refresh(store, { servers: [item("io.a/one"), item("io.b/two")] }, { now: T1 })
    expect(grown.change.reason).toBe("COHORT_DIGEST_MOVED")
    expect(grown.snapshot.count).toBe(2)
  })
})

describe("a withdrawal is detected, which a count cannot see (controls #1, #4)", () => {
  it("reports SOURCE_WITHDRAWAL when upstream stops serving a subject", async () => {
    const store = await freshStore()
    await refresh(store, { servers: [item("io.a/one"), item("io.b/gone")] }, { now: T0 })
    const shrunk = await refresh(store, { servers: [item("io.a/one")] }, { now: T1 })

    // #1, measured where the shortcut is actually available: a withdrawal writes NO ROW, so
    // `persisted.inserted` is 0 and a count-keyed detector reports "unchanged" while the
    // served cohort has lost an entry. This is the assertion that pins the count as unsound —
    // the precondition is graded, not assumed.
    expect(shrunk.sync.persisted.inserted).toBe(0)
    expect(shrunk.change.changed).toBe(true)
    expect(shrunk.change.reason).toBe("SOURCE_WITHDRAWAL")
    expect(shrunk.change.absentFromSource).toEqual(["io.b/gone"])
  })

  it("the mirror KEEPS the withdrawn subject — its memory is what makes detection possible", async () => {
    const store = await freshStore()
    await refresh(store, { servers: [item("io.a/one"), item("io.b/gone")] }, { now: T0 })
    const shrunk = await refresh(store, { servers: [item("io.a/one")] }, { now: T1 })

    // Append-only: there is no DELETE anywhere in this package. The withdrawn subject stays
    // current in the mirror, and the snapshot therefore STILL SERVES IT.
    expect(shrunk.currentSubjects).toBe(2)
    expect(shrunk.snapshot.entries.map((e) => e.name)).toEqual(["io.a/one", "io.b/gone"])

    // R-11 CLOSES THE OTHER HALF, AND THE OLD ASSERTION HERE IS INVERTED IN PLACE. It read
    // `toMatch(/de-listing is NOT applied/)` under a comment calling this "the deferred half this
    // batch reports rather than fixes". Both halves are now asserted TOGETHER, because they are two
    // planes and not one deferral — that is the whole content of INV-R12, and an assertion on either
    // plane alone reads as if the other did not exist:
    //
    //   MIRROR (source_records)   — KEEPS the row. Asserted above: 2 current, both names served.
    //   SUBJECT (canonical_subjects) — MOVES the row to `WITHDRAWN`. Asserted below.
    //
    // The mirror's memory is what makes detection possible on the NEXT run too, so a withdrawal that
    // deleted mirror rows would destroy the evidence for its own reversal.
    expect(shrunk.lifecycle.withdrawn.map((e) => e.canonicalName)).toEqual(["io.b/gone"])
    expect(shrunk.lifecycle.withdrawn.map((e) => `${e.from}->${e.to}`)).toEqual(["ACTIVE->WITHDRAWN"])
    expect(shrunk.lifecycle.reinstated).toEqual([])
    expect(shrunk.lifecycle.unmatched).toEqual([])
    expect(shrunk.lifecycle.unchanged).toBe(0)
    expect(describeSourceChange(shrunk.change)).toMatch(/de-listing applied to the subject plane/)

    // And the plane that moved is the STORE's, read back rather than inferred from the summary.
    const gone = store.listSubjects().find((s) => s.canonicalName === "io.b/gone")
    expect(gone?.lifecycleStatus).toBe("WITHDRAWN")
    expect(gone?.withdrawnAt).toBe(T1)
    const kept = store.listSubjects().find((s) => s.canonicalName === "io.a/one")
    expect(kept?.lifecycleStatus, "an observed subject must not move").toBe("ACTIVE")
    expect(kept?.withdrawnAt).toBeNull()
  })

  it("is measured against the subjects that were current BEFORE the sync", async () => {
    // The ordering control. `refreshFromMirror` reads `subjectsBefore` before `syncSource`
    // persists, because afterwards this run's own records are current by construction and the
    // set difference is empty for every input — the probe would be structurally blind.
    const store = await freshStore()
    await refresh(store, { servers: [item("io.a/one"), item("io.b/gone")] }, { now: T0 })
    const before = new Set(store.listLatestSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID).map((r) => r.sourceNativeId))
    expect(before.size).toBe(2)

    const shrunk = await refresh(store, { servers: [item("io.a/one")] }, { now: T1 })
    expect(shrunk.sync.observedNativeIds.size).toBe(1)
    // AFTER the sync the mirror still reports 2 current subjects, so a probe run at this point
    // would difference 2 against the 1 observed and — for the withdrawal — still find it. What
    // it could NOT find is the case where the withdrawn subject was never in `subjectsBefore`:
    // this assertion pins that the two reads see different populations at all.
    expect(store.listLatestSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)).toHaveLength(2)
  })

  it("observedNativeIds is REPORTED by the run, not recovered from last_seen_at", async () => {
    // Two runs sharing one injected clock value. Recovering "what this run saw" from
    // `last_seen_at` is wrong for exactly this input — every test that pins `now`, and any two
    // real runs inside the same millisecond.
    const store = await freshStore()
    await refresh(store, { servers: [item("io.a/one"), item("io.b/gone")] }, { now: T0 })
    const same = await refresh(store, { servers: [item("io.a/one")] }, { now: T0 })

    const stamps = store.listLatestSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID).map((r) => r.lastSeenAt)
    // WITNESS: both rows carry the SAME stamp, so a `last_seen_at === now` filter would report
    // both as observed and find no withdrawal.
    expect(stamps).toEqual([T0, T0])
    expect(same.change.reason).toBe("SOURCE_WITHDRAWAL")
    expect(same.change.absentFromSource).toEqual(["io.b/gone"])
  })

  it("a version bump is NOT a withdrawal — the subject was observed", async () => {
    // The positive half of #4. A probe that differenced payload digests instead of native ids
    // would call every version bump a withdrawal, and every assertion above would still pass.
    const store = await freshStore()
    await refresh(store, { servers: [item("io.a/one", { version: "1.0.0" })] }, { now: T0 })
    const bumped = await refresh(store, { servers: [item("io.a/one", { version: "2.0.0" })] }, { now: T1 })
    expect(bumped.change.reason).toBe("COHORT_DIGEST_MOVED")
    expect(bumped.change.absentFromSource).toEqual([])
  })

  it("sorts the absent set, so the report is deterministic", async () => {
    const store = await freshStore()
    await refresh(store, { servers: [item("io.z/last"), item("io.a/first"), item("io.m/mid")] }, { now: T0 })
    const shrunk = await refresh(store, { servers: [item("io.m/mid")] }, { now: T1 })
    expect(shrunk.change.absentFromSource).toEqual(["io.a/first", "io.z/last"])
  })
})

describe("INV-R6: an unchanged upstream commits BYTE-identical bytes (control #13)", () => {
  it("compares the committed BYTES with ===, not the parsed snapshot", async () => {
    // The reproducibility gate byte-compares committed served bytes against a fresh render, so
    // byte-identity is the requirement. `toEqual` on the parsed object would pass for an
    // equivalent-but-reordered snapshot and fail the real gate — a weaker test that looks like
    // the same assertion.
    const payload = {
      servers: [
        item("io.example/zulu", { version: "3.1.0" }, { publishedAt: T0 }),
        item("io.example/alpha", { version: "1.0.0" }, { publishedAt: T0 }),
        item("io.example/gone", {}, { status: "deprecated" }),
      ],
    }
    const store = await freshStore()
    const first = await refresh(store, payload, { now: T0 })
    const second = await refresh(store, payload, { now: T0 })

    expect(second.snapshotText === first.snapshotText).toBe(true)
    // And the skip is EARNED on the same run: the bytes are identical AND the detector says so.
    expect(second.change).toMatchObject({ changed: false, reason: "NO_CHANGE" })
    expect(second.snapshotDigest).toBe(first.snapshotDigest)
  })

  it("a skipped run still advances the run bookkeeping", async () => {
    // "Skip the rebuild" must never mean "skip the checkpoint". The run completed; recording it
    // as anything else would leave a RUNNING checkpoint behind and trip INV-R5.
    const payload = { servers: [item("io.a/one")] }
    const store = await freshStore()
    await refresh(store, payload, { now: T0 })
    const second = await refresh(store, payload, { now: T1 })

    expect(second.change.changed).toBe(false)
    const cp = store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)
    expect(cp.status).toBe("COMPLETED")
    expect(cp.lastCompletedAt).toBe(T1)
    expect(store.allRunsTerminal()).toBe(true)
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

/**
 * R-3's end-to-end closure: the identity layer resolves and persists inside the SAME run, and
 * `rebuild.identity` stops being `null`.
 *
 * The two facts worth stating before the assertions, because both were measured and neither is
 * what the plan predicted:
 *
 *   - ARTIFACTS FOLLOW PACKAGES, NOT SUBJECTS. The plan said "19 records ⇒ 19 subjects + 19
 *     artifact rows". The committed corpus declares 3 packages against 22 remotes over its 25
 *     entries, so the real number is 25 subjects and THREE artifacts. A remote is an endpoint, not
 *     a downloadable artifact; there is nothing to pin a digest to. Asserting 25 here would have
 *     forced either a fabricated artifact per remote or a loosened assertion.
 *   - `rebuild.identity` IS ASYMMETRIC ON PURPOSE. `true` on a changed run, `null` on
 *     `NO_CHANGE` — never `false`. A skipped run did not re-measure the identity layer, and
 *     `false` would assert a measurement that never happened. That is control #13.
 */
describe("identity resolves and persists in the same run (R-3)", () => {
  const twoSubjects = {
    servers: [
      item("io.test/alpha", {
        version: "1",
        packages: [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }],
      }),
      item("io.test/beta", { version: "1", remotes: [{ type: "http", url: "https://beta.dev" }] }),
    ],
  }

  it("persists a subject per current observation, and artifacts follow PACKAGES", async () => {
    const store = await freshStore()
    const result = await refresh(store, twoSubjects)

    expect(result.identity.subjects).toBe(2)
    expect(result.identity.conflicts).toBe(0)
    // One package across the two entries ⇒ ONE artifact row. `beta` declares a remote, which
    // carries nothing to resolve. This is the corpus's 25-subjects/3-artifacts shape in
    // miniature, and it is the assertion that would have failed against the plan's "25".
    expect(result.identity.artifacts).toBe(1)

    // What the RUN reported and what the STORE holds are two different measurements. Reading
    // both is the point: `persisted` counts rows the transaction wrote, and a document entry
    // the store silently folded would show up here as an inequality.
    expect(result.identity.persisted.subjects).toBe(2)
    expect(result.identity.persisted.artifacts).toBe(1)
    expect(result.identity.persisted.conflicts).toBe(0)
    expect(store.listSubjects()).toHaveLength(2)
    expect(store.listArtifactVersions()).toHaveLength(1)
    expect(store.listIdentityConflicts()).toEqual([])
    expect(store.countSubjectAliases()).toBe(result.identity.persisted.aliases)
  })

  it("stamps every subject from `now`, never from a clock or from retrievedAt (control #15)", async () => {
    const store = await freshStore()
    await refresh(store, twoSubjects, { now: T1 })
    // `refresh` passes `now: T1` as BOTH the sync stamp and `observedAt`, so this asserts the
    // parameter reached the resolver rather than that two clocks happened to agree.
    for (const s of store.listSubjects()) {
      expect(s.firstSeenAt).toBe(T1)
      expect(s.lastSeenAt).toBe(T1)
    }
  })

  it("flips rebuild.identity from null to a measured TRUE on a changed run", async () => {
    const store = await freshStore()
    const result = await refresh(store, twoSubjects)
    // The R-2 seam closed. This cell was `boolean | null` with the comment "Needs
    // canonical_subjects — R-3", and the whole batch exists to make it a measurement.
    expect(result.change.rebuild.identity).toBe(true)
    expect(result.change.rebuild.canonicalize).toBe(true)
    // The five tiers R-3 still cannot honestly compute stay `null`. Asserted as a set so a
    // future batch that flips one has to come here and say so.
    expect(result.change.rebuild.artifact).toBeNull()
    expect(result.change.rebuild.evidence).toBeNull()
    expect(result.change.rebuild.decision).toBeNull()
    expect(result.change.rebuild.semanticContract).toBeNull()
    expect(result.change.rebuild.presentation).toBeNull()
  })

  it("keeps rebuild.identity NULL on NO_CHANGE — null is not false (control #13)", async () => {
    const store = await freshStore()
    const first = await refresh(store, twoSubjects)
    expect(first.change.reason).toBe("NO_PRIOR_DIGEST")
    expect(first.change.rebuild.identity).toBe(true)

    // Second run over an unchanged upstream. The run DID resolve an identity layer — the
    // records are still there — and `identityResolved: true` still reaches the detector. The
    // verdict discards it anyway, which is the behaviour under test: nothing was re-measured
    // for the purposes of a rebuild, so the tier reports "unknown", not "no".
    const second = await refresh(store, twoSubjects)
    expect(second.change.reason).toBe("NO_CHANGE")
    expect(second.change.rebuild.identity).toBeNull()
    expect(second.change.rebuild.identity).not.toBe(false)
    expect(second.identity.subjects).toBe(2)
  })

  it("is idempotent across runs — a replay upserts, never duplicates", async () => {
    const store = await freshStore()
    await refresh(store, twoSubjects)
    const after1 = store.listSubjects()
    await refresh(store, twoSubjects)
    // Ids are `hashJson`-derived, so the same bytes reproduce the same rows. A uuid would
    // double the table here (control #10, measured at the operation level rather than the unit).
    expect(store.listSubjects()).toEqual(after1)
    expect(store.listArtifactVersions()).toHaveLength(1)
  })

  it("resolves the CURRENT observation only — a version bump is one subject, not two", async () => {
    const store = await freshStore()
    await refresh(store, { servers: [item("io.test/alpha", { version: "1" })] })
    await refresh(store, { servers: [item("io.test/alpha", { version: "2" })] }, { now: T1 })

    // The mirror deliberately keeps both observations; identity must read the current one. This
    // is the history-duplication defect this file was written for, now measured on the identity
    // layer as well as on the projection.
    expect(store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID).length).toBe(2)
    expect(store.listSubjects()).toHaveLength(1)
  })

  it("the projection is a function of the MIRROR ALONE — identity never feeds it (control #16)", async () => {
    // CONTROL #16, RESTATED BY MEASUREMENT. The plan specified the mutation as "resolve identity
    // BEFORE `projectSnapshot`" and expected the byte comparison to fail. It does not: moving the
    // call above the projection leaves all 44 tests here and in `snapshot-projection` GREEN, and
    // it has to — `resolveIdentity` is pure, `records` is computed before both call sites, and
    // the projection never reads what resolution returns, so the two statements commute. A
    // control that cannot go red is a finding about the harness, not a pass (R-2 control #11).
    //
    // The invariant worth guarding was never line order; it is the DATA DEPENDENCY. So the
    // falsifiable mutation is to give the projection an identity-derived input — filter `records`
    // by resolved subject, project only non-conflicted names, anything of that shape — which
    // breaks this equality because the entries projected are no longer the entries mirrored.
    // Recorded here rather than deleted, because the wrong version of this control is the reason
    // the right one is legible.
    const store = await freshStore()
    const result = await refresh(store, twoSubjects)
    expect(result.snapshotText).toBe(await shippedBytes(twoSubjects))
    // Not the vacuous kind of equality: the same run resolved and persisted a real identity
    // layer, so the projection stayed put while something downstream of it definitely ran.
    expect(result.identity.persisted.subjects).toBe(2)
    // The dependency stated as a count. `shippedBytes` renders from the SAME fixture through the
    // shipped emitter with no identity layer in scope at all, so an identity-derived filter would
    // change one side and not the other. Asserting the entry count too means the failure names
    // "the projection lost an entry" rather than only "bytes differ".
    expect(JSON.parse(result.snapshotText).entries).toHaveLength(2)
  })

  it("commits the checkpoint and the identity layer TOGETHER", async () => {
    const store = await freshStore()
    const result = await refresh(store, twoSubjects)
    // One transaction. A run that advanced the digest without persisting subjects would report
    // NO_CHANGE forever after while holding no identity for the cohort that digest names — so
    // the digest on disk and the subjects on disk are asserted as one fact.
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)?.snapshotDigest).toBe(result.snapshotDigest)
    expect(store.listSubjects()).toHaveLength(2)
  })
})
