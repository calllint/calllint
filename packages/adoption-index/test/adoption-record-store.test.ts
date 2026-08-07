/**
 * adoption-record-store — `upsertAdoptionRecord` against a REAL driver, because every claim it makes
 * is about STORAGE.
 *
 * `adoption-record.test.ts` measures the pure compiler; nothing there can see the four properties
 * below, and a fake store would report green on all four:
 *
 *   - ONE SUBJECT, EXACTLY ONE ROW is a fact about `ON CONFLICT(subject_id)` hitting a PRIMARY KEY.
 *     `adoption_records` is the OPPOSITE of `source_records`: a record is a subject's current
 *     conclusion, so a re-compile must overwrite. Whether it does is a property of the SQL.
 *   - `OR REPLACE` vs `DO UPDATE` is only distinguishable on a row's SURVIVING identity: both leave
 *     one row with the new values. Control (a) measures it, and what catches it is that REPLACE
 *     deletes first — so anything the old row alone could tell us is gone.
 *   - `OR IGNORE` is the dangerous one and the easiest to miss: it drops the update and reports
 *     success. A subject whose verdict moved SAFE → BLOCK would keep serving the old conclusion. The
 *     assertion is that a second write with a MOVED verdict is visible in the row.
 *   - THE ENUM ASSERTION IS ON THE WRITE PATH, not in the DDL. Measured: `001-canonical-adoption-graph
 *     .sql` declares `lifecycle_status TEXT NOT NULL` with NO `CHECK`, so SQLite accepts any string and
 *     TypeScript is erased before it gets there. Control (b) writes a misspelling through a cast.
 *
 * THE CENSUS (control g), and why it is here rather than in a docblock: R-4's stickiness guard was
 * defeated by a SECOND WRITER of a column the test only measured one writer of
 * ([[workstream-r-r4-second-writer]]). So this file enumerates every statement in `src/` that writes
 * `adoption_records` and requires the set to be exactly one method, with a vacuity guard on the scan.
 *
 * TIME IS A LADDER OF LITERALS, never a clock read — the same rule as `job-lease.test.ts`. Every
 * `updated_at` assertion is a comparison between two stamps this file chose.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  MIGRATIONS_DIRNAME,
  compileAdoptionRecord,
  openBetterSqlite3,
  resolveIndexPaths,
  toSourceRecord,
  type AdoptionRecordV1,
  type CompileAdoptionRecordInput,
  type SourceRecordV1,
  type StoredArtifactVersion,
  type StoredEvidenceRecord,
  type StoredSubject,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const SRC_DIR = join(PKG_ROOT, "src")

const OFFICIAL_META = "io.modelcontextprotocol.registry/official"
const T0 = "2026-08-04T00:00:00.000Z"
const T1 = "2026-08-04T00:05:00.000Z"
const T2 = "2026-08-04T00:10:00.000Z"

const IDENTITY = `sha256:${"1".repeat(64)}`
const ARTIFACT = `sha256:${"2".repeat(64)}`
const EVIDENCE = `sha256:${"3".repeat(64)}`
const DECISION = `sha256:${"4".repeat(64)}`
const DECISION_MOVED = `sha256:${"5".repeat(64)}`
const POLICY = `sha256:${"6".repeat(64)}`
const CONTRACT = `sha256:${"7".repeat(64)}`
const PRESENTATION = `sha256:${"8".repeat(64)}`

const dirs: string[] = []
const stores: AdoptionIndexStore[] = []

afterEach(() => {
  for (const s of stores.splice(0)) {
    try {
      s.close()
    } catch {
      // Already closed by the test; removing the temp dir is what matters.
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/**
 * The store plus its driver handle.
 *
 * The handle is kept because one assertion has to write a row NO SUPPORTED API CAN PRODUCE — a
 * `lifecycle_status` the write path refuses — to prove the reader validates too. Reaching into the
 * store's private `db` field would be the alternative, and it breaks silently the day the field is
 * renamed; this file already owns the handle it passed in.
 */
interface Opened {
  store: AdoptionIndexStore
  db: Awaited<ReturnType<typeof openBetterSqlite3>>
}

async function openStore(now = T0): Promise<Opened> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-r7-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now })
  stores.push(store)
  return { store, db }
}

