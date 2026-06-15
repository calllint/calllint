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
export { ConfigParseError } from "@mcpguard/config-parser"
