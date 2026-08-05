/**
 * evidenceDocument — the shape stored in `evidence_records.evidence_json`.
 *
 * A NEW schema id rather than a reuse of `calllint.evidence-manifest.v1`, and the difference is
 * not cosmetic. The manifest (`packages/evidence/src/manifest.ts`) is a PROJECTION over a completed
 * scan: it carries a verdict "VERBATIM — never recomputed by the projection", which presupposes
 * that something upstream already decided one. R-5 has no verdict to carry (see `compileEvidence`'s
 * docblock), so emitting a manifest would mean writing `UNKNOWN` into a field whose contract is
 * "the verdict a decision path produced" — a lie in the schema's own terms. This document records
 * what was OBSERVED in a set of verified bytes and stops there. The decision batch that owns
 * `adoption_records` is where a manifest becomes constructible.
 *
 * WHY THE SERIALIZATION IS ITS OWN FUNCTION. `evidence_json` is compared BYTE-FOR-BYTE by the
 * idempotence control: run twice, assert exactly one row and an unmoved `created_at`. Two runs over
 * the same bytes must therefore produce the same string, not merely an equal object. `JSON.stringify`
 * preserves insertion order, so that guarantee comes from this module constructing the object in a
 * fixed field order and sorting every collection — never from callers happening to agree.
 *
 * `findings` are carried as the detectors produced them, unsorted and unfiltered. They are already
 * deterministic: `analyzeDocumentSurfaces` walks `surfaces` in order and pushes evidence in scanner
 * order, and `surfaces` itself is ordered by `documentSurfaces.ts`'s fixed allowlist. Re-sorting
 * them here would add a second ordering authority that could disagree with the one the CLI's
 * findings already have — the same finding ids would render in a different order depending on which
 * caller produced them.
 */
import type { Finding } from "@calllint/types"

/** The document's schema id. Versioned independently of the manifest, for the reason above. */
export const EVIDENCE_DOCUMENT_SCHEMA = "calllint.adoption-evidence.v1"

/**
 * One document surface as RECORDED — its identity and whether it was cut, never its text.
 *
 * The text is deliberately absent. It is attacker-controlled content from a public registry, and
 * copying it into a database column would turn the index into a redistribution channel for whatever
 * a hostile publisher put in a README. What matters downstream is which surfaces existed and what
 * the detectors concluded; the bytes themselves stay in the CAS, addressed by digest, where they
 * can be re-read on demand. `truncated` is kept because a finding's absence means something weaker
 * when the scanned text was cut at the cap.
 */
export interface RecordedSurface {
  path: string
  kind: string
  truncated: boolean
}

export interface EvidenceDocument {
  schema: string
  /** The artifact these observations came from. */
  artifactVersionId: string
  /** `sha256:<hex>` of the bytes actually read and re-verified. */
  artifactDigest: string
  packageType: string
  packageIdentifier: string
  version: string | null
  /** `hashJson` over the sorted entry inventory — see `evidenceDigest.ts`. */
  observationDigest: string
  /** Entries the static inspection enumerated. Nothing was extracted. */
  entryCount: number
  /** Decompressed size, as measured. */
  uncompressedBytes: number
  /** Allowlisted surfaces read, in allowlist order. */
  surfaces: readonly RecordedSurface[]
  /** Findings from the existing deterministic detectors, in detector order. */
  findings: readonly Finding[]
}

/**
 * Serialize deterministically: fixed field order, no indentation.
 *
 * Compact rather than pretty-printed because this is a database column read by a program, not a
 * committed artifact reviewed by a human — and every byte of indentation is stored per row.
 */
export function serializeEvidenceDocument(doc: EvidenceDocument): string {
  return JSON.stringify({
    schema: doc.schema,
    artifactVersionId: doc.artifactVersionId,
    artifactDigest: doc.artifactDigest,
    packageType: doc.packageType,
    packageIdentifier: doc.packageIdentifier,
    version: doc.version,
    observationDigest: doc.observationDigest,
    entryCount: doc.entryCount,
    uncompressedBytes: doc.uncompressedBytes,
    surfaces: doc.surfaces.map((s) => ({ path: s.path, kind: s.kind, truncated: s.truncated })),
    findings: doc.findings,
  })
}
