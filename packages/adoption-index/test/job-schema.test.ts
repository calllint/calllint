/**
 * job-schema — R-6's two documents validated against the COMMITTED schemas, from rows a real store
 * actually wrote.
 *
 * WHY THIS IS A THIRD FILE. `job-state-machine.test.ts` measures the pure layer against TypeScript's
 * view of the types; `job-lease.test.ts` measures behaviour against a real driver. Neither compares
 * anything to `schemas/calllint.compiler-{job,run}.v1.schema.json`, and TypeScript cannot: the types
 * in `domain/job.ts` were TRANSCRIBED from those files by hand, so a transcription error produces a
 * type that is internally consistent, a store that round-trips it, and a document the committed
 * contract rejects. Only a validator sees that.
 *
 * THE DOCUMENTS ARE PROJECTED FROM STORED ROWS, never hand-authored. A literal built in this file
 * would validate the fixture rather than the emitter — the R-2 lesson, "measure the artifact, not an
 * intermediate". So every case here goes: enqueue or begin through the operations layer → read the
 * row back through `listCompilerJobs`/`listCompilerRuns` → project with
 * `toCompilerJobDocument`/`toCompilerRunDocument` → validate. What the schema sees is what the
 * pipeline produces.
 *
 * FOUR THINGS THE SCHEMAS CONSTRAIN THAT NOTHING ELSE DOES:
 *
 *   - `additionalProperties: false` on both, and on `metrics`. An invented field makes every document
 *     invalid, which is the only reason `metrics` cannot become "a second, unaudited place where a
 *     decision is made" (the schema's words). Asserted by ADDING one and watching validation fail.
 *   - `schema` is `required` and is a `const`, while NEITHER TABLE HAS A `schema` COLUMN. So the
 *     property is produced, not stored, and a structural cast in place of `toCompilerJobDocument`
 *     would omit it. Asserted by validating a document with the property deleted.
 *   - `format: "date-time"` on six properties. Off by default in ajv — enabled here with
 *     `ajv-formats`, because the alternative is a suite that reports green over `availableAt: "soon"`.
 *   - `outputManifestDigest` is in `required` AND nullable. A `RUNNING` run must therefore carry an
 *     explicit `null`, and a document that merely omits the key is invalid. That asymmetry is the one
 *     the schema argues for at length, so it gets both halves asserted.
 *
 * Negative controls this file is the measurement for:
 *   #91 drop `schema` from the projection    → the document loses a `required` property
 *   #92 add a field to a document            → `additionalProperties: false` must refuse it
 *   #93 omit `outputManifestDigest` on a RUNNING run → a required-but-nullable property must be present
 *
 * The validators are compiled from the committed bytes on disk, never from a copy in this file. A
 * schema inlined here would be a second normative source, and the only thing it could prove is that
 * it agrees with itself.
 */
import { describe, it, expect, afterEach } from "vitest"
import Ajv, { type ValidateFunction } from "ajv"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  beginCompilerRun,
  concludeCompilerRun,
  emptyRunMetrics,
  enqueueJobs,
  leaseNextJob,
  settleAttempt,
  toCompilerJobDocument,
  toCompilerRunDocument,
  COMPILER_JOB_SCHEMA,
  COMPILER_JOB_TYPES,
  COMPILER_RUN_SCHEMA,
  COMPILER_RUN_TYPES,
  MIGRATIONS_DIRNAME,
  type CompilerJobV1,
  type CompilerRunV1,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const REPO_ROOT = join(PKG_ROOT, "..", "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const SCHEMA_DIR = join(REPO_ROOT, "schemas")

const T0 = "2026-08-04T00:00:00.000Z"
const T1 = "2026-08-04T00:05:00.000Z"
const T2 = "2026-08-04T00:10:00.000Z"
const D1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
const MANIFEST = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const OUTPUT = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

// `strict: false` matches `tests/schema/schema-compatibility.test.ts`, so the two suites compile the
// same bytes under the same reading.
const ajv = new Ajv({ allErrors: true, strict: false })

/**
 * `date-time`, registered by hand rather than via `ajv-formats`.
 *
 * Ajv leaves `format` INERT by default, and six properties across these two schemas declare
 * `date-time` — so without a registered checker this file would report green over `availableAt:
 * "soon"`, which is the opposite of what it exists to do. `ajv-formats` is not in the dependency set
 * and R-6 adds no dependencies (a gate pins that), so the checker is a regex here.
 *
 * RFC 3339, matching what `ajv-formats` accepts in its non-strict mode: a `T` separator, optional
 * fractional seconds, and either `Z` or a numeric offset. Deliberately NOT `.endsWith("Z")` — the
 * store never parses a stamp, so a caller supplying `+00:00` is writing something this schema
 * permits, and a checker stricter than the contract would fail a valid document. The suite asserts
 * BOTH directions below: prose is refused, and an offset stamp is accepted.
 */
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
ajv.addFormat("date-time", { type: "string", validate: (s: string) => RFC3339.test(s) })

function validatorFor(name: string): ValidateFunction {
  const raw = readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), "utf8")
  return ajv.compile(JSON.parse(raw) as object)
}

