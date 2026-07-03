import type { AgentExtractor, AgentType, AgentPriority } from "../types.js"

/**
 * Base class for agent extractors.
 * Provides common utilities for path resolution and validation.
 */
export abstract class BaseAgentExtractor implements AgentExtractor {
  abstract readonly agentType: AgentType
  abstract readonly priority: AgentPriority

  abstract discover(cwd: string): import("../types.js").DiscoveredConfig[]

  /**
   * Resolve home directory (~) to absolute path.
   */
  protected resolveHome(): string {
    const home = process.env.HOME || process.env.USERPROFILE
    if (!home) {
      throw new Error("Could not resolve home directory (HOME/USERPROFILE not set)")
    }
    return home
  }

  /**
   * Get platform-specific application data directory.
   *
   * Windows: %APPDATA% (Roaming)
   * macOS: ~/Library/Application Support
   * Linux: ~/.config (XDG_CONFIG_HOME or default)
   */
  protected getAppDataDir(): string {
    const platform = process.platform

    if (platform === "win32") {
      const appData = process.env.APPDATA
      if (!appData) {
        throw new Error("Could not resolve APPDATA directory on Windows")
      }
      return appData
    }

    if (platform === "darwin") {
      return `${this.resolveHome()}/Library/Application Support`
    }

    // Linux/Unix: XDG Base Directory
    return process.env.XDG_CONFIG_HOME || `${this.resolveHome()}/.config`
  }
}
