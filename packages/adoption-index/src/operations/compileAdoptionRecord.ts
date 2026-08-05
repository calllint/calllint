/**
 * `compileAdoptionRecord` — the projection that turns five tables' rows into THE canonical asset.
 *
 * PURE, and the purity is the point. No I/O, no clock, no database handle: every input is passed in,
 * so the same inputs produce a deep-equal record on any machine at any time. `updated_at` is the
 * caller's injected `now`, never a wall-clock read here — the same rule R-6 held for `availableAt`
 * (INV-R6, §9.5). The single writer is `store.upsertAdoptionRecord`; this function only builds.
 *
 * WHY EVERY DIGEST IS AN INPUT AND NONE IS COMPUTED HERE. All eight already have exactly one
 * producer, measured at HEAD:
 *
 *   sourcePayloadDigest     `source_records.payload_digest`   (R-1, mirrored from the source)
 *   identityDigest          `subjects.identity_digest`        (R-3, `subjectIdentityDigest`)
 *   artifactDigest          `artifact_versions`               (R-4)
 *   evidenceDigest          `evidence_records`                (R-5, `evidenceDigest()`)
 *   decisionDigest          `TrustDecision.digest`            (`policy/decideOverAuthority`)
 *   semanticContractDigest  `semanticContractDigest()`        (`trust-index/safe-install`)
 *   presentationDigest      `presentationDigest()`            (`trust-index/safe-install`)
 *   pageDigest              `bakeTrustPage`                   (`trust-index`)
 *
 * Recomputing any of them here would create a second producer of a value that is supposed to have
 * one, and for `decisionDigest` it would be worse than untidy: it would be a second, unaudited place
 * where a security decision is made, which product principles 4 and 5 forbid outright. So this file
 * COPIES. A negative control recomputes `decisionDigest` from the record's own fields and must fail.
 *
 * THE DEPENDENCY RUNS trust-index → adoption-index, AND THIS FILE DOES NOT INVERT IT.
 * `presentationDigest` and `semanticContractDigest` live in `@calllint/trust-index`, which already
 * depends on this package (`refreshSnapshot.ts:92`). Importing them back would make the canonical
 * record depend on a projection of itself. They arrive as `PresentationInputs` instead — the caller
 * that has both packages does the wiring. Likewise `hostCompatibility`: the verdict→route mapping is
 * `trust-index`'s `toInstallability`, so the rows are passed in rather than derived here.
 */
import {
  ADOPTION_LIFECYCLE_STATUSES,
  ADOPTION_RECORD_SCHEMA,
  adoptionRecordDigest,
  isAdoptionLifecycleStatus,
  type AdoptionLifecycleStatus,
  type AdoptionRecordDigests,
  type AdoptionRecordEvidence,
  type AdoptionRecordHostCompatibility,
  type AdoptionRecordSource,
  type AdoptionRecordV1,
} from "../domain/adoptionRecord.js"
import { assertDigestChain } from "../domain/adoptionDigestSet.js"
import type { SourceRecordV1 } from "../domain/sourceRecord.js"
import type {
  StoredArtifactVersion,
  StoredEvidenceRecord,
  StoredSubject,
} from "../storage/store.js"

/**
 * The two digests produced in `@calllint/trust-index`, injected rather than imported.
 *
 * `presentationDigest` is required because the schema requires it: there is always a presentation
 * document, even when it is the canonical EMPTY one (`emptyPresentationDigest()` exists for exactly
 * this — "the honest digest of 'there is no content plane yet'", never a null).
 */
export interface PresentationInputs {
  /** `presentationDigest(doc).presentationDigest`. Required by the schema. */
  presentationDigest: string
  /** `semanticContractDigest(contract).semanticContractDigest`, or null when none is sealed yet. */
  semanticContractDigest: string | null
  /** `bakeTrustPage`'s digest, when a page has been baked. Optional in the schema. */
  pageDigest?: string
}

/**
 * The three PUBLIC fields of a `TrustDecision`, plus the digest, exactly as produced.
 *
 * Typed structurally rather than as `TrustDecision` so a caller can pass a decision read back from
 * storage without reconstructing the whole sealed object — and so this package does not have to
 * depend on `@calllint/policy`, which it currently does not.
 */
export interface DecisionInputs {
  verdict: "SAFE" | "REVIEW" | "BLOCK" | "UNKNOWN"
  /** `TrustDecision.digest`. COPIED, never recomputed. */
  decisionDigest: string
  /** `TrustDecision.policyDigest`. */
  policyDigest: string
}

/** Everything one record is compiled from. */
export interface CompileAdoptionRecordInput {
  /** The `subjects` row. Supplies identity and `identityDigest`. */
  subject: StoredSubject
  /**
   * The chosen `artifact_versions` row, or null when none resolved.
   *
   * When null, `digests.artifactDigest` and `digests.evidenceDigest` are both null and the record
   * still carries a decision — see `assertDigestChain`.
   */
  selectedArtifact: StoredArtifactVersion | null
  /**
   * The latest `source_records` payloads for this subject, in the order the caller resolved them.
   *
   * Sorted here by `(sourceId, sourceRecordId)` so two runs over the same rows produce a
   * byte-identical record regardless of row order — the same reason `observationDigest` sorts by
   * path. `sourcePayloadDigest` is taken from the FIRST after sorting, so it too is order-stable.
   */
  sourcePayloads: readonly SourceRecordV1[]
  /** The `evidence_records` row for the selected artifact, or null when nothing is graded. */
  evidence: StoredEvidenceRecord | null
  /** How many findings that evidence carries. Published as a count; the findings are not. */
  findingCount: number | null
  decision: DecisionInputs
  presentation: PresentationInputs
  hostCompatibility: readonly AdoptionRecordHostCompatibility[]
  /** Our compiled conclusion about the subject's life. */
  lifecycleStatus: AdoptionLifecycleStatus
}

