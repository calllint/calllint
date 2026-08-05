/**
 * compileEvidence — compile one evidence row per artifact whose VERIFIED BYTES we already hold.
 *
 * The shape mirrors `resolveArtifacts` deliberately: read the whole artifact list, filter by a
 * POSITIVE status whitelist, take a deterministic prefix, then loop with one transaction per
 * artifact. Two of those choices are load-bearing rather than stylistic:
 *
 *   - ONE TRANSACTION PER ARTIFACT, because `store.transaction()` issues raw `BEGIN`/`COMMIT` with
 *     no nesting. A single transaction around the loop would let one unreadable blob roll back
 *     every row already compiled — the fail-DESTRUCTIVE shape that discarded 19_737 innocent
 *     subjects when 2 collided. A per-artifact scope makes a bad blob a per-artifact outcome.
 *   - A POSITIVE WHITELIST (`isEvidenceCompilable`), because `ArtifactStatus` has five members and
 *     TWO of them mean "we hold no bytes" for different reasons. See `domain/evidenceInputs.ts`.
 *
 * WHAT IS ABSENT IS THE POINT: there is no `fetchImpl` on the input, and no `fetch` in this
 * module. R-4 obtains bytes; R-5 only reads what R-4 already verified into the CAS. Offline is
 * therefore a property of the TYPE, not a promise in a comment — a caller cannot inject network
 * access here because there is no parameter to inject it through. Control #64 injects a `fetchImpl`
 * that throws into the surrounding run and observes that compilation still completes.
 *
 * WHY THE VERDICT IS `UNKNOWN`, AND WHY THAT IS NOT A SHORTCUT. `evidence_records.verdict` is
 * `NOT NULL`, and both routes to a computed verdict are closed to honest bytes:
 *
 *   - `computeVerdict(findings, binding)` needs a `RuntimeBinding` — eleven fields describing how
 *     some host was CONFIGURED to launch a server. Exactly one (`packageName`) is answerable from a
 *     tarball. Fabricating the other ten would feed an INFERENCE to a function and then record its
 *     output as an OBSERVATION, which Product Principle 8 and ADR 0061 both forbid.
 *   - `applyPolicy(..., now)` reads the clock at exactly one place: whether a policy override is
 *     still active. `evidence_digest` is deliberately timeless, so a verdict computed under an
 *     override would be cached under a key that cannot see the override expire — stale by
 *     construction.
 *
 * No findings-only verdict path exists in the repo, and adding one here would be a SECOND decision
 * path competing with `applyPolicy` (user rule 6; the A-08 "shipped-not-wired" grading). So R-5
 * records the honest value. The contract already names it: "UNKNOWN is not SAFE", "Never mark an
 * unknown source as SAFE." The findings are real and OBSERVED; the verdict is deferred to the
 * decision batch that will own `adoption_records`. `policy_digest` is still recorded, because it
 * says which policy this row stands under — that is what lets the later batch know whether a
 * recompilation is required — but no override is applied, so idempotence holds.
 */
import { analyzeDocumentSurfaces } from "@calllint/static-analyzer"
import type { Finding } from "@calllint/types"
import { extractDocumentSurfaces } from "../artifacts/documentSurfaces.js"
import { readVerifiedBlob } from "../artifacts/casRead.js"
import { DEFAULT_TAR_CAPS, type TarInspectCaps } from "../artifacts/tarInspect.js"
import { isEvidenceCompilable } from "../domain/evidenceInputs.js"
import { evidenceDigest, observationDigest } from "../domain/evidenceDigest.js"
import { EVIDENCE_DOCUMENT_SCHEMA, serializeEvidenceDocument } from "../domain/evidenceDocument.js"
import type { AdoptionIndexStore, StoredArtifactVersion } from "../storage/store.js"

/**
 * Why one artifact produced no evidence row, or that it did.
 *
 * `NO_DIGEST` and `BLOB_UNREADABLE` are separated on purpose. The first is a store-consistency
 * problem — a row is `FETCHED` but carries no `immutable_digest`, which R-4 should make
 * unreachable — while the second is a CAS problem. Collapsing them would hide a broken invariant
 * behind a routine cache miss.
 */
export type EvidenceCompilationOutcome =
  /** A row was inserted. */
  | "COMPILED"
  /** The identical row was already present — the idempotent path. */
  | "UNCHANGED"
  /** `FETCHED` but no `immutable_digest`: nothing names the bytes to read. */
  | "NO_DIGEST"
  /** The CAS could not return bytes matching that digest. */
  | "BLOB_UNREADABLE"
  /** Bytes read and re-verified, but the archive itself was refused by static inspection. */
  | "ARCHIVE_REFUSED"

