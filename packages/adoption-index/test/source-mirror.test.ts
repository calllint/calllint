/**
 * source-mirror — cursor pagination, the `updated_since` watermark, digest deduplication,
 * and the two invariants that govern a sync run.
 *
 * Negative controls this file is the measurement for:
 *   #10  a source record ends in no terminal state → INV-R5
 *   #11  a wall-clock read inside the compile path → INV-R6
 *
 * The fetch is stubbed, but nothing else is: every assertion runs through the real adapter,
 * the real store, and a real transaction. The behaviours worth measuring are the ones a
 * mirror gets wrong silently — a watermark that moves BACKWARD converts every later
 * incremental into a full read; a re-read that inserts duplicate rows makes the mirror grow
 * without new information; a crashed run that looks resumable skips the records it never
 * persisted. None of those throw on their own, which is why each has an assertion here.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  createOfficialRegistryAdapter,
  syncSource,
  pickLater,
  overlappedWatermark,
  highWaterMark,
  normalizeLifecycle,
  toSourceRecord,
  assertUsableCheckpoint,
  emptyCheckpoint,
  isTerminalCheckpointStatus,
  TERMINAL_CHECKPOINT_STATUSES,
  sourceRecordRowId,
  OFFICIAL_REGISTRY_SOURCE_ID,
  OVERLAP_WINDOW_MS,
  MIGRATIONS_DIRNAME,
  PAGE_SIZE,
  type SourceRecordV1,
  type SourceSyncContext,
  type SyncTruncationReason,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const SRC_DIR = join(PKG_ROOT, "src")
const ENDPOINT = "https://registry.test/v0/servers"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"
const T0 = "2026-08-01T00:00:00.000Z"
const T1 = "2026-08-02T00:00:00.000Z"

function item(name: string, publishedAt?: string, extra?: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = { status: "active", isLatest: true }
  if (publishedAt !== undefined) meta.publishedAt = publishedAt
  return { server: { name, ...(extra ?? {}) }, _meta: { [OFFICIAL_META]: meta } }
}

/**
 * A paging stub that records every URL it was asked for. The URLs are the evidence: a
 * cursor that was never sent, or an `updated_since` that was, is only visible here.
 */
function pagingFetch(pages: { servers: unknown[]; metadata?: { nextCursor?: string } }[]): {
  fetchImpl: typeof fetch
  urls: string[]
} {
  const urls: string[] = []
  let call = 0
  const fetchImpl = (async (url: string) => {
    urls.push(String(url))
    const page = pages[Math.min(call, pages.length - 1)]
    call += 1
    return { ok: true, status: 200, json: async () => page }
  }) as unknown as typeof fetch
  return { fetchImpl, urls }
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

async function freshStore(now = T0): Promise<{ store: AdoptionIndexStore; cwd: string }> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-mirror-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now })
  stores.push(store)
  return { store, cwd }
}

function ctx(fetchImpl: typeof fetch, retrievedAt: string, over?: Partial<SourceSyncContext>): SourceSyncContext {
  return { retrievedAt, fetchImpl, maxEntries: 1000, ...over }
}

