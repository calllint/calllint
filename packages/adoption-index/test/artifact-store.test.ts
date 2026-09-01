/**
 * artifact-store — R-4's write path against a REAL better-sqlite3 store.
 *
 * `artifact-resolution.test.ts` grades the pure halves (claim, tar, CAS, adapter). This file grades
 * the half a pure function cannot see, and four of the facts asserted here are properties of
 * STORAGE rather than of any document:
 *
 *   - `REJECTED` is terminal *because the store refuses the transition*, not because a caller
 *     remembers to check. The guard runs inside the transaction, so a refused move rolls that one
 *     artifact back and leaves the row exactly as it was (control #25).
 *   - `last_verified_at` uses `COALESCE(?, last_verified_at)`, so a later failed attempt cannot
 *     erase the time a successful one recorded. Only a read-back can show that.
 *   - ONE TRANSACTION PER ARTIFACT: a throwing artifact must not roll back the ones already
 *     persisted in the same run. A single wrapping transaction would pass every other assertion
 *     in this file and fail only this one.
 *   - The four R-4 columns are `NULL` until something writes them. `identity-store.test.ts:158-161`
 *     asserts that for an unresolved artifact and must STAY true; this file asserts the other
 *     direction over the same columns.
 *
 * Negative controls this file is the measurement for:
 *   #23 a flipped byte            → REJECTED, and `cas/blobs` does not hold it
 *   #25 permit `REJECTED → FETCHED` → a re-run silently "heals" a digest mismatch
 *   #26 write the blob before verifying → the CAS holds unverified bytes
 *   #27 default `artifactResolved` to `false` → a no-port run claims "no artifact rebuild needed"
 *   #28 `artifactResolved: true` with a NO_CHANGE verdict → the tier must stay `null`
 *
 * The production driver, not a fake, following `store-schema.test.ts`: the two things most likely
 * to be wrong are whether the transition guard actually fires inside a transaction and whether
 * `COALESCE` does what the comment says, and a fake can see neither.
 */
import { describe, it, expect, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { sha256Bytes } from "@calllint/fingerprint"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  resolveIdentity,
  toSourceRecord,
  createAdapterRegistry,
  resolveArtifacts,
  describeArtifactResolution,
  detectSourceChange,
  npmArtifactAdapter,
  casBlobPath,
  canTransitionArtifact,
  isTerminalArtifactStatus,
  assertArtifactTransition,
  ARTIFACT_TRANSITIONS,
  ARTIFACT_RESOLUTION_INPUT_STATUSES,
  NPM_REGISTRY,
  DEFAULT_MAX_ARTIFACTS,
  OFFICIAL_REGISTRY_SOURCE_ID,
  MIGRATIONS_DIRNAME,
  type ArtifactAdapter,
  type ArtifactStatus,
  type SourceRecordV1,
  type StoredArtifactVersion,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const NOW = "2026-08-04T00:00:00.000Z"
const LATER = "2026-08-05T00:00:00.000Z"
const RETRIEVED = "2026-08-03T12:00:00.000Z"
const SOURCE_ID = OFFICIAL_REGISTRY_SOURCE_ID
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────

const BLOCK = 512

/** One ustar header, checksum computed. Duplicated from `artifact-resolution.test.ts`'s builder. */
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
 * A gzipped tar carrying one file, built IN MEMORY.
 *
 * Never a committed archive: these tests must control the exact byte to flip, and a committed
 * `.tgz` could only be corrupted by committing a second one (and would make git call the file
 * binary — the R-3 NUL lesson).
 */
function tgz(name: string, body: string): Uint8Array {
  const data = Buffer.from(body, "utf8")
  const padded = Buffer.alloc(Math.ceil(data.length / BLOCK) * BLOCK, 0)
  data.copy(padded)
  const tar = Buffer.concat([header(`package/${name}`, data.length), padded, Buffer.alloc(BLOCK * 2, 0)])
  return new Uint8Array(gzipSync(tar, { level: 9 }))
}

function sri(bytes: Uint8Array, algorithm: "sha1" | "sha512" = "sha512"): string {
  return `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`
}

/** A `SourceRecordV1` through the SHIPPED adapter — hand-authoring produced three silent defects. */
function record(name: string, packages?: { registryType: string; identifier: string; version?: string }[]): SourceRecordV1 {
  const server: Record<string, unknown> = { name, version: "1.0.0" }
  if (packages !== undefined) server.packages = packages
  const built = toSourceRecord(
    { server, _meta: { [OFFICIAL_META]: { status: "active", isLatest: true } } } as never,
    RETRIEVED,
  )
  if (built === null) throw new Error(`fixture "${name}" was rejected by the shipped adapter`)
  return built
}

const dirs: string[] = []
async function openStore(): Promise<AdoptionIndexStore> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-artifact-store-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  return AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now: NOW })
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Seed a cohort through the real identity path, so the rows are the ones R-3 would have written. */
function seed(store: AdoptionIndexStore, records: SourceRecordV1[]) {
  const identity = resolveIdentity({ records, sourceId: SOURCE_ID, observedAt: NOW })
  return store.transaction((tx) => tx.persistIdentity(identity))
}

