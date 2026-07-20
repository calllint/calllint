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
export { prepare, prepareExitCode, type PrepareInput } from "./gateway/prepare.js"
export {
  buildAuthorityManifest,
  verifyAuthorityDigest,
  type BuildAuthorityInput,
} from "./gateway/authority.js"
