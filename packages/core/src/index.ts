export {
  type ScanOptions,
  type ResolvedScanOptions,
  resolveScanOptions,
} from "./options.js"
export { scanServer, type ScanServerInput } from "./scanServer.js"
export { scanConfigFile, scanConfigText } from "./scanConfig.js"
export {
  refineSummaryWithEvidence,
  REMOTE_UNVERIFIED_REASON,
  REMOTE_SURFACE_UNANALYZED_REASON,
  REMOTE_OWNER_UNVERIFIED_REASON,
} from "./refineWithEvidence.js"
export { summarize } from "./summarize.js"
export { buildBaseline, computeDrift } from "./drift.js"
export {
  type TargetSpec,
  type TargetSpecKind,
  parseTargetSpec,
  serverNameForPackage,
  synthesizeNpmConfig,
} from "./targets.js"
export {
  defaultCachePath,
  writeCache,
  readCache,
  defaultBaselinePath,
  writeBaseline,
  readBaseline,
} from "./cache.js"

// Re-export the parse error so consumers can catch it from one place.
export { ConfigParseError } from "@calllint/config-parser"

// new4 L1 — Capability Fingerprint extraction (ADR 0019).
export {
  buildFingerprint,
  fingerprintHash,
  type BuildFingerprintInput,
  type SurfaceOrigin,
} from "./extract/fingerprint.js"

// new4 L2 — Sparse Risk Kernel + Compact Decision (ADR 0020).
export { findingsToReasonCodes } from "./rules/reasonCodes.js"
export { sparseDecision, type SparseDecision } from "./rules/sparseRules.js"
export { toCompactDecision } from "./decision/decide.js"
export { checkParsed, type SurfaceDecision } from "./decision/checkParsed.js"

// new4 L0 — Surface trigger + load (ADR 0018).
export { classifySurface, type SurfaceVerdict } from "./surface/detect.js"
export {
  loadSurfaceFile,
  loadSurfaceText,
  inferOrigin,
  type LoadedSurface,
} from "./surface/load.js"
export {
  parseSnippet,
  extractPackageSpec,
  type ParsedSnippet,
} from "./surface/snippet.js"
export {
  findSurfaces,
  decideRepoSurfaces,
  readCapped,
  SKIP_DIRS,
  type WalkOpts,
} from "./surface/walk.js"

// new4 L4 — Approved state + capability-layer drift (ADR 0024).
export {
  defaultApprovedPath,
  buildApproved,
  writeApproved,
  readApproved,
} from "./state/approve.js"
export { verifyApproved } from "./state/verifyApproved.js"

// H1 — Continuous Guard engine (authority-change watch — ADR 0045).
export {
  assessGuardDrift,
  guardFailClosed,
  GUARD_ACTIONS,
  type GuardAction,
  type GuardAssessment,
} from "./state/continuousGuard.js"

// new4 L1 — Global host extractors (Phase 2 — ADR 0018 §15.12).
export {
  extractGenericMcpJson,
  extractGenericMcpJsonText,
} from "./extract/mappings/genericMcpJson.js"
export {
  extractGenericMcpToml,
  parseCodexToml,
} from "./extract/mappings/genericMcpToml.js"
export {
  extractInstallSnippet,
  type ExtractedSnippet,
} from "./extract/mappings/installSnippet.js"
export {
  extractForHost,
  type HostExtraction,
} from "./extract/mappings/hostExtractor.js"
export { extractVscode } from "./extract/mappings/vscode.js"
export { extractCursor } from "./extract/mappings/cursor.js"
export { extractClaude } from "./extract/mappings/claude.js"
export { extractCodex } from "./extract/mappings/codex.js"
export { extractGemini } from "./extract/mappings/gemini.js"
export { extractWindsurf } from "./extract/mappings/windsurf.js"
export { extractCline } from "./extract/mappings/cline.js"
export {
  extractOpenClaw,
  isOpenClawSnippet,
  type GatewayExtraction,
} from "./extract/mappings/openclaw.js"
export {
  extractHermes,
  parseHermesYaml,
} from "./extract/mappings/hermes.js"
export {
  HOST_HINTS,
  type HostId,
  type HostHint,
  type HostDialect,
} from "./extract/hostHints.js"

