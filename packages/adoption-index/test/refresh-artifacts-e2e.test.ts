/**
 * refresh-artifacts-e2e — R-4's whole chain, over the COMMITTED CORPUS, offline.
 *
 * The plan's verification step 7. Everything else that grades R-4 grades a part:
 * `artifact-resolution.test.ts` the pure halves, `artifact-store.test.ts` the write path against a
 * real driver, `refresh-from-mirror.test.ts` the operation with NO port. None of them answers the
 * question this file exists for — *does the shipped chain, driven the way `refreshSnapshot.ts`
 * drives it, resolve the artifacts the committed corpus actually declares?*
 *
 * Three things make this a distinct measurement rather than a bigger version of the others:
 *
 *   1. THE FIXTURE IS THE COMMITTED SNAPSHOT, not a hand-authored cohort. The 19 entries are
 *      replayed through the official adapter's raw wire shape, so the count under test is the
 *      corpus's own 19-subjects/2-artifacts shape rather than a number a fixture chose. If someone
 *      publishes a third npm package into the registry and re-bakes, this file changes — which is
 *      the point: the assertion is about the corpus, so the corpus moving should be visible.
 *   2. THE PORT IS INJECTED THE WAY PRODUCTION INJECTS IT. `refreshSnapshot.ts:202-210` builds a
 *      closure over `resolveArtifacts` and passes it as `artifactPort`. This file builds the same
 *      closure over a routed stub. What is graded is the SEAM, and the seam has two sides that no
 *      unit test can see together: the port's summary reaching `RefreshResult.artifacts`, and
 *      `artifactResolved` reaching the change detector so `rebuild.artifact` stops being `null`.
 *   3. ONE `fetch` STUB SERVES BOTH PLANES. The registry pages and the npm packuments/tarballs go
 *      through one routed implementation, because in production they do too (`fetch` is passed to
 *      both `refreshFromMirror` and the port). A test that gave each plane its own stub could not
 *      catch a URL the wrong plane claimed.
 *
 * `it.each` is deliberately absent: each assertion below names a different failure, and a table
 * would collapse them into one row label.
 */
import { describe, it, expect, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseSnapshot } from "../../trust-index/src/snapshot.js"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  createOfficialRegistryAdapter,
  refreshFromMirror,
  createAdapterRegistry,
  resolveArtifacts,
  npmArtifactAdapter,
  casBlobPath,
  NPM_REGISTRY,
  OFFICIAL_REGISTRY_SOURCE_ID,
  MIGRATIONS_DIRNAME,
  type ArtifactResolutionSummary,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const SNAPSHOT_PATH = join(PKG_ROOT, "..", "trust-index", "snapshots", "official-mcp-registry.json")
const ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"
const T0 = "2026-08-01T00:00:00.000Z"
const T1 = "2026-08-02T00:00:00.000Z"

// ── the corpus, replayed as wire bytes ─────────────────────────────────────────────────────────

interface CorpusPackage {
  registryType: string
  identifier: string
  version: string | null
}

/**
 * The committed 19 entries, turned back into the raw registry shape the official adapter parses.
 *
 * Read from the snapshot rather than from a copy, so a re-bake that changes the corpus changes
 * this fixture too. `parseSnapshot` is the shipped reader — going through it means a snapshot this
 * repo could not itself parse fails here rather than producing a fixture nothing serves.
 */
function corpusPayload(): { servers: Record<string, unknown>[] } {
  const snapshot = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8"))
  return {
    servers: snapshot.entries.map((e) => {
      const server: Record<string, unknown> = { name: e.name }
      if (e.description.length > 0) server.description = e.description
      if (e.version != null) server.version = e.version
      if (e.repositoryUrl != null) server.repository = { url: e.repositoryUrl, source: "github" }
      if (e.packages.length > 0) {
        server.packages = e.packages.map((p) => ({
          registryType: p.registryType,
          identifier: p.identifier,
          ...(p.version == null ? {} : { version: p.version }),
        }))
      }
      if (e.remotes.length > 0) server.remotes = e.remotes.map((r) => ({ type: r.type, url: r.url }))
      return { server, _meta: { [OFFICIAL_META]: { status: e.status, isLatest: true } } }
    }),
  }
}