describe("cursor pagination (§9.4)", () => {
  it("follows nextCursor across pages and sends the cursor it was given", async () => {
    const { store } = await freshStore()
    const { fetchImpl, urls } = pagingFetch([
      { servers: [item("io.test/a", T0)], metadata: { nextCursor: "c1" } },
      { servers: [item("io.test/b", T0)], metadata: { nextCursor: "c2" } },
      { servers: [item("io.test/c", T0)] },
    ])
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(fetchImpl, T0),
      mode: "full",
      completedAt: T1,
    })
    expect(result.records).toBe(3)
    expect(urls).toHaveLength(3)
    // Page 1 carries no cursor; pages 2 and 3 carry the cursor the PREVIOUS page returned.
    //
    // UPDATED: this asserted `urls[0] === ENDPOINT` — page 1 sent NO query string at all, so it
    // took the source's default page size of 30 and made the page ceiling bind 3.3x sooner for
    // the same round trips. `limit` is now on every request, so the assertion becomes
    // "page 1 carries the limit and no cursor" rather than "page 1 is the bare endpoint".
    expect(urls[0]).toBe(`${ENDPOINT}?limit=${PAGE_SIZE}`)
    expect(urls[0]).not.toContain("cursor")
    expect(urls[1]).toContain("cursor=c1")
    expect(urls[2]).toContain("cursor=c2")
    // The limit is sent on EVERY page, not just the first. A cap that lapses after page 1 would
    // silently fall back to 30/page for the rest of the read and be invisible in the record count.
    for (const u of urls) expect(u).toContain(`limit=${PAGE_SIZE}`)
    // A full sync never sends a watermark, whatever the checkpoint holds.
    for (const u of urls) expect(u).not.toContain("updated_since")
  })

  it("stops when a source echoes the same cursor back, instead of looping forever", async () => {
    const { store } = await freshStore()
    // Every page returns cursor "same" — a source that never terminates.
    const { fetchImpl, urls } = pagingFetch([{ servers: [item("io.test/a", T0)], metadata: { nextCursor: "same" } }])
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(fetchImpl, T0),
      mode: "full",
      completedAt: T1,
    })
    // Page 1 sends no cursor and returns "same"; page 2 sends "same" and gets "same" back,
    // which is the repeat that ends the read.
    expect(urls).toHaveLength(2)
    expect(result.records).toBe(2)
    // And it is REPORTED as a truncation, not as exhaustion. A source that echoes a cursor said
    // "there is more" and then failed to advance — collapsing that to `cursor = null` (which this
    // did) makes a broken cursor indistinguishable from a complete read, and a complete read is
    // what `assertMirrorComplete` lets through.
    expect(result.truncationReason).toBe<SyncTruncationReason>("cursor-repeat")
    expect(result.capReached).toBe(true)
  })

  it("honours the page ceiling so a broken cursor cannot spin", async () => {
    const { store } = await freshStore()
    let n = 0
    const fetchImpl = (async () => {
      n += 1
      // A fresh cursor every time: only maxPages can stop this.
      return { ok: true, status: 200, json: async () => ({ servers: [item(`io.test/s${n}`, T0)], metadata: { nextCursor: `c${n}` } }) }
    }) as unknown as typeof fetch
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(fetchImpl, T0, { maxPages: 3 }),
      mode: "full",
      completedAt: T1,
    })
    expect(n).toBe(3)

    // THE ASSERTION THIS TEST WAS MISSING, and the reason a truncated mirror shipped as complete.
    //
    // `expect(n).toBe(3)` alone measures that the ceiling STOPPED the read. It says nothing about
    // whether the read admitted it, and `capReached` used to be `records.length >= maxEntries` —
    // 3 records against a cap of 1000 is false, so this read reported itself COMPLETE and
    // `assertMirrorComplete` projected a snapshot from 3 of an unbounded source.
    expect(result.records).toBe(3)
    expect(result.records).toBeLessThan(1000) // the record cap is nowhere near binding here
    expect(result.capReached).toBe(true)
    expect(result.truncationReason).toBe<SyncTruncationReason>("page-cap")
  })

  it("reports exhaustion as NOT truncated — the negative half of the same measurement", async () => {
    // Without this, every assertion above is satisfied by a `capReached` that is hardcoded true.
    const { store } = await freshStore()
    const { fetchImpl } = pagingFetch([
      { servers: [item("io.test/a", T0)], metadata: { nextCursor: "c1" } },
      { servers: [item("io.test/b", T0)] },
    ])
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(fetchImpl, T0, { maxPages: 3 }),
      mode: "full",
      completedAt: T1,
    })
    expect(result.records).toBe(2)
    expect(result.capReached).toBe(false)
    expect(result.truncationReason).toBeNull()
  })

  it("stops at maxEntries mid-page", async () => {
    const { store } = await freshStore()
    const { fetchImpl } = pagingFetch([
      { servers: [item("io.test/a", T0), item("io.test/b", T0), item("io.test/c", T0)], metadata: { nextCursor: "c1" } },
    ])
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(fetchImpl, T0, { maxEntries: 2 }),
      mode: "full",
      completedAt: T1,
    })
    expect(result.records).toBe(2)
    // The third exit, asserted on the SAME channel as the other two. This was the only exit
    // `capReached` could ever see, and it saw it by a count comparison rather than by report —
    // so it is now the one exit where both the report and the fallback must agree.
    expect(result.capReached).toBe(true)
    expect(result.truncationReason).toBe<SyncTruncationReason>("record-cap")
  })
})

