/**
 * job — the two compiler documents (§7.1, §10.2, ADR 0061), written by R-6.
 *
 * `calllint.compiler-job.v1` is ONE UNIT OF PENDING WORK; `calllint.compiler-run.v1` is ONE
 * EXECUTION of the compiler. Every field below is transcribed from the committed schema's
 * `required` list and `enum` members — not designed here. Both schemas are
 * `additionalProperties: false`, so an invented field would make every document invalid, and both
 * have shipped since R-1 with the canonical DDL.
 *
 * WHERE THE DOCUMENT AND THE ROW DIVERGE, measured against `migrations/001:111-138` rather than
 * assumed — the same discipline `subject.ts` applies to the identity layer:
 *
 *   - `compiler_jobs` and `calllint.compiler-job.v1` agree column-for-property, all 14. The only
 *     translation is snake_case ⇄ camelCase, done in `store.ts`.
 *   - `compiler_runs.metrics_json` is one TEXT column; the document's `metrics` is a closed object
 *     of six integers. `serializeRunMetrics` is the only translation, and it is deterministic in
 *     field order for the same reason `evidenceDocument.ts` serializes in a fixed order: a column a
 *     digest is ever taken over cannot depend on key iteration order.
 *   - Neither schema declares a `schema` COLUMN, so `schema` is a document-only property. The
 *     store writes rows; `toCompilerJobDocument` is what produces a validatable document from one.
 *
 * `outputManifestDigest` IS IN `required` AND IS NULLABLE, and that asymmetry is load-bearing
 * enough that the schema's own description argues it: "a run that crashed produced no output, and a
 * schema that required both would force a lie (an empty-string or all-zero digest) into the one
 * place a later replay reads". So the type is `string | null` and the property is never optional —
 * a crashed run writes an explicit `null`, and control #87 supplies an all-zero digest instead.
 *
 * NO WALL CLOCK. Every timestamp here is a parameter (INV-R6, §9.5). This module has no `Date`
 * import and derives no time; `availableAt` is the caller's computed backoff, and `jobId` is a
 * digest over the identity triple, never over a clock read.
 */
import { hashJson } from "@calllint/fingerprint"

export const COMPILER_JOB_SCHEMA = "calllint.compiler-job.v1" as const
export const COMPILER_RUN_SCHEMA = "calllint.compiler-run.v1" as const

/**
 * The queue lifecycle. Five members, transcribed from the schema's `state` enum.
 *
 * See `jobStates.ts` for which layer this is and which five vocabularies it is not. `FAILED` and
 * `DEAD_LETTER` are terminal by the schema's own words, and the difference between them is
 * intent: `FAILED` is a job the compiler decided not to retry, `DEAD_LETTER` is one that exhausted
 * its attempts. Both need a human and a new row; keeping them distinct is what lets a reader tell a
 * refusal apart from an exhaustion without reading `lastErrorCode`.
 */
export type CompilerJobState = "PENDING" | "LEASED" | "SUCCEEDED" | "FAILED" | "DEAD_LETTER"

/**
 * The seven kinds of compiler work, transcribed from the schema's `jobType` enum in its order.
 *
 * Note what this enumeration is: the compiler's PIPELINE, one entry per stage, and four of the seven
 * name work that already ships as an operation (`syncSource`, `resolveIdentity`, `resolveArtifacts`,
 * `compileEvidence`). R-6 builds the queue that can hold them; it does not re-implement any stage,
 * and wiring the stages to consume from it is later work. Enumerating all seven now rather than the
 * four with implementations is deliberate — the set is fixed by a committed schema, and a partial
 * transcription would read as a design decision this batch is not entitled to make.
 */
export type CompilerJobType =
  | "ingest-source"
  | "resolve-identity"
  | "resolve-artifact"
  | "compile-evidence"
  | "compile-decision"
  | "compile-presentation"
  | "emit-projection"

/** Frozen so a caller cannot widen the set at runtime; the arrangement `subject.ts` uses. */
export const COMPILER_JOB_STATES: readonly CompilerJobState[] = Object.freeze([
  "PENDING",
  "LEASED",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTER",
])

export const COMPILER_JOB_TYPES: readonly CompilerJobType[] = Object.freeze([
  "ingest-source",
  "resolve-identity",
  "resolve-artifact",
  "compile-evidence",
  "compile-decision",
  "compile-presentation",
  "emit-projection",
])

