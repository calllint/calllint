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

// P0 Agent extractors
export { CursorExtractor } from "./extractors/cursor.js"
export { ClaudeCodeExtractor } from "./extractors/claude-code.js"
export { ClaudeDesktopExtractor } from "./extractors/claude-desktop.js"

// Path utilities (exported for extractor implementations)
export {
  resolvePath,
  isRegularFile,
  isReasonableSize,
  validateConfigPath,
} from "./path-resolver.js"