describe("the updated_since watermark (§9.4)", () => {
  it("sends the watermark MINUS the overlap window on an incremental run", async () => {
    const { store } = await freshStore()
    const adapter = createOfficialRegistryAdapter(ENDPOINT)

    const first = pagingFetch([{ servers: [item("io.test/a", "2026-07-20T00:00:00.000Z")] }])
    await syncSource({ store, adapter, ctx: ctx(first.fetchImpl, T0), mode: "full", completedAt: T0 })
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).updatedSince).toBe("2026-07-20T00:00:00.000Z")

    const second = pagingFetch([{ servers: [] }])
    await syncSource({ store, adapter, ctx: ctx(second.fetchImpl, T1), mode: "incremental", completedAt: T1 })
    // 24h before the stored watermark, not the watermark itself.
    expect(second.urls[0]).toContain("updated_since=2026-07-19T00%3A00%3A00.000Z")
  })

  it("never moves the watermark backward when a run returns nothing", async () => {
    const { store } = await freshStore()
    const adapter = createOfficialRegistryAdapter(ENDPOINT)

    const first = pagingFetch([{ servers: [item("io.test/a", "2026-07-20T00:00:00.000Z")] }])
    await syncSource({ store, adapter, ctx: ctx(first.fetchImpl, T0), mode: "full", completedAt: T0 })

    const empty = pagingFetch([{ servers: [] }])
    const result = await syncSource({
      store,
      adapter,
      ctx: ctx(empty.fetchImpl, T1),
      mode: "incremental",
      completedAt: T1,
    })
    // The common case for an incremental run is "nothing changed". Resetting the watermark
    // to null here would silently convert every later incremental into a full read.
    expect(result.records).toBe(0)
    expect(result.checkpoint.updatedSince).toBe("2026-07-20T00:00:00.000Z")
  })

  it("advances the watermark to the newest publishedAt observed", async () => {
    const { store } = await freshStore()
    const { fetchImpl } = pagingFetch([
      {
        servers: [
          item("io.test/old", "2026-01-01T00:00:00.000Z"),
          item("io.test/new", "2026-07-31T00:00:00.000Z"),
          item("io.test/mid", "2026-04-01T00:00:00.000Z"),
        ],
      },
    ])
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(fetchImpl, T0),
      mode: "full",
      completedAt: T1,
    })
    expect(result.checkpoint.updatedSince).toBe("2026-07-31T00:00:00.000Z")
  })

  it("overlappedWatermark and pickLater refuse unparseable input rather than inventing one", () => {
    expect(overlappedWatermark(null)).toBeNull()
    expect(overlappedWatermark("not-a-date")).toBeNull()
    expect(overlappedWatermark("2026-08-02T00:00:00.000Z")).toBe(
      new Date(Date.parse("2026-08-02T00:00:00.000Z") - OVERLAP_WINDOW_MS).toISOString(),
    )
    expect(pickLater(null, null)).toBeNull()
    expect(pickLater(T1, T0)).toBe(T1)
    expect(pickLater(T0, T1)).toBe(T1)
    // An unparseable candidate must never win: it would poison the stored watermark and
    // `assertUsableCheckpoint` would then refuse every later run.
    expect(pickLater(T0, "garbage")).toBe(T0)
    expect(pickLater("garbage", T0)).toBe(T0)
    expect(highWaterMark([])).toBeNull()
  })

  it("rejects a checkpoint belonging to another source", async () => {
    const adapter = createOfficialRegistryAdapter(ENDPOINT)
    expect(() => adapter.validateCheckpoint(emptyCheckpoint("some-other-source"))).toThrow(
      /belongs to source some-other-source/,
    )
    expect(() =>
      adapter.validateCheckpoint({ ...emptyCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID), updatedSince: "nope" }),
    ).toThrow(/not a parseable timestamp/)
  })
})