// new4 Phase 3 — Agent distribution rules (declarative — ADR 0018 §10).
export {
  UNIVERSAL_AGENT_RULE,
  RELEVANT_SURFACES,
  AGENT_RULE_MAX_LINES,
} from "./distribution/agentRule.js"
export {
  renderHostRule,
  RULE_HOSTS,
  RULE_TARGETS,
  type RuleHost,
  type RuleTarget,
} from "./distribution/hostRules.js"
export {
  renderCiGate,
  CI_GATE_MODES,
  CI_GATE_PATHS,
  type CiGateMode,
  type CiGateOptions,
} from "./distribution/ciGate.js"

// new5 R3 — Receipt-first Trust Layer (reporting layer only — ADR 0028).
export {
  createReceipt,
  verifyReceipt,
  type CallLintReceipt,
  type CreateReceiptInput,
  type VerifyReceiptResult,
} from "./receipt/index.js"

// new8 Phase G — Automated Trust Gateway (read-only preparation; ADR 0035).
export {
  prepare,
  prepareExitCode,
  type PrepareInput,
  type InstallExpectations,
} from "./gateway/prepare.js"
export {
  buildAuthorityManifest,
  verifyAuthorityDigest,
  type BuildAuthorityInput,
} from "./gateway/authority.js"

// Phase 2.4 — shared safe-install prepare orchestration (ADR 0056 §10.4). The one
// writer-free sequence the CLI `safe-install` and the MCP `prepare_safe_install`
// tool both delegate to, so there is no second copy of the gateway glue.
export {
  prepareSafeInstall,
  type PrepareSafeInstallInput,
  type SafeInstallHostPlan,
} from "./gateway/prepareSafeInstall.js"

// Workstream R — the `calllint://adoption/…` deep link an install page emits.
//
// Three pure modules and one writer, kept separate on purpose:
//   adoptionUri         — parse/build the URI as HOSTILE input (fails closed, by name)
//   adoptionUriDispatch — the exact argv a handler may run; the write flags are
//                         unreachable by construction, so a link cannot install
//   urlHandlerPlan      — per-platform registration plan (macOS = reasoned refusal)
//   urlHandlerWriter    — the SECOND live writer in this repo (registry/.desktop are
//                         not JSON-patchable, so `applyPlan` cannot be reused); same
//                         plan → digest → approve → verify → rollback discipline
export {
  ADOPTION_URI_SCHEME,
  buildAdoptionUri,
  parseAdoptionUri,
  type AdoptionUriParse,
  type AdoptionUriRejection,
  type AdoptionUriRequest,
} from "./gateway/adoptionUri.js"
export {
  FORBIDDEN_ARGS,
  dispatchAdoptionUri,
  type AdoptionDispatch,
  type AdoptionDispatchResult,
} from "./gateway/adoptionUriDispatch.js"
export {
  planUrlHandler,
  type HandlerPlatform,
  type HandlerRecord,
  type PlanInput as UrlHandlerPlanInput,
  type UrlHandlerPlan,
} from "./gateway/urlHandlerPlan.js"
export {
  applyUrlHandler,
  planDigest as urlHandlerPlanDigest,
  unregisterUrlHandler,
  urlHandlerStatus,
  type ApplyOutcome as UrlHandlerApplyOutcome,
  type ApplyResult as UrlHandlerApplyResult,
  type HandlerRegistry,
} from "./gateway/urlHandlerWriter.js"

// Phase 2.4 Batch 8 — continuous-protection conversion (INV-2.4-07). Pure disclosure:
// the one component list + uninstall story + renderer shared by the CLI post-success
// offer and the MCP `enable_continuous_guard` tool. Enables nothing, writes nothing.
// PR P-5 adds the three configurable offer strings (`DEFAULT_GUARD_OFFER_COPY`) so the
// presentation resolver can import ONE default source rather than restating the wording.
export {
  CONTINUOUS_PROTECTION_OFFER_SCHEMA,
  DEFAULT_GUARD_OFFER_COPY,
  GUARD_HOST_IDS,
  continuousProtectionOffer,
  disclosureDigest,
  isGuardHostId,
  persistentComponentFor,
  renderContinuousProtectionOffer,
  resolveGuardOfferCopy,
  type ContinuousProtectionInput,
  type ContinuousProtectionOffer,
  type ContinuousProtectionRecommendation,
  type GuardHostId,
  type GuardOfferCopy,
  type PersistentComponent,
} from "./gateway/continuousProtection.js"