const validateJob = validatorFor("calllint.compiler-job.v1")
const validateRun = validatorFor("calllint.compiler-run.v1")

/** Validation errors as one readable line, so a failure names the property rather than a boolean. */
function why(validate: ValidateFunction): string {
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`).join("; ")
}

function expectValidJob(doc: unknown): void {
  const ok = validateJob(doc)
  expect(ok, `compiler-job.v1 rejected the emitter's own output: ${why(validateJob)}`).toBe(true)
}

function expectValidRun(doc: unknown): void {
  const ok = validateRun(doc)
  expect(ok, `compiler-run.v1 rejected the emitter's own output: ${why(validateRun)}`).toBe(true)
}

const dirs: string[] = []
const stores: AdoptionIndexStore[] = []

afterEach(() => {
  for (const s of stores.splice(0)) s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function openStore(): Promise<AdoptionIndexStore> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-r6-schema-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now: T0 })
  stores.push(store)
  return store
}

/** Every queued row, as documents. */
function jobDocs(store: AdoptionIndexStore): CompilerJobV1[] {
  return store.listCompilerJobs().map((row) => toCompilerJobDocument(row))
}

function runDocs(store: AdoptionIndexStore): CompilerRunV1[] {
  return store.listCompilerRuns().map((row) => toCompilerRunDocument(row))
}

/**
 * The first document, ASSERTED rather than indexed.
 *
 * `docs[0]` is `T | undefined`, and `docs[0]!` would silence that by promising something no code
 * checks. The difference shows up on failure: an empty list handed to `expectValidRun` fails with
 * "compiler-run.v1 rejected the emitter's own output", which blames the SCHEMA for a producer that
 * wrote nothing. These fail one line earlier and name the producer.
 */
function firstJob(store: AdoptionIndexStore): CompilerJobV1 {
  const docs = jobDocs(store)
  expect(docs.length, "the emitter queued no row for this case to grade").toBeGreaterThan(0)
  return docs[0]!
}

function firstRun(store: AdoptionIndexStore): CompilerRunV1 {
  const docs = runDocs(store)
  expect(docs.length, "the emitter recorded no run for this case to grade").toBeGreaterThan(0)
  return docs[0]!
}

