/**
 * CLI state management tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadState,
  saveState,
  enableTelemetry,
  disableTelemetry,
  resetTelemetry,
  generateInstallationId,
  type CliState,
} from "../src/state.js"
import { isValidInstallationId } from "@calllint/telemetry-contract"

describe("CLI state", () => {
  let testDir: string

  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "calllint-state-test-"))
    // BOTH, because `getConfigDir()` reads LOCALAPPDATA on win32 and XDG_CONFIG_HOME
    // elsewhere. Setting only LOCALAPPDATA (as this did) left ubuntu and macos — two of
    // the three CI legs — resolving to the runner's REAL ~/.config/calllint, so these
    // tests were reading and WRITING actual user state. On a developer's Linux machine
    // that meant `pnpm test` enabled their telemetry and minted a real installation id.
    for (const k of ["LOCALAPPDATA", "XDG_CONFIG_HOME"]) savedEnv[k] = process.env[k]
    process.env.LOCALAPPDATA = testDir
    process.env.XDG_CONFIG_HOME = testDir
  })

  afterEach(async () => {
    // Restored, not just overwritten: the previous version left the temp path in
    // process.env for every later test file sharing this worker.
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await rm(testDir, { recursive: true, force: true })
  })

  it("loads default state when no file exists", async () => {
    const state = await loadState()
    expect(state.telemetryEnabled).toBe(false)
    expect(state.anonymousInstallationId).toBeUndefined()
  })

  it("generates valid installation ID", () => {
    const id = generateInstallationId()
    expect(isValidInstallationId(id)).toBe(true)
    expect(id).toMatch(/^cli-anon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it("enableTelemetry creates installation ID", async () => {
    const state = await enableTelemetry()
    expect(state.telemetryEnabled).toBe(true)
    expect(state.anonymousInstallationId).toBeDefined()
    expect(isValidInstallationId(state.anonymousInstallationId!)).toBe(true)
  })

  it("disableTelemetry keeps installation ID", async () => {
    const enabled = await enableTelemetry()
    const originalId = enabled.anonymousInstallationId

    const disabled = await disableTelemetry()
    expect(disabled.telemetryEnabled).toBe(false)
    expect(disabled.anonymousInstallationId).toBe(originalId)
  })

  it("resetTelemetry rotates ID when enabled", async () => {
    await enableTelemetry()
    const before = await loadState()
    const originalId = before.anonymousInstallationId

    const after = await resetTelemetry()
    expect(after.telemetryEnabled).toBe(true)
    expect(after.anonymousInstallationId).toBeDefined()
    expect(after.anonymousInstallationId).not.toBe(originalId)
    expect(isValidInstallationId(after.anonymousInstallationId!)).toBe(true)
  })

  it("resetTelemetry clears ID when disabled", async () => {
    await enableTelemetry()
    await disableTelemetry()

    const after = await resetTelemetry()
    expect(after.telemetryEnabled).toBe(false)
    expect(after.anonymousInstallationId).toBeUndefined()
  })

  it("round-trip persistence", async () => {
    const original: CliState = {
      telemetryEnabled: true,
      anonymousInstallationId: generateInstallationId(),
    }
    await saveState(original)

    const loaded = await loadState()
    expect(loaded).toEqual(original)
  })
})