describe("digest deduplication (§9.4)", () => {
  it("re-reading unchanged upstream inserts no row and refreshes last_seen_at", async () => {
    const { store } = await freshStore()
    const adapter = createOfficialRegistryAdapter(ENDPOINT)
    const page = [{ servers: [item("io.test/a", T0), item("io.test/b", T0)] }]

    const first = await syncSource({
      store,
      adapter,
      ctx: ctx(pagingFetch(page).fetchImpl, T0),
      mode: "full",
      completedAt: T0,
    })
    expect(first.persisted).toEqual({ inserted: 2, unchanged: 0 })

    const second = await syncSource({
      store,
      adapter,
      ctx: ctx(pagingFetch(page).fetchImpl, T1),
      mode: "full",
      completedAt: T1,
    })
    // The whole point of the overlap window: re-reading a day of records must cost nothing.
    expect(second.persisted).toEqual({ inserted: 0, unchanged: 2 })
    expect(store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)).toHaveLength(2)

    const rows = store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)
    for (const row of rows) {
      // `first_seen_at` keeps meaning "when we first saw these exact bytes".
      expect(row.firstSeenAt).toBe(T0)
      expect(row.lastSeenAt).toBe(T1)
    }
  })

  it("a changed payload adds a NEW row and keeps the old one as history", async () => {
    const { store } = await freshStore()
    const adapter = createOfficialRegistryAdapter(ENDPOINT)

    await syncSource({
      store,
      adapter,
      ctx: ctx(pagingFetch([{ servers: [item("io.test/a", T0, { version: "1.0.0" })] }]).fetchImpl, T0),
      mode: "full",
      completedAt: T0,
    })
    const second = await syncSource({
      store,
      adapter,
      ctx: ctx(pagingFetch([{ servers: [item("io.test/a", T0, { version: "2.0.0" })] }]).fetchImpl, T1),
      mode: "full",
      completedAt: T1,
    })

    expect(second.persisted).toEqual({ inserted: 1, unchanged: 0 })
    const rows = store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)
    // Two observations of ONE native id. R-2's change detector reads exactly this.
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.sourceNativeId))).toEqual(new Set(["io.test/a"]))
    expect(new Set(rows.map((r) => r.payloadDigest)).size).toBe(2)
  })

  it("row ids are derived from the triple, so a replay on a fresh store reproduces them", async () => {
    const raw = item("io.test/a", T0)
    const record = toSourceRecord(raw as never, T0)!
    const replayed = toSourceRecord(raw as never, T0)!
    expect(sourceRecordRowId(replayed)).toBe(sourceRecordRowId(record))

    // A different retrievedAt is NOT part of the identity triple — the same observation
    // read at a different moment is the same observation.
    const later = toSourceRecord(raw as never, T1)!
    expect(sourceRecordRowId(later)).toBe(sourceRecordRowId(record))

    // A different payload IS.
    const changed = toSourceRecord(item("io.test/a", T0, { version: "9.9.9" }) as never, T0)!
    expect(sourceRecordRowId(changed)).not.toBe(sourceRecordRowId(record))
  })

  it("mirrors deprecated and non-latest records rather than filtering them", async () => {
    const { store } = await freshStore()
    const { fetchImpl } = pagingFetch([
      {
        servers: [
          { server: { name: "io.test/gone" }, _meta: { [OFFICIAL_META]: { status: "deleted", isLatest: true } } },
          { server: { name: "io.test/old" }, _meta: { [OFFICIAL_META]: { status: "active", isLatest: false } } },
        ],
      },
    ])
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(fetchImpl, T0),
      mode: "full",
      completedAt: T1,
    })
    // A `deleted` record is EVIDENCE, not noise — R-2's change detector needs the history.
    expect(result.records).toBe(2)
    const statuses = store.listSourceRecordPayloads(OFFICIAL_REGISTRY_SOURCE_ID).map((r) => r.lifecycle.status)
    expect(statuses.sort()).toEqual(["active", "deleted"])
  })

  it("maps an unrecognized lifecycle to unknown, never to active", () => {
    expect(normalizeLifecycle("active")).toBe("active")
    expect(normalizeLifecycle("deprecated")).toBe("deprecated")
    expect(normalizeLifecycle("deleted")).toBe("deleted")
    // "UNKNOWN is not SAFE" — a source that invents a fifth status must not read as healthy.
    expect(normalizeLifecycle("thriving")).toBe("unknown")
    expect(normalizeLifecycle(undefined)).toBe("unknown")
    expect(normalizeLifecycle(null)).toBe("unknown")
  })
})