describe("the validators are real (the vacuity guard)", () => {
  it("compiled both schemas from the committed bytes", () => {
    // A misspelled filename would make `readFileSync` throw, but a validator compiled from `{}`
    // accepts everything — so the guard is that each one REFUSES something obvious.
    expect(validateJob({})).toBe(false)
    expect(validateRun({})).toBe(false)
    expect(validateJob({ schema: "calllint.compiler-job.v1" })).toBe(false)
  })

  it("has date-time actually enabled, and not by a checker that refuses everything", () => {
    // TWO DIRECTIONS, because a registered format is itself code that can be wrong. A checker that
    // refused every string would pass the first half of this test and quietly fail every valid
    // document elsewhere in the file — so the accepted cases are asserted too.
    const base = {
      schema: COMPILER_JOB_SCHEMA,
      jobId: "j",
      jobType: "compile-evidence",
      subjectKey: "io.test/a",
      inputDigest: D1,
      state: "PENDING",
      priority: 100,
      attemptCount: 0,
      createdAt: T0,
      updatedAt: T0,
    }
    // Without a registered checker, `format` is inert and this validates — the suite would then
    // report green over a queue whose timestamps are prose.
    expect(validateJob({ ...base, availableAt: "soon" })).toBe(false)
    expect(why(validateJob)).toContain("date-time")
    expect(validateJob({ ...base, availableAt: "2026-08-04" })).toBe(false)
    expect(validateJob({ ...base, availableAt: "2026-08-04 00:00:00Z" })).toBe(false)

    for (const stamp of [T0, "2026-08-04T00:00:00Z", "2026-08-04T00:00:00.123456Z", "2026-08-04T00:00:00+00:00"]) {
      const ok = validateJob({ ...base, availableAt: stamp })
      expect(ok, `${stamp} is a valid RFC 3339 stamp: ${why(validateJob)}`).toBe(true)
    }
  })

  it("agrees with the transcribed enums, member for member", () => {
    // The types in `domain/job.ts` were transcribed by hand. This is the assertion that the
    // transcription is FAITHFUL — read out of the committed schema, compared to the frozen arrays.
    const jobSchema = JSON.parse(readFileSync(join(SCHEMA_DIR, "calllint.compiler-job.v1.schema.json"), "utf8"))
    const runSchema = JSON.parse(readFileSync(join(SCHEMA_DIR, "calllint.compiler-run.v1.schema.json"), "utf8"))

    expect(jobSchema.properties.jobType.enum).toEqual([...COMPILER_JOB_TYPES])
    expect(runSchema.properties.runType.enum).toEqual([...COMPILER_RUN_TYPES])
    expect(jobSchema.properties.schema.const).toBe(COMPILER_JOB_SCHEMA)
    expect(runSchema.properties.schema.const).toBe(COMPILER_RUN_SCHEMA)
    // And both are closed, which is what makes every `additionalProperties` assertion below mean
    // something rather than being a claim about ajv's defaults.
    expect(jobSchema.additionalProperties).toBe(false)
    expect(runSchema.additionalProperties).toBe(false)
    expect(runSchema.properties.metrics.additionalProperties).toBe(false)
  })
})

describe("every queue state projects to a valid document", () => {
  it("validates a PENDING row straight out of enqueue", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [{ jobType: "compile-evidence", subjectKey: "io.test/a", inputDigest: D1 }], now: T0 })
    const docs = jobDocs(store)
    expect(docs).toHaveLength(1)
    expectValidJob(docs[0])
    // The three nullable properties are ABSENT from `required` but present in the row, and null is
    // what the schema permits for each. Asserted so a future projection that dropped them would fail
    // here rather than pass on a technicality.
    expect(docs[0]).toMatchObject({ leaseOwner: null, leaseExpiresAt: null, lastErrorCode: null })
  })

  it("validates a LEASED row, with both lease properties populated", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [{ jobType: "resolve-artifact", subjectKey: "io.test/a", inputDigest: D1 }], now: T0 })
    leaseNextJob({ store, owner: "worker-1", now: T0, leaseExpiresAt: T1 })
    const doc = firstJob(store)
    expectValidJob(doc)
    expect(doc).toMatchObject({ state: "LEASED", leaseOwner: "worker-1", leaseExpiresAt: T1 })
  })

  it("validates a PENDING row released with a backoff and an error digest", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [{ jobType: "ingest-source", subjectKey: "io.test/a", inputDigest: D1 }], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T2 })
    if (leased === null) throw new Error("expected a leased job")
    settleAttempt({
      store,
      job: leased,
      outcome: "RETRYABLE",
      now: T1,
      schedule: () => T2,
      errorCode: "UPSTREAM_503",
      errorDigest: D1,
    })
    const doc = firstJob(store)
    // `lastErrorDigest` carries the schema's `sha256:` pattern, so a projection that put prose there
    // would be refused. The error BYTES are in the CAS; this is a pointer.
    expectValidJob(doc)
    expect(doc).toMatchObject({ state: "PENDING", lastErrorCode: "UPSTREAM_503", lastErrorDigest: D1 })
  })

  it("validates each terminal row", async () => {
    const store = await openStore()
    const outcomes = [
      { key: "io.test/ok", outcome: "SUCCESS" as const, expected: "SUCCEEDED" },
      { key: "io.test/no", outcome: "PERMANENT" as const, expected: "FAILED" },
    ]
    for (const { key, outcome, expected } of outcomes) {
      enqueueJobs({ store, jobs: [{ jobType: "compile-evidence", subjectKey: key, inputDigest: D1 }], now: T0 })
      const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T2 })
      if (leased === null) throw new Error(`expected a leased job for ${key}`)
      const disposition = settleAttempt({ store, job: leased, outcome, now: T1, schedule: () => T2 })
      expect(disposition).toBe(expected)
    }
    // DEAD_LETTER too — reached by exhausting a one-attempt budget rather than by writing the state.
    enqueueJobs({ store, jobs: [{ jobType: "compile-evidence", subjectKey: "io.test/dead", inputDigest: D1 }], now: T0 })
    const last = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T2 })
    if (last === null) throw new Error("expected a leased job")
    expect(settleAttempt({ store, job: last, outcome: "RETRYABLE", now: T1, schedule: () => T2, maxAttempts: 1 })).toBe(
      "DEAD_LETTER",
    )

    const docs = jobDocs(store)
    expect(docs).toHaveLength(3)
    for (const doc of docs) expectValidJob(doc)
    expect(docs.map((d) => d.state).sort()).toEqual(["DEAD_LETTER", "FAILED", "SUCCEEDED"])
  })

  it("validates a document for every jobType the schema declares", async () => {
    const store = await openStore()
    // All seven, so the transcription is exercised rather than merely compared. Four of the seven
    // name work that already ships as an operation; the other three are stages R-6 does not build,
    // and a queue that could not HOLD them would be a partial transcription of a committed set.
    enqueueJobs({
      store,
      jobs: COMPILER_JOB_TYPES.map((jobType, i) => ({ jobType, subjectKey: `io.test/${i}`, inputDigest: D1 })),
      now: T0,
    })
    const docs = jobDocs(store)
    expect(docs).toHaveLength(COMPILER_JOB_TYPES.length)
    for (const doc of docs) expectValidJob(doc)
    expect(docs.map((d) => d.jobType).sort()).toEqual([...COMPILER_JOB_TYPES].sort())
  })
})