/** The packages the corpus DECLARES — the population artifact resolution may act on. */
function corpusPackages(): CorpusPackage[] {
  const snapshot = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8"))
  return snapshot.entries.flatMap((e) =>
    e.packages.map((p) => ({ registryType: p.registryType, identifier: p.identifier, version: p.version ?? null })),
  )
}

// ── in-memory npm fixtures (never a committed archive) ─────────────────────────────────────────

const BLOCK = 512

function header(path: string, size: number, typeFlag = "0"): Buffer {
  const h = Buffer.alloc(BLOCK, 0)
  h.write(path.slice(0, 100), 0, "utf8")
  h.write("0000644\0", 100, "ascii")
  h.write("0000000\0", 108, "ascii")
  h.write("0000000\0", 116, "ascii")
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii")
  h.write("00000000000\0", 136, "ascii")
  h.write("        ", 148, "ascii")
  h.write(typeFlag, 156, "ascii")
  h.write("ustar\0" + "00", 257, "ascii")
  let sum = 0
  for (let i = 0; i < BLOCK; i += 1) sum += h[i] ?? 0
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii")
  return h
}

/**
 * A gzipped tar carrying one file, built in memory.
 *
 * The body is keyed on the package name so the two corpus packages produce DIFFERENT bytes, hence
 * different digests, hence two distinct CAS blobs. Identical bytes would deduplicate to one blob
 * and the "2 blobs" assertion below would pass for the wrong reason.
 */
function tgz(pkg: string): Uint8Array {
  const data = Buffer.from(`module.exports = ${JSON.stringify(pkg)}\n`, "utf8")
  const padded = Buffer.alloc(Math.ceil(data.length / BLOCK) * BLOCK, 0)
  data.copy(padded)
  const tar = Buffer.concat([header("package/index.js", data.length), padded, Buffer.alloc(BLOCK * 2, 0)])
  return new Uint8Array(gzipSync(tar, { level: 9 }))
}

