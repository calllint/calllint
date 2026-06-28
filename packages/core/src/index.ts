export {
  type ScanOptions,
  type ResolvedScanOptions,
  resolveScanOptions,
} from "./options.js"
export { scanServer, type ScanServerInput } from "./scanServer.js"
export { scanConfigFile, scanConfigText } from "./scanConfig.js"
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
