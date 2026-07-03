// Core types
export type {
  AgentType,
  AgentPriority,
  DiscoveredConfig,
  DiscoveryResult,
  DiscoveryOptions,
  AgentExtractor,
} from "./types.js"

// Discovery engine
export { discoverConfigs, discoverAgent } from "./discovery-engine.js"

// Registry
export { registry } from "./registry.js"

// Base extractor class
export { BaseAgentExtractor } from "./extractors/base.js"

// Path utilities (exported for extractor implementations)
export {
  resolvePath,
  isRegularFile,
  isReasonableSize,
  validateConfigPath,
} from "./path-resolver.js"
