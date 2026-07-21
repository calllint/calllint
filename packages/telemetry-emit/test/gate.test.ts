/**
 * Emission-gate matrix (new11 §3.5, ADR 0049 §2.6). The load-bearing rules:
 *  - local `cli` is consent-first: OFF without consent, ON only with explicit consent;
 *  - server/install/ci are on by default;
 *  - `CALLLINT_TELEMETRY=0/false/off/no` disables EVERY tier, and beats cli consent;
 *  - fail closed on an unknown/ambiguous state.
 */
import { describe, it, expect } from "vitest"
import { shouldEmit, isTelemetryDisabledByEnv } from "../src/index.js"

describe("shouldEmit — tier defaults", () => {
  it("cli is off without consent, on with consent", () => {
    expect(shouldEmit("cli")).toBe(false)
    expect(shouldEmit("cli", { consented: false })).toBe(false)
    expect(shouldEmit("cli", { consented: true })).toBe(true)
  })

  it("server / install / ci are on by default", () => {
    expect(shouldEmit("server")).toBe(true)
    expect(shouldEmit("install")).toBe(true)
    expect(shouldEmit("ci")).toBe(true)
  })
})

describe("shouldEmit — env kill-switch", () => {
  for (const v of ["0", "false", "off", "no", "FALSE", " Off "]) {
    it(`CALLLINT_TELEMETRY="${v}" disables every tier`, () => {
      const env = { CALLLINT_TELEMETRY: v }
      expect(shouldEmit("server", { env })).toBe(false)
      expect(shouldEmit("ci", { env })).toBe(false)
      expect(shouldEmit("cli", { consented: true, env })).toBe(false)
    })
  }

  it("a non-disable value leaves defaults intact", () => {
    const env = { CALLLINT_TELEMETRY: "1" }
    expect(shouldEmit("server", { env })).toBe(true)
    expect(shouldEmit("cli", { consented: true, env })).toBe(true)
    // ...but still cannot force cli on without consent
    expect(shouldEmit("cli", { env })).toBe(false)
  })

  it("isTelemetryDisabledByEnv is precise", () => {
    expect(isTelemetryDisabledByEnv({ CALLLINT_TELEMETRY: "0" })).toBe(true)
    expect(isTelemetryDisabledByEnv({ CALLLINT_TELEMETRY: "1" })).toBe(false)
    expect(isTelemetryDisabledByEnv({})).toBe(false)
  })
})
