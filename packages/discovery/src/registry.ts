import type { AgentExtractor, AgentType, AgentPriority } from "./types.js"

/**
 * Global registry of agent extractors.
 */
class ExtractorRegistry {
  private extractors = new Map<AgentType, AgentExtractor>()

  /**
   * Register an agent extractor.
   */
  register(extractor: AgentExtractor): void {
    if (this.extractors.has(extractor.agentType)) {
      throw new Error(`Extractor already registered for agent type: ${extractor.agentType}`)
    }
    this.extractors.set(extractor.agentType, extractor)
  }

  /**
   * Get extractor for a specific agent type.
   */
  get(agentType: AgentType): AgentExtractor | undefined {
    return this.extractors.get(agentType)
  }

  /**
   * Get all registered extractors.
   */
  getAll(): AgentExtractor[] {
    return Array.from(this.extractors.values())
  }

  /**
   * Get extractors filtered by agent types.
   */
  getByTypes(agentTypes: AgentType[]): AgentExtractor[] {
    return agentTypes
      .map(type => this.extractors.get(type))
      .filter((e): e is AgentExtractor => e !== undefined)
  }

  /**
   * Get extractors filtered by priority tier.
   */
  getByPriority(priority: AgentPriority): AgentExtractor[] {
    return this.getAll().filter(e => e.priority === priority)
  }

  /**
   * Get all extractors sorted by priority (P0 first, P3 last).
   */
  getAllSortedByPriority(): AgentExtractor[] {
    const priorityOrder: Record<AgentPriority, number> = {
      P0: 0,
      P1: 1,
      P2: 2,
      P3: 3,
    }

    return this.getAll().sort((a, b) => {
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })
  }

  /**
   * Clear all registered extractors (for testing).
   */
  clear(): void {
    this.extractors.clear()
  }
}

/**
 * Singleton registry instance.
 */
export const registry = new ExtractorRegistry()
