/**
 * @calllint/evidence — identity-resolution model (new11 P1).
 * Barrel for the evidence-model.v0 layer (distinct from the provider envelope).
 */
export {
  EVIDENCE_GAP_CODES,
  EVIDENCE_GAP_META,
  isMaintainerFixable,
  isNetworkRecoverable,
  type EvidenceGapCode,
  type GapCategory,
  type GapSeverity,
  type EvidenceGapMeta,
} from "./reasonCodes.js"
export {
  SUBJECT_TYPES,
  EVIDENCE_TIERS,
  RESOLUTION_STATES,
  tierRank,
  type SubjectType,
  type EvidenceSubject,
  type EvidenceTier,
  type EvidenceItem,
  type EvidenceGap,
  type ResolverStatus,
  type ResolverResult,
  type ResolutionState,
  type EvidenceBundle,
} from "./types.js"
export {
  canTransition,
  isTerminal,
  stateFromResolverStatus,
} from "./stateMachine.js"
export {
  makeGap,
  hasBlockingGap,
  mergeResults,
  bundleState,
  isCleanlyResolved,
} from "./bundle.js"
export {
  evaluatePublishEligibility,
  completenessReport,
  explainUnknown,
  type EligibilityCriterion,
  type EligibilityReport,
  type ReportedGap,
  type CompletenessReport,
  type UnknownCause,
  type UnknownExplanation,
} from "./eligibility.js"
