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
 *   1. THE FIXTURE IS THE COMMITTED SNAPSHOT, not a hand-authored cohort. The 25 entries are
 *      replayed through the official adapter's raw wire shape, so the count under test is the
 *      corpus's own 25-subjects/3-artifacts shape rather than a number a fixture chose. If someone
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
 *
 * R-7 EXTENDS IT, and does NOT add a port. `refreshFromMirror` has an `artifactPort` and an
 * `evidencePort` and deliberately no record port: this batch writes `adoption_records` and does not
 * wire the projection, so the compiler is driven where production will drive it — from the caller
 * that holds both packages. The last describe therefore refreshes the chain first and compiles
 * against the ROWS that run left behind, which is the honest shape of the seam as it stands at HEAD.
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
  compileEvidence,
  compileAdoptionRecordWithDigest,
  type AdoptionRecordV1,
  type ArtifactResolutionSummary,
  type EvidenceCompilationSummary,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const SNAPSHOT_PATH = join(PKG_ROOT, "..", "trust-index", "snapshots", "official-mcp-registry.json")
const ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"
const T0 = "2026-08-01T00:00:00.000Z"
const T1 = "2026-08-02T00:00:00.000Z"
/** R-5's two injected inputs. Fixed here so a digest that moves means the BYTES moved. */
const POLICY_DIGEST = "sha256:" + "9".repeat(64)
const ENGINE_VERSION = "0.1.0-e2e"

// ── the corpus, replayed as wire bytes ─────────────────────────────────────────────────────────

interface CorpusPackage {
  registryType: string
  identifier: string
  version: string | null
}

/**
 * The committed 25 entries, turned back into the raw registry shape the official adapter parses.
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
  opts?: { now?: string; withPort?: boolean; withEvidencePort?: boolean },
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
  // R-5's port, built the same way and DEFAULTED OFF so every existing assertion in this file
  // keeps measuring what it measured before. Note what is NOT threaded through: `fetchImpl`. R-5
  // reads the CAS, so there is no parameter to hand it — the offline property is visible right
  // here, in the shape of the call site, rather than only in a docblock.
  const evidencePort = (opts?.withEvidencePort ?? false)
    ? (ctx: { now: string }): Promise<EvidenceCompilationSummary> =>
        Promise.resolve(
          compileEvidence({
            store: opened.store,
            now: ctx.now,
            policyDigest: POLICY_DIGEST,
            engineVersion: ENGINE_VERSION,
          }),
        )
    : undefined
  return refreshFromMirror({
    store: opened.store,
    adapter: createOfficialRegistryAdapter(ENDPOINT),
    fetchImpl,
    now,
    endpoint: ENDPOINT,
    snapshotMaxEntries: 25,
    ...(artifactPort === undefined ? {} : { artifactPort }),
    ...(evidencePort === undefined ? {} : { evidencePort }),
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

/**
 * The corpus's dimensions, READ from the committed snapshot rather than written down. Every count
 * in this file is one of these numbers, so pinning them as literals (`25` and `3`, true of the
 * cohort committed before ADR 0074's cap first bound at 100) made a snapshot refresh red thirteen
 * tests that are about artifact resolution, not about how many entries were fetched.
 *
 * Deriving them does NOT weaken the file: what each test asserts is a RELATION between them —
 * subjects follow entries, artifact rows follow DECLARED packages, blobs follow FETCHABLE ones —
 * and every one of those still has a failing mode. The shape itself is graded below, separately
 * and first, so a corpus that lost its packages reports "the corpus moved" rather than
 * "resolution broke".
 *
 * THERE ARE THREE NUMBERS HERE, NOT TWO, AND AT COHORT 25 THAT WAS INVISIBLE. Every package the
 * 25-entry cohort declared was npm, so "declared" and "fetchable" were the same 3 and one constant
 * served both. At 100 the corpus declares 30 — 27 npm, 2 oci, 1 pypi — and the two populations
 * separate: `artifact_versions` gets a row per DECLARED package (identity does not care which
 * types this build can fetch), while the CAS, the tarball calls and every FETCHED/REJECTED count
 * follow only the ones an adapter exists for. Collapsing them would have made the non-npm branch
 * unmeasurable at exactly the moment the corpus started exercising it.
 */
const CORPUS_ENTRIES = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8")).entries.length
/** Every package the corpus declares — the population `artifact_versions` holds a row for. */
const CORPUS_PACKAGES = corpusPackages().length
/** The subset an adapter ships for. `corpusRoutes` serves a tarball for exactly these. */
const CORPUS_FETCHABLE = corpusPackages().filter((p) => p.registryType === "npm" && p.version !== null).length
/** The remainder: declared, typed, and NOT TRIED — `NO_ADAPTER`, never `UNAVAILABLE`. */
const CORPUS_NO_ADAPTER = CORPUS_PACKAGES - CORPUS_FETCHABLE
/**
 * A FOURTH NUMBER, and the docblock above predicted its shape without predicting it (added 2026-09-01,
 * ADR 0096). The three above all count PACKAGES. The record layer publishes one record per SUBJECT and
 * selects ONE artifact for it — `persistAll` does `artifacts.find((a) => a.subjectId === …)`, the FIRST
 * stored row, and `artifact_versions` holds a row per DECLARED package in declaration order.
 *
 * So a subject's record gets bytes only if its FIRST declared package is one an adapter ships for. That
 * is not "has a fetchable package anywhere in its list", and the two coincided for the whole life of
 * this corpus: until cohort 200 no subject declared a non-npm package AHEAD of an npm one. At 200 two
 * do — `ai.bourdon/bourdon` and `ai.bowmark/bowmark`, both `pypi` first, `npm` second — so
 * `CORPUS_FETCHABLE` (37 packages) and the with-bytes record population (35 subjects) separated.
 *
 * `CORPUS_FETCHABLE` remains correct for every artifact-plane assertion (37 tarball calls, 37 CAS
 * blobs, 37 FETCHED rows) — those really are per-package, and all ~30 of them stayed green. Only the
 * per-subject partition was wrong, and it was wrong in the direction that matters: it would have gone
 * on agreeing forever on a corpus where declaration order never varied.
 */