describe("every run state projects to a valid document", () => {
  it("validates a RUNNING run, whose outputManifestDigest is an explicit null (control #93)", async () => {
    const store = await openStore()
    beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    const doc = firstRun(store)
    expectValidRun(doc)
    expect(doc.outputManifestDigest).toBeNull()
    expect(doc.completedAt).toBeNull()

    // The asymmetry the schema argues for: `required` AND nullable. Present-and-null validates;
    // absent does not. Both halves, because only the pair rules out "just omit it when there is none".
    expect("outputManifestDigest" in doc).toBe(true)
    const { outputManifestDigest: _dropped, ...withoutOutput } = doc
    expect(validateRun(withoutOutput)).toBe(false)
    expect(why(validateRun)).toContain("outputManifestDigest")
  })

  it("validates a SUCCEEDED run with its manifest and counters", async () => {
    const store = await openStore()
    const runId = beginCompilerRun({ store, runType: "incremental", inputManifestDigest: MANIFEST, startedAt: T0 })
    concludeCompilerRun({
      store,
      runId,
      outputManifestDigest: OUTPUT,
      completedAt: T1,
      metrics: { ...emptyRunMetrics(), sourceRecordsRead: 25, subjectsCompiled: 25, recordsEmitted: 25 },
    })
    const doc = firstRun(store)
    expectValidRun(doc)
    expect(doc).toMatchObject({ state: "SUCCEEDED", outputManifestDigest: OUTPUT, completedAt: T1 })
    expect(doc.metrics.subjectsCompiled).toBe(25)
  })

  it("validates a PARTIAL run — 24 of 25 is a real conclusion", async () => {
    const store = await openStore()
    const runId = beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    concludeCompilerRun({
      store,
      runId,
      outputManifestDigest: OUTPUT,
      completedAt: T1,
      metrics: { ...emptyRunMetrics(), sourceRecordsRead: 25, subjectsCompiled: 24, failures: 1 },
    })
    const doc = firstRun(store)
    expectValidRun(doc)
    // The manifest is real for the 24 that compiled, which is why PARTIAL carries one and FAILED
    // does not.
    expect(doc).toMatchObject({ state: "PARTIAL", outputManifestDigest: OUTPUT })
  })

  it("validates a FAILED run with a null manifest", async () => {
    const store = await openStore()
    const runId = beginCompilerRun({ store, runType: "reconcile", inputManifestDigest: MANIFEST, startedAt: T0 })
    concludeCompilerRun({
      store,
      runId,
      outputManifestDigest: null,
      completedAt: T1,
      metrics: { ...emptyRunMetrics(), failures: 3 },
    })
    const doc = firstRun(store)
    // The nullability exists precisely so this document does not have to "force a lie (an
    // empty-string or all-zero digest) into the one place a later replay reads".
    expectValidRun(doc)
    expect(doc).toMatchObject({ state: "FAILED", outputManifestDigest: null })
  })

  it("validates a document for every runType the schema declares", async () => {
    const store = await openStore()
    const stamps = ["2026-08-04T00:00:00.000Z", T1, T2, "2026-08-04T00:20:00.000Z"]
    COMPILER_RUN_TYPES.forEach((runType, i) => {
      beginCompilerRun({ store, runType, inputManifestDigest: MANIFEST, startedAt: stamps[i]! })
    })
    const docs = runDocs(store)
    expect(docs).toHaveLength(COMPILER_RUN_TYPES.length)
    for (const doc of docs) expectValidRun(doc)
    expect(docs.map((d) => d.runType).sort()).toEqual([...COMPILER_RUN_TYPES].sort())
  })
})

