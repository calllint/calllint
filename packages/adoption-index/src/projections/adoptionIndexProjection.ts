/**
 * `projectAdoptionIndex` — `calllint.adoption-index.v1`, the IDENTITY projection of the canonical
 * adoption records.
 *
 * WHY IDENTITY AND NOT VERDICT, stated first because it is the whole shape of this file. ADR 0061 §4:
 * "the Canonical Adoption Graph resolves *which subject this is*. It has no opinion about whether
 * that subject is safe" — and `computeVerdict` "is the only verdict engine, and no adapter, compiler,
 * graph query, page renderer, Agent Contract, or LLM may issue or modify a verdict". A verdict is
 * computed downstream from evidence, EVERY TIME, by that one engine. So this projection carries
 * addressing and provenance, and `FORBIDDEN_PROJECTION_FIELDS` below is the enumeration that keeps a
 * later edit from quietly adding a decision to it.
 *
 * That is not a hypothetical guard. Measured at R-7 over the committed corpus, all 19 records carry
 * `decision.verdict: "UNKNOWN"` (R-7 wired no decision port, deliberately). Letting a record's
 * verdict reach a served surface today would regress 19 real verdicts to UNKNOWN *and* move the
 * verdict authority off `computeVerdict` — product principles 4 and 5, in one edit.
 *
 * ~~The projection is driven by `adoption_records`; every entry names the record it came from.~~
 * INVERTED at R-8, kept because the wrong reading is what the batch was named after. Measured at
 * HEAD, four facts together:
 *
 *   1. NOTHING IN `src/` COMPILES A RECORD. `grep upsertAdoptionRecord|compileAdoptionRecord(` over
 *      every `packages/*&#47;src` hits one docblock sentence and no call. The only caller is
 *      `refresh-artifacts-e2e.test.ts` — a test.
 *   2. The production path stops one layer short. `trust-index/src/refreshSnapshot.ts`'s
 *      `refreshFromMirror` persists IDENTITY (`persistIdentity`: subjects, aliases, artifacts,
 *      conflicts) and never compiles a record.
 *   3. So the store is empty where records are concerned: the local `.var/` carries all ten tables
 *      with `adoption_records = 0`.
 *   4. And a record could not be honestly compiled here anyway. `decisionDigest` is NON-NULLABLE
 *      (`adoptionDigestSet.ts`: "UNKNOWN is a decision, and it is not SAFE") and
 *      `compileAdoptionRecord`'s own docblock names its one producer as `policy/decideOverAuthority`,
 *      which needs an `AuthorityManifest` + `Policy` — scan-pipeline products. `@calllint/trust-index`
 *      does not depend on `@calllint/policy`, and adding that edge to serve a page would put a second
 *      decision authority in the serving plane (INV-01).
 *
 * THEREFORE SUBJECTS DRIVE THIS PROJECTION AND A RECORD IS OPTIONAL. `subjects` has a real
 * production writer today, and `identityDigest` is R-3's pure `subjectIdentityDigest` — so identity
 * can be served honestly now, while `adoptionRecordDigest` fills itself in when the decision port
 * lands, with no schema change and no fabricated digest in a committed served artifact. Driving off
 * records instead would have made this file's output empty in production while green in tests.
 *
 * PURE, for the reason `projectSnapshot` is pure: no I/O, no clock, no database handle. The rows are
 * passed in, so the same rows produce byte-identical output on any machine. The bin at the edge
 * (`trust-index/src/projectAdoptionIndex.ts`) opens the database; this function only projects.
 *
 * THE SHAPE IS DUPLICATED, NOT IMPORTED — the same choice `snapshotProjection.ts` documents. The
 * consumer of this document lives in `@calllint/trust-index`, which already depends on this package;
 * importing its types back would put an edge from the canonical store into the serving plane.
 * Equivalence is proved BEHAVIOURALLY instead: a test drives the committed reader over a projected
 * document and asserts the join lands.
 */
import type { AdoptionLifecycleStatus } from "../domain/adoptionRecord.js"
import type { IdentityStatus } from "../domain/subject.js"
import type { StoredAdoptionRecord, StoredSubject } from "../storage/store.js"

/** The projection's schema id. Bumped, never redefined in place, if a field's meaning changes. */
export const ADOPTION_INDEX_SCHEMA = "calllint.adoption-index.v1"

