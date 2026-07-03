import type { DiscoveryOptions, DiscoveryResult, AgentType, DiscoveredConfig } from "./types.js"
import { registry } from "./registry.js"

/**
 * Discover agent configurations across all registered extractors.
 *
 * @param options - Discovery options
 * @returns Discovery result with all found configs
 */
export async function discoverConfigs(
  options: DiscoveryOptions
): Promise<DiscoveryResult> {
  const { cwd, agentTypes, includeMissing = false } = options

  // Get extractors to run
  const extractors = agentTypes
    ? registry.getByTypes(agentTypes)
    : registry.getAllSortedByPriority()

  // Run all extractors in parallel
  const results = await Promise.all(
    extractors.map(async extractor => {
      try {
        return await extractor.discover(cwd)
      } catch (error) {
        // One extractor failure should not fail the entire discovery
        console.error(`[discovery] Extractor ${extractor.agentType} failed:`, error)
        return []
      }
    })
  )

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
 * @param cwd - Working directory
 * @returns Discovered configs for that agent
 */
export async function discoverAgent(
  agentType: AgentType,
  cwd: string
): Promise<DiscoveredConfig[]> {
  const extractor = registry.get(agentType)
  if (!extractor) {
    throw new Error(`Unknown agent type: ${agentType}`)
  }

  try {
    return await extractor.discover(cwd)
  } catch (error) {
    console.error(`[discovery] Failed to discover ${agentType}:`, error)
    return []
  }
}