export interface EvidenceCompilationRecord {
  artifactVersionId: string
  outcome: EvidenceCompilationOutcome
  /** Set once an evidence digest could be computed; null on every earlier refusal. */
  evidenceDigest: string | null
  /** A coded reason on the refusal paths. Null on `COMPILED` / `UNCHANGED`. */
  reason: string | null
  /** Entries seen by the static inspection, on the two success paths. */
  entryCount: number | null
  /** Allowlisted document surfaces read, on the two success paths. */
  surfaceCount: number | null
  /** Findings the existing detectors produced. Zero is the common, healthy case. */
  findingCount: number | null
}

export interface EvidenceCompilationSummary {
  /** Artifacts considered — those in `FETCHED`, up to the cap. */
  considered: number
  compiled: number
  unchanged: number
  noDigest: number
  blobUnreadable: number
  archiveRefused: number
  /** Every artifact's record, in `artifact_version_id` order. */
  records: EvidenceCompilationRecord[]
}

export interface CompileEvidenceInput {
  store: AdoptionIndexStore
  /**
   * One clock read, captured at the edge (INV-R6). It becomes `created_at` on rows this run
   * INSERTS, and is deliberately not an input to `evidence_digest` — see `domain/evidenceDigest.ts`.
   */
  now: string
  /**
   * `hashJson(policy)`, computed by the caller from the policy actually in force.
   *
   * INJECTED, not read here, for the same reason `now` is: this package must not decide which
   * policy is in force, and `@calllint/policy` is not one of its dependencies. It is an INPUT to
   * the digest, so dropping it would let a policy change silently reuse evidence graded under the
   * old one (control #56).
   */
  policyDigest: string
  /**
   * The engine version whose detectors ran. Injected from the ONE existing source
   * (`packages/trust-index/src/bake.ts`'s `engineVersion`) rather than re-read here, so the two
   * can never disagree about what produced a finding.
   */
  engineVersion: string
  /** Hard ceiling on artifacts compiled per run. */
  maxArtifacts?: number
  /** Static-inspection caps, forwarded verbatim. */
  tarCaps?: TarInspectCaps
}

/** 64 artifacts per run, matching `resolveArtifacts`'s ceiling so the two stay in step. */
export const DEFAULT_MAX_EVIDENCE_ARTIFACTS = 64

/**
 * Compile evidence for every `FETCHED` artifact, one transaction each.
 *
 * SYNCHRONOUS, and that is the honest signature: every step reads local bytes or the store, and
 * `better-sqlite3` has no async API. An `async` wrapper would suggest a network turn exists
 * somewhere in here.
 */
export function compileEvidence(input: CompileEvidenceInput): EvidenceCompilationSummary {
  const tarCaps = input.tarCaps ?? DEFAULT_TAR_CAPS
  const maxArtifacts = input.maxArtifacts ?? DEFAULT_MAX_EVIDENCE_ARTIFACTS

  const all = input.store.listArtifactVersions()
  const pending = all.filter((a) => isEvidenceCompilable(a.artifactStatus))
  // `listArtifactVersions` is already ordered by `artifact_version_id`, so the cap takes a
  // deterministic prefix rather than whichever rows the driver happened to return first.
  const considered = pending.slice(0, maxArtifacts)

  const summary: EvidenceCompilationSummary = {
    considered: considered.length,
    compiled: 0,
    unchanged: 0,
    noDigest: 0,
    blobUnreadable: 0,
    archiveRefused: 0,
    records: [],
  }

  for (const artifact of considered) {
    const record = compileOne(artifact, input, tarCaps)
    summary.records.push(record)

    switch (record.outcome) {
      case "COMPILED":
        summary.compiled += 1
        break
      case "UNCHANGED":
        summary.unchanged += 1
        break
      case "NO_DIGEST":
        summary.noDigest += 1
        break
      case "BLOB_UNREADABLE":
        summary.blobUnreadable += 1
        break
      case "ARCHIVE_REFUSED":
        summary.archiveRefused += 1
        break
    }
  }

  return summary
}

/**
 * One line for a run log. Kept here so the bin does not re-derive the phrasing.
 *
 * The three refusal counts are printed only when non-zero, but `unchanged` always is: on a healthy
 * warm store it is the whole cohort, and a line reading "0 compiled" with nothing else would look
 * like a failed run rather than a working idempotent one.
 */
