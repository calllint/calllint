/**
 * `calllint.adoption-record.v1` — THE canonical system asset (§7.1, ADR 0061).
 *
 * Every human page, agent contract, lookup entry and partner response is a PROJECTION of this
 * record. The record is the product; the pages are views of it. This file is the TYPE only —
 * `compileAdoptionRecord` builds one, `store.upsertAdoptionRecord` is its single writer.
 *
 * WHY THE TYPES ARE TRANSCRIBED RATHER THAN DERIVED. Every `required` list and every `enum` below
 * is copied field-for-field from `schemas/calllint.adoption-record.v1.schema.json`, which is the
 * normative source. A type generated from the schema at build time would be nicer to maintain and
 * strictly worse here: the schema is validated against the emitter's real output in
 * `tests/schema/schema-compatibility.test.ts`, so a transcription error surfaces as a red test,
 * whereas a generator would make the two agree by construction and validate nothing.
 *
 * TWO ENUMS ARE DELIBERATELY NOT REDEFINED. `identityStatus` and `artifactStatus` reuse
 * `IdentityStatus` and `ArtifactStatus` from `./subject.js`, whose members are verbatim-identical
 * to the schema's. Restating them here would create a second vocabulary that could drift from the
 * one the store's columns already use — the mistake R-6 avoided by scanning every existing status
 * column before adding an enum.
 *
 * `AdoptionLifecycleStatus` IS new, and is NOT a duplicate of `sources[].lifecycleStatus`. The
 * schema carries both in the same document, at different cases, on purpose:
 *
 *   - `sources[].lifecycleStatus` is LOWERCASE `active|deprecated|deleted|unknown` — what a source
 *     says about itself, mirrored unchanged. Reused from `./sourceRecord.js` (`SourceLifecycleStatus`),
 *     whose members are verbatim-identical to the schema's, for the same reason as the two above.
 *   - `lifecycle.status` is UPPERCASE `ACTIVE|DEPRECATED|WITHDRAWN|TOMBSTONED` — what WE concluded
 *     across every source. `WITHDRAWN` has no lowercase counterpart because no registry reports it;
 *     it is a conclusion drawn from a record's disappearance, which is exactly why the two layers
 *     cannot share one enum.
 *
 * INV-10's seven terminal states are NOT here, and this is not an omission. Measurement of this
 * schema found five distinct status vocabularies (`identityStatus` 4, `artifactStatus` 5,
 * `sources[].lifecycleStatus` 4 lowercase, `lifecycle.status` 4 uppercase, `decision.verdict` 4)
 * and none of them is the seven. `adrs/0061` §8 puts the seven in a GENERALIZED
 * `packages/evidence/src/model/stateMachine.ts`, not in this record. See `./jobStates.ts`, whose
 * forward pointer this batch inverts in place.
 */
import { hashJson } from "@calllint/fingerprint"
import type { SourceLifecycleStatus } from "./sourceRecord.js"
import type { ArtifactStatus, IdentityStatus } from "./subject.js"

/** The schema id this module emits. A `const` in the schema, so a literal here. */
export const ADOPTION_RECORD_SCHEMA = "calllint.adoption-record.v1" as const

/**
 * Our compiled conclusion about a subject's life, distinct from what any source claims.
 *
 * Frozen and exported as a value, not only as a type, because `adoption_records.lifecycle_status`
 * is a bare `TEXT NOT NULL` with NO CHECK constraint (`001-canonical-adoption-graph.sql`) and
 * TypeScript is erased before SQLite ever sees the write. Closure therefore has to be asserted on
 * the write path against a runtime list — same conclusion R-6 reached for `compiler_jobs.state`.
 */
export const ADOPTION_LIFECYCLE_STATUSES = Object.freeze([
  "ACTIVE",
  "DEPRECATED",
  "WITHDRAWN",
  "TOMBSTONED",
] as const)

export type AdoptionLifecycleStatus = (typeof ADOPTION_LIFECYCLE_STATUSES)[number]

/** Runtime membership test for `lifecycle_status`, for the write path the DDL does not guard. */
export function isAdoptionLifecycleStatus(value: unknown): value is AdoptionLifecycleStatus {
  return (
    typeof value === "string" &&
    (ADOPTION_LIFECYCLE_STATUSES as readonly string[]).includes(value)
  )
}

/** The verdict vocabulary, restated as the schema's closed enum for the public record. */
export type AdoptionVerdict = "SAFE" | "REVIEW" | "BLOCK" | "UNKNOWN"

/** Host support tier (`packages/types/src/installPlan.ts` uses the same three). */
export type HostTier = "A" | "B" | "C"

/**
 * The route a host offers for this subject.
 *
 * Structurally identical to `trust-index`'s `Installability`, and NOT imported from it: the
 * dependency runs `trust-index → adoption-index`, so importing back would invert it and make the
 * record depend on a projection of itself. The compatibility of the two is asserted by a test
 * instead of by a shared declaration.
 */
export type HostInstallability =
  | "PREPARE_AVAILABLE"
  | "REVIEW_REQUIRED"
  | "BLOCKED"
  | "LOCAL_PREFLIGHT_REQUIRED"
  | "UNSUPPORTED"