/**
 * The EXACT field set one projected entry carries — frozen as a value, not just a type.
 *
 * A `type` is erased before anything runs, so a type alone cannot stop a field being added at
 * runtime; and the reason to freeze the POSITIVE set as well as the forbidden one is
 * [[optional-field-defeats-source-guards]]: a forbidden-name scan passes vacuously if a projection
 * quietly grows a differently-named field carrying the same information. The test asserts BOTH
 * directions — every key present, no key absent — plus a vacuity guard that the list is non-empty.
 */
export const ADOPTION_INDEX_ENTRY_FIELDS = [
  "subjectId",
  "canonicalName",
  "canonicalSlug",
  "identityStatus",
  "identityDigest",
  "lastSeenAt",
] as const

/**
 * The three fields an entry carries ONLY when a compiled record exists for that subject.
 *
 * Split from the required set rather than folded into it, because "absent because no record has been
 * compiled yet" and "absent because the projection dropped it" must not look the same to the test.
 * The frozen-set assertion is therefore two-sided: required ∪ (record ? record-fields : ∅), exactly.
 * Today every production subject takes the `∅` branch (see the docblock's fact 3); the fixtures cover
 * both branches so the record-bearing path is not untested code waiting on a future batch.
 */
export const ADOPTION_INDEX_RECORD_FIELDS = [
  "adoptionRecordDigest",
  "lifecycleStatus",
  "recordUpdatedAt",
] as const

/**
 * Field names this projection must NEVER carry, and why each one is named individually.
 *
 * `decision`, `verdict`, `decisionDigest`, `policyDigest` — ADR 0061 §4 / INV-01: the record has no
 * opinion about safety, and the served verdict comes from `computeVerdict` every time.
 * `evidence`, `evidenceDigest`, `findingCount` — the record's `evidence` is already a narrow PUBLIC
 * projection; re-projecting it here would make a second, unaudited evidence surface.
 * `recordJson` — the whole record as text would smuggle every one of the above through one key,
 * which is exactly the shape a name-only scan would otherwise miss.
 */
export const FORBIDDEN_PROJECTION_FIELDS = [
  "decision",
  "verdict",
  "decisionDigest",
  "policyDigest",
  "evidence",
  "evidenceDigest",
  "findingCount",
  "recordJson",
  "record_json",
] as const

/** One projected entry: addressing + provenance for a single canonical subject. */
export interface AdoptionIndexEntry {
  /** The subject's stable id — the identity layer's primary key. */
  subjectId: string
  /** The authoritative name (reverse-DNS registry form, e.g. `ac.inference.sh/mcp`). Never null. */
  canonicalName: string
  /**
   * The addressable slug, e.g. `mcp-registry/ac.inference.sh-mcp`.
   *
   * THIS IS THE JOIN KEY into the served `index.json`, and that was a measured correction: the plan
   * said join on `canonicalName`, but `index.json`'s own `canonicalName` field holds the SLUG
   * (`registryCanonicalName` produces it), while `StoredSubject.canonicalName` holds the raw
   * reverse-DNS name. Probed over the two committed files: raw name matched 0/19, slug matched
   * 19/19. Both fields are carried so a consumer can address by either and neither has to re-derive
   * the other; the join direction is recorded in `adoptionMap`.
   */
  canonicalSlug: string
  identityStatus: IdentityStatus
  /** R-3's `subjectIdentityDigest` — what the identity layer concluded, COPIED never recomputed. */
  identityDigest: string
  /** The subject row's `lastSeenAt`. Provenance for the identity, not a freshness claim. */
  lastSeenAt: string
  /**
   * R-7's `adoptionRecordDigest` — names the record this entry was projected from.
   *
   * OPTIONAL, and the optionality is measured rather than defensive: nothing in `src/` compiles a
   * record yet (the projection's docblock, fact 1), so in production this is absent on every entry
   * today. Absent — never null, never `""`: a subject with no compiled record has no record digest,
   * and a placeholder would let a consumer join on a value that names nothing.
   */
  adoptionRecordDigest?: string
  /** The record's lifecycle conclusion. Present exactly when `adoptionRecordDigest` is. */
  lifecycleStatus?: AdoptionLifecycleStatus
  /** The record row's `updatedAt`. Named apart from `lastSeenAt` so the two provenances cannot merge. */
  recordUpdatedAt?: string
}

