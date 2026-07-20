/**
 * @calllint/trust-index — Phase I ingestion plane (I1a, fixtures cohort).
 *
 * Bakes reproducible, digest-addressed Trust Pages by orchestrating the shipped
 * scan + authority + prepare engines. This is the ONLY scanner in Phase I; it runs
 * offline/batch and never serves a request (ADR 0046 §1/§3). No new verdict logic,
 * no new scan — orchestration only.
 */
export {
  bakeTrustPage,
  fixtureArtifactIdentity,
  canonicalizeConfigText,
  ConfigParseError,
  type BakeInput,
  type BakedTrustPage,
} from "./bakeTrustPage.js"
export {
  fixtureCohort,
  fixtureCanonicalName,
  FIXTURE_OBSERVED_AT,
  type CohortEntry,
} from "./cohort.js"
export {
  renderHtml,
  renderSidecar,
  observedStatement,
  pagePath,
  CORRECTION_URL,
} from "./renderPage.js"
export {
  emitAllCohorts,
  SERVE_PREFIX,
  type EmittedFile,
  type EmittedCohort,
} from "./emitCohort.js"
export { TRUST_PAGE_FORBIDDEN_PHRASES } from "./language.js"
export {
  parseClaimStore,
  verifiedPublisherFor,
  EMPTY_CLAIM_STORE,
  type ClaimRecord,
  type ClaimStore,
  type ClaimStatus,
  type VerifiedPublisher,
} from "./claim.js"
export {
  registryCohort,
  type RegistryEntryPlan,
} from "./registryCohort.js"
export {
  reconcileClaims,
  parseGitHubRepo,
  registryRepoIndex,
  repoKey,
  type CoveredRepo,
  type InstallationView,
  type ReconcileInput,
} from "./reconcileClaims.js"
export {
  parseSnapshot,
  synthesizeConfigText,
  registryCanonicalName,
  REGISTRY_NAMESPACE,
  type RegistrySnapshot,
  type SnapshotEntry,
  type SnapshotPackage,
  type SnapshotRemote,
} from "./snapshot.js"
export {
  parseEvidenceSnapshot,
  serializeEvidenceSnapshot,
  evidenceMap,
  type EvidenceSnapshot,
} from "./evidenceSnapshot.js"
export { remoteSubjects } from "./resolveEvidence.js"
