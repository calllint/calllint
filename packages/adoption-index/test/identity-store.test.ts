/**
 * identity-store — persisting a resolved identity cohort to a REAL better-sqlite3 store.
 *
 * `resolve-identity.test.ts` grades the pure function; this file grades the half that a pure
 * function cannot see. The distinction is not ceremony — three of the facts asserted here are
 * properties of the DDL, not of the document:
 *
 *   - `canonical_subjects.canonical_slug` is `UNIQUE` but NULLABLE (migration 002), so a slug
 *     collision is RECORDED rather than refused. This assertion is INVERTED from what this file
 *     first claimed — "NOT NULL UNIQUE … two subjects sharing a slug cannot both land" — which
 *     was a true reading of 001's DDL and the wrong requirement. See the two collision tests
 *     below for the argument; the short form is that the resolver's fail-closed path emitted
 *     output its own schema could not store, so a refusal rolled back the entire cohort.
 *   - `subject_aliases`' PRIMARY KEY is `(alias, subject_id)`, so a duplicate alias pair is
 *     folded silently. `PersistIdentityResult.aliases` counts DOCUMENT entries, so document
 *     count and row count are two different numbers and only the store knows the second.
 *   - `identity_digest` and `first_seen_at` exist only in storage — the schemas forbid them as
 *     properties — so they are computed at write time and can only be graded by reading back.
 *
 * Negative controls this file is the measurement for:
 *   #6  a CONFLICT subject that still carries artifacts → fail-closed, asserted on ROWS
 *   #10 a random `subjectId` → determinism across two independent stores over the same bytes
 *   #15 `new Date()` for a timestamp → every stamp read back is one that was passed in
 *
 * The production driver is used rather than a fake, following `store-schema.test.ts`: the two
 * things most likely to be wrong are whether the native module resolves under vitest and
 * whether the write actually satisfies the constraints, and a fake can see neither.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  resolveIdentity,
  canonicalSlug,
  participantId,
  subjectIdentityDigest,
  sourceRecordRowId,
  toSourceRecord,
  OFFICIAL_REGISTRY_SOURCE_ID,
  MIGRATIONS_DIRNAME,
  type SourceRecordV1,
  type ResolveIdentityResult,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const NOW = "2026-08-04T00:00:00.000Z"
const RETRIEVED = "2026-08-03T12:00:00.000Z"
// The SOURCE id, not the `_meta` key. An earlier version of this file used
// `io.modelcontextprotocol.registry/official` here — that string is the key the registry
// namespaces its lifecycle metadata under, and `sourceId` is `official-mcp-registry`. The
// fixture was internally consistent and every assertion still passed, because `subjectId`
// hashes whatever `sourceId` it is handed; it was simply hashing an id production never uses.
const SOURCE_ID = OFFICIAL_REGISTRY_SOURCE_ID
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"

const dirs: string[] = []
async function openStore(): Promise<AdoptionIndexStore> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-identity-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  const { mkdirSync } = await import("node:fs")
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  return AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now: NOW })
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

interface Over {
  repositoryUrl?: string
  packages?: { registryType: string; identifier: string; version?: string }[]
  remotes?: { type: string; url: string }[]
  version?: string
}

/**
 * Build a `SourceRecordV1` through the SHIPPED adapter, matching `resolve-identity.test.ts`.
 *
 * This file's first version hand-authored the record, and every one of that decision's costs
 * showed up as a defect rather than as a type error at the boundary:
 *
 *   - It invented `sourceNativeId`, `lifecycleStatus` and `rawPayload`, none of which exist on
 *     `SourceRecordV1`, and omitted the `lifecycle` object that does. `vitest` transpiles
 *     without checking types, so nine tests passed green over a shape the compiler rejects.
 *   - It hashed its own `payloadDigest` over a 16-byte PREFIX of the payload JSON — identical
 *     for any two records of one name — so two deliberately-different observations shared one
 *     digest and the collision test measured "one observation seen twice" instead.
 *   - It set `sourceType: "official-registry"`, which is not one of the four `SourceType`s.
 *
 * The adapter gets all three right by construction: `hashJson` over the whole raw item,
 * `sourceRecordId` = the server name (so a republish is a new observation, not a new subject —
 * the fact the conflict participants and the alias fold both turn on), and optional fields
 * assigned only when present, because an absent field and a present-but-`undefined` one must
 * not produce two digests for one observation.
 */