function payload(name: string): SourceRecordV1 {
  const built = toSourceRecord(
    { server: { name, version: "1.0.0" }, _meta: { [OFFICIAL_META]: { status: "active", isLatest: true } } } as never,
    T0,
  )
  if (built === null) throw new Error(`fixture "${name}" was rejected by the shipped adapter`)
  return built
}

function subject(id: string, slug: string): StoredSubject {
  return {
    subjectId: id,
    canonicalName: `io.example/${slug}`,
    canonicalSlug: `io-example-${slug}`,
    displayName: slug,
    identityStatus: "RESOLVED",
    identityDigest: IDENTITY,
    firstSeenAt: T0,
    lastSeenAt: T0,
    lifecycleStatus: "ACTIVE",
    withdrawnAt: null,
  }
}

function artifact(): StoredArtifactVersion {
  return {
    artifactVersionId: `sha256:${"a".repeat(64)}`,
    subjectId: `sha256:${"9".repeat(64)}`,
    packageType: "npm",
    packageIdentifier: "@example/alpha",
    version: "1.0.0",
    sourceLocator: "https://registry.npmjs.org/@example/alpha",
    immutableDigest: ARTIFACT,
    registryIntegrity: null,
    artifactStatus: "FETCHED",
    cacheKey: ARTIFACT,
    firstSeenAt: T0,
    lastVerifiedAt: T0,
  }
}

function evidenceRow(): StoredEvidenceRecord {
  return {
    evidenceDigest: EVIDENCE,
    artifactVersionId: artifact().artifactVersionId,
    engineVersion: "1.7.2",
    policyDigest: POLICY,
    verdict: "UNKNOWN",
    evidenceJson: JSON.stringify({ findings: [] }),
    createdAt: T0,
  }
}

function compile(overrides: Partial<CompileAdoptionRecordInput> = {}): AdoptionRecordV1 {
  return compileAdoptionRecord({
    subject: subject(`sha256:${"9".repeat(64)}`, "alpha"),
    selectedArtifact: artifact(),
    sourcePayloads: [payload("io.example/alpha")],
    evidence: evidenceRow(),
    findingCount: 0,
    decision: { verdict: "REVIEW", decisionDigest: DECISION, policyDigest: POLICY },
    presentation: { presentationDigest: PRESENTATION, semanticContractDigest: CONTRACT },
    hostCompatibility: [{ host: "cursor", tier: "A", installability: "REVIEW_REQUIRED" }],
    lifecycleStatus: "ACTIVE",
    ...overrides,
  })
}