/**
 * How a whole compiler pass ended. Four members, transcribed from the schema's `state` enum.
 *
 * `PARTIAL` is distinct from `SUCCEEDED` because "a run that compiled 24 of 25 subjects is not a
 * success, and grading it as one would let a projection ship over an incomplete index" (the
 * schema's description). It is TERMINAL here, unlike the identically-spelled `ResolutionState`
 * member, which is re-queueable — see `jobStates.ts`.
 */
export type CompilerRunState = "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED"

/** The four run kinds, transcribed from the schema's `runType` enum. */
export type CompilerRunType = "full" | "incremental" | "reconcile" | "dry-run"

export const COMPILER_RUN_STATES: readonly CompilerRunState[] = Object.freeze([
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
])

export const COMPILER_RUN_TYPES: readonly CompilerRunType[] = Object.freeze([
  "full",
  "incremental",
  "reconcile",
  "dry-run",
])

/**
 * One `compiler_jobs` document.
 *
 * `leaseOwner` and `leaseExpiresAt` are nullable TOGETHER and populated only while `LEASED` — the
 * schema states it and `assertLeaseCoherent` enforces it, because a half-set lease is either a row
 * held forever (owner without expiry) or a claim nobody made (expiry without owner).
 */
export interface CompilerJobV1 {
  schema: typeof COMPILER_JOB_SCHEMA
  /** `hashJson` over the identity triple — see `compilerJobId`. Never random. */
  jobId: string
  jobType: CompilerJobType
  /** The subject this work is about. `canonicalName`, never the lossy slug (`subject.ts:82`). */
  subjectKey: string
  /** `sha256:<hex>` over whatever the stage consumes. Part of the identity triple. */
  inputDigest: string
  state: CompilerJobState
  /** Lower runs first. `>= 0` per the schema; the DDL defaults it to 100. */
  priority: number
  /** How many leases this row has been handed out under. `>= 0`. */
  attemptCount: number
  /** Injected ISO-8601. The caller's computed backoff, never a clock read here (INV-R6). */
  availableAt: string
  leaseOwner: string | null
  leaseExpiresAt: string | null
  lastErrorCode: string | null
  /** `sha256:<hex>` into the CAS. The error BYTES are content-addressed, never inlined. */
  lastErrorDigest: string | null
  createdAt: string
  updatedAt: string
}

/**
 * The six counters of `metrics`. Closed and numeric-only, transcribed from the schema, which
 * argues the closure itself: "no verdict, no score, no free-form prose — so a run report can never
 * become a second, unaudited place where a decision is made". Product Principle 4 is the reason
 * that matters: deterministic rules decide verdicts, and a run report is not a rule.
 */
export interface CompilerRunMetrics {
  sourceRecordsRead: number
  subjectsCompiled: number
  artifactsResolved: number
  evidenceCompiled: number
  recordsEmitted: number
  failures: number
}

/** The metric field names, in the schema's `required` order. The closed set, frozen. */
export const COMPILER_RUN_METRIC_KEYS: readonly (keyof CompilerRunMetrics)[] = Object.freeze([
  "sourceRecordsRead",
  "subjectsCompiled",
  "artifactsResolved",
  "evidenceCompiled",
  "recordsEmitted",
  "failures",
])

/** A run with every counter at zero — what `beginCompilerRun` records before any work. */
export function emptyRunMetrics(): CompilerRunMetrics {
  return {
    sourceRecordsRead: 0,
    subjectsCompiled: 0,
    artifactsResolved: 0,
    evidenceCompiled: 0,
    recordsEmitted: 0,
    failures: 0,
  }
}

/** One `compiler_runs` document. */
export interface CompilerRunV1 {
  schema: typeof COMPILER_RUN_SCHEMA
  runId: string
  runType: CompilerRunType
  inputManifestDigest: string
  /** `null` while `RUNNING` and for a crashed run. REQUIRED to be present — see the docblock. */
  outputManifestDigest: string | null
  state: CompilerRunState
  startedAt: string
  completedAt: string | null
  metrics: CompilerRunMetrics
}

/**
 * Project one stored row into a validatable `calllint.compiler-job.v1` document.
 *
 * THE ONLY THING THIS ADDS IS `schema`, and that is why it exists rather than being a cast. Neither
 * table declares a `schema` COLUMN — a per-row copy of a constant would be 14 bytes of redundancy in
 * every row and a second place for the version to drift — so the document form is PRODUCED, and this
 * is the one place that produces it. A structural cast would compile identically today and silently
 * omit the property the schema's `required` list names first.
 *
 * The row's field names already match the schema's properties one-for-one (`store.ts` does the
 * snake_case ⇄ camelCase translation on read), so there is nothing else to map. That correspondence
 * is asserted rather than assumed: `job-schema.test.ts` validates the output of this function against
 * the committed schema, whose `additionalProperties: false` refuses an extra key and whose `required`
 * refuses a missing one.
 *
 * `Omit<CompilerJobV1, "schema">` as the parameter type rather than `StoredCompilerJob`, so this
 * module stays free of a storage import — the domain layer describes documents, and a row that
 * happens to have the same shape is the storage layer's business.
 */