function record(name: string, over: Over = {}): SourceRecordV1 {
  const server: Record<string, unknown> = { name, version: over.version ?? "1.0.0" }
  if (over.repositoryUrl !== undefined) server.repository = { url: over.repositoryUrl, source: "github" }
  if (over.packages !== undefined) server.packages = over.packages
  if (over.remotes !== undefined) server.remotes = over.remotes
  const built = toSourceRecord(
    { server, _meta: { [OFFICIAL_META]: { status: "active", isLatest: true } } } as never,
    RETRIEVED,
  )
  if (built === null) throw new Error(`fixture "${name}" was rejected by the shipped adapter`)
  return built
}

function resolve(records: SourceRecordV1[]): ResolveIdentityResult {
  return resolveIdentity({ records, sourceId: SOURCE_ID, observedAt: NOW })
}

/** Persist one cohort in one transaction, the way `refreshFromMirror` does. */
function persist(store: AdoptionIndexStore, identity: ResolveIdentityResult) {
  return store.transaction((tx) => tx.persistIdentity(identity))
}

describe("persist → read back", () => {
  it("round-trips a clean single-subject cohort, columns and derived values", async () => {
    const store = await openStore()
    try {
      const identity = resolve([
        record("io.test/alpha", {
          repositoryUrl: "https://github.com/x/alpha",
          packages: [{ registryType: "npm", identifier: "alpha", version: "1.2.3" }],
        }),
      ])
      const written = persist(store, identity)
      expect(written).toEqual({ subjects: 1, aliases: identity.aliases.length, artifacts: 1, conflicts: 0 })

      const [subject] = store.listSubjects()
      expect(subject!.canonicalName).toBe("io.test/alpha")
      expect(subject!.canonicalSlug).toBe(canonicalSlug("io.test/alpha"))
      expect(subject!.identityStatus).toBe("PROVISIONAL")
      // The two STORAGE-derived columns: absent from the document, computed at write time.
      expect(subject!.identityDigest).toBe(subjectIdentityDigest(identity.subjects[0]!))
      // Control #15: every stamp read back is one that was PASSED IN. Both come from
      // `observedAt`, the resolver's injected stamp — not from the record's `retrievedAt`, which
      // is when the SOURCE was read, and not from a clock. Asserting the value distinguishes
      // all three: `RETRIEVED` is present in the input and is deliberately not what lands here.
      expect(subject!.firstSeenAt).toBe(NOW)
      expect(subject!.lastSeenAt).toBe(NOW)
      expect(subject!.firstSeenAt).not.toBe(RETRIEVED)

      const [artifact] = store.listArtifactVersions()
      expect(artifact!.subjectId).toBe(subject!.subjectId)
      expect(artifact!.packageType).toBe("npm")
      expect(artifact!.packageIdentifier).toBe("alpha")
      expect(artifact!.version).toBe("1.2.3")
      expect(artifact!.artifactStatus).toBe("RESOLVED")
      // The R-4 boundary, read from the columns rather than from the document (control #12).
      // `registryIntegrity` is OMITTED on the document and lands NULL; `immutableDigest` is
      // required-and-nullable and is an explicit null. Both read back as null, which is why
      // the document-level distinction has its own assertion in resolve-identity.test.ts.
      expect(artifact!.immutableDigest).toBeNull()
      expect(artifact!.registryIntegrity).toBeNull()
      expect(artifact!.cacheKey).toBeNull()
      expect(artifact!.lastVerifiedAt).toBeNull()
      // `first_seen_at` is NOT NULL in the DDL and absent from the artifact SCHEMA, so it is
      // taken from the owning SUBJECT. Not a placeholder, and not the clock.
      expect(artifact!.firstSeenAt).toBe(subject!.firstSeenAt)
    } finally {
      store.close()
    }
  })

  it("stores exactly one alias ROW per document entry — the count is not over-reported", async () => {
    const store = await openStore()
    try {
      // The adversarial shape the resolver was corrected for: two versions of one package
      // (one basis value twice) AND a repositoryUrl equal to the derived slug (a claimed value
      // colliding with the derived row). Both would have produced a duplicate primary key.
      const slug = canonicalSlug("io.test/alpha")
      const identity = resolve([
        record("io.test/alpha", {
          repositoryUrl: slug,
          packages: [
            { registryType: "npm", identifier: "same", version: "1" },
            { registryType: "npm", identifier: "same", version: "2" },
          ],
        }),
      ])
      const written = persist(store, identity)
      // `PersistIdentityResult.aliases` counts DOCUMENT entries. The store folds duplicate
      // `(alias, subject_id)` pairs silently, so this equality is the assertion that the
      // document carries no entry the store cannot hold.
      expect(store.countSubjectAliases()).toBe(written.aliases)
      expect(store.countSubjectAliases()).toBe(identity.aliases.length)
    } finally {
      store.close()
    }
  })

  it("replaying the same cohort is idempotent — upserts, not duplicates", async () => {
    const store = await openStore()
    try {
      const identity = resolve([record("io.test/alpha", { packages: [{ registryType: "npm", identifier: "a" }] })])
      persist(store, identity)
      const first = store.listSubjects()
      persist(store, identity)
      expect(store.listSubjects()).toEqual(first)
      expect(store.listArtifactVersions()).toHaveLength(1)
      expect(store.countSubjectAliases()).toBe(identity.aliases.length)
    } finally {
      store.close()
    }
  })
})