const CORPUS_SUBJECTS_WITH_SELECTED_BYTES = parseSnapshot(readFileSync(SNAPSHOT_PATH, "utf8"))
  .entries.filter((e) => {
    const first = e.packages[0]
    return first !== undefined && first.registryType === "npm" && (first.version ?? null) !== null
  }).length

describe("the corpus's own shape, graded before anything is asserted about it", () => {
  it("declares entries, strictly fewer packages, and splits them into fetchable and not", () => {
    // The precondition for every count below. Asserted first and separately so a corpus change
    // reports "the corpus moved" rather than "artifact resolution broke" — the two failures need
    // different fixes and a single combined assertion cannot tell them apart.
    //
    // Stated as inequalities because that is what the file downstream depends on: there must BE
    // entries, there must BE packages (else every artifact assertion is vacuous), and packages
    // must be FEWER than entries (else "artifacts follow packages, not subjects" is untestable —
    // the two counts would coincide and no assertion could tell which rule produced the rows).
    expect(CORPUS_ENTRIES, "an empty corpus makes every count below vacuous").toBeGreaterThan(0)
    expect(CORPUS_PACKAGES, "a corpus with no packages cannot exercise artifact resolution").toBeGreaterThan(0)
    expect(
      CORPUS_PACKAGES,
      "packages must be strictly fewer than entries, or 'artifacts follow packages' is unfalsifiable",
    ).toBeLessThan(CORPUS_ENTRIES)
    // The fetchable subset must be non-empty, or every FETCHED/CAS/tarball assertion below is
    // vacuous. It must also be a real SUBSET — see the type census in the next assertion.
    expect(CORPUS_FETCHABLE, "no fetchable package makes every FETCHED assertion vacuous").toBeGreaterThan(0)
    expect(CORPUS_FETCHABLE, "fetchable cannot exceed declared").toBeLessThanOrEqual(CORPUS_PACKAGES)
    // Every fetchable package carries a version — `corpusRoutes` builds its packument from it, so
    // a null would silently drop a route and under-serve the wire.
    for (const pkg of corpusPackages().filter((p) => p.registryType === "npm")) {
      expect(pkg.version, pkg.identifier).not.toBeNull()
    }
  })

  it("carries non-npm packages, which is what makes the NO_ADAPTER branch corpus-driven", () => {
    // WHAT COHORT 100 CHANGED, RECORDED AS A MEASUREMENT RATHER THAN A COMMENT. At 25 every
    // declared package was npm, so `skippedNoAdapter` was 0 on the corpus and the branch was
    // reachable only from the unit suite's synthetic input. At 100 the corpus declares oci and
    // pypi packages, so the "NOT TRIED" path — status does not move, nothing is written, and the
    // outcome is `NO_ADAPTER` rather than the dishonest `UNAVAILABLE` — is exercised by committed
    // bytes. Asserted as a census so a refresh that loses the non-npm entries reds HERE, naming
    // the reason, rather than turning the branch back into dead corpus coverage silently.
    const census: Record<string, number> = {}
    for (const p of corpusPackages()) census[p.registryType] = (census[p.registryType] ?? 0) + 1
    expect(Object.keys(census).sort(), "the corpus must declare more than one registryType").not.toEqual(["npm"])
    expect(
      CORPUS_NO_ADAPTER,
      `the non-npm population is what drives skippedNoAdapter; census ${JSON.stringify(census)}`,
    ).toBeGreaterThan(0)
    // The partition is exact: declared = fetchable + not-tried, with no third bucket. If a type
    // gained an adapter, this still holds and `CORPUS_FETCHABLE` moves with it.
    expect({ fetchable: CORPUS_FETCHABLE, noAdapter: CORPUS_NO_ADAPTER }).toEqual({
      fetchable: census.npm ?? 0,
      noAdapter: CORPUS_PACKAGES - (census.npm ?? 0),
    })
  })

  it("the package fixtures are DIFFERENT bytes, so N blobs is not one blob reused", () => {
    const { bytesFor } = corpusRoutes()
    const digests = new Set([...bytesFor.values()].map((b) => createHash("sha256").update(b).digest("hex")))
    // Keyed on the FETCHABLE count: `corpusRoutes` serves bytes only for packages it can build a
    // packument for, so a non-npm package contributes no fixture and must not be counted here.
    expect(bytesFor.size).toBe(CORPUS_FETCHABLE)
    // The point of this control: as many DISTINCT digests as fixtures. If two packages served the
    // same bytes, the CAS would hold one blob and every "N blobs" assertion below would be
    // satisfied by a coincidence rather than by per-artifact storage.
    expect(digests.size).toBe(CORPUS_FETCHABLE)
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
  it("reaches FETCHED for every npm artifact, with nothing unavailable and nothing rejected", async () => {
    const opened = await freshStore()
    const { fetchImpl } = stubFetch(corpusRoutes().routes)
    const result = await refresh(opened, fetchImpl)

    // The mirror half first: entries in, one subject each, one artifact row per declared package.
    // Grading this here means a failure below cannot be a mirror failure wearing an artifact
    // failure's label.
    expect(result.mirroredRecords).toBe(CORPUS_ENTRIES)
    expect(result.identity.subjects).toBe(CORPUS_ENTRIES)
    expect(result.identity.artifacts).toBe(CORPUS_PACKAGES)
    expect(result.identity.conflicts).toBe(0)

    const artifacts = result.artifacts
    expect(artifacts).not.toBeNull()
    // EVERY declared package is CONSIDERED — the pending set is built from the rows, not from the
    // types this build happens to support — but only the fetchable ones can reach FETCHED.
    expect(artifacts!.considered).toBe(CORPUS_PACKAGES)
    expect(artifacts!.fetched).toBe(CORPUS_FETCHABLE)
    expect(artifacts!.unavailable).toBe(0)
    expect(artifacts!.rejected).toBe(0)
    // The non-npm remainder, and the DISTINCTION that makes it honest: a type with no adapter is
    // NOT TRIED, so it lands in `skippedNoAdapter` and never in `unavailable`, which would claim
    // "tried and failed". Both halves asserted — the count above is 0, and this one carries the
    // rest — so a build that mislabelled the branch reds here rather than balancing out.
    expect(artifacts!.skippedNoAdapter).toBe(CORPUS_NO_ADAPTER)
    expect(artifacts!.fetched + artifacts!.skippedNoAdapter).toBe(artifacts!.considered)
    // And the reason names the type, so the row says WHICH adapter was missing.
    const notTried = artifacts!.records.filter((r) => r.outcome === "NO_ADAPTER")
    expect(notTried).toHaveLength(CORPUS_NO_ADAPTER)
    expect(notTried.every((r) => r.reason === `NO_ADAPTER:${r.packageType}`)).toBe(true)
    expect(notTried.every((r) => r.packageType !== "npm")).toBe(true)
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

  it("writes the four R-4 columns for every FETCHED artifact, and NULLS none of them", async () => {
    const opened = await freshStore()
    const { bytesFor, routes } = corpusRoutes()
    const { fetchImpl } = stubFetch(routes)
    await refresh(opened, fetchImpl)

    const rows = opened.store.listArtifactVersions()
    // A row per DECLARED package, including the types no adapter shipped for: identity writes the
    // row, resolution decides what fills it.
    expect(rows).toHaveLength(CORPUS_PACKAGES)
    const fetched = rows.filter((r) => bytesFor.has(r.packageIdentifier))
    expect(fetched, "the fixture map must cover every fetchable row").toHaveLength(CORPUS_FETCHABLE)
    // The NOT-TRIED half, asserted rather than filtered away. A row with no adapter keeps the
    // status identity gave it and leaves the R-4 columns null — writing a digest for bytes nobody
    // fetched is precisely the fabrication this branch exists to avoid.
    const notTried = rows.filter((r) => !bytesFor.has(r.packageIdentifier))
    expect(notTried).toHaveLength(CORPUS_NO_ADAPTER)
    for (const row of notTried) {
      expect(row.artifactStatus, row.packageIdentifier).toBe("RESOLVED")
      expect(row.immutableDigest, row.packageIdentifier).toBeNull()
      expect(row.cacheKey, row.packageIdentifier).toBeNull()
      expect(row.packageType, row.packageIdentifier).not.toBe("npm")
    }
    for (const row of fetched) {
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
    expect(casBlobs(opened.root)).toHaveLength(CORPUS_FETCHABLE)

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

    // 22 of the 25 entries declare remotes and no package. Their endpoints are recorded in the
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
    expect(tarballCalls(first.calls)).toHaveLength(CORPUS_FETCHABLE)

    // A SECOND stub, so the count starts at zero rather than being subtracted. Cache reuse can
    // never be observed in CI — every scheduled run is a cold checkout — so this test over a warm
    // temp store is the only place the property is measurable at all.
    const second = stubFetch(routes)
    const result = await refresh(opened, second.fetchImpl, { now: T1 })

    // `FETCHED` is not an input status, so every fetched artifact is out of the pending set. The
    // NOT-TRIED rows are a different case and are asserted as one: `RESOLVED` IS an input status,
    // so they are reconsidered on every run and skipped again — which is correct (an adapter could
    // ship tomorrow) and is why `considered` is the not-tried count rather than 0.
    expect(result.artifacts!.considered).toBe(CORPUS_NO_ADAPTER)
    expect(result.artifacts!.skippedNoAdapter).toBe(CORPUS_NO_ADAPTER)
    expect(result.artifacts!.fetched).toBe(0)
    // The load-bearing half: NOTHING went back on the wire. Reconsidering a row with no adapter
    // must cost no request, so cache reuse is measured by the wire being silent, not by a counter.
    expect(tarballCalls(second.calls)).toHaveLength(0)

    // And the columns the first run wrote are untouched — `last_verified_at` still T0, not T1.
    // `COALESCE(?, last_verified_at)` is what protects it, and only a read-back shows that.
    const rows = opened.store.listArtifactVersions()
    const warmFetched = rows.filter((r) => r.artifactStatus === "FETCHED")
    expect(warmFetched).toHaveLength(CORPUS_FETCHABLE)
    for (const row of warmFetched) {
      expect(row.lastVerifiedAt, row.packageIdentifier).toBe(T0)
    }
    // The not-tried rows never got a verification instant at all — an adapter-less type has no
    // bytes anyone verified, so a timestamp here would be a claim about work never done.
    for (const row of rows.filter((r) => r.artifactStatus !== "FETCHED")) {
      expect(row.artifactStatus, row.packageIdentifier).toBe("RESOLVED")
      expect(row.lastVerifiedAt, row.packageIdentifier).toBeNull()
    }
    expect(casBlobs(opened.root)).toHaveLength(CORPUS_FETCHABLE)
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
    // Not vacuous: the ported run really did resolve three artifacts, and the unported one really
    // did resolve none.
    expect(a.artifacts!.fetched).toBe(CORPUS_FETCHABLE)
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
    expect(result.artifacts!.rejected).toBe(CORPUS_FETCHABLE)
    expect(result.artifacts!.unavailable).toBe(0)
    // Refused bytes were never written. Verify-then-write, not write-then-delete.
    expect(casBlobs(opened.root)).toEqual([])
    // Only the tampered population can be REJECTED — the adapter-less rows were never fetched, so
    // they cannot be refused either. Partitioned rather than looped over, so a build that refused
    // a package it never requested reds instead of passing on a bulk `every`.
    const rows = opened.store.listArtifactVersions()
    const refused = rows.filter((r) => r.artifactStatus === "REJECTED")
    expect(refused).toHaveLength(CORPUS_FETCHABLE)
    for (const row of refused) {
      // The claim is recorded even on refusal — that is the evidence of WHAT was refused — while
      // `cache_key` stays null because no blob was stored.
      expect(row.registryIntegrity, row.packageIdentifier).not.toBeNull()
      expect(row.cacheKey, row.packageIdentifier).toBeNull()
    }
    for (const row of rows.filter((r) => r.artifactStatus !== "REJECTED")) {
      expect(row.artifactStatus, row.packageIdentifier).toBe("RESOLVED")
      expect(row.registryIntegrity, row.packageIdentifier).toBeNull()
    }

    // And it is STICKY: a later honest run cannot heal it. `REJECTED` is terminal and not an
    // input status, so the refused artifacts are not even reconsidered — only the adapter-less
    // rows come back around, and they still cost no request.
    const honest = stubFetch(corpusRoutes().routes)
    const second = await refresh(opened, honest.fetchImpl, { now: T1 })
    expect(second.artifacts!.considered).toBe(CORPUS_NO_ADAPTER)
    expect(second.artifacts!.fetched).toBe(0)
    expect(honest.calls.filter((c) => c.endsWith(".tgz"))).toHaveLength(0)
    expect(opened.store.listArtifactVersions().filter((r) => r.artifactStatus === "REJECTED")).toHaveLength(
      CORPUS_FETCHABLE,
    )
  })

  it("a registry that 404s the tarball records UNAVAILABLE, which a later run RETRIES", async () => {
    // `UNAVAILABLE` and `REJECTED` differ in exactly one respect that matters operationally:
    // whether a later run tries again. Measured as a pair with the case above, over the corpus.
    const opened = await freshStore()
    const { routes } = corpusRoutes()
    for (const pkg of corpusPackages()) delete routes[tarballUrl(pkg.identifier, pkg.version!)]
    const first = await refresh(opened, stubFetch(routes).fetchImpl)

    expect(first.artifacts!.unavailable).toBe(CORPUS_FETCHABLE)
    expect(first.artifacts!.rejected).toBe(0)
    expect(casBlobs(opened.root)).toEqual([])

    const honest = stubFetch(corpusRoutes().routes)
    const second = await refresh(opened, honest.fetchImpl, { now: T1 })
    // `UNAVAILABLE` retries, so the whole declared population is reconsidered here: the fetchable
    // rows because their failure was transient, the adapter-less ones because `RESOLVED` never
    // leaves the pending set. Both are in `considered` and only the first kind can succeed.
    expect(second.artifacts!.considered).toBe(CORPUS_PACKAGES)
    expect(second.artifacts!.fetched).toBe(CORPUS_FETCHABLE)
    expect(second.artifacts!.skippedNoAdapter).toBe(CORPUS_NO_ADAPTER)
    expect(casBlobs(opened.root)).toHaveLength(CORPUS_FETCHABLE)
    const healed = opened.store.listArtifactVersions().filter((r) => r.artifactStatus === "FETCHED")
    expect(healed).toHaveLength(CORPUS_FETCHABLE)
    for (const row of healed) expect(row.lastVerifiedAt, row.packageIdentifier).toBe(T1)
  })
})

// ── R-5 through the WIRING (the plan's verification step 8) ─────────────────────────────────────

/**
 * `evidence-compilation.test.ts` drives `compileEvidence` directly, which proves the operation.
 * This proves the PORT — that a run reaches it, that its summary lands on `RefreshResult`, and that
 * `rebuild.evidence` stops being `null` because something measured it.
 *
 * Those are different failures. R-4 built exactly this file for `artifactPort` for the same reason:
 * a wired-but-never-driven port is the "shipped-not-wired" shape the A-08 grading penalizes, and it
 * is invisible to a unit test of the operation and to a tier assertion over a hand-built verdict.
 * R-5 shipped the port with the unit half only; this closes it over the real committed corpus.
 */
describe("R-5's evidencePort, driven end-to-end over the committed corpus", () => {
  it("compiles evidence for the corpus's FETCHED artifacts and reports it on the result", async () => {
    // ONE COLD RUN, both ports on — and that is the only arrangement in which the tier can flip.
    // I first wrote this as two runs (fetch, then compile on a replay) and it failed with
    // `expected null to be true`. The failure was the assertion's, not the code's: a replay leaves
    // the cohort digest unmoved, so the verdict is `NO_CHANGE` and `NO_REBUILD` holds EVERY tier at
    // `null` — control #62's property, arriving here uninvited. A tier assertion is therefore only
    // meaningful on a run that changed something.
    //
    // Keeping both ports on one cold run also asserts something the two-run shape could not:
    // `refreshFromMirror` awaits `artifactPort` BEFORE `evidencePort` (its own comment calls this a
    // data dependency, not a preference), so 2 artifacts fetched AND 2 evidence rows compiled in a
    // single pass is that ordering, measured. Reverse the two awaits and `compiled` becomes 0,
    // because nothing is in `FETCHED` yet.
    const opened = await freshStore()
    const first = await refresh(opened, stubFetch(corpusRoutes().routes).fetchImpl, {
      now: T1,
      withEvidencePort: true,
    })

    expect(first.artifacts!.fetched).toBe(CORPUS_FETCHABLE)
    expect(first.evidence!.considered).toBe(CORPUS_FETCHABLE)
    expect(first.evidence!.compiled).toBe(CORPUS_FETCHABLE)
    // `NO_PRIOR_DIGEST` on a cold store ⇒ `changed`, so the measured tiers are reported.
    expect(first.change.rebuild.evidence).toBe(true)

    const rows = opened.store.listEvidenceRecords()
    expect(rows).toHaveLength(CORPUS_FETCHABLE)
    // The verdict is `UNKNOWN` by construction, and asserting it over a REAL corpus is the point:
    // "Never mark an unknown source as SAFE" has to hold on the honest path, not only in a fixture.
    for (const row of rows) {
      expect(row.verdict).toBe("UNKNOWN")
      expect(row.policyDigest).toBe(POLICY_DIGEST)
      expect(row.engineVersion).toBe(ENGINE_VERSION)
      expect(row.createdAt).toBe(T1)
    }
  })

  it("a THIRD run inserts nothing and moves no created_at — idempotence through the port", async () => {
    // Step 8's "run twice, assert exactly one row" measured against the wiring rather than the
    // operation. `evidence_digest` is a function of its four inputs and no clock, so a later run at
    // a different `now` must land on the same key and be ignored.
    const opened = await freshStore()
    await refresh(opened, stubFetch(corpusRoutes().routes).fetchImpl, { now: T1, withEvidencePort: true })
    const before = opened.store.listEvidenceRecords()
    expect(before).toHaveLength(CORPUS_FETCHABLE)

    const third = await refresh(opened, stubFetch(corpusRoutes().routes).fetchImpl, {
      now: "2026-08-03T00:00:00.000Z",
      withEvidencePort: true,
    })
    expect(third.evidence!.compiled).toBe(0)
    expect(third.evidence!.unchanged).toBe(CORPUS_FETCHABLE)

    const after = opened.store.listEvidenceRecords()
    expect(after).toHaveLength(CORPUS_FETCHABLE)
    // Byte-for-byte, INCLUDING `created_at`. A row rewritten under a new clock reading would still
    // be "two rows", so the count alone cannot see control #55's failure — the digests and the
    // timestamps are what can.
    expect(after).toEqual(before)
  })

  it("the tier stays null when the port is absent, on a CHANGED run that had bytes to compile", async () => {
    // Control #61 asserts this over a hand-built verdict. Here it is asserted over a real run that
    // COULD have compiled: the artifacts reach `FETCHED` in this very run and their blobs are in the
    // CAS, so `null` is demonstrably "nobody measured it" rather than "there was nothing to measure".
    //
    // ON A CHANGED RUN, and this file taught me why the word matters. I first wrote this against a
    // replay and it passed — but a replay is `NO_CHANGE`, which returns the frozen `NO_REBUILD`
    // constant, so `null` arrived from a shared literal regardless of what the portless default is.
    // Mutating that default to `false` (control #61's mutation, applied here) left the test GREEN and
    // tripped only R-4's artifact assertion. A cold run is `NO_PRIOR_DIGEST` ⇒ `changed`, so the
    // value under test is the DERIVED one, and the assertion can finally fail.
    const opened = await freshStore()
    const cold = await refresh(opened, stubFetch(corpusRoutes().routes).fetchImpl, { now: T1 })

    // Bytes were available to compile from: the run that skipped evidence is the same run that
    // fetched them, so "nothing to measure" is ruled out before `null` is interpreted.
    expect(cold.artifacts!.fetched).toBe(CORPUS_FETCHABLE)
    // Scoped to the fetchable population: the adapter-less rows stay `RESOLVED` and never had
    // bytes, so an `every` over all rows would fail for a reason that has nothing to do with the
    // evidence tier this test is about.
    expect(
      opened.store.listArtifactVersions().filter((r) => r.artifactStatus === "FETCHED"),
      "bytes must exist to compile from, or `null` below means 'nothing to measure'",
    ).toHaveLength(CORPUS_FETCHABLE)
    expect(cold.change.changed).toBe(true)
    expect(cold.change.reason).toBe("NO_PRIOR_DIGEST")
    // The measured neighbour is `true` on this same verdict, which is what makes the `null` next to
    // it meaningful: the two tiers are derived side by side and disagree, so `null` cannot be an
    // artifact of the whole verdict having been skipped.
    expect(cold.change.rebuild.artifact).toBe(true)

    expect(cold.evidence).toBeNull()
    expect(cold.change.rebuild.evidence).toBeNull()
    expect(opened.store.listEvidenceRecords()).toEqual([])
  })
})

// ── R-7: the canonical record, compiled over the same corpus ────────────────────────────────────

/**
 * The three digests R-7 does not produce, fixed here so a record digest that moves means the RECORD
 * moved. `presentationDigest` and `semanticContractDigest` are `@calllint/trust-index`'s, and the
 * dependency runs trust-index → adoption-index, so this file injects them exactly as production
 * will: from the caller that holds both packages.
 */
const PRESENTATION_DIGEST = "sha256:" + "a".repeat(64)
const CONTRACT_DIGEST = "sha256:" + "b".repeat(64)
const DECISION_DIGEST = "sha256:" + "c".repeat(64)

/**
 * Compile a record for every subject the store holds, joining the five upstream tables the way a
 * projection caller would.
 *
 * THE JOIN IS THE MEASUREMENT. `compileAdoptionRecord` is pure and every unit test hands it a
 * literal; what no unit test can answer is whether the rows five different batches wrote can
 * actually be joined into one record. The path is subject → `subject_aliases.sourceRecordId` →
 * `source_records` payload → `artifact_versions` → `evidence_records`, and each hop is a real
 * committed read method rather than a query written here.
 */
function compileAll(
  store: AdoptionIndexStore,
  opts?: { sealContract?: boolean },
): { record: AdoptionRecordV1; adoptionRecordDigest: string }[] {
  const payloadById = new Map(
    store.listLatestSourceRecordPayloads(OFFICIAL_REGISTRY_SOURCE_ID).map((p) => [p.source.sourceRecordId, p]),
  )
  const artifacts = store.listArtifactVersions()
  const evidenceByArtifact = new Map(store.listEvidenceRecords().map((e) => [e.artifactVersionId, e]))

  const out: { record: AdoptionRecordV1; adoptionRecordDigest: string }[] = []
  for (const subject of store.listSubjects()) {
    // Every DISTINCT payload this subject was merged from, not just the first: a subject built from
    // two records must carry both in `sources[]`, and `compileAdoptionRecord` sorts them itself.
    const recordIds = new Set(
      store
        .listSubjectAliases(subject.subjectId)
        .map((a) => a.sourceRecordId)
        .filter((id): id is string => id !== null),
    )
    const sourcePayloads = [...recordIds].map((id) => payloadById.get(id)).filter((p) => p !== undefined)
    // A subject with no reachable payload or no slug is SKIPPED, not compiled with a substitute —
    // `compileAdoptionRecord` would refuse both, and papering over the refusal here would hide it.
    if (sourcePayloads.length === 0 || subject.canonicalSlug === null) continue

    const artifact = artifacts.find((a) => a.subjectId === subject.subjectId) ?? null
    const evidence = artifact === null ? null : evidenceByArtifact.get(artifact.artifactVersionId) ?? null
    // The count comes off the stored document, which is where the findings actually live. The record
    // publishes the COUNT; the findings stay in `evidence_json` (D3).
    const findingCount =
      evidence === null ? null : (JSON.parse(evidence.evidenceJson) as { findings: unknown[] }).findings.length

    out.push(
      compileAdoptionRecordWithDigest({
        subject,
        selectedArtifact: artifact,
        sourcePayloads,
        evidence,
        findingCount,
        // UNKNOWN because nothing in this package decides: `decideOverAuthority` lives in
        // `@calllint/policy` and its digest is COPIED. A record with no graded bytes still carries a
        // decision, which is product principle 2 and the one mid-chain digest that may not be null.
        decision: { verdict: "UNKNOWN", decisionDigest: DECISION_DIGEST, policyDigest: POLICY_DIGEST },
        presentation: {
          presentationDigest: PRESENTATION_DIGEST,
          semanticContractDigest: (opts?.sealContract ?? false) ? CONTRACT_DIGEST : null,
        },
        hostCompatibility: [{ host: "claude-code", tier: "A", installability: "LOCAL_PREFLIGHT_REQUIRED" }],
        lifecycleStatus: "ACTIVE",
      }),
    )
  }
  return out
}

/** Refresh the whole chain, then persist one record per subject. Returns the write results. */
function persistAll(
  store: AdoptionIndexStore,
  updatedAt: string,
  opts?: { sealContract?: boolean },
): { compiled: { record: AdoptionRecordV1; adoptionRecordDigest: string }[]; inserted: boolean[] } {
  const compiled = compileAll(store, opts)
  // PER-RECORD transactions, the `fail-closed` shape: one subject that cannot be written must not
  // discard the nineteen that can. Control (m) measures both halves of this choice.
  const inserted = compiled.map(
    (c) => store.transaction((tx) => tx.upsertAdoptionRecord({ record: c.record, updatedAt })).inserted,
  )
  return { compiled, inserted }
}

describe("R-7's adoption records, compiled over the committed corpus (plan step 9)", () => {
  it("writes exactly one row per subject", async () => {
    const opened = await freshStore()
    const { routes } = corpusRoutes()
    const { fetchImpl } = stubFetch(routes)
    await refresh(opened, fetchImpl, { withEvidencePort: true })

    const subjects = opened.store.listSubjects()
    expect(subjects).toHaveLength(CORPUS_ENTRIES)
    const { compiled, inserted } = persistAll(opened.store, T1)
    // Every subject the corpus produced is compilable: no slug is null and every one reaches a
    // payload. Asserted as an equality against the subject count rather than as a bare 25, so a
    // corpus that grows keeps this honest and a subject that becomes uncompilable fails here.
    expect(compiled).toHaveLength(subjects.length)
    expect(inserted.every((i) => i)).toBe(true)

    const rows = opened.store.listAdoptionRecords()
    expect(rows).toHaveLength(subjects.length)
    // PRIMARY KEY, unlike append-only `source_records`: one row per subject, so the distinct count
    // and the row count are the same number.
    expect(new Set(rows.map((r) => r.subjectId)).size).toBe(subjects.length)
    expect(rows.map((r) => r.subjectId).sort()).toEqual(subjects.map((s) => s.subjectId).sort())
  })

  it("holds the 8-digest chain on the corpus's real with-bytes / without-bytes split", async () => {
    const opened = await freshStore()
    const { routes } = corpusRoutes()
    const { fetchImpl } = stubFetch(routes)
    await refresh(opened, fetchImpl, { withEvidencePort: true })
    const { compiled } = persistAll(opened.store, T1)

    const withBytes = compiled.filter((c) => c.record.digests.artifactDigest !== null)
    const withoutBytes = compiled.filter((c) => c.record.digests.artifactDigest === null)
    // The corpus's own shape reaching the record layer: most subjects declare no fetchable package
    // at all. Derived as the COMPLEMENT rather than pinned, because the two halves have to sum to
    // the compiled population — a subject that fell out of both buckets is the failure this
    // partition exists to catch, and a pair of literals cannot see it.
    // Per-SUBJECT, not per-package — see `CORPUS_SUBJECTS_WITH_SELECTED_BYTES`. This read
    // `CORPUS_FETCHABLE` until 2026-09-01, which counts packages and happened to equal the subject
    // population until a subject declared a non-npm package ahead of an npm one.
    expect(withBytes).toHaveLength(CORPUS_SUBJECTS_WITH_SELECTED_BYTES)
    expect(withoutBytes).toHaveLength(compiled.length - CORPUS_SUBJECTS_WITH_SELECTED_BYTES)
    // The two constants must now DIFFER, or this fix is untested: if a future corpus goes back to
    // one-package-per-subject they coincide again and the assertion above stops discriminating. Stated
    // as an inequality on the quantities themselves rather than on literals.
    expect(
      CORPUS_SUBJECTS_WITH_SELECTED_BYTES,
      "a subject's selected artifact is its FIRST declared package, so this cannot exceed the fetchable packages",
    ).toBeLessThanOrEqual(CORPUS_FETCHABLE)
    // Non-vacuity for the loop below: the without-bytes half must be non-empty, or control (d)'s
    // "no bytes ⇒ no evidence" claim is asserted over nothing.
    expect(withoutBytes.length, "no bytes-less subject makes control (d) vacuous").toBeGreaterThan(0)

    for (const { record } of withBytes) {
      expect(record.digests.evidenceDigest).not.toBeNull()
      expect(record.selectedArtifact?.artifactStatus).toBe("FETCHED")
      expect(record.evidence).not.toBeNull()
      // FOUR FIELDS, on real evidence rows rather than a literal: the public projection cannot widen.
      expect(Object.keys(record.evidence!).sort()).toEqual([
        "engineVersion",
        "evidenceDigest",
        "findingCount",
        "policyDigest",
      ])
    }
    // THE WITHOUT-BYTES HALF IS TWO CASES AT COHORT 100, AND WAS ONE AT 25. A subject reaches
    // `artifactDigest === null` either because it declared NO package at all, or because it declared
    // one of a type no adapter ships for — the second row exists, is selected, and carries a null
    // digest. Collapsing them into `selectedArtifact === null` was correct only while every declared
    // package was npm. Split here, because the two say different things: the first is "nothing to
    // fetch", the second is "something we chose not to try", and a record that confused them would
    // report an unfetched artifact as an absent one.
    const noArtifact = withoutBytes.filter((c) => c.record.selectedArtifact === null)
    const unfetchedArtifact = withoutBytes.filter((c) => c.record.selectedArtifact !== null)
    expect(noArtifact.length + unfetchedArtifact.length).toBe(withoutBytes.length)
    expect(
      unfetchedArtifact.length,
      "the corpus must carry an adapter-less package, or the second case below is vacuous",
    ).toBeGreaterThan(0)
    for (const { record } of withoutBytes) {
      // Control (d)'s claim, over the real corpus instead of one fixture: no bytes ⇒ no evidence.
      // True of BOTH cases — an artifact we never fetched grounds no evidence either.
      expect(record.digests.evidenceDigest).toBeNull()
      expect(record.evidence).toBeNull()
    }
    for (const { record } of unfetchedArtifact) {
      // The row is REPORTED, with the status that says why it has no digest. Asserting the status
      // rather than the absence is what keeps "not tried" distinguishable from "fetched and empty".
      expect(record.selectedArtifact?.artifactStatus).toBe("RESOLVED")
      expect(record.selectedArtifact?.packageType).not.toBe("npm")
    }
    for (const { record } of compiled) {
      // Product principle 2 across the whole cohort: every record has a decision, including the 17
      // that resolved nothing. This is the assertion `evidenceDigest === null` most tempts a reader
      // to weaken.
      expect(record.digests.decisionDigest).toBe(DECISION_DIGEST)
      expect(record.decision.verdict).toBe("UNKNOWN")
      expect(record.digests.sourcePayloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(record.digests.identityDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(record.digests.presentationDigest).toBe(PRESENTATION_DIGEST)
      expect(record.digests.semanticContractDigest).toBeNull()
      // Omitted, not null: no page is baked, and this batch deliberately does not bake one.
      expect("pageDigest" in record.digests).toBe(false)
      expect(record.sources.length).toBeGreaterThan(0)
    }
  })

  it("adds no row on a second pass, and moves only updated_at", async () => {
    const opened = await freshStore()
    const { routes } = corpusRoutes()
    const { fetchImpl } = stubFetch(routes)
    await refresh(opened, fetchImpl, { withEvidencePort: true })

    const first = persistAll(opened.store, T1)
    expect(first.inserted.every((i) => i)).toBe(true)
    const afterFirst = opened.store.listAdoptionRecords()

    // SECOND PASS at a later clock. The rows are re-derived from the same stored corpus, so a record
    // that moved would mean the projection is not a function of the tables it reads.
    const T2 = "2026-08-03T00:00:00.000Z"
    const second = persistAll(opened.store, T2)
    // `inserted: false` on every one — the upsert found each key. `OR IGNORE` would report the same
    // thing while silently dropping the update, which is why `updated_at` is checked below too.
    expect(second.inserted.every((i) => !i)).toBe(true)

    const afterSecond = opened.store.listAdoptionRecords()
    expect(afterSecond).toHaveLength(afterFirst.length)
    expect(second.compiled.map((c) => c.record)).toEqual(first.compiled.map((c) => c.record))
    expect(second.compiled.map((c) => c.adoptionRecordDigest)).toEqual(
      first.compiled.map((c) => c.adoptionRecordDigest),
    )
    // The digest column did NOT move; the timestamp column DID. Both halves matter: the first says
    // the record is stable, the second says the write actually happened rather than being ignored.
    expect(afterSecond.map((r) => r.adoptionRecordDigest)).toEqual(afterFirst.map((r) => r.adoptionRecordDigest))
    expect(afterFirst.every((r) => r.updatedAt === T1)).toBe(true)
    expect(afterSecond.every((r) => r.updatedAt === T2)).toBe(true)
    // And the stored document round-trips to the compiled one, so `record_json` is the record rather
    // than a re-serialization that lost a field.
    for (const c of second.compiled) {
      expect(opened.store.readAdoptionRecord(c.record.subject.subjectId)).toEqual(c.record)
    }
  })

  it("moves the record when a contract is sealed, without moving the decision", async () => {
    const opened = await freshStore()
    const { routes } = corpusRoutes()
    const { fetchImpl } = stubFetch(routes)
    await refresh(opened, fetchImpl, { withEvidencePort: true })

    const plain = persistAll(opened.store, T1)
    const sealed = persistAll(opened.store, T1, { sealContract: true })

    // WHY THIS IS A SEPARATE TEST AND NOT A VARIANT OF THE ONE ABOVE: it is the corpus-scale
    // justification for `semanticContract` being its own rebuild tier in `detectSourceChange`. The
    // decision is byte-identical across the two runs and the record is not, so a fan-out that fused
    // the two tiers would rebuild the wrong set of projections.
    for (let i = 0; i < plain.compiled.length; i += 1) {
      const before = plain.compiled[i]!
      const after = sealed.compiled[i]!
      expect(after.record.digests.decisionDigest).toBe(before.record.digests.decisionDigest)
      expect(after.record.digests.semanticContractDigest).toBe(CONTRACT_DIGEST)
      expect(after.adoptionRecordDigest).not.toBe(before.adoptionRecordDigest)
    }
    expect(sealed.inserted.every((i) => !i)).toBe(true)
    expect(opened.store.listAdoptionRecords()).toHaveLength(plain.compiled.length)
    expect(
      opened.store.listAdoptionRecords().every((r) => r.semanticContractDigest === CONTRACT_DIGEST),
    ).toBe(true)
  })
})