describe("terminal run states (INV-R5, control #10)", () => {
  it("a completed run leaves a terminal checkpoint", async () => {
    const { store } = await freshStore()
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(pagingFetch([{ servers: [item("io.test/a", T0)] }]).fetchImpl, T0),
      mode: "full",
      completedAt: T1,
    })
    expect(result.checkpoint.status).toBe("COMPLETED")
    expect(isTerminalCheckpointStatus(result.checkpoint.status)).toBe(true)
    expect(store.allRunsTerminal()).toBe(true)
  })

  it("a FAILED fetch is terminal, keeps the watermark, and persists nothing", async () => {
    const { store } = await freshStore()
    const adapter = createOfficialRegistryAdapter(ENDPOINT)

    await syncSource({
      store,
      adapter,
      ctx: ctx(pagingFetch([{ servers: [item("io.test/a", "2026-07-20T00:00:00.000Z")] }]).fetchImpl, T0),
      mode: "full",
      completedAt: T0,
    })

    const failing = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
    await expect(
      syncSource({ store, adapter, ctx: ctx(failing, T1), mode: "incremental", completedAt: T1 }),
    ).rejects.toThrow(/HTTP 503/)

    const cp = store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)
    // Terminal for the RUN, not for the source: the next run retries the same window.
    expect(cp.status).toBe("FAILED")
    expect(cp.lastErrorCode).toBe("SOURCE_FETCH_FAILED")
    expect(cp.updatedSince).toBe("2026-07-20T00:00:00.000Z")
    expect(store.allRunsTerminal()).toBe(true)
    expect(store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)).toHaveLength(1)
  })

  it("a mid-stream failure persists NOTHING — half a page is not a synced source", async () => {
    const { store } = await freshStore()
    let call = 0
    const fetchImpl = (async () => {
      call += 1
      if (call === 1) {
        return { ok: true, status: 200, json: async () => ({ servers: [item("io.test/a", T0)], metadata: { nextCursor: "c1" } }) }
      }
      return { ok: false, status: 500, json: async () => ({}) }
    }) as unknown as typeof fetch

    await expect(
      syncSource({
        store,
        adapter: createOfficialRegistryAdapter(ENDPOINT),
        ctx: ctx(fetchImpl, T0),
        mode: "full",
        completedAt: T1,
      }),
    ).rejects.toThrow(/HTTP 500/)

    // Page 1 succeeded. Recording it as a sync would advance the watermark past records
    // page 2 never delivered — the silent gap §9.4 forbids.
    expect(store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)).toHaveLength(0)
    const cp = store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)
    expect(cp.status).toBe("FAILED")
    expect(cp.updatedSince).toBeNull()
  })

  it("refuses to resume from a RUNNING checkpoint left by a crash", async () => {
    const { store } = await freshStore()
    const adapter = createOfficialRegistryAdapter(ENDPOINT)

    // Simulate the crash: beginRun writes RUNNING and the process dies before failRun.
    store.beginRun(OFFICIAL_REGISTRY_SOURCE_ID, T0)
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).status).toBe("RUNNING")
    // A crashed run is the one state that is NOT terminal, and it must be visible as such.
    expect(store.allRunsTerminal()).toBe(false)

    await expect(
      syncSource({
        store,
        adapter,
        ctx: ctx(pagingFetch([{ servers: [] }]).fetchImpl, T1),
        mode: "incremental",
        completedAt: T1,
      }),
    ).rejects.toThrow(/did not reach a terminal state/)
  })

  it("TERMINAL_CHECKPOINT_STATUSES names exactly the two states that end a run", () => {
    expect([...TERMINAL_CHECKPOINT_STATUSES].sort()).toEqual(["COMPLETED", "FAILED"])
    expect(isTerminalCheckpointStatus("IDLE")).toBe(false)
    expect(isTerminalCheckpointStatus("RUNNING")).toBe(false)
    // A fresh source is IDLE, which is not terminal but is resumable — the distinction
    // between "never ran" and "crashed mid-run".
    expect(() => assertUsableCheckpoint(emptyCheckpoint("s"))).not.toThrow()
  })
})