/** `subject` — identity, as resolved by R-3. */
export interface AdoptionRecordSubject {
  subjectId: string
  canonicalName: string
  canonicalSlug: string
  displayName: string
  identityStatus: IdentityStatus
}

/** `selectedArtifact` — the one version this record is about. `null` when none resolved. */
export interface AdoptionRecordArtifact {
  artifactVersionId: string
  packageType: string
  packageIdentifier: string
  version: string | null
  artifactStatus: ArtifactStatus
}

/** One `sources[]` entry: which record from which source, and what it claimed. */
export interface AdoptionRecordSource {
  sourceId: string
  sourceRecordId: string
  retrievedAt: string
  lifecycleStatus: SourceLifecycleStatus
}

/**
 * `evidence` — a PUBLIC PROJECTION, in the schema's own words "never the raw evidence bundle".
 *
 * Exactly four fields, and `additionalProperties: false` in the schema, so a caller cannot widen
 * it by passing the findings array through. The count is published; the findings are not.
 */
export interface AdoptionRecordEvidence {
  evidenceDigest: string
  engineVersion: string
  policyDigest: string
  findingCount: number
}

/**
 * `decision` — the three fields of `TrustDecision` that are public.
 *
 * All three are COPIED from a `TrustDecision` produced by `decideOverAuthority`, never recomputed.
 * Recomputing `decisionDigest` here would make this file a second, unaudited place where a security
 * decision is made, which product principles 4 and 5 forbid.
 *
 * TODAY EVERY WRITTEN RECORD CARRIES `verdict: "UNKNOWN"` — 19/19, measured — and that is an HONEST
 * value, not a placeholder awaiting a function (S-1). R-7 wired this table with no decision port;
 * S-1 measured what a real one would produce over the SAME committed 19-entry corpus and found no
 * agreement to copy:
 *
 *   `decideOverAuthority` + `defaultPolicy()`         →  BLOCK 19
 *   `decideOverAuthority` + `adoptionBasisPolicy()`   →  BLOCK 17 / REVIEW 2
 *   what the public tree serves today (`computeVerdict` + committed evidence)
 *                                                     →  REVIEW 17 / SAFE 2
 *
 * 19/19 disagree with the served tree, and the BLOCK is a genuine policy floor rather than a
 * fail-closed degradation (`completeness` is `complete` 19/19, `unknowns: []`): 17 entries are
 * remote-only → `UNKNOWN_REMOTE` → `unknownSource: "deny"` in BOTH policies. Copying either one into
 * this field would publish a BLOCK about 17 third parties under a policy whose four documented
 * arguments are all about the `npx -y pkg@ver` package-install shape — never about remote.
 *
 * So `UNKNOWN` here reads exactly as the contract intends ("UNKNOWN is not SAFE", principle 2): the
 * verdict could not be established, and saying so is the correct record. What unblocks it is a
 * product judgement about which policy adjudicates remote-only adoption, not this file. See
 * `operations/compileEvidence.ts`, which carries the same table with the same measurement.
 */
export interface AdoptionRecordDecision {
  verdict: AdoptionVerdict
  decisionDigest: string
  policyDigest: string
}

/** One `hostCompatibility[]` row. */
export interface AdoptionRecordHostCompatibility {
  host: string
  tier: HostTier
  installability: HostInstallability
}

/** `lifecycle` — our conclusion plus the window it was observed over. */
export interface AdoptionRecordLifecycle {
  status: AdoptionLifecycleStatus
  firstSeenAt: string
  lastSeenAt: string
}

/**
 * `digests` — the 8-field AdoptionDigestSet. Order encodes the dependency chain; the constraints
 * that make that order checkable live in `./adoptionDigestSet.ts`.
 */
export interface AdoptionRecordDigests {
  sourcePayloadDigest: string
  identityDigest: string
  artifactDigest: string | null
  evidenceDigest: string | null
  decisionDigest: string
  semanticContractDigest: string | null
  presentationDigest: string
  /** The only non-required member of the set: a page may not have been baked yet. */
  pageDigest?: string
}

/** One adoption record. `additionalProperties: false` in the schema, so this list is exhaustive. */
export interface AdoptionRecordV1 {
  schema: typeof ADOPTION_RECORD_SCHEMA
  subject: AdoptionRecordSubject
  selectedArtifact: AdoptionRecordArtifact | null
  sources: readonly AdoptionRecordSource[]
  evidence: AdoptionRecordEvidence | null
  decision: AdoptionRecordDecision
  hostCompatibility: readonly AdoptionRecordHostCompatibility[]
  lifecycle: AdoptionRecordLifecycle
  digests: AdoptionRecordDigests
}

/**
 * `adoption_record_digest` — sha256 over the whole record.
 *
 * Uses the shipped `hashJson`, whose `stableStringify` sorts keys, so the digest is invariant under
 * field reordering and a re-serialization cannot move it. Never a hand-rolled hash: the digest of
 * THE canonical asset must be computed by the same primitive as every other digest in the chain,
 * or two records that are the same record would carry different names.
 */
export function adoptionRecordDigest(record: AdoptionRecordV1): string {
  return hashJson(record)
}
