export type {
  ScanMode,
  Completeness,
  EvidenceFinding,
  EvidenceEnvelope,
} from "./types.js"
export { EVIDENCE_SCHEMA_VERSION } from "./types.js"
export {
  importEvidence,
  digestArtifact,
  type EvidenceFormat,
  type ImportOptions,
  type AdapterResult,
} from "./importEvidence.js"
export {
  parseSkillSpectorJson,
  parseSkillSpectorSarif,
} from "./providers/skillspector.js"

// new12 P-D4 — the portable Evidence Manifest type (calllint.evidence-manifest.v1),
// a projection of a decided Trust Page onto the ADR 0034 discipline. Type + version
// const only; the projection builder + ed25519 signing live in @calllint/trust-index.
export {
  EVIDENCE_MANIFEST_SCHEMA_VERSION,
  type EvidenceManifest,
  type EvidenceManifestVerdict,
  type EvidenceManifestCompleteness,
  type EvidenceManifestLevel,
  type EvidenceManifestSignature,
  type EvidenceManifestCapability,
  type EvidenceManifestAuthority,
  type EvidenceManifestStatus,
} from "./manifest.js"

// new11 P1 — identity-resolution model (evidence-model.v0), distinct from the
// provider envelope above. See ./model/index.ts.
export * from "./model/index.js"