function artifactBy(store: AdoptionIndexStore, packageIdentifier: string): StoredArtifactVersion {
  const found = store.listArtifactVersions().find((a) => a.packageIdentifier === packageIdentifier)
  if (found === undefined) throw new Error(`no artifact row for ${packageIdentifier}`)
  return found
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

interface StubRoute {
  status?: number
  json?: unknown
  bytes?: Uint8Array
  throws?: string
}

function stubFetch(routes: Record<string, StubRoute>): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    const route = routes[url]
    if (route === undefined) return new Response("not found", { status: 404 })
    if (route.throws !== undefined) throw new Error(route.throws)
    if (route.bytes !== undefined) return new Response(route.bytes, { status: route.status ?? 200 })
    return new Response(JSON.stringify(route.json ?? {}), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function packument(name: string, version: string, bytes: Uint8Array, integrity?: string) {
  return {
    name,
    "dist-tags": { latest: version },
    versions: {
      [version]: {
        name,
        version,
        dist: {
          tarball: tarballUrl(name, version),
          integrity: integrity ?? sri(bytes),
          shasum: createHash("sha1").update(bytes).digest("hex"),
        },
      },
    },
  }
}

function tarballUrl(name: string, version: string): string {
  return `${NPM_REGISTRY}/${name}/-/${name}-${version}.tgz`
}

const NPM_ADAPTERS = createAdapterRegistry([npmArtifactAdapter])

// ── the transition table ──────────────────────────────────────────────────────────────────────

describe("the transition table (control #25)", () => {
  it("REJECTED and UNSUPPORTED are terminal; the other three are not", () => {
    expect(isTerminalArtifactStatus("REJECTED")).toBe(true)
    expect(isTerminalArtifactStatus("UNSUPPORTED")).toBe(true)
    for (const status of ["RESOLVED", "UNAVAILABLE", "FETCHED"] as ArtifactStatus[]) {
      expect(isTerminalArtifactStatus(status), status).toBe(false)
    }
  })

  it("terminality is DERIVED from the table, so the two cannot disagree", () => {
    // Not a restatement of `TERMINAL_*` as a second list: a rule duplicated at call sites is a
    // rule that gets half-changed.
    for (const [from, tos] of Object.entries(ARTIFACT_TRANSITIONS)) {
      expect(isTerminalArtifactStatus(from as ArtifactStatus), from).toBe(tos.length === 0)
    }
  })

  it("nothing may leave REJECTED — the assertion control #25 inverts", () => {
    for (const to of ["RESOLVED", "FETCHED", "UNAVAILABLE", "REJECTED", "UNSUPPORTED"] as ArtifactStatus[]) {
      expect(canTransitionArtifact("REJECTED", to), to).toBe(false)
      expect(canTransitionArtifact("UNSUPPORTED", to), to).toBe(false)
    }
  })

  it("no status may return to RESOLVED once resolution has run", () => {
    // `RESOLVED` is the *unattempted* state. Moving back to it would erase the fact that a run
    // tried, which is the whole distinction between it and `UNAVAILABLE`.
    for (const from of ["UNAVAILABLE", "FETCHED", "REJECTED", "UNSUPPORTED"] as ArtifactStatus[]) {
      expect(canTransitionArtifact(from, "RESOLVED"), from).toBe(false)
    }
    // `RESOLVED -> RESOLVED` IS permitted: "no adapter" means not tried, so nothing changed.
    expect(canTransitionArtifact("RESOLVED", "RESOLVED")).toBe(true)
  })

  it("nothing may transition INTO UNSUPPORTED — only identity re-resolution writes it", () => {
    for (const from of Object.keys(ARTIFACT_TRANSITIONS) as ArtifactStatus[]) {
      expect(canTransitionArtifact(from, "UNSUPPORTED"), from).toBe(false)
    }
  })

  it("the input statuses are exactly the retryable ones, and exclude FETCHED", () => {
    expect([...ARTIFACT_RESOLUTION_INPUT_STATUSES]).toEqual(["RESOLVED", "UNAVAILABLE"])
    // Excluding `FETCHED` is what makes "cache hit ⇒ no refetch" observable at all: every
    // scheduled CI run is a cold checkout and can never demonstrate cache reuse.
    expect(ARTIFACT_RESOLUTION_INPUT_STATUSES).not.toContain("FETCHED")
    for (const status of ARTIFACT_RESOLUTION_INPUT_STATUSES) {
      expect(isTerminalArtifactStatus(status), status).toBe(false)
    }
  })

  it("the assertion names the artifact and says WHY when the source is terminal", () => {
    expect(() => assertArtifactTransition("REJECTED", "FETCHED", "sha256:abc")).toThrow(
      /artifact "sha256:abc": REJECTED -> FETCHED is not a permitted transition \(REJECTED is terminal\)/,
    )
    // A non-terminal refusal omits the parenthetical rather than printing a false reason.
    expect(() => assertArtifactTransition("FETCHED", "RESOLVED", "sha256:abc")).toThrow(
      /FETCHED -> RESOLVED is not a permitted transition$/,
    )
    expect(() => assertArtifactTransition("RESOLVED", "FETCHED", "sha256:abc")).not.toThrow()
  })
})

// ── the write path ────────────────────────────────────────────────────────────────────────────

describe("updateArtifactResolution — the four columns", () => {
  it("writes all four on a FETCHED artifact and reads them back", async () => {
    const store = await openStore()
    try {
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const before = artifactBy(store, "alpha")
      // The R-3 starting state, re-asserted here so this file fails if that changes underneath it.
      expect(before.artifactStatus).toBe("RESOLVED")
      expect(before.immutableDigest).toBeNull()

      const bytes = tgz("index.js", "export const x = 1\n")
      store.transaction((tx) =>
        tx.updateArtifactResolution({
          artifactVersionId: before.artifactVersionId,
          artifactStatus: "FETCHED",
          immutableDigest: sha256Bytes(bytes),
          registryIntegrity: sri(bytes),
          cacheKey: sha256Bytes(bytes),
          lastVerifiedAt: NOW,
        }),
      )

      const after = artifactBy(store, "alpha")
      expect(after.artifactStatus).toBe("FETCHED")
      expect(after.immutableDigest).toBe(sha256Bytes(bytes))
      expect(after.registryIntegrity).toBe(sri(bytes))
      expect(after.cacheKey).toBe(sha256Bytes(bytes))
      expect(after.lastVerifiedAt).toBe(NOW)
      // The identity columns are UNTOUCHED. `artifact_version_id` is
      // `hashJson({subjectId, packageType, packageIdentifier, version})`, so writing the
      // RESOLVED version back into `version` would make the id undebivable and dangle every
      // downstream reference. R-4 resolves a version and deliberately does not persist it.
      expect(after.version).toBe("1.2.3")
      expect(after.subjectId).toBe(before.subjectId)
      expect(after.artifactVersionId).toBe(before.artifactVersionId)
      expect(after.firstSeenAt).toBe(before.firstSeenAt)
    } finally {
      store.close()
    }
  })

  it("REFUSES a REJECTED → FETCHED move and leaves the row exactly as it was (control #25)", async () => {
    const store = await openStore()
    try {
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const id = artifactBy(store, "alpha").artifactVersionId
      const bytes = tgz("index.js", "real\n")

      store.transaction((tx) =>
        tx.updateArtifactResolution({
          artifactVersionId: id,
          artifactStatus: "REJECTED",
          immutableDigest: sha256Bytes(bytes),
          registryIntegrity: sri(bytes),
          cacheKey: null,
          lastVerifiedAt: null,
        }),
      )
      const rejected = artifactBy(store, "alpha")
      expect(rejected.artifactStatus).toBe("REJECTED")

      // A later run tries to "heal" it. The store refuses — this is the assertion control #25
      // inverts, and it is a property of STORAGE, so no caller can forget to check.
      expect(() =>
        store.transaction((tx) =>
          tx.updateArtifactResolution({
            artifactVersionId: id,
            artifactStatus: "FETCHED",
            immutableDigest: sha256Bytes(bytes),
            registryIntegrity: sri(bytes),
            cacheKey: sha256Bytes(bytes),
            lastVerifiedAt: LATER,
          }),
        ),
      ).toThrow(/REJECTED -> FETCHED is not a permitted transition \(REJECTED is terminal\)/)

      // Rolled back whole: not one column moved, including the ones the refused write would have set.
      expect(artifactBy(store, "alpha")).toEqual(rejected)
    } finally {
      store.close()
    }
  })

  it("PRESERVES lastVerifiedAt when a later attempt fails", async () => {
    const store = await openStore()
    try {
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const id = artifactBy(store, "alpha").artifactVersionId
      const bytes = tgz("index.js", "v1\n")

      store.transaction((tx) =>
        tx.updateArtifactResolution({
          artifactVersionId: id,
          artifactStatus: "FETCHED",
          immutableDigest: sha256Bytes(bytes),
          registryIntegrity: sri(bytes),
          cacheKey: sha256Bytes(bytes),
          lastVerifiedAt: NOW,
        }),
      )
      // A later run cannot reach the registry. `COALESCE(?, last_verified_at)` keeps the stamp:
      // "we last verified these bytes at NOW" stays true even though today's attempt failed.
      // Overwriting it with null would report that we had never verified it.
      store.transaction((tx) =>
        tx.updateArtifactResolution({
          artifactVersionId: id,
          artifactStatus: "UNAVAILABLE",
          immutableDigest: null,
          registryIntegrity: null,
          cacheKey: null,
          lastVerifiedAt: null,
        }),
      )

      const after = artifactBy(store, "alpha")
      expect(after.artifactStatus).toBe("UNAVAILABLE")
      expect(after.lastVerifiedAt).toBe(NOW)
    } finally {
      store.close()
    }
  })

  it("throws — rather than inserting — when the artifact row does not exist", async () => {
    const store = await openStore()
    try {
      // An id with no row means the caller derived it wrongly. Inserting would manufacture an
      // artifact with no subject, which the DDL's foreign key would then either refuse or orphan.
      expect(() =>
        store.transaction((tx) =>
          tx.updateArtifactResolution({
            artifactVersionId: "sha256:" + "f".repeat(64),
            artifactStatus: "FETCHED",
            immutableDigest: null,
            registryIntegrity: null,
            cacheKey: null,
            lastVerifiedAt: NOW,
          }),
        ),
      ).toThrow(/has no row to update/)
      expect(store.listArtifactVersions()).toEqual([])
    } finally {
      store.close()
    }
  })

  it("records registryIntegrity on a FAILED attempt — the claim is an observation either way", async () => {
    const store = await openStore()
    try {
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const id = artifactBy(store, "alpha").artifactVersionId
      const claim = sri(tgz("index.js", "x\n"))

      store.transaction((tx) =>
        tx.updateArtifactResolution({
          artifactVersionId: id,
          artifactStatus: "UNAVAILABLE",
          immutableDigest: null,
          registryIntegrity: claim,
          cacheKey: null,
          lastVerifiedAt: null,
        }),
      )

      const after = artifactBy(store, "alpha")
      // What THEY claimed is recorded even though we hold no bytes; what WE measured stays null.
      // Collapsing the two would make "the registry says sha512-…" and "we hold bytes hashing to
      // it" indistinguishable — the Observed-vs-Inferred line (Product Principle 8).
      expect(after.registryIntegrity).toBe(claim)
      expect(after.immutableDigest).toBeNull()
      expect(after.cacheKey).toBeNull()
    } finally {
      store.close()
    }
  })
})

// ── the orchestrator ──────────────────────────────────────────────────────────────────────────

describe("resolveArtifacts — one transaction per artifact", () => {
  it("FETCHES the corpus shape: two npm artifacts, both verified and stored", async () => {
    const store = await openStore()
    try {
      const root = store.paths.root
      seed(store, [
        // The corpus's own two package-declaring entries: one scoped, one not.
        record("ai.adeu/mcp-server", [{ registryType: "npm", identifier: "@adeu/mcp-server", version: "1.7.1" }]),
        record("com.calllint/calllint", [{ registryType: "npm", identifier: "calllint-mcp", version: "0.2.0" }]),
        // And an entry with no packages at all, which must produce no artifact row to resolve.
        record("io.test/remote-only"),
      ])
      expect(store.listArtifactVersions()).toHaveLength(2)

      const scoped = tgz("index.js", "scoped\n")
      const plain = tgz("index.js", "plain\n")
      const { fetchImpl, calls } = stubFetch({
        [`${NPM_REGISTRY}/@adeu%2fmcp-server`]: { json: packument("@adeu/mcp-server", "1.7.1", scoped) },
        [tarballUrl("@adeu/mcp-server", "1.7.1")]: { bytes: scoped },
        [`${NPM_REGISTRY}/calllint-mcp`]: { json: packument("calllint-mcp", "0.2.0", plain) },
        [tarballUrl("calllint-mcp", "0.2.0")]: { bytes: plain },
      })

      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })

      expect(summary).toMatchObject({
        considered: 2,
        fetched: 2,
        unavailable: 0,
        rejected: 0,
        skippedNoAdapter: 0,
        cached: 0,
      })
      expect(summary.records).toHaveLength(2)
      // Two reads per artifact: the packument, then the tarball. Phase A and Phase B, in order.
      expect(calls).toHaveLength(4)

      for (const identifier of ["@adeu/mcp-server", "calllint-mcp"]) {
        const row = artifactBy(store, identifier)
        expect(row.artifactStatus, identifier).toBe("FETCHED")
        expect(row.immutableDigest, identifier).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(row.registryIntegrity, identifier).toMatch(/^sha512-/)
        expect(row.cacheKey, identifier).toBe(row.immutableDigest)
        expect(row.lastVerifiedAt, identifier).toBe(NOW)
        expect(existsSync(casBlobPath(root, row.immutableDigest!)), identifier).toBe(true)
      }
      expect(casBlobs(root)).toHaveLength(2)
      // Still nothing extracted. `cas/expanded` is the evidence batch's need, not R-4's.
      expect(readdirSync(join(root, "cas", "expanded"))).toEqual([])
    } finally {
      store.close()
    }
  })

  it("is IDEMPOTENT: a second run refetches nothing, because FETCHED is not an input status", async () => {
    const store = await openStore()
    try {
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const bytes = tgz("index.js", "same\n")
      const routes = {
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", bytes) },
        [tarballUrl("alpha", "1.2.3")]: { bytes },
      }

      const first = stubFetch(routes)
      const one = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl: first.fetchImpl, now: NOW })
      expect(one.fetched).toBe(1)
      expect(first.calls).toHaveLength(2)
      const afterFirst = artifactBy(store, "alpha")

      // The warm-store path CI can never demonstrate, because every scheduled run is a cold
      // checkout. Measured over `fetchImpl` call counts, which is the seam that exists for it.
      const second = stubFetch(routes)
      const two = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl: second.fetchImpl, now: LATER })
      expect(two).toMatchObject({ considered: 0, fetched: 0, unavailable: 0, rejected: 0 })
      expect(second.calls).toEqual([])
      // And nothing moved — including `last_verified_at`, which a re-verifying run would advance.
      expect(artifactBy(store, "alpha")).toEqual(afterFirst)
    } finally {
      store.close()
    }
  })

  it("REJECTS a tampered tarball and stores NOTHING (control #23)", async () => {
    const store = await openStore()
    try {
      const root = store.paths.root
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])

      const real = tgz("index.js", "real\n")
      const served = Uint8Array.from(real)
      served[served.length - 1] = (served[served.length - 1]! ^ 0x01) & 0xff
      const { fetchImpl } = stubFetch({
        // The registry claims the real bytes; the CDN serves a flipped one.
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", real) },
        [tarballUrl("alpha", "1.2.3")]: { bytes: served },
      })

      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })
      expect(summary).toMatchObject({ considered: 1, fetched: 0, rejected: 1, unavailable: 0 })

      const row = artifactBy(store, "alpha")
      expect(row.artifactStatus).toBe("REJECTED")
      // The claim is recorded (we saw it); no digest and no cache key are (we hold nothing).
      expect(row.registryIntegrity).toBe(sri(real))
      expect(row.cacheKey).toBeNull()
      expect(row.lastVerifiedAt).toBeNull()
      // Control #26's assertion: verify-then-write means there is no window in which unverified
      // bytes exist under the root, not a window a cleanup path closes.
      expect(casBlobs(root)).toEqual([])
      expect(readdirSync(join(root, "work"))).toEqual([])
      expect(existsSync(casBlobPath(root, sha256Bytes(served)))).toBe(false)
    } finally {
      store.close()
    }
  })

  it("REJECTED is then STICKY across a re-run that would succeed", async () => {
    const store = await openStore()
    try {
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const real = tgz("index.js", "real\n")
      const bad = Uint8Array.from(real)
      bad[0] = bad[0]! ^ 0xff

      const first = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", real) },
        [tarballUrl("alpha", "1.2.3")]: { bytes: bad },
      })
      await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl: first.fetchImpl, now: NOW })
      const rejected = artifactBy(store, "alpha")
      expect(rejected.artifactStatus).toBe("REJECTED")

      // Now the registry serves matching bytes. The artifact is NOT reconsidered — `REJECTED` is
      // outside the input statuses, so the run does not even reach the transition guard. Two
      // independent mechanisms, which is why both are asserted.
      const second = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", real) },
        [tarballUrl("alpha", "1.2.3")]: { bytes: real },
      })
      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl: second.fetchImpl, now: LATER })
      expect(summary.considered).toBe(0)
      expect(second.calls).toEqual([])
      expect(artifactBy(store, "alpha")).toEqual(rejected)
    } finally {
      store.close()
    }
  })

  it("REJECTED survives an IDENTITY REPLAY — persistIdentity is a second writer (control #32)", async () => {
    const store = await openStore()
    try {
      const records = [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])]
      seed(store, records)
      const real = tgz("index.js", "real\n")
      const bad = Uint8Array.from(real)
      bad[0] = bad[0]! ^ 0xff
      const { fetchImpl } = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", real) },
        [tarballUrl("alpha", "1.2.3")]: { bytes: bad },
      })
      await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })
      const rejected = artifactBy(store, "alpha")
      expect(rejected.artifactStatus).toBe("REJECTED")

      // The scheduled run persists identity BEFORE resolving artifacts, every run, over the same
      // cohort — and `artifactVersionId` hashes only {subjectId, packageType, packageIdentifier,
      // version}, so the row collides and `resolveIdentity` re-offers `RESOLVED` for it. An
      // unconditional `artifact_status = excluded.artifact_status` therefore resets a terminal
      // rejection without ever reaching `assertArtifactTransition`: the transition table would be
      // enforced on one writer and bypassed on the other. Asserted on the STATUS COLUMN after a
      // replay rather than on the guard, because the guard is precisely what this path skips.
      seed(store, records)
      expect(artifactBy(store, "alpha")).toEqual(rejected)

      // Same argument for a successful fetch: without it, `cached` could never be observed,
      // because `FETCHED` would not survive to become a cache hit on the next run.
      seed(store, [record("io.test/beta", [{ registryType: "npm", identifier: "beta", version: "2.0.0" }])])
      const good = tgz("index.js", "beta\n")
      const beta = stubFetch({
        [`${NPM_REGISTRY}/beta`]: { json: packument("beta", "2.0.0", good) },
        [tarballUrl("beta", "2.0.0")]: { bytes: good },
      })
      await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl: beta.fetchImpl, now: NOW })
      const fetched = artifactBy(store, "beta")
      expect(fetched.artifactStatus).toBe("FETCHED")
      seed(store, records)
      expect(artifactBy(store, "beta")).toEqual(fetched)
    } finally {
      store.close()
    }
  })

  it("lets the identity layer RE-GRADE a row it still owns: UNSUPPORTED → RESOLVED", async () => {
    const store = await openStore()
    try {
      // The narrowing must not freeze the two statuses R-3 owns. A package type that moves into
      // `RESOLVABLE_PACKAGE_TYPES` has to be able to leave `UNSUPPORTED`, or the gate would trade
      // one silent staleness for another. Driven through the store rather than the resolver,
      // because `RESOLVABLE_PACKAGE_TYPES` is a constant and this is a claim about the SQL.
      const records = [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])]
      const identity = resolveIdentity({ records, sourceId: SOURCE_ID, observedAt: NOW })
      const artifact = identity.artifacts[0]!
      expect(artifact.artifactStatus).toBe("RESOLVED")

      store.transaction((tx) =>
        tx.persistIdentity({ ...identity, artifacts: [{ ...artifact, artifactStatus: "UNSUPPORTED" }] }),
      )
      expect(artifactBy(store, "alpha").artifactStatus).toBe("UNSUPPORTED")

      store.transaction((tx) => tx.persistIdentity(identity))
      expect(artifactBy(store, "alpha").artifactStatus).toBe("RESOLVED")
    } finally {
      store.close()
    }
  })

  it("marks UNAVAILABLE — not REJECTED — when it TRIED and got no bytes", async () => {
    const store = await openStore()
    try {
      const root = store.paths.root
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const bytes = tgz("index.js", "x\n")
      const { fetchImpl } = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", bytes) },
        [tarballUrl("alpha", "1.2.3")]: { throws: "ECONNRESET" },
      })

      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })
      // The load-bearing distinction: no bytes in hand ⇒ UNAVAILABLE (retryable). Bytes in hand
      // and refused ⇒ REJECTED (terminal). A network failure must never become terminal.
      expect(summary).toMatchObject({ considered: 1, fetched: 0, unavailable: 1, rejected: 0 })
      expect(artifactBy(store, "alpha").artifactStatus).toBe("UNAVAILABLE")
      expect(casBlobs(root)).toEqual([])
    } finally {
      store.close()
    }
  })

  it("RETRIES an UNAVAILABLE artifact on the next run and can reach FETCHED", async () => {
    const store = await openStore()
    try {
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const bytes = tgz("index.js", "x\n")

      const down = stubFetch({ [`${NPM_REGISTRY}/alpha`]: { throws: "ETIMEDOUT" } })
      await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl: down.fetchImpl, now: NOW })
      expect(artifactBy(store, "alpha").artifactStatus).toBe("UNAVAILABLE")

      const up = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", bytes) },
        [tarballUrl("alpha", "1.2.3")]: { bytes },
      })
      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl: up.fetchImpl, now: LATER })
      expect(summary).toMatchObject({ considered: 1, fetched: 1 })
      const row = artifactBy(store, "alpha")
      expect(row.artifactStatus).toBe("FETCHED")
      expect(row.lastVerifiedAt).toBe(LATER)
    } finally {
      store.close()
    }
  })

  it("marks UNAVAILABLE when the registry states no usable integrity claim", async () => {
    const store = await openStore()
    try {
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      const bytes = tgz("index.js", "x\n")
      const doc = packument("alpha", "1.2.3", bytes) as Record<string, unknown>
      const versions = doc.versions as Record<string, { dist: Record<string, unknown> }>
      delete versions["1.2.3"]!.dist.integrity
      delete versions["1.2.3"]!.dist.shasum
      const { fetchImpl, calls } = stubFetch({ [`${NPM_REGISTRY}/alpha`]: { json: doc } })

      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })
      // Unverifiable, not refused — and NOT a silent unverified FETCHED, which is the failure
      // mode a "just store the bytes" implementation has.
      expect(summary).toMatchObject({ considered: 1, unavailable: 1, fetched: 0, rejected: 0 })
      expect(artifactBy(store, "alpha").artifactStatus).toBe("UNAVAILABLE")
      // And Phase B never ran: with no claim there is nothing to verify against, so downloading
      // would be bytes we could say nothing about.
      expect(calls).toEqual([`${NPM_REGISTRY}/alpha`])
    } finally {
      store.close()
    }
  })

  it("REJECTS a well-formed download that is not a tarball", async () => {
    const store = await openStore()
    try {
      const root = store.paths.root
      seed(store, [record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }])])
      // A gzip that decompresses fine and contains no tar. Bytes IN HAND and refused ⇒ REJECTED.
      const notTar = new Uint8Array(gzipSync(Buffer.alloc(BLOCK, 0x41)))
      const { fetchImpl } = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", notTar) },
        [tarballUrl("alpha", "1.2.3")]: { bytes: notTar },
      })

      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })
      expect(summary).toMatchObject({ considered: 1, rejected: 1, fetched: 0 })
      expect(artifactBy(store, "alpha").artifactStatus).toBe("REJECTED")
      // Refused BEFORE the CAS: a structural refusal must not leave bytes behind either.
      expect(casBlobs(root)).toEqual([])
    } finally {
      store.close()
    }
  })

  it("SKIPS a package type with no adapter, and writes nothing at all", async () => {
    const store = await openStore()
    try {
      seed(store, [
        record("io.test/py", [{ registryType: "pypi", identifier: "alpha", version: "1.0.0" }]),
        record("io.test/oci", [{ registryType: "oci", identifier: "alpha/img", version: "1.0.0" }]),
      ])
      const before = store.listArtifactVersions()
      // R-3 graded both `RESOLVED` because they are inside `RESOLVABLE_PACKAGE_TYPES`; R-4 ships
      // one adapter. "No adapter" is NOT TRIED, so it must not become `UNAVAILABLE`, which means
      // "tried and failed".
      expect(before.map((a) => a.artifactStatus)).toEqual(["RESOLVED", "RESOLVED"])

      const { fetchImpl, calls } = stubFetch({})
      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })

      expect(summary).toMatchObject({
        considered: 2,
        fetched: 0,
        unavailable: 0,
        rejected: 0,
        skippedNoAdapter: 2,
      })
      expect(calls).toEqual([])
      // Byte-for-byte unchanged: a skip writes NOTHING, not even a status rewrite to itself.
      expect(store.listArtifactVersions()).toEqual(before)
      expect(summary.records.map((r) => r.outcome)).toEqual(["NO_ADAPTER", "NO_ADAPTER"])
      // ADR 0097's NEGATIVE FIXTURE for the processing-time distribution. Two considered artifacts,
      // both skipped, so there is no distribution — and `null` rather than `{ n: 0, meanMs: 0 }`,
      // which the gate would print as an instantaneous compiler from zero observations.
      expect(summary.records.map((r) => r.durationMs)).toEqual([null, null])
      expect(
        summary.processing,
        "a run that attempted nothing has NO processing time, not a processing time of zero",
      ).toBeNull()
    } finally {
      store.close()
    }
  })

  it("ONE TRANSACTION PER ARTIFACT: a throwing artifact does not roll back its neighbours", async () => {
    const store = await openStore()
    try {
      seed(store, [
        record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.0.0" }]),
        record("io.test/beta", [{ registryType: "npm", identifier: "beta", version: "1.0.0" }]),
        record("io.test/gamma", [{ registryType: "npm", identifier: "gamma", version: "1.0.0" }]),
      ])
      const bytes = tgz("index.js", "ok\n")

      // An adapter that THROWS for one identifier. Not a returned failure — a thrown one, which is
      // the case a single wrapping transaction would turn into "the whole cohort lost its writes".
      const exploding: ArtifactAdapter = {
        packageType: "npm",
        async resolveMetadata(artifact, ctx) {
          if (artifact.packageIdentifier === "beta") throw new Error("adapter exploded")
          return npmArtifactAdapter.resolveMetadata(artifact, ctx)
        },
      }
      const { fetchImpl } = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.0.0", bytes) },
        [tarballUrl("alpha", "1.0.0")]: { bytes },
        [`${NPM_REGISTRY}/gamma`]: { json: packument("gamma", "1.0.0", bytes) },
        [tarballUrl("gamma", "1.0.0")]: { bytes },
      })

      const summary = await resolveArtifacts({
        store,
        adapters: createAdapterRegistry([exploding]),
        fetchImpl,
        now: NOW,
      })

      // The run SURVIVED and the two healthy artifacts landed. `beta` is `UNAVAILABLE` — it was
      // tried and the attempt failed — rather than aborting the run or corrupting the others.
      expect(summary).toMatchObject({ considered: 3, fetched: 2, unavailable: 1, rejected: 0 })
      expect(artifactBy(store, "alpha").artifactStatus).toBe("FETCHED")
      expect(artifactBy(store, "gamma").artifactStatus).toBe("FETCHED")
      expect(artifactBy(store, "beta").artifactStatus).toBe("UNAVAILABLE")
      // Both blobs are in the CAS: dedup would collapse them, so assert the alpha/gamma bytes are
      // identical and therefore ONE blob — the honest expectation for identical content.
      expect(casBlobs(store.paths.root)).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  it("DEDUPLICATES identical bytes across two artifacts, and says so", async () => {
    const store = await openStore()
    try {
      seed(store, [
        record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.0.0" }]),
        record("io.test/beta", [{ registryType: "npm", identifier: "beta", version: "1.0.0" }]),
      ])
      const shared = tgz("index.js", "identical\n")
      const { fetchImpl } = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.0.0", shared) },
        [tarballUrl("alpha", "1.0.0")]: { bytes: shared },
        [`${NPM_REGISTRY}/beta`]: { json: packument("beta", "1.0.0", shared) },
        [tarballUrl("beta", "1.0.0")]: { bytes: shared },
      })

      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })
      expect(summary).toMatchObject({ considered: 2, fetched: 2, cached: 1 })
      // Two FETCHED artifacts, ONE blob: content addressing means identical bytes are one object,
      // and `cached` is how a reader tells that from "we only fetched one".
      expect(casBlobs(store.paths.root)).toHaveLength(1)
      expect(artifactBy(store, "alpha").cacheKey).toBe(artifactBy(store, "beta").cacheKey)
    } finally {
      store.close()
    }
  })

  it("honours maxArtifacts, and the cap is a parameter", async () => {
    const store = await openStore()
    try {
      seed(store, [
        record("io.test/alpha", [{ registryType: "npm", identifier: "alpha", version: "1.0.0" }]),
        record("io.test/beta", [{ registryType: "npm", identifier: "beta", version: "1.0.0" }]),
        record("io.test/gamma", [{ registryType: "npm", identifier: "gamma", version: "1.0.0" }]),
      ])
      const bytes = tgz("index.js", "ok\n")
      const { fetchImpl } = stubFetch({
        [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.0.0", bytes) },
        [tarballUrl("alpha", "1.0.0")]: { bytes },
        [`${NPM_REGISTRY}/beta`]: { json: packument("beta", "1.0.0", bytes) },
        [tarballUrl("beta", "1.0.0")]: { bytes },
        [`${NPM_REGISTRY}/gamma`]: { json: packument("gamma", "1.0.0", bytes) },
        [tarballUrl("gamma", "1.0.0")]: { bytes },
      })

      const summary = await resolveArtifacts({
        store,
        adapters: NPM_ADAPTERS,
        fetchImpl,
        now: NOW,
        maxArtifacts: 2,
      })
      // The cap bounds a RUN, not the corpus: the third artifact stays `RESOLVED` and the next
      // run picks it up, because `RESOLVED` is an input status.
      expect(summary.considered).toBe(2)
      expect(store.listArtifactVersions().filter((a) => a.artifactStatus === "RESOLVED")).toHaveLength(1)
      expect(DEFAULT_MAX_ARTIFACTS).toBeGreaterThan(2)
    } finally {
      store.close()
    }
  })

  it("returns a zero summary over an empty store without touching the network", async () => {
    const store = await openStore()
    try {
      const { fetchImpl, calls } = stubFetch({})
      const summary = await resolveArtifacts({ store, adapters: NPM_ADAPTERS, fetchImpl, now: NOW })
      expect(summary).toMatchObject({ considered: 0, fetched: 0, unavailable: 0, rejected: 0, skippedNoAdapter: 0 })
      expect(summary.records).toEqual([])
      expect(calls).toEqual([])
    } finally {
      store.close()
    }
  })

  it("refuses two adapters for one package type", () => {
    // A duplicate registration is a configuration defect, and the quiet alternatives (last wins,
    // first wins) both mean the operator's second adapter silently never runs.
    expect(() => createAdapterRegistry([npmArtifactAdapter, npmArtifactAdapter])).toThrow(
      /two adapters registered for package type "npm"/,
    )
  })
})