describe("id determinism (control #10)", () => {
  it("two independent stores over the same bytes agree on every id and digest", async () => {
    const a = await openStore()
    const b = await openStore()
    try {
      const records = [
        record("io.test/alpha", { packages: [{ registryType: "npm", identifier: "a", version: "1" }] }),
        record("io.test/beta", { repositoryUrl: "https://github.com/x/beta" }),
      ]
      // Resolved TWICE, independently, so a resolver holding state between calls would show up.
      persist(a, resolve(records))
      persist(b, resolve(records))
      expect(b.listSubjects()).toEqual(a.listSubjects());
      expect(b.listArtifactVersions()).toEqual(a.listArtifactVersions())
      // A uuid would differ here on every run, which is exactly the mutation.
      expect(a.listSubjects().every((s) => /^sha256:[0-9a-f]{64}$/.test(s.subjectId))).toBe(true)
    } finally {
      a.close()
      b.close()
    }
  })

  it("participantId is byte-for-byte sourceRecordRowId — a conflict names a mirror ROW", async () => {
    // The two are separate functions because `store.ts` imports `node:fs` and the resolver
    // must stay pure. That duplication is only safe if it is graded, so this is the assertion
    // that keeps them equal: a conflict participant that did not equal a stored row id would
    // point a human at nothing.
    const r = record("io.test/alpha", { packages: [{ registryType: "npm", identifier: "a" }] })
    expect(participantId(r)).toBe(sourceRecordRowId(r))
  })
})