export function describeEvidenceCompilation(s: EvidenceCompilationSummary): string {
  return (
    `evidence: ${s.considered} considered, ${s.compiled} compiled, ${s.unchanged} unchanged` +
    (s.noDigest > 0 ? `, ${s.noDigest} without digest` : "") +
    (s.blobUnreadable > 0 ? `, ${s.blobUnreadable} unreadable blob(s)` : "") +
    (s.archiveRefused > 0 ? `, ${s.archiveRefused} archive(s) refused` : "")
  )
}

function compileOne(
  artifact: StoredArtifactVersion,
  input: CompileEvidenceInput,
  tarCaps: TarInspectCaps,
): EvidenceCompilationRecord {
  const base = {
    artifactVersionId: artifact.artifactVersionId,
    evidenceDigest: null,
    entryCount: null,
    surfaceCount: null,
    findingCount: null,
  }

  // `immutable_digest` is the CAS key (`cas.ts`: "this is also the `cache_key`"). A `FETCHED` row
  // without one is a store-consistency defect, not a cache miss, so it is reported as its own
  // outcome instead of being folded into BLOB_UNREADABLE.
  const artifactDigest = artifact.immutableDigest
  if (artifactDigest === null) {
    return { ...base, outcome: "NO_DIGEST", reason: "FETCHED_WITHOUT_IMMUTABLE_DIGEST" }
  }

  // RE-HASHED, not trusted by filename. The whole argument is in `casRead.ts`'s docblock: the name
  // is a CLAIM about the content, and R-4's own discipline is that a claim and a measurement are
  // two different things. Control #60 renames a blob onto another digest's path.
  const blob = readVerifiedBlob(input.store.paths.root, artifactDigest)
  if (!blob.ok) {
    return { ...base, outcome: "BLOB_UNREADABLE", reason: `${blob.reason}: ${blob.detail}` }
  }

  // ONE pass over the archive yields both the entry inventory the digest covers and the surface
  // text the detectors read, so the digest can never describe bytes the findings did not come from.
  const extraction = extractDocumentSurfaces(blob.bytes, tarCaps)
  if (!extraction.inspection.ok) {
    return {
      ...base,
      outcome: "ARCHIVE_REFUSED",
      reason: `${extraction.inspection.refusal}: ${extraction.inspection.detail}`,
    }
  }

  // THE EXISTING PIPELINE, second caller. Same detectors, same `promptScan.js` scanners, same
  // finding ids as the CLI's `--online` surface scan. R-5 substitutes "text from a verified CAS
  // blob" for "text from disk" and changes nothing else.
  const findings: Finding[] = analyzeDocumentSurfaces(extraction.surfaces)

  const observation = observationDigest(extraction.inspection.entries)
  const digest = evidenceDigest({
    artifactDigest: blob.digest,
    policyDigest: input.policyDigest,
    engineVersion: input.engineVersion,
    observationDigest: observation,
  })

  const evidenceJson = serializeEvidenceDocument({
    schema: EVIDENCE_DOCUMENT_SCHEMA,
    artifactVersionId: artifact.artifactVersionId,
    artifactDigest: blob.digest,
    packageType: artifact.packageType,
    packageIdentifier: artifact.packageIdentifier,
    version: artifact.version,
    observationDigest: observation,
    entryCount: extraction.inspection.entries.length,
    uncompressedBytes: extraction.inspection.uncompressedBytes,
    surfaces: extraction.surfaces.map((s) => ({
      path: s.path,
      kind: s.kind,
      truncated: s.truncated,
    })),
    findings,
  })

  // One transaction, this artifact only. The store re-checks the `FETCHED` gate inside it against
  // the same whitelist used above, so the refusal is a property of the table rather than of this
  // function's control flow (see `store.recordEvidence`).
  const written = input.store.transaction((tx) =>
    tx.recordEvidence({
      evidenceDigest: digest,
      artifactVersionId: artifact.artifactVersionId,
      engineVersion: input.engineVersion,
      policyDigest: input.policyDigest,
      verdict: "UNKNOWN",
      evidenceJson,
      createdAt: input.now,
    }),
  )

  return {
    artifactVersionId: artifact.artifactVersionId,
    outcome: written.inserted ? "COMPILED" : "UNCHANGED",
    evidenceDigest: digest,
    reason: null,
    entryCount: extraction.inspection.entries.length,
    surfaceCount: extraction.surfaces.length,
    findingCount: findings.length,
  }
}