export function toCompilerJobDocument(row: Omit<CompilerJobV1, "schema">): CompilerJobV1 {
  return { schema: COMPILER_JOB_SCHEMA, ...row }
}

/**
 * Project one stored run into a validatable `calllint.compiler-run.v1` document.
 *
 * `metrics` is COPIED rather than shared, so a caller cannot mutate a document's counters and have
 * the change reach whatever the row's object is still referenced by. The copy is built from
 * `COMPILER_RUN_METRIC_KEYS` for the reason `serializeRunMetrics` is: one definition of the closed
 * set, so a seventh counter cannot enter through a spread that nothing enumerates.
 */
export function toCompilerRunDocument(row: Omit<CompilerRunV1, "schema">): CompilerRunV1 {
  const metrics = {} as CompilerRunMetrics
  for (const key of COMPILER_RUN_METRIC_KEYS) metrics[key] = row.metrics[key]
  return { schema: COMPILER_RUN_SCHEMA, ...row, metrics }
}

/**
 * The stable id for one job: a digest over the canonical UNIQUE triple.
 *
 * `(job_type, subject_key, input_digest)` is `migrations/001:137`'s UNIQUE constraint verbatim, and
 * the schema's description names the same three as the idempotency key: "re-enqueueing unchanged
 * inputs updates the existing row instead of growing the queue". Deriving the PRIMARY KEY from the
 * UNIQUE triple makes those two constraints the same constraint, so one upsert satisfies both and no
 * row can exist that is unique by one and duplicated by the other.
 *
 * `hashJson` over a NAMED object, never a concatenated string — the arrangement
 * `evidenceDigest.ts` and `sourceRecordRowId` use. A join would make `("a-b", "c")` and `("a",
 * "b-c")` the same key; `hashJson` sorts keys, so the field names are part of what is hashed.
 *
 * `attemptCount`, `priority` and every timestamp are DELIBERATELY EXCLUDED. They are mutable
 * properties of a row whose identity must not move when they do — including `availableAt`, which a
 * re-enqueue is explicitly allowed to advance. Including any of them would give every re-enqueue a
 * fresh key and turn the queue into an append-only log, which is exactly the growth the schema
 * forbids.
 */
export function compilerJobId(jobType: CompilerJobType, subjectKey: string, inputDigest: string): string {
  return hashJson({ jobType, subjectKey, inputDigest })
}

/**
 * The stable id for one run: a digest over what makes a run distinguishable.
 *
 * `startedAt` is INCLUDED here, unlike in `compilerJobId`, and the asymmetry is the point. A job is
 * a unit of work identified by its inputs — the same inputs are the same job. A run is an EVENT, and
 * two passes over an unchanged corpus are two runs whose records must both survive; keying on the
 * input manifest alone would make the second silently replace the first and destroy the history the
 * table exists to keep. `startedAt` is injected, so this stays reproducible: replaying a run with
 * the same stamp yields the same id.
 */
export function compilerRunId(runType: CompilerRunType, inputManifestDigest: string, startedAt: string): string {
  return hashJson({ runType, inputManifestDigest, startedAt })
}

/**
 * Serialize `metrics` for `compiler_runs.metrics_json`.
 *
 * Fixed field order, compact, no indentation — the arrangement `evidenceDocument.ts` uses, because
 * a column that is ever digested or byte-compared must not depend on key iteration order.
 * `COMPILER_RUN_METRIC_KEYS` supplies the order, so the serializer and the closed set cannot drift.
 */
export function serializeRunMetrics(metrics: CompilerRunMetrics): string {
  const ordered: Record<string, number> = {}
  for (const key of COMPILER_RUN_METRIC_KEYS) ordered[key] = metrics[key]
  return JSON.stringify(ordered)
}

/**
 * Parse `metrics_json` back, refusing anything that is not the closed numeric set.
 *
 * Validated on the way OUT as well as in, because the column is TEXT: a row written by a future
 * caller that skipped `assertRunMetrics` would otherwise be read back as a `CompilerRunMetrics` the
 * type system believes in. `additionalProperties: false` in the schema is only checkable if
 * something checks it.
 */