describe("fail closed, asserted on ROWS (control #6)", () => {
  it("a CONFLICT subject is recorded and contributes ZERO artifact rows", async () => {
    const store = await openStore()
    try {
      // Two records claiming one name, distinguishable only by payload — the reachable shape,
      // since the mirror's UNIQUE key is (source, nativeId, payloadDigest).
      const identity = resolve([
        record("io.test/dup", { version: "1.0.0", packages: [{ registryType: "npm", identifier: "one" }] }),
        record("io.test/dup", { version: "2.0.0", packages: [{ registryType: "npm", identifier: "two" }] }),
      ])
      persist(store, identity)

      const subjects = store.listSubjects()
      expect(subjects).toHaveLength(1)
      expect(subjects[0]!.identityStatus).toBe("CONFLICT")
      // The refusal produces LESS data, never a winner: no artifact row for either claim.
      expect(store.listArtifactVersions()).toEqual([])

      const conflicts = store.listIdentityConflicts()
      expect(conflicts.length).toBeGreaterThan(0)
      // Every conflict names ≥2 participants, and they are participant ids (mirror rows), not
      // the native id both records share.
      for (const c of conflicts) {
        expect(c.sourceRecordIds.length).toBeGreaterThanOrEqual(2)
        expect(new Set(c.sourceRecordIds).size).toBe(c.sourceRecordIds.length)
        expect(c.sourceRecordIds).not.toContain("io.test/dup")
        expect(c.status).toBe("OPEN")
        expect(c.resolvedAt).toBeNull()
        expect(c.resolution).toBeNull()
      }
    } finally {
      store.close()
    }
  })

  it("survives the JSON round-trip of a conflict's participants and resolution", async () => {
    const store = await openStore()
    try {
      const identity = resolve([
        record("io.test/dup", { version: "1.0.0" }),
        record("io.test/dup", { version: "2.0.0" }),
      ])
      persist(store, identity)
      const [c] = store.listIdentityConflicts()
      // Parsed back to an ARRAY, not left as a string: a caller counting a string's characters
      // would never see `minItems: 2`.
      expect(Array.isArray(c!.sourceRecordIds)).toBe(true)
      expect(c!.sourceRecordIds).toEqual(identity.conflicts[0]!.sourceRecordIds)
    } finally {
      store.close()
    }
  })
})

