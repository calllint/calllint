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
import { makeInstallationId, DISCOVERY_SURFACES } from "@calllint/telemetry-contract"
import { readDiscoverySurface } from "./discoverySurface.js"
import { getStatePath, getConfigDir } from "./paths.js"

/** Accept a stored surface only if it is still a contract vocabulary member. */
function readStoredSurface(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return (DISCOVERY_SURFACES as readonly string[]).includes(value) ? value : undefined
}

export interface CliState {
  telemetryEnabled: boolean
  anonymousInstallationId?: string
  /**
   * Which KIND of discovery surface this installation arrived through (new19 §21).
   *
   * Stored beside the identity because provenance is knowable exactly once — at the run
   * that creates the identity. A later run cannot recover it, so re-reading the
   * environment per run would report "unattributed" for every run but the first.
   *
   * Always a member of the contract's `DISCOVERY_SURFACES`, validated before it gets
   * here (see discoverySurface.ts). Absent means unattributed, which is the honest
   * default and by far the common case.
   */
  discoverySurface?: string
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
      // Re-validated on READ, not trusted because it was validated on write. The state
      // file is user-writable plain JSON, and an off-vocabulary value reaching the
      // emitter makes `sanitizeEvent` throw, which `emit()` turns into a DROPPED EVENT —
      // losing the whole event rather than one dimension. Hand-editing this file must
      // cost attribution, never usage data.
      discoverySurface: readStoredSurface(parsed.discoverySurface),
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

/**
 * Enable telemetry, generating a fresh installation ID if none exists.
 *
 * This is also where discovery provenance is CAPTURED (new19 §21): the run that mints an
 * identity is the last moment the arriving environment is still observable. `env` is
 * injected rather than read from `process.env` so the capture is testable and so a caller
 * can decline to supply one.
 *
 * An already-stored surface is never overwritten. Provenance describes how this
 * installation was FIRST reached; letting a later `--enable` under a different env var
 * rewrite it would silently re-attribute an existing install to whichever shelf happened
 * to be set most recently.
 */
export async function enableTelemetry(
  env: Record<string, string | undefined> = {},
): Promise<CliState> {
  const state = await loadState()
  const surface = state.discoverySurface ?? readDiscoverySurface(env)
  const newState: CliState = {
    telemetryEnabled: true,
    anonymousInstallationId: state.anonymousInstallationId ?? generateInstallationId(),
    ...(surface ? { discoverySurface: surface } : {}),
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

/**
 * Reset telemetry: remove installation ID, rotate to fresh identity, keep enabled state.
 *
 * THE STORED `discoverySurface` IS DROPPED, NOT CARRIED OVER. This is a privacy
 * requirement, not housekeeping. The point of rotation is that events before and after
 * cannot be linked. A surface that survived rotation would be a low-cardinality
 * attribute persisting across the boundary — and joined with the other stored dimensions
 * it narrows the candidate set on both sides of a rotation, turning a fresh identity into
 * a re-identifiable one. Rotation must cost attribution; the alternative is a rotation
 * that only looks like one.
 *
 * Consequence, accepted deliberately: a reset install reports unattributed forever after,
 * because provenance is not re-derivable. An undercount that is honest beats an
 * attribution that quietly defeats the identity rotation it rides along with.
 */
export async function resetTelemetry(): Promise<CliState> {
  const state = await loadState()
  const newState: CliState = {
    telemetryEnabled: state.telemetryEnabled,
    anonymousInstallationId: state.telemetryEnabled ? generateInstallationId() : undefined,
  }
  await saveState(newState)
  return newState
}

/**
 * Remove all state. Used by reset when user wants to fully clear.
 *
 * Deletes the file outright, so the stored `discoverySurface` goes with it — see
 * `resetTelemetry` for why that is required and not merely tidy.
 */
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
