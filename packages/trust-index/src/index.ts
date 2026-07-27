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
  renderSitemap,
  structuredData,
  observedStatement,
  pagePath,
  pageUrl,
  CORRECTION_URL,
  CLAIM_APP_URL,
  SITE_ORIGIN,
  LOOKUP_PAGE_PATH,
} from "./renderPage.js"
export { renderAppCreatedPage } from "./renderAppCreated.js"
export {
  renderLookupIndex,
  renderLookupPage,
  type LookupSourceEntry,
} from "./renderLookup.js"
export {
  emitAllCohorts,
  SERVE_PREFIX,
  type EmittedFile,
  type EmittedCohort,
} from "./emitCohort.js"
export { TRUST_PAGE_FORBIDDEN_PHRASES, SAFE_INSTALL_FORBIDDEN_PHRASES } from "./language.js"
export {
  evidenceLevel,
  fourDimensionStatus,
  EVIDENCE_LEVEL_META,
  type EvidenceLevel,
  type EvidenceLevelMeta,
  type FourDimensionStatus,
} from "./evidenceLevel.js"
export {
  publishChannel,
  AUTO_PUBLISH_EVIDENCE_LIMITATION,
  type PublishChannel,
} from "./publishChannel.js"
export {
  reproductionCommand,
  scanHistory,
  type Reproduction,
  type ScanHistoryEntry,
} from "./pageProjections.js"
export {
  buildEvidenceManifest,
  evidenceManifestBodyDigest,
  signEvidenceManifest,
  verifyEvidenceManifest,
  type EvidenceManifestContext,
} from "./evidenceManifest.js"
export {
  runCalibrationAudit,
  CALIBRATION_THRESHOLDS,
  EMPTY_REVIEW_STORE,
  type CalibrationReport,
  type CalibrationFinding,
  type NegativeArtifact,
  type ReviewStore,
  type ReviewerSignoff,
  type FindingSeverity,
} from "./calibration.js"
export {
  parseClaimStore,
  verifiedPublisherFor,
  verifiedPublisherForNamespace,
  registryNamespaceOf,
  namespaceCovers,
  EMPTY_CLAIM_STORE,
  type ClaimRecord,
  type ClaimStore,
  type ClaimStatus,
  type VerifiedPublisher,
  type PageClaimCoords,
} from "./claim.js"
export {
  registryCohort,
  registryNameFromSourceLabel,
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
export {
  MAINTAINER_CONTEXT_KINDS,
  assertNoVerdictAuthority,
  validateMaintainerContext,
  signMaintainerContext,
  verifyMaintainerContext,
  isContextCurrentForDigest,
  buildDriftNotification,
  type MaintainerContextKind,
  type MaintainerContextClaim,
  type SignedMaintainerContext,
  type MaintainerDriftNotification,
} from "./maintainerContext.js"
export {
  CLAIM_LIFECYCLE_STATES,
  CLAIM_REVERIFY_TRIGGERS,
  transition,
  applyReverifyTrigger,
  projectToStoreStatus,
  isServingState,
  type ClaimLifecycleState,
  type ClaimReverifyTrigger,
  type ClaimEvent,
  type TransitionResult,
} from "./claimStateMachine.js"
// Phase 2.4 Batch 1 — Safe-install acquisition projection (ADR 0056; plan §6–§8).
export {
  ADOPTION_AUTHORITIES,
  selectDecisionAuthorities,
  type AdoptionAuthority,
  type DecisionAuthorityFact,
  type DecisionAuthoritySelection,
} from "./selectDecisionAuthorities.js"
export {
  AGENT_ADOPTION_CONTRACT_VERSION,
  AGENT_GUIDANCE,
  PLACEHOLDER_DIGEST,
  buildAgentAdoptionContract,
  sealAgentAdoptionContract,
  type AgentAdoptionContractV1,
  type AgentAdoptionContractInput,
  type AdoptionSubjectInput,
  type RecommendedNextAction,
  type PrepareArguments,
} from "./agentAdoptionContract.js"
export {
  safeInstallProjection,
  type SafeInstallProjection,
  type SafeInstallProjectionInput,
  type Installability,
  type HumanDispositionProjection,
} from "./safeInstallProjection.js"
// Phase 2.4 Batch 2 — Human Install renderer + discovery manifest + shadow emit (ADR 0056).
export { renderSafeInstall, renderSafeInstallContract } from "./renderSafeInstall.js"
export {
  renderDiscoveryManifest,
  DISCOVERY_SCHEMA,
  INSTALL_URL_TEMPLATE,
  CONTRACT_URL_TEMPLATE,
  CONTRACT_MEDIA_TYPE,
  MCP_RESOURCE_TEMPLATE,
  type DiscoveryResourceEntry,
} from "./renderDiscoveryManifest.js"
export { emitSafeInstall } from "./emitSafeInstall.js"