/** The committed document. */
export interface AdoptionIndexDocument {
  schema: typeof ADOPTION_INDEX_SCHEMA
  /** ISO-8601 UTC, injected by the caller — never a wall-clock read here (INV-R6). */
  projectedAt: string
  count: number
  /** Sorted by `canonicalName` with a literal comparator, so the bytes are locale-independent. */
  entries: AdoptionIndexEntry[]
}

/** What one projection run is given. */
export interface ProjectAdoptionIndexOptions {
  /**
   * `store.listSubjects()` — THE DRIVING INPUT. Every entry is a subject; see the docblock for why
   * this is not `listAdoptionRecords()`.
   */
  subjects: readonly StoredSubject[]
  /**
   * `store.listAdoptionRecords()`, when any exist. Enriches a subject's entry with the record
   * fields; a subject with no record still gets an entry.
   *
   * Defaulted to empty rather than required, so the bin's honest "no records compiled yet" case is
   * the SAME code path a future record-bearing run takes, instead of a second branch that only the
   * empty case exercises.
   */
  records?: readonly StoredAdoptionRecord[]
  projectedAt: string
}

/**
 * Project the identity plane of every canonical subject. Pure.
 *
 * ONE SKIP RULE, and only one: a subject whose `canonicalSlug` is null is omitted. That is exactly
 * the `identity_status = 'CONFLICT'` case (`store.ts`'s `subjectSlugRow`: "an ADDRESS IS A PROPERTY
 * OF A CONCLUDED IDENTITY"), and emitting a substitute would advertise a page at a URL the identity
 * layer refused to conclude.
 *
 * A subject with no compiled record is NOT skipped — it is emitted without the three record fields.
 * That is the difference the R-8 inversion turned on: skipping it would have produced an empty
 * document in production, where `adoption_records` has no writer yet, while every fixture-driven test
 * stayed green. A record with no matching subject is dropped silently, since a record's identity is
 * the subject row and there is nothing to address it by.
 */
export function projectAdoptionIndex(opts: ProjectAdoptionIndexOptions): AdoptionIndexDocument {
  // Keyed by subject id. A subject with two records would be a store defect, not a shape this
  // projection reconciles — `adoption_records`'s primary key is the subject id, so the last write
  // wins in the table and this map mirrors that rather than inventing a merge.
  const recordBySubject = new Map((opts.records ?? []).map((r) => [r.subjectId, r]))
  const entries: AdoptionIndexEntry[] = []

  for (const subject of opts.subjects) {
    if (subject.canonicalSlug === null) continue
    const record = recordBySubject.get(subject.subjectId)
    entries.push({
      subjectId: subject.subjectId,
      canonicalName: subject.canonicalName,
      canonicalSlug: subject.canonicalSlug,
      identityStatus: subject.identityStatus,
      identityDigest: subject.identityDigest,
      lastSeenAt: subject.lastSeenAt,
      // Spread-or-nothing, so the three record fields are all present or all absent. Writing them
      // as `x: record?.y` would emit three `undefined`s, which `JSON.stringify` drops from the bytes
      // but `Object.keys` still reports — and the frozen-set assertion reads `Object.keys`.
      ...(record === undefined
        ? {}
        : {
            adoptionRecordDigest: record.adoptionRecordDigest,
            lifecycleStatus: record.lifecycleStatus,
            recordUpdatedAt: record.updatedAt,
          }),
    })
  }

  // The shipped comparator, character for character (`snapshotProjection.ts`). `localeCompare` would
  // order differently under some locales and make the committed bytes environment-dependent.
  entries.sort((a, b) => (a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0))

  return {
    schema: ADOPTION_INDEX_SCHEMA,
    projectedAt: opts.projectedAt,
    count: entries.length,
    entries,
  }
}

/**
 * Serialize to committed bytes. `count` is recomputed from the array so a hand-edited count cannot
 * survive a re-serialization, and the 2-space + trailing-newline shape is pinned here because it is
 * part of the contract the reproducibility gate diffs.
 */
export function serializeAdoptionIndex(doc: AdoptionIndexDocument): string {
  return JSON.stringify({ ...doc, count: doc.entries.length }, null, 2) + "\n"
}