export function parseRunMetrics(json: string, runId: string): CompilerRunMetrics {
  const parsed: unknown = JSON.parse(json)
  assertRunMetrics(parsed, runId)
  return parsed
}

/**
 * Throw unless `value` is exactly the six required counters, all non-negative integers, and
 * nothing else.
 *
 * THE CLOSURE IS THE ASSERTION, not the six presence checks. `metrics` is `additionalProperties:
 * false` for a stated reason — it must never become "a second, unaudited place where a decision is
 * made" — and a verdict, a score, or a prose note would arrive as an EXTRA key, which presence
 * checks cannot see. Control #84 adds `verdict: "SAFE"` and control #85 adds a non-numeric counter.
 *
 * Non-negative INTEGERS specifically: the schema says `"type": "integer", "minimum": 0`, so `-1`,
 * `1.5` and `NaN` are all outside it. A count that can be fractional is not a count.
 */
export function assertRunMetrics(value: unknown, runId: string): asserts value is CompilerRunMetrics {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`run "${runId}": metrics must be an object, found ${describe(value)}`)
  }
  const keys = Object.keys(value).sort()
  const expected = [...COMPILER_RUN_METRIC_KEYS].sort()
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    throw new Error(
      `run "${runId}": metrics must declare exactly [${expected.join(", ")}], found [${keys.join(", ")}]`,
    )
  }
  for (const key of COMPILER_RUN_METRIC_KEYS) {
    const n = (value as Record<string, unknown>)[key]
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new Error(`run "${runId}": metrics.${key} must be a non-negative integer, found ${describe(n)}`)
    }
  }
}

/**
 * Throw unless the lease pair is coherent with the state.
 *
 * The schema's rule, verbatim: `leaseOwner`/`leaseExpiresAt` "are nullable together and only
 * populated while `LEASED`". That is TWO rules, and both fail in a way worth naming separately:
 *
 *   - A HALF-SET pair is either a row held by an owner that never expires (owner, no expiry) or a
 *     claim nobody made (expiry, no owner). The first is the "permanently-held row" the schema
 *     exists to prevent; the second makes `reclaimExpiredLeases` release a job no worker holds.
 *   - A lease on a NON-`LEASED` row is a claim on work that is already finished or still waiting.
 *     A terminal row carrying an owner would be reclaimed forever by an expiry sweep.
 *
 * Checked on the write path rather than only in the type checker, because `lease_owner` and
 * `lease_expires_at` are two independently-nullable TEXT columns and the DDL relates them not at
 * all. Controls #88 and #89 are the two halves.
 */
export function assertLeaseCoherent(
  state: CompilerJobState,
  leaseOwner: string | null,
  leaseExpiresAt: string | null,
  jobId: string,
): void {
  if ((leaseOwner === null) !== (leaseExpiresAt === null)) {
    throw new Error(
      `job "${jobId}": leaseOwner and leaseExpiresAt are nullable together, found owner=${describe(leaseOwner)} expiresAt=${describe(leaseExpiresAt)}`,
    )
  }
  if (state !== "LEASED" && leaseOwner !== null) {
    throw new Error(`job "${jobId}": a lease is only held while LEASED, found state=${state} with leaseOwner set`)
  }
  if (state === "LEASED" && leaseOwner === null) {
    throw new Error(`job "${jobId}": state is LEASED with no leaseOwner — a lease is a claim by someone`)
  }
}

/** `sha256:<hex>`, the repo's digest convention and both schemas' `pattern`. */
const DIGEST = /^sha256:[0-9a-f]{64}$/

/**
 * Throw unless `digest` matches `sha256:<64 hex>`.
 *
 * Both schemas constrain every digest property with this `pattern`, and nothing in SQLite or in
 * TypeScript enforces a string's shape. The all-zero digest control (#87) is refused by the
 * NULLABILITY rule rather than by this one — `sha256:000…0` is a well-formed digest of nothing —
 * so the two checks are separate and both are needed.
 */
export function assertDigestShape(digest: string, field: string, id: string): void {
  if (!DIGEST.test(digest)) {
    throw new Error(`"${id}": ${field} must match sha256:<64 hex>, found ${JSON.stringify(digest)}`)
  }
}

/** A value described for an error message, without stringifying something enormous. */
function describe(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "object") return Array.isArray(value) ? "an array" : "an object"
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)
  return String(value)
}
