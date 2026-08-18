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

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "calllint-state-test-"))
    // Override getStateDir for tests
    process.env.LOCALAPPDATA = testDir
  })

  afterEach(async () => {
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
