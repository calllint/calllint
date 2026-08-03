/**
 * snapshot-projection — the control that protects a GREEN gate from this batch.
 *
 * Negative control this file is the measurement for:
 *   #8  the mirror changes the committed snapshot for unchanged upstream
 *
 * The committed `calllint.trust-snapshot.v0` feeds the bake, and the bake feeds a
 * reproducibility gate that byte-compares committed served bytes against a fresh render.
 * R-1 adds a mirror upstream of that file. So the assertion cannot be "the projection looks
 * right" — it has to be **the projection reproduces the shipped emitter's bytes**, over the
 * same upstream, through the real store.
 *
 * Both paths are driven from ONE raw registry body:
 *
 *   raw body ──> fetchRegistrySnapshot                    ──> committed bytes (shipped)
 *          └───> toSourceRecord ─> store ─> projectSnapshot ──> committed bytes (mirror)
 *
 * and the two byte strings must be equal. That is strictly stronger than a shared type: it
 * catches BEHAVIOURAL drift — a different filter, a different comparator, a different cap
 * order, a `null` where the emitter writes `""` — none of which a structural check sees.
 *
 * `fetchRegistrySnapshot` is imported from its module rather than the package barrel
 * because `packages/trust-index/src/index.ts` does not re-export it (measured); this is the
 * same import path `packages/trust-index/test/registry.test.ts` uses.
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
  toSourceRecord,
  projectSnapshot,
  serializeSnapshot,
  isLiveCohort,
  OFFICIAL_REGISTRY_SOURCE_ID,
  MIGRATIONS_DIRNAME,
  type SourceRecordV1,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const NOW = "2026-08-03T00:00:00.000Z"
const ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"

interface ItemSpec {
  name: string
  description?: string
  version?: string
  repositoryUrl?: string
  status?: string
  isLatest?: boolean
  publishedAt?: string
  packages?: unknown[]
  remotes?: unknown[]
}

/** Build one raw registry item in the shape BOTH readers parse. */
function rawItem(spec: ItemSpec): Record<string, unknown> {
  const server: Record<string, unknown> = { name: spec.name }
  if (spec.description !== undefined) server.description = spec.description
  if (spec.version !== undefined) server.version = spec.version
  if (spec.repositoryUrl !== undefined) server.repository = { url: spec.repositoryUrl }
  if (spec.packages !== undefined) server.packages = spec.packages
  if (spec.remotes !== undefined) server.remotes = spec.remotes
  const meta: Record<string, unknown> = { status: spec.status ?? "active", isLatest: spec.isLatest ?? true }
  if (spec.publishedAt !== undefined) meta.publishedAt = spec.publishedAt
  return { server, _meta: { [OFFICIAL_META]: meta } }
}

/**
 * The fixture deliberately includes the three cohorts the two paths treat DIFFERENTLY:
 * a live record, a `deprecated` one, and one whose `isLatest` is absent. The shipped
 * emitter drops the latter two at ingestion; the mirror STORES them and the projection
 * drops them. If the projection failed to, the bytes would diverge — which is the whole
 * reason the deprecated rows are in here rather than a clean happy-path fixture.
 */
const FIXTURE: ItemSpec[] = [
  {
    name: "io.example/zulu",
    description: "last alphabetically, newest published",
    version: "3.1.0",
    repositoryUrl: "https://github.com/example/zulu",
    publishedAt: "2026-07-30T12:00:00.000Z",
    packages: [{ registryType: "npm", identifier: "@example/zulu", version: "3.1.0", transport: "stdio" }],
  },
  {
    name: "io.example/alpha",
    description: "first alphabetically, oldest published",
    version: "1.0.0",
    repositoryUrl: "https://github.com/example/alpha",
    publishedAt: "2026-01-02T00:00:00.000Z",
    remotes: [{ type: "sse", url: "https://alpha.example/sse" }],
  },
  // No description, no version, no repository: the "" vs null divergence lives here.
  { name: "io.example/mike", publishedAt: "2026-04-04T00:00:00.000Z" },
  // Filtered by the shipped emitter at ingestion; must also be filtered by the projection.
  { name: "io.example/deprecated", status: "deprecated", publishedAt: "2026-05-05T00:00:00.000Z" },
  { name: "io.example/superseded", isLatest: false, publishedAt: "2026-06-06T00:00:00.000Z" },
  // `isLatest` absent entirely — absence of evidence is not evidence of currency.
  { server: { name: "io.example/flagless" }, _meta: { [OFFICIAL_META]: { status: "active" } } } as never,
]

