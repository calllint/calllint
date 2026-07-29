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
  OBSERVED_CONSEQUENCE,
  ABSENCE_CONSEQUENCE,
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
  PRIMARY_CTA,
  safeInstallProjection,
  type SafeInstallProjection,
  type SafeInstallProjectionInput,
  type Installability,
  type HumanDispositionProjection,
} from "./safeInstallProjection.js"
// Workstream P Batch 0 — presentation-plane reality audit (ADR 0058 §1/§5).
export {
  COPY_SITES,
  PROBE_SENTINEL,
  gradePresentationAudit,
  probeCopySite,
  runPresentationAudit,
  toProbeSubject,
  type CopyPlane,
  type CopyProbeResult,
  type CopySiteDeclaration,
  type PresentationAuditResult,
  type ProbeSubject,
} from "./presentationAudit.js"
// Phase 2.4 — Human Install renderer + discovery manifest + Safe-install emit (ADR 0056).
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
export {
  emitSafeInstall,
  type EmittedSafeInstall,
  type EmittedInstallResource,
} from "./emitSafeInstall.js"
export {
  evaluateHumanCapsule,
  measureFiveSecondPanel,
  decideGateB,
  evaluateAgentContract,
  CANONICAL_FIXTURES,
  canonicalProjection,
  canonicalProjectionInput,
  EVAL_ENGINE_VERSION,
  PUBLISHER_INJECTION_BLURBS,
  FIVE_SECOND_QUESTIONS,
  FIVE_SECOND_THRESHOLD,
  FIVE_SECOND_MIN_PANEL,
  type StructuralCheck,
  type HumanCapsuleStructure,
  type FiveSecondQuestion,
  type FiveSecondResponse,
  type FiveSecondPanelStore,
  type FiveSecondPanelMeasures,
  type AgentContractEval,
  type CanonicalFixture,
  type GateStatus,
  type Reproject,
} from "./phase24Eval.js"
export {
  decideGate,
  measureIdentityConsistency,
  evaluateOneSourceConsistency,
  evaluateLocalBinding,
  evaluateOneTimeSetup,
  evaluateConversion,
  evaluateNoRegression,
  TARGET_MISMATCH_OUTCOME,
  type GateMeasure,
  type GateResult,
  type SurfaceFacts,
  type IdentitySurfaces,
  type MismatchRun,
  type WriteSite,
  type RollbackRun,
  type ConversionObservation,
  type GateRecord,
  type WiredCheck,
  type ServedGuard,
} from "./phase24Gates.js"

// Workstream P Batch 1 — the presentation control plane's schema + digest seams
// (new15 §6.2 PR P-1; ADR 0058). Pure: the config document is a PARAMETER, never
// an import (ADR 0058 §2), so nothing here reads apps/web/content/**.
export {
  PRESENTATION_CONTENT_VERSION,
  LEVEL_BY_SECTION,
  PRESENTATION_STATES,
  DISPLAY_GROUPS,
  RESERVED_KEYS,
  FORBIDDEN_ABSENCE_TERMS,
  EMPTY_PRESENTATION_CONTENT,
  validatePresentationContent,
  isValidPresentationContent,
  type PresentationLevel,
  type PresentationSection,
  type DisplayGroup,
  type StateCopy,
  type PresentationContentV1,
  type PresentationContentError,
  type PresentationValidationContext,
} from "./safe-install/presentationContent.js"
export {
  presentationDigest,
  emptyPresentationDigest,
  semanticPreimage,
  semanticContractDigest,
  proseLeaves,
  SEMANTIC_PREIMAGE_OMISSIONS,
  type PresentationDigestSet,
  type SemanticOmission,
  type SemanticPreimageResult,
  type SemanticContractDigestResult,
} from "./safe-install/presentationDigest.js"