describe("one subject, exactly one row (controls a, a')", () => {
  it("inserts on the first write and updates on the second", async () => {
    const { store } = await openStore()
    const record = compile()

    const first = store.transaction((tx) => tx.upsertAdoptionRecord({ record, updatedAt: T0 }))
    expect(first.inserted).toBe(true)
    expect(store.listAdoptionRecords()).toHaveLength(1)

    const second = store.transaction((tx) => tx.upsertAdoptionRecord({ record, updatedAt: T1 }))
    expect(second.inserted).toBe(false)
    // The row COUNT is the claim: `subject_id` is the primary key, so a re-compile overwrites rather
    // than accumulating. Append-only here would grow the served cohort on every run.
    expect(store.listAdoptionRecords()).toHaveLength(1)
    expect(second.adoptionRecordDigest).toBe(first.adoptionRecordDigest)
  })

  it("carries an unchanged record's updated_at forward, because that is what the column means", async () => {
    const { store } = await openStore()
    const record = compile()
    store.transaction((tx) => tx.upsertAdoptionRecord({ record, updatedAt: T0 }))
    store.transaction((tx) => tx.upsertAdoptionRecord({ record, updatedAt: T2 }))
    const [row] = store.listAdoptionRecords()
    expect(row!.updatedAt).toBe(T2)
    // And the digest did NOT move: the record is the same record. So `updated_at` advancing while
    // `adoption_record_digest` holds still is the honest report of "re-verified, unchanged" — which is
    // exactly what the freshness calculator in a later batch has to be able to distinguish.
    expect(row!.adoptionRecordDigest).toBe(store.listAdoptionRecords()[0]!.adoptionRecordDigest)
  })

  it("UPDATES the existing row rather than replacing it (control a: OR REPLACE)", async () => {
    // THE BEHAVIOURAL HALF of control (a)'s REPLACE spelling, added because running the control
    // proved the claim was only being made in prose: with `INSERT OR REPLACE`, every assertion in
    // this file still passed and the mutation survived on a source-text grep alone. A grep is a real
    // guard but a weak one — it constrains how the statement is SPELLED, not what it DOES, so a
    // future rewrite that reaches the same behaviour by another route would pass it.
    //
    // `rowid` is what makes the difference observable. `adoption_records` is not WITHOUT ROWID
    // (measured against `001-canonical-adoption-graph.sql`), so every row has one, and it is assigned
    // at INSERT. `DO UPDATE` keeps it; `OR REPLACE` deletes the row and inserts a new one, which
    // takes a fresh rowid. That deletion is the thing that matters: it fires `ON DELETE` behaviour on
    // any future child table, so a re-compile would silently start cascading.
    const { store, db } = await openStore()
    const record = compile()
    store.transaction((tx) => tx.upsertAdoptionRecord({ record, updatedAt: T0 }))
    const before = db.prepare("SELECT rowid AS rid FROM adoption_records").get() as { rid: number }

    const moved = compile({ decision: { verdict: "BLOCK", decisionDigest: DECISION_MOVED, policyDigest: POLICY } })
    store.transaction((tx) => tx.upsertAdoptionRecord({ record: moved, updatedAt: T1 }))
    const after = db.prepare("SELECT rowid AS rid FROM adoption_records").get() as { rid: number }

    expect(after.rid, "the row was replaced rather than updated — REPLACE deletes first").toBe(before.rid)
    // And the update did land, so this cannot be satisfied by refusing the second write outright.
    expect(store.listAdoptionRecords()[0]!.decisionDigest).toBe(DECISION_MOVED)
  })

  it("applies a MOVED verdict rather than dropping it (control a: OR IGNORE)", async () => {
    const { store } = await openStore()
    store.transaction((tx) => tx.upsertAdoptionRecord({ record: compile(), updatedAt: T0 }))

    const moved = compile({
      decision: { verdict: "BLOCK", decisionDigest: DECISION_MOVED, policyDigest: POLICY },
      lifecycleStatus: "DEPRECATED",
    })
    store.transaction((tx) => tx.upsertAdoptionRecord({ record: moved, updatedAt: T1 }))

    const [row] = store.listAdoptionRecords()
    // `OR IGNORE` would leave DECISION and ACTIVE here and still report a successful write — the
    // stale-verdict failure arriving as a cache hit.
    expect(row!.decisionDigest).toBe(DECISION_MOVED)
    expect(row!.lifecycleStatus).toBe("DEPRECATED")
    expect(store.listAdoptionRecords()).toHaveLength(1)

    // And the parsed record agrees with its own columns: five of the nine are projections OF
    // `record_json`, so a partial update would leave the row internally contradictory.
    const parsed = store.readAdoptionRecord(row!.subjectId)
    expect(parsed?.decision.verdict).toBe("BLOCK")
    expect(parsed?.digests.decisionDigest).toBe(row!.decisionDigest)
    expect(parsed?.lifecycle.status).toBe(row!.lifecycleStatus)
  })

  it("keeps two subjects in two rows", async () => {
    const { store } = await openStore()
    const alpha = compile()
    const beta = compile({
      subject: subject(`sha256:${"8".repeat(64)}`, "beta"),
      sourcePayloads: [payload("io.example/beta")],
    })
    store.transaction((tx) => {
      tx.upsertAdoptionRecord({ record: alpha, updatedAt: T0 })
      tx.upsertAdoptionRecord({ record: beta, updatedAt: T0 })
    })
    expect(store.listAdoptionRecords().map((r) => r.subjectId).sort()).toEqual(
      [alpha.subject.subjectId, beta.subject.subjectId].sort(),
    )
  })
})