/** The one raw body both paths read. */
function body(specs: ItemSpec[] = FIXTURE): { servers: unknown[] } {
  return {
    servers: specs.map((s) =>
      // The flagless entry is already a raw item, not a spec.
      "server" in (s as object) ? (s as unknown as Record<string, unknown>) : rawItem(s),
    ),
  }
}

/** The shipped fetch-stub idiom (`packages/trust-index/test/registry.test.ts`). */
function stubFetch(payload: unknown): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch
}

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Mirror the raw body through a REAL store and read the payloads back out. */
async function throughStore(payload: { servers: unknown[] }): Promise<SourceRecordV1[]> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-projection-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now: NOW })
  try {
    const records = payload.servers
      .map((item) => toSourceRecord(item as never, NOW))
      .filter((r): r is SourceRecordV1 => r !== null)
    store.transaction((tx) => tx.persistSourceRecords(records, NOW))
    // Read back from SQLite rather than reusing the in-memory array: the production path
    // projects from stored bytes, and a JSON round-trip is exactly where a key-order or
    // undefined-vs-absent difference would appear.
    return store.listSourceRecordPayloads(OFFICIAL_REGISTRY_SOURCE_ID)
  } finally {
    store.close()
  }
}

async function shippedBytes(payload: unknown, maxEntries = DEFAULT_MAX_ENTRIES): Promise<string> {
  const snapshot = await fetchRegistrySnapshot({
    now: NOW,
    endpoint: ENDPOINT,
    maxEntries,
    fetchImpl: stubFetch(payload),
  })
  // Exactly how `refreshSnapshot.ts:54` commits it.
  return JSON.stringify(snapshot, null, 2) + "\n"
}

