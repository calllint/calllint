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
  CLI_VERSION,
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
  DEFAULT_AUTHORITY_COPY,
  selectDecisionAuthorities,
  MAX_DECISION_AUTHORITY_FACTS,
  type AdoptionAuthority,
  type AuthorityCopy,
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
  type ProjectionPresentation,
  type Installability,
  type HumanDispositionProjection,
} from "./safeInstallProjection.js"
// Workstream P Batch 0 — presentation-plane reality audit (ADR 0058 §1/§5).
export {
  COPY_SITES,
  PROBE_SENTINEL,
  gradePresentationAudit,
  probeCopySite,
  renderedForms,
  runPresentationAudit,
  toProbeSubject,
  type CopyPlane,
  type CopyProbeResult,
  type CopySiteDeclaration,
  type PresentationAuditResult,
  type ProbeSubject,
} from "./presentationAudit.js"
// Phase 2.4 — Human Install renderer + discovery manifest + Safe-install emit (ADR 0056).
// `CTA_DOC_HREF` + `DEEP_LINK_STATES` are exported at P-6 (additive): the preview
// harness partitions pages on the CTA route, and it must read the renderer's own
// predicate rather than keep a second copy that could fall out of step with it.
export {
  renderSafeInstall,
  renderSafeInstallContract,
  SECTION_TITLES,
  INSTALL_COPY_SCRIPT_SRC,
  CTA_DOC_HREF,
  DEEP_LINK_STATES,
  altRouteHref,
  type SectionTitles,
} from "./renderSafeInstall.js"
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
  partitionPanelFreshness,
  stylesheetHrefs,
  auditShownArtifact,
  extractCapsuleAnswers,
  decideGateB,
  evaluateAgentContract,
  CANONICAL_FIXTURES,
  canonicalProjection,
  canonicalProjectionInput,
  redactRunVaryingNote,
  DOGFOOD_SANDBOX_MARKER,
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
  type StalePanelResponse,
  type PanelFreshness,
  type ShownArtifactAudit,
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
// Workstream P Batch 2 — the resolver P-1 deferred (new15 §6.2 PR P-2; ADR 0058
// §2/§5). Fails open per slot to the shipped code defaults, so an absent, partial,
// or rejected document still renders a complete page.
//
// PR P-5 widens this export: the two classification tables and `codeOwnedReason` are
// exported because the LOCK reads them — a failure message that names the measured reason a
// slot is code-owned has to read that reason from the same table the resolver derives
// `unwiredSlots` from, or the two can disagree. `overrideKey`/`decodeOverrideKey` are
// exported for the same reason: a consumer holding a canonical slug must encode it the one
// way the resolver decodes, and the round-trip test needs both directions.
export {
  resolvePresentation,
  DEFAULT_PRESENTATION,
  WIRED_SECTION_TITLES,
  UNWIRED_SECTION_TITLES,
  WIRED_SLOTS,
  CODE_OWNED_SLOTS,
  codeOwnedReason,
  overrideKey,
  decodeOverrideKey,
  type ResolvedPresentation,
  type ResolvedOverrides,
  type ResolvedResourceOverride,
  type ResourceOverride,
} from "./safe-install/resolvePresentation.js"
// PR P-5/P-6 — the AGENT RELAY copy slice (new15 §20.2; ADR 0058 §6). ALL SIX slots are
// wired: `guardOffer` reaches the MCP guard tool's relay line, and the five decision-relay
// slots reach the MCP prepare result's `notes[]` through `composeRelayNotes` — each sentence
// gated on the sealed-contract field it relays, so the surface cannot overstate the contract.
export {
  DEFAULT_AGENT_RELAY_COPY,
  WIRED_AGENT_RELAY,
  AGENT_RELAY_SLOTS,
  composeRelayNotes,
  type AgentRelayCopy,
  type RelayFacts,
} from "./safe-install/agentRelay.js"
// PR P-5 — the SHIPPED fail-open loader, exported so a second edge (Gate 2.4-F) reuses it
// rather than reimplementing the path and the try/catch. Two copies of a fail-open loader is
// two chances to fail CLOSED by accident, and the gate would be the copy nobody notices.
//
// This does NOT weaken ADR 0058 §2: the export hands out a FUNCTION, and the path it defaults
// to is computed at the edge from `import.meta.url`. Nothing under `packages/*/src` imports
// from `apps/web/content/**` — the import-boundary probe in the lock still measures that, and
// still measures it over this file.
export { loadPresentationIfPresent, PRESENTATION_DOC_PATH } from "./bake.js"
// Workstream P Batch 3 — the LAYOUT STRUCTURE model (new15 §6.2 PR P-3; ADR 0058
// §3). The section/group model the renderer actually emits, and the predicate that
// decides which group orderings it can express. Exported so the lock script and the
// tests measure the same model the renderer uses, rather than describing it twice.
export {
  ABOVE_FOLD_SECTION_IDS,
  SECTION_GROUPS,
  DEFAULT_GROUP_ORDER,
  FUSED_GROUP_RUNS,
  SHIPPED_LAYOUT_CAPS,
  DEFAULT_LAYOUT,
  checkLayoutSupport,
  isStructurallySupported,
  sectionOrderFor,
  clampCap,
  type AboveFoldSectionId,
  type LayoutSupportResult,
  type ResolvedLayout,
} from "./safe-install/layoutStructure.js"
// Workstream P Batch 7 — the PREVIEW & SNAPSHOT harness (new15 §14 PR P-6). Pure
// measurement for the four acceptance-gate blocks §14 declares and nothing ran:
// 配置完整性 · 页面一致性 · 安全隔离 · 视觉回归. All I/O lives in scripts/preview-snapshot.ts,
// which is why each block is unit-testable without a bake — and why the observer cannot
// quietly become a second renderer.
export {
  structuralSignature,
  signatureConditionals,
  ctaRoutePartition,
  predictCtaColumns,
  gradeConfigIntegrity,
  gradePageConsistency,
  gradeSecurityIsolation,
  gradeVisualRegression,
  gradePreviewSnapshot,
  CTA_ROUTE_PARTITIONS,
  CTA_REFLOW_RULES,
  CONDITIONAL_SITES,
  PREVIEW_VIEWPORTS,
  type PreviewCheck,
  type PreviewBlock,
  type PreviewSnapshotInput,
  type PreviewSnapshotResult,
  type CtaRoutePartition,
  type CatalogFacts,
  type HostCopyFacts,
  type HostVocabularyFacts,
  type ConfigIntegrityInput,
  type PageSample,
  type PageConsistencyInput,
  type InjectionSample,
  type SentinelSample,
  type SecurityIsolationInput,
  type StylesheetSample,
  type VisualRegressionInput,
  type VisualRegressionResult,
  type ViewportObservation,
} from "./previewSnapshot.js"
// Workstream P Batch 4 — the L0 TOKEN PLANE measurement (new15 §4.2 PR P-4; ADR
// 0058 §1/§4). Pure parsing + comparison, no filesystem: the lock script and the
// tests read the files and hand the bytes here, so both measure the token plane
// through one implementation instead of describing it twice.
//
// PR P-4b adds the pieces that make the plane SERVED: `ResolvedTokens`/`DEFAULT_TOKENS`
// (the renderer's fourth argument), `BASELINE_SELECTORS` + `nonClassRuleHeads` (the
// element rules a class-only parser could not see), and `resolveDeclarations` (the
// var()-resolved visual fact the lock digests).
export {
  parseRootTokens,
  parseClassSelectors,
  parseStyledClasses,
  countCssRules,
  forbiddenCssConstructs,
  suppressionViolations,
  tokenDrift,
  emittedInstallClasses,
  nonClassRuleHeads,
  resolveDeclarations,
  FORBIDDEN_CSS_CONSTRUCTS,
  SUPPRESSION_PROPERTIES,
  BASELINE_SELECTORS,
  DEFAULT_TOKENS,
  type CssToken,
  type ResolvedRule,
  type ResolvedTokens,
} from "./safe-install/tokenPlane.js"