describe("the write path asserts what the DDL does not (control b)", () => {
  it("has no CHECK constraint on lifecycle_status — the premise, measured not assumed", () => {
    // If the DDL DID constrain the column, the write-path assertion would be redundant and the control
    // below would be measuring SQLite rather than our code. So the premise is asserted first, against
    // the committed migration.
    const ddl = readFileSync(join(PKG_ROOT, MIGRATIONS_DIRNAME, "001-canonical-adoption-graph.sql"), "utf8")
    const table = /CREATE TABLE adoption_records \(([\s\S]*?)\n\);/.exec(ddl)
    expect(table, "adoption_records is not declared in 001").not.toBeNull()
    expect(table![1]).toContain("lifecycle_status TEXT NOT NULL")
    expect(table![1]).not.toContain("CHECK")
  })

  it("refuses a misspelled lifecycle_status", async () => {
    const { store } = await openStore()
    const record = compile()
    // The DOUBLE cast is the point, and `tsc` insisted on it: a single `as AdoptionRecordV1` is a
    // TS2352 here, because the two types do not overlap at all. That refusal IS the type system doing
    // its job — and it is erased at runtime, which is why the store must assert as well. A JSON-parsed
    // record or a JS caller reaches the store exactly like this.
    const bad = { ...record, lifecycle: { ...record.lifecycle, status: "WITHDRAWNN" } } as unknown as AdoptionRecordV1
    expect(() => store.transaction((tx) => tx.upsertAdoptionRecord({ record: bad, updatedAt: T0 }))).toThrow(
      /no CHECK constraint/,
    )
    expect(store.listAdoptionRecords()).toHaveLength(0)
  })

  it("refuses a foreign schema id", async () => {
    const { store } = await openStore()
    const record = compile()
    const bad = { ...record, schema: "calllint.adoption-record.v2" } as unknown as AdoptionRecordV1
    expect(() => store.transaction((tx) => tx.upsertAdoptionRecord({ record: bad, updatedAt: T0 }))).toThrow(
      /schema must be calllint\.adoption-record\.v1/,
    )
  })

  it("re-checks the digest chain at the boundary, not only in the compiler", async () => {
    const { store } = await openStore()
    const record = compile()
    // THE R-4 LESSON as an assertion: a guard that lives in one caller is a guard the next caller
    // bypasses. This record never went through `compileAdoptionRecord`'s check — it was mutated after
    // — so if the store trusted its input, an incoherent chain would reach the table.
    const bad = {
      ...record,
      digests: { ...record.digests, artifactDigest: null },
    } as AdoptionRecordV1
    expect(() => store.transaction((tx) => tx.upsertAdoptionRecord({ record: bad, updatedAt: T0 }))).toThrow(
      /mis-ordered chain/,
    )
    expect(store.listAdoptionRecords()).toHaveLength(0)
  })

  it("validates lifecycle_status on the way OUT as well", async () => {
    const { store, db } = await openStore()
    store.transaction((tx) => tx.upsertAdoptionRecord({ record: compile(), updatedAt: T0 }))
    // A row written by some future path that skipped the write-path assertion would otherwise be handed
    // to callers as an `AdoptionLifecycleStatus` the type system believes in. Written through the raw
    // driver precisely because no supported API can produce it.
    db.prepare("UPDATE adoption_records SET lifecycle_status = ?").run("ARCHIVED")
    expect(() => store.listAdoptionRecords()).toThrow(/ARCHIVED/)
  })
})

describe("the store is the only writer (control g)", () => {
  it("finds every adoption_records write in exactly one file, in one method", () => {
    // THE CENSUS, not a claim. R-4's guard was defeated by a second writer of a guarded column that the
    // test never enumerated, so this scans all of `src/` rather than reading the file it expects.
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(".ts")) files.push(full)
      }
    }
    walk(SRC_DIR)
    // VACUITY GUARD: an empty file list would satisfy every assertion below.
    expect(files.length).toBeGreaterThan(20)

    const writers = files.filter((f) => {
      const src = readFileSync(f, "utf8")
      // `INSERT(\s+OR\s+\w+)?\s+INTO` and not `INSERT\s+INTO`: measured while running control (a).
      // The first version of this line missed `INSERT OR IGNORE INTO adoption_records` entirely, so a
      // second writer had only to use a conflict-clause spelling to be invisible to the census — the
      // R-4 defect ([[workstream-r-r4-second-writer]]) reachable through the guard meant to prevent
      // it. The control failed on THIS assertion instead of on its own claim, which is how the hole
      // was found.
      return /(INSERT(\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+adoption_records/i.test(src)
    })
    expect(writers.map((f) => f.slice(SRC_DIR.length + 1).replace(/\\/g, "/"))).toEqual([
      "storage/store.ts",
    ])

    const storeSrc = readFileSync(join(SRC_DIR, "storage", "store.ts"), "utf8")
    // THE SHAPE FIRST, then the count. Ordering measured while running control (a): with the count
    // assertion first, `OR IGNORE` made `.match()` return null and the test died on
    // "Target cannot be null or undefined" — a crash, not a claim, and a reader would have to
    // reconstruct why. The two spellings the control applies are named here, so the control fails on
    // the sentence it is about.
    expect(storeSrc).not.toMatch(/INSERT\s+OR\s+(REPLACE|IGNORE)\s+INTO adoption_records/i)
    expect(storeSrc).toContain("ON CONFLICT(subject_id) DO UPDATE")
    // One INSERT, and NO bare UPDATE or DELETE anywhere: the upsert's `DO UPDATE SET` is part of the
    // INSERT statement, so a separate `UPDATE adoption_records` would be a second write path inside the
    // one file the census permits.
    expect(storeSrc.match(/INSERT INTO adoption_records/g)).toHaveLength(1)
    expect(storeSrc).not.toMatch(/\bUPDATE adoption_records\b/)
    expect(storeSrc).not.toMatch(/DELETE FROM adoption_records/)
  })
})