describe("projection equivalence (control #8)", () => {
  it("reproduces the shipped emitter's bytes, through the real store", async () => {
    const payload = body()
    const records = await throughStore(payload)
    const mirrored = serializeSnapshot(
      projectSnapshot({ records, endpoint: ENDPOINT, fetchedAt: NOW, maxEntries: DEFAULT_MAX_ENTRIES }),
    )
    expect(mirrored).toBe(await shippedBytes(payload))
  })

  it("keeps the records the shipped emitter never stored, and still emits the same bytes", async () => {
    const payload = body()
    const records = await throughStore(payload)
    // The mirror is a superset: it holds the deprecated, the superseded and the flagless
    // rows that the shipped emitter discarded at ingestion. This is the asymmetry the
    // projection exists to absorb, so it is measured rather than assumed.
    expect(records).toHaveLength(6)
    expect(records.filter(isLiveCohort)).toHaveLength(3)

    const shipped = await shippedBytes(payload)
    expect(JSON.parse(shipped).count).toBe(3)
    expect(
      serializeSnapshot(
        projectSnapshot({ records, endpoint: ENDPOINT, fetchedAt: NOW, maxEntries: DEFAULT_MAX_ENTRIES }),
      ),
    ).toBe(shipped)
  })

  it("is independent of mirror row order", async () => {
    const payload = body()
    const records = await throughStore(payload)
    const forward = serializeSnapshot(
      projectSnapshot({ records, endpoint: ENDPOINT, fetchedAt: NOW, maxEntries: DEFAULT_MAX_ENTRIES }),
    )
    const reversed = serializeSnapshot(
      projectSnapshot({
        records: [...records].reverse(),
        endpoint: ENDPOINT,
        fetchedAt: NOW,
        maxEntries: DEFAULT_MAX_ENTRIES,
      }),
    )
    // The store's ORDER BY is not part of the contract; the projection's own sort is.
    expect(reversed).toBe(forward)
  })

  it("caps AFTER sorting, so the retained entries are alphabetically first, not newest", async () => {
    const payload = body()
    const records = await throughStore(payload)
    const capped = projectSnapshot({ records, endpoint: ENDPOINT, fetchedAt: NOW, maxEntries: 2 })

    // `io.example/zulu` has the NEWEST publishedAt of the three live records and is
    // alphabetically last, so a cap that took the most recent would retain it. The shipped
    // emitter does not, and this property is load-bearing: "improving" it would change
    // which pages the bake emits.
    expect(capped.entries.map((e) => e.name)).toEqual(["io.example/alpha", "io.example/mike"])
    expect(capped.count).toBe(2)
    expect(serializeSnapshot(capped)).toBe(await shippedBytes(payload, 2))
  })

  it("agrees on the empty case", async () => {
    const payload = { servers: [] }
    const records = await throughStore(payload)
    expect(records).toHaveLength(0)
    expect(
      serializeSnapshot(projectSnapshot({ records, endpoint: ENDPOINT, fetchedAt: NOW, maxEntries: DEFAULT_MAX_ENTRIES })),
    ).toBe(await shippedBytes(payload))
  })

  it("agrees when NOTHING upstream is live — an all-filtered body is not an error", async () => {
    // The pathological case for a projection: the mirror is full and the snapshot is empty.
    const payload = body([
      { name: "io.example/one", status: "deprecated" },
      { name: "io.example/two", isLatest: false },
    ])
    const records = await throughStore(payload)
    expect(records).toHaveLength(2)
    const mirrored = serializeSnapshot(
      projectSnapshot({ records, endpoint: ENDPOINT, fetchedAt: NOW, maxEntries: DEFAULT_MAX_ENTRIES }),
    )
    expect(JSON.parse(mirrored).count).toBe(0)
    expect(mirrored).toBe(await shippedBytes(payload))
  })

  it("reproduces bytes for an unchanged upstream read twice (the gate's actual question)", async () => {
    // Two independent mirrors of the same upstream, each with its own temp store and its
    // own fresh migration run. The reproducibility gate asks precisely this: same input,
    // same committed bytes — so it is asserted across store instances, not within one.
    const payload = body()
    const first = serializeSnapshot(
      projectSnapshot({
        records: await throughStore(payload),
        endpoint: ENDPOINT,
        fetchedAt: NOW,
        maxEntries: DEFAULT_MAX_ENTRIES,
      }),
    )
    const second = serializeSnapshot(
      projectSnapshot({
        records: await throughStore(payload),
        endpoint: ENDPOINT,
        fetchedAt: NOW,
        maxEntries: DEFAULT_MAX_ENTRIES,
      }),
    )
    expect(second).toBe(first)
  })

  it("carries endpoint and fetchedAt verbatim, never derived", async () => {
    const records = await throughStore(body())
    const odd = "https://example.invalid/v0/servers?page=2"
    const projected = projectSnapshot({
      records,
      endpoint: odd,
      fetchedAt: "1999-12-31T23:59:59.000Z",
      maxEntries: DEFAULT_MAX_ENTRIES,
    })
    // A projection that normalized either field would silently diverge from the emitter,
    // which carries both through untouched.
    expect(projected.endpoint).toBe(odd)
    expect(projected.fetchedAt).toBe("1999-12-31T23:59:59.000Z")
  })

  it("writes \"\" for a missing description, matching the emitter rather than null", async () => {
    const payload = body([{ name: "io.example/mike" }])
    const records = await throughStore(payload)
    const projected = projectSnapshot({
      records,
      endpoint: ENDPOINT,
      fetchedAt: NOW,
      maxEntries: DEFAULT_MAX_ENTRIES,
    })
    // `null` and `""` serialize differently and the bytes are compared, so this is a
    // byte-level requirement, not a style preference.
    expect(projected.entries[0]?.description).toBe("")
    expect(serializeSnapshot(projected)).toBe(await shippedBytes(payload))
  })
})