describe("the checkpoint is written only after the records (§9.4)", () => {
  it("rolls the checkpoint back with the records when the write transaction throws", async () => {
    const { store } = await freshStore()
    const before = store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)

    expect(() =>
      store.transaction((tx) => {
        tx.persistSourceRecords([toSourceRecord(item("io.test/a", T0) as never, T0)!], T0)
        tx.advanceCheckpoint({ ...before, updatedSince: T0, status: "COMPLETED" })
        throw new Error("boom after both writes")
      }),
    ).toThrow(/boom after both writes/)

    // Either both land or neither does. A checkpoint that survived here would point past
    // records that were rolled back.
    expect(store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)).toHaveLength(0)
    expect(store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID).updatedSince).toBeNull()
  })

  it("exposes the write methods ONLY inside a transaction", async () => {
    const { store } = await freshStore()

    // `advanceCheckpoint` is not a class member at all — the class has a `private
    // writeCheckpoint`, and the name `advanceCheckpoint` exists ONLY on the transaction
    // handle. That half is runtime-true and asserted as such.
    expect((store as unknown as Record<string, unknown>).advanceCheckpoint).toBeUndefined()

    // `persistSourceRecords`, by contrast, IS on the prototype at runtime: TypeScript's
    // `private` is erased at compile time. So the enforcement for it is the COMPILER, and
    // the honest assertion is on the declaration rather than on the runtime object — a
    // `toBeUndefined()` here would fail, and passing it by deleting the modifier would be
    // the mutation this is meant to catch. `pnpm typecheck` is the link that enforces it.
    const storeSrc = readFileSync(join(SRC_DIR, "storage", "store.ts"), "utf8")
    expect(storeSrc).toMatch(/^ {2}private persistSourceRecords\(/m)
    expect(storeSrc).toMatch(/^ {2}private writeCheckpoint\(/m)
    // R-3's writer joins the same compiler-enforced discipline. Asserted here rather than
    // only in the key list below because the key list would still pass if the modifier were
    // dropped — the handle would carry the same name either way.
    expect(storeSrc).toMatch(/^ {2}private persistIdentity\(/m)
    // R-4's writer likewise. It is the one writer on the handle that does NOT participate in
    // the checkpoint transaction — `resolveArtifacts` opens one transaction PER ARTIFACT,
    // because it runs a network loop and holding a single transaction across it would let one
    // slow artifact roll back the outcomes already established for the others. It is on the
    // handle anyway, and privately declared, so that the "all SQL lives in store.ts" rule
    // (§10.3) has no exception carved for it.
    expect(storeSrc).toMatch(/^ {2}private updateArtifactResolution\(/m)
    // R-5's writer likewise, and for the same reason as R-4's: `compileEvidence` opens one
    // transaction PER ARTIFACT, because a single transaction around the loop would let one
    // unreadable CAS blob roll back every row already compiled — the fail-DESTRUCTIVE shape.
    expect(storeSrc).toMatch(/^ {2}private recordEvidence\(/m)

    // The ordering rule's positive half: the handle carries exactly these SIX and no
    // seventh, so a caller inside a transaction cannot reach a wider write surface.
    //
    // This list was THREE until R-3, FOUR until R-4, FIVE until R-5, and is widened here
    // deliberately, not relaxed. The assertion's subject is that the write surface is a CLOSED SET
    // enumerated in one place; R-3 added `persistIdentity` because the identity layer must commit
    // in the same transaction as the checkpoint that describes it (a digest advanced without its
    // subjects would report "no change" forever), R-4 added `updateArtifactResolution` because the
    // four artifact columns are that batch's whole write surface, and R-5 adds `recordEvidence`
    // because `evidence_records` gains its first writer. Growing the list is how a new writer
    // announces itself; a writer that reached the handle without appearing here is the defect.
    // This assertion CAUGHT R-4's writer rather than being updated alongside it, and CAUGHT R-5's
    // the same way — it failed on the run that added the sixth key, before any control was
    // applied. That is twice now, which is the behaviour a closed-set pin exists for.
    const keys = store.transaction((tx) => Object.keys(tx).sort())
    expect(keys).toEqual([
      "advanceCheckpoint",
      "persistIdentity",
      "persistSourceRecords",
      "readCheckpoint",
      "recordEvidence",
      "updateArtifactResolution",
    ])
  })
})

describe("no wall clock on the compile path (INV-R6, control #11)", () => {
  /** Every `.ts` file under the package's `src/`, recursively. */
  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) out.push(...sourceFiles(full))
      else if (ent.name.endsWith(".ts")) out.push(full)
    }
    return out
  }

  /**
   * Strip comments before scanning.
   *
   * This is not a convenience — the first version of this probe FAILED, and it failed on
   * `storage/migrate.ts:98`, a docblock that reads "`appliedAt` is an injected ISO-8601
   * string, not a `new Date()` read". That sentence is evidence of COMPLIANCE, and a probe
   * that grades it as a violation is measuring prose rather than behaviour. The house has
   * hit this exact shape before ("mentions" ≠ "styles").
   */
  function codeOnly(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  }

  it("the comment stripper removes prose and keeps code (the probe's own control)", () => {
    // A stripper that deleted everything would make every assertion below pass vacuously,
    // so it is graded against a fixture carrying one of each.
    const fixture = [
      "/** a docblock naming new Date() and Date.now() */",
      "// a line comment naming new Date()",
      "const kept = new Date(t - 1).toISOString()",
    ].join("\n")
    const stripped = codeOnly(fixture)
    expect(stripped).toContain("new Date(t - 1)")
    expect(stripped).not.toContain("docblock")
    expect(stripped).not.toContain("line comment")
    expect(stripped).not.toMatch(/new Date\(\s*\)/)
    expect(stripped).not.toContain("Date.now(")
    // And it must actually be reading this package: migrate.ts is the file that broke the
    // first draft, so its prose mention is pinned as the live case, not just the fixture.
    const migrateSrc = readFileSync(join(SRC_DIR, "storage", "migrate.ts"), "utf8")
    expect(migrateSrc).toMatch(/new Date\(\s*\)/)
    expect(codeOnly(migrateSrc)).not.toMatch(/new Date\(\s*\)/)
  })

  it("contains no Date.now() in executable code anywhere in src/", () => {
    const files = sourceFiles(SRC_DIR)
    // The probe must be able to fail: a src/ that read as empty would pass vacuously.
    expect(files.length).toBeGreaterThan(8)
    // Relative paths, not absolute: an absolute list is long enough that vitest truncates it
    // to `[ Array(1) ]` and the failure stops naming the offending file (measured while
    // running control #11).
    const offenders = files
      .filter((f) => codeOnly(readFileSync(f, "utf8")).includes("Date.now("))
      .map((f) => f.slice(SRC_DIR.length + 1).replace(/\\/g, "/"))
    expect(offenders).toEqual([])
  })

  it("uses `new Date(` only to transform an INJECTED timestamp, never to read the clock", () => {
    const withDate = sourceFiles(SRC_DIR).filter((f) => codeOnly(readFileSync(f, "utf8")).includes("new Date("))
    // `new Date(t - windowMs)` in `overlappedWatermark` is a pure transform of a stored
    // watermark. An argless `new Date()` is a clock read and is what this forbids.
    //
    // Asserted as a LIST of offending paths rather than per-file `not.toMatch`: the
    // per-file form fails by printing the entire source text of the offender, which names
    // the violation nowhere in the message (measured while running control #11b).
    const clockReaders = withDate
      .filter((f) => /new Date\(\s*\)/.test(codeOnly(readFileSync(f, "utf8"))))
      .map((f) => f.slice(SRC_DIR.length + 1).replace(/\\/g, "/"))
    expect(clockReaders, "argless new Date() is a clock read").toEqual([])
    expect(withDate.map((f) => f.slice(SRC_DIR.length + 1).replace(/\\/g, "/"))).toEqual([
      "sources/officialRegistry.ts",
    ])
  })

  it("every timestamp a run records came from its caller", async () => {
    const { store } = await freshStore("2026-08-01T00:00:00.000Z")
    const result = await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(pagingFetch([{ servers: [item("io.test/a", T0)] }]).fetchImpl, "2026-08-01T11:22:33.000Z"),
      mode: "full",
      completedAt: "2026-08-01T12:00:00.000Z",
    })
    // Injected in, injected out — the assertion is that NO value was manufactured.
    expect(result.checkpoint.lastStartedAt).toBe("2026-08-01T11:22:33.000Z")
    expect(result.checkpoint.lastCompletedAt).toBe("2026-08-01T12:00:00.000Z")
    const rows = store.listSourceRecords(OFFICIAL_REGISTRY_SOURCE_ID)
    expect(rows[0]?.retrievedAt).toBe("2026-08-01T11:22:33.000Z")
    expect(rows[0]?.firstSeenAt).toBe("2026-08-01T11:22:33.000Z")
  })

  it("a sync writes only inside the index root (INV-R7, at operation level)", async () => {
    const { store, cwd } = await freshStore()
    await syncSource({
      store,
      adapter: createOfficialRegistryAdapter(ENDPOINT),
      ctx: ctx(pagingFetch([{ servers: [item("io.test/a", T0)] }]).fetchImpl, T0),
      mode: "full",
      completedAt: T1,
    })
    // store-schema.test.ts measures containment on OPEN. This measures it after a real
    // write path has run, which is when a stray sidecar file would appear.
    const top = readdirSync(cwd)
    expect(top).toEqual([".var"])
    expect(statSync(join(cwd, ".var", "calllint-adoption-index")).isDirectory()).toBe(true)
  })
})