describe("what STORAGE refuses that the document alone would not", () => {
  it("RECORDS two subjects sharing one canonical_slug, both at NULL — migration 002", async () => {
    const store = await openStore()
    try {
      // THIS ASSERTION IS INVERTED, and the inversion is the point of the change that carries it.
      //
      // It previously read `expect(() => persist(...)).toThrow(/UNIQUE constraint failed/)` and
      // `expect(store.listSubjects()).toEqual([])`, with a comment calling the throw "the honest
      // outcome" and the input "UNREACHABLE ON REAL DATA … 19 names → 19 distinct slugs → 0
      // collisions". Both halves were true when written and both are now false:
      //
      //   REACHABILITY. 19-of-19 was a property of the 19 COMMITTED SNAPSHOT ENTRIES, not of the
      //   source. The companion cap raise fans identity resolution out to the full live cohort
      //   (19_739 `active` + `isLatest` names, measured 2026-08-04 by a walk that ran to
      //   `reason=exhausted`), where collisions are MEASURED. The two below are real registry
      //   names, substituted for this test's original synthetic `a.b/c` / `a.b-c` pair precisely
      //   so the input can no longer be dismissed as hypothetical.
      //
      //   CORRECTNESS. The throw was not fail-closed, it was fail-DESTRUCTIVE. `resolveIdentity`
      //   emits both contesting subjects deliberately — "dropping it would turn a refusal into a
      //   silent omission" — marks both CONFLICT, and withholds every artifact row. Storage was
      //   the ONLY layer that disagreed, and it disagreed by rolling back the whole cohort: 19_737
      //   uncontested subjects discarded because 2 collided. A refusal that destroys the evidence
      //   it refuses over is worse than the merge it prevented.
      //
      // TWO IS A FLOOR, NOT A COUNT: the probe that found these stopped at its own 500-page
      // ceiling, having seen 14_454 of the 19_739 live names.
      const identity = resolve([
        record("io.github.LocalSynapse/LocalSynapse-mcp"),
        record("io.github.LocalSynapse/localsynapse-mcp"),
      ])
      expect(identity.conflicts.map((c) => c.conflictType)).toContain("slug-collision")
      expect(identity.subjects).toHaveLength(2)
      // Case-fold, not `/`-rewrite: `canonicalSlug` lowercases and the registry does not.
      expect(new Set(identity.subjects.map((s) => s.canonicalSlug)).size).toBe(1)
      // The DOCUMENT still carries its required non-null slug. `calllint.canonical-subject.v1`
      // types `canonicalSlug` as `{"type": "string", "minLength": 1}`, required — and it is a
      // PUBLISHED schema behind a compatibility gate. The divergence is storage-only.
      expect(identity.subjects.every((s) => s.canonicalSlug.length > 0)).toBe(true)

      const res = persist(store, identity)
      expect(res).toEqual({ subjects: 2, aliases: 4, artifacts: 0, conflicts: 1 })

      // BOTH rows land, both CONFLICT, both slugs NULL. SQLite treats NULLs as DISTINCT under
      // UNIQUE, so the true invariant — one address, one owner — survives untouched while the
      // column gains the ability to say "no address was concluded".
      expect(store.listSubjects().map((s) => [s.canonicalName, s.canonicalSlug, s.identityStatus])).toEqual([
        ["io.github.LocalSynapse/LocalSynapse-mcp", null, "CONFLICT"],
        ["io.github.LocalSynapse/localsynapse-mcp", null, "CONFLICT"],
      ])
      // The conflict row is the adjudication evidence, and it is now REACHABLE — under 001 it
      // was rolled back with everything else, so the refusal left no trace at all.
      expect(store.listIdentityConflicts()).toHaveLength(1)
      // Still fail-closed where fail-closed belongs: a CONFLICT subject contributes no artifact.
      expect(store.listArtifactVersions()).toEqual([])
    } finally {
      store.close()
    }
  })

  it("keeps uncontested subjects when a collision occurs — the cohort is no longer rolled back", async () => {
    const store = await openStore()
    try {
      // INVERTED from "rolls back the whole cohort when any single row is refused", which
      // asserted `listSubjects()` was EMPTY. That test's own reasoning was sound — one
      // transaction, so a refusal must not publish a partial cohort — but it was measuring the
      // wrong refusal. Nothing here is refused: all three subjects are recorded, and the
      // conflicted pair is recorded AS conflicted. That is what makes the clean subject's
      // survival safe rather than partial.
      const identity = resolve([
        record("io.test/clean"),
        record("io.github.LocalSynapse/LocalSynapse-mcp"),
        record("io.github.LocalSynapse/localsynapse-mcp"),
      ])
      persist(store, identity)
      expect(
        store.listSubjects().map((s) => [s.canonicalName, s.canonicalSlug === null, s.identityStatus]),
      ).toEqual([
        ["io.github.LocalSynapse/LocalSynapse-mcp", true, "CONFLICT"],
        ["io.github.LocalSynapse/localsynapse-mcp", true, "CONFLICT"],
        // The uncontested subject keeps its address. Under 001 this row was destroyed by a
        // collision it had no part in — the defect stated as a single assertion.
        ["io.test/clean", false, "PROVISIONAL"],
      ])
    } finally {
      store.close()
    }
  })

  it("stays idempotent across a replay of a colliding cohort — TWO runs, ONE store", async () => {
    const store = await openStore()
    try {
      // The R-4 lesson, applied without being made to learn it again: a per-writer control
      // cannot see a second writer, so the guarded column is graded by READING BACK after a
      // realistic replay rather than by inspecting one call site. `persistIdentity`'s upsert is
      // the writer that reset FETCHED→RESOLVED every replay in R-4 and passed its own control.
      //
      // Two NULLs re-inserted must not become two rows: the UNIQUE column cannot dedupe them
      // (NULLs are distinct), so idempotence here rests entirely on `subject_id` being the
      // PRIMARY KEY and a function of the inputs alone.
      const identity = resolve([
        record("io.github.LocalSynapse/LocalSynapse-mcp"),
        record("io.github.LocalSynapse/localsynapse-mcp"),
      ])
      persist(store, identity)
      const first = store.listSubjects()
      persist(store, identity)
      expect(store.listSubjects()).toEqual(first)
      expect(store.listIdentityConflicts()).toHaveLength(1)
    } finally {
      store.close()
    }
  })
})
