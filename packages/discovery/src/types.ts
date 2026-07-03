import type { TargetKind } from "@calllint/types"

/**
 * Supported agent types for auto-discovery.
 * Priority tiers: P0 (must support), P1 (should support), P2/P3 (optional).
 */
export type AgentType =
  | "cursor"             // P0
  | "claude-code"        // P0
  | "claude-desktop"     // P0
  | "vscode"             // P1
  | "windsurf"           // P1
  | "codex"              // P2
  | "amazon-q"           // P2
  | "gemini-cli"         // P2
  | "openclaw"           // P3
  | "antigravity"        // P3
  | "amp"                // P3

export type AgentPriority = "P0" | "P1" | "P2" | "P3"

/**
 * A discovered agent configuration file.
 */
export interface DiscoveredConfig {
  /** The agent type (e.g., "cursor", "claude-code") */
  agentType: AgentType

  /** Absolute path to the config file */
  configPath: string

  /** Whether the file exists on disk */
  exists: boolean

  /** The config kind (for parsing) */
  kind: TargetKind

  /** Agent priority tier */
  priority: AgentPriority
}

/**
 * Result of auto-discovery operation.
 */
export interface DiscoveryResult {
  /** Working directory where discovery ran */
  cwd: string

  /** All discovered configs (may include non-existent paths) */
  discovered: DiscoveredConfig[]

  /** All paths searched (for debugging false negatives) */
  searchedPaths: string[]
}

/**
 * Options for discovery operation.
 */
export interface DiscoveryOptions {
  /** Working directory to search from */
  cwd: string

  /** Filter to specific agent types (default: all) */
  agentTypes?: AgentType[]

  /** Include non-existent configs in results (default: false) */
  includeMissing?: boolean
}

/**
 * Agent-specific extractor interface.
 * Each agent type implements this to discover its config paths.
 */
export interface AgentExtractor {
  /** The agent type this extractor handles */
  readonly agentType: AgentType

  /** Priority tier for this agent */
  readonly priority: AgentPriority

  /**
   * Discover config paths for this agent type.
   *
   * SAFETY: This function MUST NOT:
   * - Execute any commands
   * - Install any packages
   * - Connect to any network services
   * - Modify any files
   *
   * It may only:
   * - Check file existence
   * - Read file size
   * - Parse JSON to validate structure
   *
   * @param cwd - Working directory to search from
   * @returns Array of discovered configs (may include non-existent)
   */
  discover(cwd: string): Promise<DiscoveredConfig[]>
}
