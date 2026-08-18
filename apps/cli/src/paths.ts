/**
 * Platform-specific path resolution for state and queue files.
 */

import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Get the platform-appropriate config directory for CallLint.
 */
export function getConfigDir(): string {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    return join(localAppData, "calllint")
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(xdgConfig, "calllint")
}

/**
 * Get the path to the state file (consent + installation ID).
 */
export function getStatePath(): string {
  return join(getConfigDir(), "state.json")
}

/**
 * Get the path to the queue file (pending telemetry events).
 */
export function getQueuePath(): string {
  return join(getConfigDir(), "queue.json")
}
