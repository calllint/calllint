import type { DiscoveryOptions, DiscoveryResult, AgentType, DiscoveredConfig } from "./types.js"
import { registry } from "./registry.js"

/**
 * Discover agent configurations across all registered extractors.
 *
 * @param options - Discovery options
 * @returns Discovery result with all found configs
 */
export function discoverConfigs(
  options: DiscoveryOptions
): DiscoveryResult {
  const { cwd, agentTypes, includeMissing = false } = options

  // Get extractors to run
  const extractors = agentTypes
    ? registry.getByTypes(agentTypes)
    : registry.getAllSortedByPriority()

  // Run all extractors (synchronous)
  const results = extractors.map(extractor => {
    try {
      return extractor.discover(cwd)
    } catch (error) {
      // One extractor failure should not fail the entire discovery
      console.error(`[discovery] Extractor ${extractor.agentType} failed:`, error)
      return []
    }
  })

  // Flatten results
  const allDiscovered = results.flat()

  // Filter out non-existent configs unless requested
  const discovered = includeMissing
    ? allDiscovered
    : allDiscovered.filter(config => config.exists)

  // Collect all searched paths for debugging
  const searchedPaths = allDiscovered.map(config => config.configPath)

  return {
    cwd,
    discovered,
    searchedPaths,
  }
}

/**
 * Discover configs for a specific agent type.
 *
 * @param agentType - Agent type to discover
 * @param options - Discovery options
 * @returns Discovered configs for that agent
 */
export function discoverAgent(
  agentType: AgentType,
  options: DiscoveryOptions
): DiscoveredConfig[] {
  const extractor = registry.get(agentType)
  if (!extractor) {
    throw new Error(`Unknown agent type: ${agentType}`)
  }

  try {
    return extractor.discover(options.cwd)
  } catch (error) {
    console.error(`[discovery] Failed to discover ${agentType}:`, error)
    return []
  }
}