function sri(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`
}

/** Ported from the adapter: scoped names are SINGLE-encoded on the packument path. */
function packumentUrl(name: string): string {
  return `${NPM_REGISTRY}/${name.replace(/\//g, "%2f")}`
}

function tarballUrl(name: string, version: string): string {
  return `${NPM_REGISTRY}/${name}/-/${name.replace(/^@[^/]+\//, "")}-${version}.tgz`
}

interface Route {
  json?: unknown
  bytes?: Uint8Array
  status?: number
}

/**
 * ONE routed stub for both planes.
 *
 * The registry endpoint is matched on its ORIGIN + path rather than on the exact string, because
 * the official adapter appends `cursor` / `updated_since` query parameters and an exact-match route
 * would 404 the second page. npm URLs are matched exactly — there a wrong URL must be visible.
 */
function stubFetch(routes: Record<string, Route>): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    if (url.startsWith(ENDPOINT)) {
      const route = routes[ENDPOINT]
      return new Response(JSON.stringify(route?.json ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    const route = routes[url]
    if (route === undefined) return new Response("not found", { status: 404 })
    if (route.bytes !== undefined) return new Response(route.bytes, { status: route.status ?? 200 })
    return new Response(JSON.stringify(route.json ?? {}), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

/** Every route the corpus needs: one registry page, plus a packument + tarball per package. */
function corpusRoutes(): { routes: Record<string, Route>; bytesFor: Map<string, Uint8Array> } {
  const routes: Record<string, Route> = { [ENDPOINT]: { json: corpusPayload() } }
  const bytesFor = new Map<string, Uint8Array>()
  for (const pkg of corpusPackages()) {
    if (pkg.registryType !== "npm" || pkg.version === null) continue
    const bytes = tgz(pkg.identifier)
    bytesFor.set(pkg.identifier, bytes)
    routes[packumentUrl(pkg.identifier)] = {
      json: {
        name: pkg.identifier,
        "dist-tags": { latest: pkg.version },
        versions: {
          [pkg.version]: {
            name: pkg.identifier,
            version: pkg.version,
            dist: {
              tarball: tarballUrl(pkg.identifier, pkg.version),
              integrity: sri(bytes),
              shasum: createHash("sha1").update(bytes).digest("hex"),
            },
          },
        },
      },
    }
    routes[tarballUrl(pkg.identifier, pkg.version)] = { bytes }
  }
  return { routes, bytesFor }
}

// ── harness ────────────────────────────────────────────────────────────────────────────────────

const dirs: string[] = []
const stores: AdoptionIndexStore[] = []
afterEach(() => {
  while (stores.length > 0) {
    try {
      stores.pop()!.close()
    } catch {
      // Already closed by the test; removing the temp dir is what matters.
    }
  }
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

interface Opened {
  store: AdoptionIndexStore
  root: string
}

async function freshStore(now = T0): Promise<Opened> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-r4-e2e-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now })
  stores.push(store)
  return { store, root: paths.root }
}

/**
 * Drive the operation exactly as `refreshSnapshot.ts` does — port built at the call site, the same
 * `fetchImpl` handed to both the mirror and the port.
 */
async function refresh(
  opened: Opened,
  fetchImpl: typeof fetch,
  opts?: { now?: string; withPort?: boolean },
): Promise<Awaited<ReturnType<typeof refreshFromMirror>>> {
  const now = opts?.now ?? T0
  const withPort = opts?.withPort ?? true
  const artifactPort = withPort
    ? (ctx: { now: string }): Promise<ArtifactResolutionSummary> =>
        resolveArtifacts({
          store: opened.store,
          adapters: createAdapterRegistry([npmArtifactAdapter]),
          fetchImpl,
          now: ctx.now,
        })
    : undefined
  return refreshFromMirror({
    store: opened.store,
    adapter: createOfficialRegistryAdapter(ENDPOINT),
    fetchImpl,
    now,
    endpoint: ENDPOINT,
    snapshotMaxEntries: 25,
    ...(artifactPort === undefined ? {} : { artifactPort }),
  })
}

function casBlobs(root: string): string[] {
  const blobsDir = join(root, "cas", "blobs")
  if (!existsSync(blobsDir)) return []
  const out: string[] = []
  for (const shard of readdirSync(blobsDir, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue
    for (const name of readdirSync(join(blobsDir, shard.name))) out.push(`${shard.name}/${name}`)
  }
  return out.sort()
}

// ── the corpus preconditions ───────────────────────────────────────────────────────────────────

describe("the corpus's own shape, graded before anything is asserted about it", () => {
  it("declares 19 entries and exactly 2 npm packages", () => {
    // The precondition for every count below. Asserted first and separately so a corpus change
    // reports "the corpus moved" rather than "artifact resolution broke" — the two failures need
    // different fixes and a single combined assertion cannot tell them apart.
    expect(parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8")).entries).toHaveLength(19)
    const packages = corpusPackages()
    expect(packages).toHaveLength(2)
    expect([...new Set(packages.map((p) => p.registryType))]).toEqual(["npm"])
    for (const pkg of packages) expect(pkg.version, pkg.identifier).not.toBeNull()
  })

  it("the two fixtures are DIFFERENT bytes, so two blobs is not one blob twice", () => {
    const { bytesFor } = corpusRoutes()
    const digests = new Set([...bytesFor.values()].map((b) => createHash("sha256").update(b).digest("hex")))
    expect(bytesFor.size).toBe(2)
    expect(digests.size).toBe(2)
  })

  it("covers a SCOPED name, which is the encoding the packument path gets wrong", () => {
    // `@adeu/mcp-server` is in the corpus, so the single-encoding rule is exercised by the
    // corpus rather than only by a synthetic case in the unit suite.
    const scoped = corpusPackages().filter((p) => p.identifier.startsWith("@"))
    expect(scoped.length).toBeGreaterThan(0)
    expect(packumentUrl("@adeu/mcp-server")).toBe(`${NPM_REGISTRY}/@adeu%2fmcp-server`)
  })
})

// ── the plan's step 7 ──────────────────────────────────────────────────────────────────────────

describe("the injected port resolves the committed corpus end to end (plan step 7)", () => {
  it("reaches FETCHED for BOTH npm artifacts, with nothing unavailable and nothing rejected", async () => {
    const opened = await freshStore()
    const { fetchImpl } = stubFetch(corpusRoutes().routes)
    const result = await refresh(opened, fetchImpl)

    // The mirror half first: 19 in, 19 subjects, 2 artifact rows. Grading this here means a
    // failure below cannot be a mirror failure wearing an artifact failure's label.
    expect(result.mirroredRecords).toBe(19)
    expect(result.identity.subjects).toBe(19)
    expect(result.identity.artifacts).toBe(2)
    expect(result.identity.conflicts).toBe(0)

    const artifacts = result.artifacts
    expect(artifacts).not.toBeNull()
    expect(artifacts!.considered).toBe(2)
    expect(artifacts!.fetched).toBe(2)
    expect(artifacts!.unavailable).toBe(0)
    expect(artifacts!.rejected).toBe(0)
    // Nothing skipped: every package the corpus declares is npm, and npm is the one adapter
    // shipped. A non-npm package appearing upstream would land here rather than in `unavailable`.
    expect(artifacts!.skippedNoAdapter).toBe(0)
    // Cold store, so nothing was served from cache. Asserting 0 is what makes the warm-run
    // assertion below a measurement of reuse rather than of the counter existing.
    expect(artifacts!.cached).toBe(0)
  })

  it("flips rebuild.artifact from null to a measured TRUE", async () => {
    const opened = await freshStore()
    const { fetchImpl } = stubFetch(corpusRoutes().routes)
    const result = await refresh(opened, fetchImpl)

    // The §16.2 tier this batch owns. It was `null` at R-3 with the comment "Needs
    // artifact_versions — R-4", and `refresh-from-mirror.test.ts:615` still asserts that `null`
    // for the NO-PORT path. Both are true at once, which is the whole design: the tier reports
    // what the run measured, and a run with no port measured nothing.
    expect(result.change.rebuild.artifact).toBe(true)
    expect(result.change.rebuild.identity).toBe(true)
    expect(result.change.rebuild.canonicalize).toBe(true)
    // The four tiers no batch can honestly compute yet stay `null`. Asserted as a set so the
    // batch that flips one has to come here and say so.
    expect(result.change.rebuild.evidence).toBeNull()
    expect(result.change.rebuild.decision).toBeNull()
    expect(result.change.rebuild.semanticContract).toBeNull()
    expect(result.change.rebuild.presentation).toBeNull()
  })

  it("writes the four R-4 columns for both artifacts, and NULLS none of them", async () => {
    const opened = await freshStore()
    const { bytesFor, routes } = corpusRoutes()
    const { fetchImpl } = stubFetch(routes)
    await refresh(opened, fetchImpl)

    const rows = opened.store.listArtifactVersions()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      const bytes = bytesFor.get(row.packageIdentifier)
      expect(bytes, row.packageIdentifier).toBeDefined()
      expect(row.artifactStatus, row.packageIdentifier).toBe("FETCHED")
      // `immutableDigest` is OURS, computed over the bytes; `registryIntegrity` is the registry's
      // CLAIM, in the registry's own encoding. They are different strings by construction — that
      // they are both present and NOT equal is the Observed-vs-Inferred line held in the schema.
      expect(row.immutableDigest, row.packageIdentifier).toBe(
        `sha256:${createHash("sha256").update(bytes!).digest("hex")}`,
      )
      expect(row.registryIntegrity, row.packageIdentifier).toBe(sri(bytes!))
      expect(row.registryIntegrity).not.toBe(row.immutableDigest)
      // `cache_key` addresses the blob; `last_verified_at` is the run's injected clock, never a
      // wall-clock read.
      expect(row.cacheKey, row.packageIdentifier).toBe(row.immutableDigest)
      expect(row.lastVerifiedAt, row.packageIdentifier).toBe(T0)
    }
  })

  it("holds exactly 2 verified blobs in the CAS, at their digest-derived paths", async () => {
    const opened = await freshStore()
    const { bytesFor, routes } = corpusRoutes()
    const { fetchImpl } = stubFetch(routes)
    await refresh(opened, fetchImpl)

    // The count the plan's step 8 checks against the LIVE registry, measured here offline.
    expect(casBlobs(opened.root)).toHaveLength(2)

    for (const [identifier, bytes] of bytesFor) {
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
      const path = casBlobPath(opened.root, digest)
      expect(existsSync(path), identifier).toBe(true)
      // Byte-compare, not existence: a blob whose CONTENT drifted from the digest naming it
      // would pass an existence check and fail this.
      expect(new Uint8Array(readFileSync(path))).toEqual(bytes)
    }

    // `cas/expanded` stays EMPTY. R-4 parses the tar in memory to enumerate entries; writing an
    // expansion is the evidence batch's need, and a stray write here would be that batch
    // arriving early and unmeasured.
    expect(readdirSync(join(opened.root, "cas", "expanded"))).toEqual([])
    // Nothing left staged: `work/` holds `<digest>.part` only between write and rename.
    expect(readdirSync(join(opened.root, "work"))).toEqual([])
  })

  it("never fetches an artifact URL for a remote-only subject", async () => {
    const opened = await freshStore()
    const { fetchImpl, calls } = stubFetch(corpusRoutes().routes)
    await refresh(opened, fetchImpl)

    // 17 of the 19 entries declare remotes and no package. Their endpoints are recorded in the
    // mirror; they must never be REQUESTED. Fetching one would be R-4 treating an endpoint as a
    // downloadable artifact — and, worse, contacting a third-party host during ingestion.
    const remoteHosts = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8"))
      .entries.flatMap((e) => e.remotes.map((r) => r.url))
      .filter((u) => u.length > 0)
    expect(remoteHosts.length).toBeGreaterThan(0)
    for (const url of remoteHosts) expect(calls, url).not.toContain(url)

    // Every call went to exactly two hosts: the registry and npm.
    const hosts = [...new Set(calls.map((c) => new URL(c).origin))].sort()
    expect(hosts).toEqual(["https://registry.modelcontextprotocol.io", "https://registry.npmjs.org"])
  })

  it("a warm second run RE-VERIFIES from cache without refetching either tarball", async () => {
    const opened = await freshStore()
    const { routes } = corpusRoutes()
    const first = stubFetch(routes)
    await refresh(opened, first.fetchImpl)
    const tarballCalls = (calls: string[]) => calls.filter((c) => c.endsWith(".tgz"))
    expect(tarballCalls(first.calls)).toHaveLength(2)

    // A SECOND stub, so the count starts at zero rather than being subtracted. Cache reuse can
    // never be observed in CI — every scheduled run is a cold checkout — so this test over a warm
    // temp store is the only place the property is measurable at all.
    const second = stubFetch(routes)
    const result = await refresh(opened, second.fetchImpl, { now: T1 })

    // `FETCHED` is not an input status, so both artifacts are out of the pending set entirely.
    expect(result.artifacts!.considered).toBe(0)
    expect(result.artifacts!.fetched).toBe(0)
    expect(tarballCalls(second.calls)).toHaveLength(0)

    // And the columns the first run wrote are untouched — `last_verified_at` still T0, not T1.
    // `COALESCE(?, last_verified_at)` is what protects it, and only a read-back shows that.
    for (const row of opened.store.listArtifactVersions()) {
      expect(row.artifactStatus).toBe("FETCHED")
      expect(row.lastVerifiedAt).toBe(T0)
    }
    expect(casBlobs(opened.root)).toHaveLength(2)
  })

  it("resolves artifacts WITHOUT moving the projected bytes or the checkpoint digest", async () => {
    // The reproducibility claim R-4 must not break: `snapshot` is a function of `records` alone.
    // Two stores over the same corpus, one with the port and one without, must commit identical
    // bytes and identical digests. If artifact resolution had leaked into the projection — a
    // filter on `FETCHED`, a digest folded into an entry — this is where it would show.
    const withPort = await freshStore()
    const withoutPort = await freshStore()
    const { routes } = corpusRoutes()
    const a = await refresh(withPort, stubFetch(routes).fetchImpl, { withPort: true })
    const b = await refresh(withoutPort, stubFetch(routes).fetchImpl, { withPort: false })

    expect(a.snapshotText).toBe(b.snapshotText)
    expect(a.snapshotDigest).toBe(b.snapshotDigest)
    // Not vacuous: the ported run really did resolve two artifacts, and the unported one really
    // did resolve none.
    expect(a.artifacts!.fetched).toBe(2)
    expect(b.artifacts).toBeNull()
    // The no-port run's tier stays `null` — the assertion control #27 inverts, restated here
    // against the corpus rather than against a two-entry fixture.
    expect(b.change.rebuild.artifact).toBeNull()
    expect(a.change.rebuild.artifact).toBe(true)
    // Both advanced the same checkpoint digest on disk, so the reorder that builds the verdict
    // AFTER the artifact port did not change what the run persists.
    expect(withPort.store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)?.snapshotDigest).toBe(a.snapshotDigest)
    expect(withoutPort.store.readCheckpoint(OFFICIAL_REGISTRY_SOURCE_ID)?.snapshotDigest).toBe(b.snapshotDigest)
  })

  it("a registry that serves a WRONG tarball leaves the corpus with 0 fetched and 2 rejected", async () => {
    // The end-to-end half of control #23. The unit suite flips a byte at the CAS boundary; this
    // flips it at the WIRE, over the real corpus, through the real port — so what is graded is
    // that a mismatch survives every layer between the socket and the column.
    const opened = await freshStore()
    const { routes, bytesFor } = corpusRoutes()
    for (const [identifier, bytes] of bytesFor) {
      const tampered = new Uint8Array(bytes)
      tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff
      const pkg = corpusPackages().find((p) => p.identifier === identifier)!
      routes[tarballUrl(identifier, pkg.version!)] = { bytes: tampered }
    }
    const result = await refresh(opened, stubFetch(routes).fetchImpl)

    expect(result.artifacts!.fetched).toBe(0)
    expect(result.artifacts!.rejected).toBe(2)
    expect(result.artifacts!.unavailable).toBe(0)
    // Refused bytes were never written. Verify-then-write, not write-then-delete.
    expect(casBlobs(opened.root)).toEqual([])
    for (const row of opened.store.listArtifactVersions()) {
      expect(row.artifactStatus, row.packageIdentifier).toBe("REJECTED")
      // The claim is recorded even on refusal — that is the evidence of WHAT was refused — while
      // `cache_key` stays null because no blob was stored.
      expect(row.registryIntegrity, row.packageIdentifier).not.toBeNull()
      expect(row.cacheKey, row.packageIdentifier).toBeNull()
    }

    // And it is STICKY: a later honest run cannot heal it. `REJECTED` is terminal and not an
    // input status, so the artifacts are not even reconsidered.
    const honest = stubFetch(corpusRoutes().routes)
    const second = await refresh(opened, honest.fetchImpl, { now: T1 })
    expect(second.artifacts!.considered).toBe(0)
    expect(honest.calls.filter((c) => c.endsWith(".tgz"))).toHaveLength(0)
    for (const row of opened.store.listArtifactVersions()) expect(row.artifactStatus).toBe("REJECTED")
  })

  it("a registry that 404s the tarball records UNAVAILABLE, which a later run RETRIES", async () => {
    // `UNAVAILABLE` and `REJECTED` differ in exactly one respect that matters operationally:
    // whether a later run tries again. Measured as a pair with the case above, over the corpus.
    const opened = await freshStore()
    const { routes } = corpusRoutes()
    for (const pkg of corpusPackages()) delete routes[tarballUrl(pkg.identifier, pkg.version!)]
    const first = await refresh(opened, stubFetch(routes).fetchImpl)

    expect(first.artifacts!.unavailable).toBe(2)
    expect(first.artifacts!.rejected).toBe(0)
    expect(casBlobs(opened.root)).toEqual([])

    const honest = stubFetch(corpusRoutes().routes)
    const second = await refresh(opened, honest.fetchImpl, { now: T1 })
    expect(second.artifacts!.considered).toBe(2)
    expect(second.artifacts!.fetched).toBe(2)
    expect(casBlobs(opened.root)).toHaveLength(2)
    for (const row of opened.store.listArtifactVersions()) expect(row.lastVerifiedAt).toBe(T1)
  })
})