describe("processing time — the observable Gate S1's blocker said did not exist (ADR 0097)", () => {
  it("times each attempt from the INJECTED monotonic clock, and excludes the unattempted", async () => {
    const store = await openStore()
    try {
      seed(store, [
        // Two npm artifacts (an adapter exists) and one `pypi` (none does). So: 3 considered, 2
        // attempted, 1 skipped — the real run's 64/36/28 shape in miniature.
        record("ai.adeu/mcp-server", [{ registryType: "npm", identifier: "@adeu/mcp-server", version: "1.7.1" }]),
        record("com.calllint/calllint", [{ registryType: "npm", identifier: "calllint-mcp", version: "0.2.0" }]),
        record("io.test/pyonly", [{ registryType: "pypi", identifier: "pyonly", version: "3.0.0" }]),
      ])

      const scoped = tgz("index.js", "scoped\n")
      const plain = tgz("index.js", "plain\n")
      const { fetchImpl } = stubFetch({
        [`${NPM_REGISTRY}/@adeu%2fmcp-server`]: { json: packument("@adeu/mcp-server", "1.7.1", scoped) },
        [tarballUrl("@adeu/mcp-server", "1.7.1")]: { bytes: scoped },
        [`${NPM_REGISTRY}/calllint-mcp`]: { json: packument("calllint-mcp", "0.2.0", plain) },
        [tarballUrl("calllint-mcp", "0.2.0")]: { bytes: plain },
      })

      // A FAKE CLOCK, WHICH IS THE WHOLE REASON `monotonicMs` IS A SEAM. With `performance.now` the
      // only available assertion is `toBeGreaterThanOrEqual(0)`, which is true of anything and
      // measures nothing.
      //
      // UNIFORM 50 ms PER ATTEMPT, deliberately, because the loop walks `listArtifactVersions()` in
      // `artifact_version_id` order — a DIGEST order, not the seed order. A tick array indexed by
      // position would encode an assumption about digest ordering that is neither guaranteed nor
      // meaningful, and the first version of this test did exactly that. The mean/p95 ARITHMETIC is
      // covered over distinct samples in `processing-time.test.ts`; what this test measures is which
      // artifacts get into the distribution at all.
      //
      // The clock IS read for the skipped artifact — nothing can know an outcome is `NO_ADAPTER`
      // until `resolveOne` has returned — so the claim under test is that its elapsed time is
      // DISCARDED, not that it was never taken. That shows up twice below: as `null` on the record,
      // and as `n: 2` on the statistic.
      let reads = 0
      const monotonicMs = (): number => {
        const t = reads * 50
        reads += 1
        return t
      }

      const summary = await resolveArtifacts({
        store,
        adapters: NPM_ADAPTERS,
        fetchImpl,
        now: NOW,
        monotonicMs,
      })

      expect(summary).toMatchObject({ considered: 3, fetched: 2, skippedNoAdapter: 1 })

      // THE POSITIVE FIXTURE: each attempt is timed off the injected clock — 50 ms, exactly, not
      // "some non-negative number" — and the skipped one is `null` rather than 0.
      const byId = new Map(summary.records.map((r) => [r.packageIdentifier, r.durationMs]))
      expect(byId.get("@adeu/mcp-server")).toBe(50)
      expect(byId.get("calllint-mcp")).toBe(50)
      expect(byId.get("pyonly"), "NOT TRIED means no duration, and `null` is how that is said").toBeNull()

      // Two reads per CONSIDERED artifact, the skip included. Asserted because it pins where the
      // timing sits: were it moved inside `resolveOne`, past the `NO_ADAPTER` return, this would drop
      // to 4 — and the measure would then be timing a decision instead of an attempt.
      expect(reads, "the clock is read around every artifact, including the one with no adapter").toBe(6)

      // The statistic is over the two attempts only. `n: 2` with a 1-row skip is what proves the
      // third elapsed time was discarded: if it leaked in, this reads `n: 3`.
      expect(summary.processing).toEqual({
        n: 2,
        skipped: 1,
        meanMs: 50,
        p95Ms: 50, // ceil(0.95 * 2) - 1 = 1 → the slower of two equal samples
        minMs: 50,
        maxMs: 50,
      })
    } finally {
      store.close()
    }
  })

  it("times an attempt that THREW, because the tail is what a p95 exists to show", async () => {
    const store = await openStore()
    try {
      seed(store, [record("ai.adeu/mcp-server", [{ registryType: "npm", identifier: "@adeu/mcp-server", version: "1.7.1" }])])

      // No routes, so the adapter's fetch rejects and the loop's `.catch` produces UNAVAILABLE.
      const { fetchImpl } = stubFetch({})
      const ticks = [0, 3000]
      let i = 0
      const summary = await resolveArtifacts({
        store,
        adapters: NPM_ADAPTERS,
        fetchImpl,
        now: NOW,
        monotonicMs: () => ticks[i++] ?? -1,
      })

      // A 3-second failure is a real sample. Timing only the happy path would hide exactly the
      // durations a p95 is for — a slow timeout would be invisible in the statistic whose entire
      // job is to surface the tail.
      expect(summary.records[0]?.outcome).not.toBe("NO_ADAPTER")
      expect(summary.records[0]?.durationMs).toBe(3000)
      expect(summary.processing).toMatchObject({ n: 1, maxMs: 3000, p95Ms: 3000 })
    } finally {
      store.close()
    }
  })
})