/** Build one `calllint.adoption-record.v1`. Throws when the inputs cannot make a valid record. */
export function compileAdoptionRecord(input: CompileAdoptionRecordInput): AdoptionRecordV1 {
  const { subject, selectedArtifact, evidence } = input

  // `canonicalSlug` is nullable in the row (null for a CONFLICT subject) but `minLength: 1` and
  // required in the schema. Refuse rather than substitute: a record addressed by a slug we do not
  // have would publish a page at a URL that is not this subject's.
  if (subject.canonicalSlug === null) {
    throw new Error(
      `compileAdoptionRecord: subject ${subject.subjectId} has no canonicalSlug (identityStatus=${subject.identityStatus}); the schema requires one, and a CONFLICT subject has no addressable page`,
    )
  }

  if (!isAdoptionLifecycleStatus(input.lifecycleStatus)) {
    // The vocabulary is JOINED from the frozen set, never spelled out. Measured while running control
    // (i): with the four written as a literal here, removing `WITHDRAWN` from the frozen set left this
    // message still advertising it as valid, and the test that reads the message stayed green — the
    // refusal and the thing it refuses on behalf of had drifted apart. `store.ts` already derived both
    // of its messages this way; this was the one place that did not.
    throw new Error(
      `compileAdoptionRecord: lifecycleStatus ${JSON.stringify(input.lifecycleStatus)} is not one of ${ADOPTION_LIFECYCLE_STATUSES.join("|")}`,
    )
  }

  if (input.sourcePayloads.length === 0) {
    throw new Error(
      `compileAdoptionRecord: subject ${subject.subjectId} has no source payloads; sourcePayloadDigest is a chain ROOT and cannot be synthesized`,
    )
  }

  const sorted = [...input.sourcePayloads].sort((a, b) => {
    if (a.source.sourceId !== b.source.sourceId) {
      return a.source.sourceId < b.source.sourceId ? -1 : 1
    }
    return a.source.sourceRecordId < b.source.sourceRecordId ? -1 : 1
  })

  const sources: AdoptionRecordSource[] = sorted.map((p) => ({
    sourceId: p.source.sourceId,
    sourceRecordId: p.source.sourceRecordId,
    retrievedAt: p.source.retrievedAt,
    lifecycleStatus: p.lifecycle.status,
  }))

  // `evidence` is a PUBLIC projection: exactly the schema's four fields. The evidence document's
  // `findings` array is NOT reachable from here — `StoredEvidenceRecord` carries it only as an
  // opaque `evidenceJson` string, and nothing below parses it. Control (f) tries to widen this.
  const evidenceProjection: AdoptionRecordEvidence | null =
    evidence === null
      ? null
      : {
          evidenceDigest: evidence.evidenceDigest,
          engineVersion: evidence.engineVersion,
          policyDigest: evidence.policyDigest,
          findingCount: input.findingCount ?? 0,
        }

  const digests: AdoptionRecordDigests = {
    sourcePayloadDigest: sorted[0]!.source.payloadDigest,
    identityDigest: subject.identityDigest,
    // The artifact's digest is its IMMUTABLE digest — the verified bytes — not its row id. A row
    // exists as soon as the version is known; the digest exists only once the bytes are pinned.
    artifactDigest: selectedArtifact?.immutableDigest ?? null,
    evidenceDigest: evidence?.evidenceDigest ?? null,
    decisionDigest: input.decision.decisionDigest,
    semanticContractDigest: input.presentation.semanticContractDigest,
    presentationDigest: input.presentation.presentationDigest,
    ...(input.presentation.pageDigest === undefined
      ? {}
      : { pageDigest: input.presentation.pageDigest }),
  }

  // The chain is checked BEFORE the record is returned, so an incoherent set cannot reach the store
  // even if a caller skips the store's own check.
  assertDigestChain(digests)

  return {
    schema: ADOPTION_RECORD_SCHEMA,
    subject: {
      subjectId: subject.subjectId,
      canonicalName: subject.canonicalName,
      canonicalSlug: subject.canonicalSlug,
      displayName: subject.displayName,
      identityStatus: subject.identityStatus,
    },
    selectedArtifact:
      selectedArtifact === null
        ? null
        : {
            artifactVersionId: selectedArtifact.artifactVersionId,
            packageType: selectedArtifact.packageType,
            packageIdentifier: selectedArtifact.packageIdentifier,
            version: selectedArtifact.version,
            artifactStatus: selectedArtifact.artifactStatus,
          },
    sources,
    evidence: evidenceProjection,
    decision: {
      verdict: input.decision.verdict,
      decisionDigest: input.decision.decisionDigest,
      policyDigest: input.decision.policyDigest,
    },
    hostCompatibility: [...input.hostCompatibility].sort((a, b) =>
      a.host < b.host ? -1 : a.host > b.host ? 1 : 0,
    ),
    lifecycle: {
      status: input.lifecycleStatus,
      firstSeenAt: subject.firstSeenAt,
      lastSeenAt: subject.lastSeenAt,
    },
    digests,
  }
}

/** Compile a record and name it, in one step, so the two can never disagree. */
export function compileAdoptionRecordWithDigest(input: CompileAdoptionRecordInput): {
  record: AdoptionRecordV1
  adoptionRecordDigest: string
} {
  const record = compileAdoptionRecord(input)
  return { record, adoptionRecordDigest: adoptionRecordDigest(record) }
}