describe("the closed sets are closed (controls #91, #92)", () => {
  it("refuses a document with an extra property", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [{ jobType: "compile-evidence", subjectKey: "io.test/a", inputDigest: D1 }], now: T0 })
    const doc = firstJob(store)
    expectValidJob(doc)
    // The closure is what stops the queue row from growing a field nobody audited.
    expect(validateJob({ ...doc, retryHint: "try again" })).toBe(false)
    expect(why(validateJob)).toContain("additional")
  })

  it("refuses a verdict inside metrics", async () => {
    const store = await openStore()
    const runId = beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    concludeCompilerRun({
      store,
      runId,
      outputManifestDigest: OUTPUT,
      completedAt: T1,
      metrics: emptyRunMetrics(),
    })
    const doc = firstRun(store)
    expectValidRun(doc)
    // Product Principle 4: deterministic rules decide verdicts, and a run report is not a rule. The
    // schema's closure is what makes that structural rather than a convention — and `assertRunMetrics`
    // refuses the same thing on the write path, so the two agree.
    expect(validateRun({ ...doc, metrics: { ...doc.metrics, verdict: "SAFE" } })).toBe(false)
    expect(validateRun({ ...doc, metrics: { ...doc.metrics, score: 42 } })).toBe(false)
    const { failures: _f, ...short } = doc.metrics
    expect(validateRun({ ...doc, metrics: short })).toBe(false)
  })

  it("refuses a document whose schema property was dropped (control #91)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [{ jobType: "compile-evidence", subjectKey: "io.test/a", inputDigest: D1 }], now: T0 })
    const row = store.listCompilerJobs()[0]!
    // NEITHER TABLE HAS A `schema` COLUMN, so this is what a structural cast in place of
    // `toCompilerJobDocument` produces: a value TypeScript is happy with, missing the property the
    // schema's `required` list names first.
    expect(validateJob(row)).toBe(false)
    expect(why(validateJob)).toContain("schema")
    // And the projection is the only difference between the two.
    expect(toCompilerJobDocument(row)).toEqual({ schema: COMPILER_JOB_SCHEMA, ...row })
    expectValidJob(toCompilerJobDocument(row))
  })

  it("refuses a run document whose schema property was dropped", async () => {
    const store = await openStore()
    beginCompilerRun({ store, runType: "dry-run", inputManifestDigest: MANIFEST, startedAt: T0 })
    const row = store.listCompilerRuns()[0]!
    expect(validateRun(row)).toBe(false)
    expectValidRun(toCompilerRunDocument(row))
  })

  it("copies metrics rather than sharing the row's object", async () => {
    const store = await openStore()
    beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    const row = store.listCompilerRuns()[0]!
    const doc = toCompilerRunDocument(row)
    doc.metrics.failures = 99
    // A shared reference would let a caller edit a document and move whatever else still holds the
    // row's counters. The copy is built from the frozen key list, so a seventh counter cannot enter
    // through a spread nothing enumerates.
    expect(row.metrics.failures).toBe(0)
    expect(Object.keys(doc.metrics).sort()).toEqual(Object.keys(row.metrics).sort())
  })
})