describe("describeArtifactResolution — the operator's one line", () => {
  it("omits the cache clause when nothing was deduplicated", () => {
    const line = describeArtifactResolution({
      considered: 2,
      fetched: 2,
      unavailable: 0,
      rejected: 0,
      skippedNoAdapter: 0,
      cached: 0,
      records: [],
      processing: null,
    })
    expect(line).toBe("artifacts: 2 considered, 2 fetched, 0 unavailable, 0 rejected, 0 skipped (no adapter)")
  })

  it("names the cache count when there was one", () => {
    const line = describeArtifactResolution({
      considered: 2,
      fetched: 2,
      unavailable: 0,
      rejected: 0,
      skippedNoAdapter: 0,
      cached: 1,
      records: [],
      processing: null,
    })
    expect(line).toContain("2 fetched (1 already in CAS)")
  })
})

// ── the rebuild tier ──────────────────────────────────────────────────────────────────────────

describe("rebuild.artifact — measured, never assumed (controls #27, #28)", () => {
  const base = {
    sourceId: SOURCE_ID,
    priorSnapshotDigest: "sha256:" + "1".repeat(64),
    nextSnapshotDigest: "sha256:" + "2".repeat(64),
    absentFromSource: [] as string[],
  }

  it("is NULL when no port ran (control #27)", () => {
    const verdict = detectSourceChange({ ...base })
    // `null` means "this run could not know". `false` would be an unmeasured claim that no
    // artifact rebuild is needed — which control #27 makes and which is the whole reason the
    // tier is nullable.
    expect(verdict.rebuild.artifact).toBeNull()
    expect(verdict.changed).toBe(true)
  })

  it("is TRUE when the port reported work", () => {
    expect(detectSourceChange({ ...base, artifactResolved: true }).rebuild.artifact).toBe(true)
  })

  it("is FALSE only when the port ran and reported none", () => {
    // The distinction `undefined` cannot express: "resolved nothing" is a measurement, and it is
    // a different fact from "was not asked".
    expect(detectSourceChange({ ...base, artifactResolved: false }).rebuild.artifact).toBe(false)
  })

  it("stays NULL on a NO_CHANGE verdict even when TRUE was passed (control #28)", () => {
    const verdict = detectSourceChange({
      ...base,
      nextSnapshotDigest: base.priorSnapshotDigest,
      artifactResolved: true,
    })
    expect(verdict.changed).toBe(false)
    expect(verdict.reason).toBe("NO_CHANGE")
    // A skipped run RESOLVED nothing, whatever the caller believed, so the tier stays null.
    expect(verdict.rebuild.artifact).toBeNull()
    // `canonicalize` is the one tier that is `false` rather than `null` here, and the asymmetry is
    // correct rather than an oversight: it is typed `boolean` because THIS batch owns it and always
    // measures it, so on a NO_CHANGE verdict `false` is a measurement ("nothing to canonicalize"),
    // not an unmeasured claim. Every tier that depends on work a run may or may not have done is
    // null. Asserting "all seven are null" would have been a stronger-sounding claim that is simply
    // untrue of the shipped code — it failed on exactly this tier.
    expect(verdict.rebuild.canonicalize).toBe(false)
    const { canonicalize: _canonicalize, ...resolvedTiers } = verdict.rebuild
    expect(Object.values(resolvedTiers).every((v) => v === null)).toBe(true)
  })
})
