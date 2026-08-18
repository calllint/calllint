/**
 * CLI user state management — consent + anonymous installation ID.
 *
 * Stores local per-user opt-in state for telemetry. Uses a single JSON file under the
 * user's config directory (platform-dependent). Never stores config/secrets/evidence.
 * The installation ID is random (crypto.randomUUID), not hardware-derived.
 *
 * State location follows XDG/platform conventions:
 *   - Linux/macOS: $XDG_CONFIG_HOME/calllint/ or ~/.config/calllint/
 *   - Windows: %LOCALAPPDATA%\calllint\
 */
import { mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { makeInstallationId } from "@calllint/telemetry-contract"
import { getStatePath, getConfigDir } from "./paths.js"

export interface CliState {
  telemetryEnabled: boolean
  anonymousInstallationId?: string
}

const DEFAULT_STATE: CliState = {
  telemetryEnabled: false,
}

/** Load current state, or default if no state file exists. Never throws. */
export async function loadState(): Promise<CliState> {
  try {
    const path = getStatePath()
    if (!existsSync(path)) return { ...DEFAULT_STATE }
    const raw = await readFile(path, "utf8")
    const parsed = JSON.parse(raw)
    return {
      telemetryEnabled: parsed.telemetryEnabled === true,
      anonymousInstallationId: parsed.anonymousInstallationId,
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/** Save state to disk. Creates directory if needed. Best-effort. */
export async function saveState(state: CliState): Promise<void> {
  try {
    const dir = getConfigDir()
    await mkdir(dir, { recursive: true })
    const path = getStatePath()
    await writeFile(path, JSON.stringify(state, null, 2), "utf8")
  } catch {
    // State save is best-effort; never break the caller
  }
}

/** Generate a fresh random installation ID using crypto.randomUUID(). */
export function generateInstallationId(): string {
  // Node 19+ has crypto.randomUUID() on globalThis.crypto
  const uuid = globalThis.crypto?.randomUUID() ?? require("node:crypto").randomUUID()
  return makeInstallationId(uuid)
}

/** Enable telemetry, generating a fresh installation ID if none exists. */
export async function enableTelemetry(): Promise<CliState> {
  const state = await loadState()
  const newState: CliState = {
    telemetryEnabled: true,
    anonymousInstallationId: state.anonymousInstallationId ?? generateInstallationId(),
  }
  await saveState(newState)
  return newState
}

/** Disable telemetry. Keeps existing installation ID for potential re-enable. */
export async function disableTelemetry(): Promise<CliState> {
  const state = await loadState()
  const newState: CliState = {
    ...state,
    telemetryEnabled: false,
  }
  await saveState(newState)
  return newState
}

/** Reset telemetry: remove installation ID, rotate to fresh identity, keep enabled state. */
export async function resetTelemetry(): Promise<CliState> {
  const state = await loadState()
  const newState: CliState = {
    telemetryEnabled: state.telemetryEnabled,
    anonymousInstallationId: state.telemetryEnabled ? generateInstallationId() : undefined,
  }
  await saveState(newState)
  return newState
}

/** Remove all state. Used by reset when user wants to fully clear. */
export async function clearState(): Promise<void> {
  try {
    const path = getStatePath()
    if (existsSync(path)) {
      await rm(path)
    }
  } catch {
    // Best-effort
  }
}