describe("one bad record does not discard the batch (control m)", () => {
  it("keeps the records committed by earlier transactions when a later one refuses", async () => {
    const { store } = await openStore()
    const good = compile()
    const bad = compile({ subject: subject(`sha256:${"7".repeat(64)}`, "beta") })
    const poisoned = { ...bad, lifecycle: { ...bad.lifecycle, status: "NOPE" } } as unknown as AdoptionRecordV1

    // PER-RECORD transactions, the `fail-closed` shape rather than `fail-DESTRUCTIVE`: the refusal is
    // scoped to the contested row. One transaction around the loop would discard `good` too — the
    // 19_737-subject incident ([[fail-closed-vs-fail-destructive]]).
    store.transaction((tx) => tx.upsertAdoptionRecord({ record: good, updatedAt: T0 }))
    expect(() => store.transaction((tx) => tx.upsertAdoptionRecord({ record: poisoned, updatedAt: T0 }))).toThrow()

    const rows = store.listAdoptionRecords()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.subjectId).toBe(good.subject.subjectId)
  })

  it("rolls back the WHOLE transaction when the caller chose to group two records", async () => {
    // The other half, so the first assertion is not read as "refusals never roll anything back". A
    // caller that groups records is choosing atomicity across them, and gets it — the scoping decision
    // belongs to the caller, and both behaviours must be observable.
    const { store } = await openStore()
    const good = compile()
    const bad = compile({ subject: subject(`sha256:${"7".repeat(64)}`, "beta") })
    const poisoned = { ...bad, lifecycle: { ...bad.lifecycle, status: "NOPE" } } as unknown as AdoptionRecordV1

    expect(() =>
      store.transaction((tx) => {
        tx.upsertAdoptionRecord({ record: good, updatedAt: T0 })
        tx.upsertAdoptionRecord({ record: poisoned, updatedAt: T0 })
      }),
    ).toThrow()
    expect(store.listAdoptionRecords()).toHaveLength(0)
  })
})

describe("the record survives a round trip through storage", () => {
  it("reads back deep-equal to what was compiled", async () => {
    const { store } = await openStore()
    const record = compile()
    store.transaction((tx) => tx.upsertAdoptionRecord({ record, updatedAt: T0 }))
    // `record_json` is the canonical asset; the columns beside it are an index into it. So this is the
    // assertion that matters most: what a projection reads back is what the compiler produced.
    expect(store.readAdoptionRecord(record.subject.subjectId)).toEqual(record)
    expect(store.readAdoptionRecord("sha256:missing")).toBeNull()
  })

  it("stores the omitted pageDigest as an absent key, not a null", async () => {
    const { store } = await openStore()
    const record = compile()
    expect("pageDigest" in record.digests).toBe(false)
    store.transaction((tx) => tx.upsertAdoptionRecord({ record, updatedAt: T0 }))
    const parsed = store.readAdoptionRecord(record.subject.subjectId)
    // JSON round-tripping an absent key keeps it absent; round-tripping an explicit `undefined` also
    // drops it, which is why the compiler omits rather than assigning. The schema's
    // `additionalProperties: false` plus `type: "string"` makes an explicit null invalid.
    expect(parsed !== null && "pageDigest" in parsed.digests).toBe(false)
  })
})
