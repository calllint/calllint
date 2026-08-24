/**
 * new19 §21 — the PRODUCER for `discoverySurface`, and the four ways it could go wrong
 * quietly.
 *
 * The conduit (contract → sanitizer → emitter → ingress → aggregate → D1) shipped with no
 * source: nothing set the field, so the dimension existed and measured nothing. These
 * tests hold the source, and each one pins a failure that would otherwise look healthy:
 *
 *   1. An off-vocabulary value must cost the ATTRIBUTION, never the EVENT. `sanitizeEvent`
 *      throws on an unknown surface and `emit()` converts that into `dropped` — the whole
 *      event. So a typo'd env var would delete real usage rather than mis-label it.
 *   2. Identity rotation must clear the stored surface, or a low-cardinality attribute
 *      survives the boundary rotation exists to create.
 *   3. Provenance is captured ONCE. A second enable under a different env var must not
 *      re-attribute an existing install.
 *   4. A stored surface must actually reach the wire, or the loop is still open with more
 *      code in it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DISCOVERY_SURFACES, sanitizeEvent } from "@calllint/telemetry-contract"
import { readDiscoverySurface, DISCOVERY_SURFACE_ENV } from "../src/discoverySurface.js"
import { buildCliEmitter } from "../src/telemetry.js"

describe("§21 readDiscoverySurface — validates at the source", () => {
  it("accepts every member of the contract vocabulary", () => {
    /* ANTI-VACUITY: if the enum were empty this whole file would pass while testing
     * nothing, so the vocabulary's own size is asserted before it is used as an oracle. */
    expect(DISCOVERY_SURFACES.length).toBeGreaterThan(0)
    for (const s of DISCOVERY_SURFACES) {
      expect(readDiscoverySurface({ [DISCOVERY_SURFACE_ENV]: s })).toBe(s)
    }
  })

  it("treats absent, empty and whitespace as unattributed rather than as a value", () => {
    expect(readDiscoverySurface({})).toBeUndefined()
    expect(readDiscoverySurface({ [DISCOVERY_SURFACE_ENV]: "" })).toBeUndefined()
    expect(readDiscoverySurface({ [DISCOVERY_SURFACE_ENV]: "   " })).toBeUndefined()
  })

  it("trims surrounding whitespace on an otherwise valid value", () => {
    // An env var set by a shell script or CI YAML very often carries a trailing newline.
    expect(readDiscoverySurface({ [DISCOVERY_SURFACE_ENV]: " mcp-registry\n" })).toBe("mcp-registry")
  })

  it("REJECTS an off-vocabulary value instead of passing it through", () => {
    for (const bad of ["registry", "MCP-REGISTRY", "mcp_registry", "io.github.calllint/calllint", "npm"]) {
      expect(readDiscoverySurface({ [DISCOVERY_SURFACE_ENV]: bad })).toBeUndefined()
    }
  })

  it("does not case-fold: the ingress compares byte-for-byte, so neither may normalize", () => {
    /* If this file lower-cased input, `MCP-Registry` would be stored, then REJECTED by the
     * server's enum check on arrival — passing locally and failing in production. */
    expect(readDiscoverySurface({ [DISCOVERY_SURFACE_ENV]: "MCP-Registry" })).toBeUndefined()
  })

  it("an unvalidated off-vocabulary value would have DROPPED THE WHOLE EVENT", () => {
    /* This is the measured reason validation lives at the source rather than being left to
     * the sanitizer. The consequence of skipping it is not a mislabeled row — it is a
     * deleted one, i.e. an install that looks like it never ran. */
    expect(() =>
      sanitizeEvent({ eventName: "install_completed", source: "install", discoverySurface: "npm" }),
    ).toThrow(/unknown discoverySurface/)
    // And with the guard in place the same env var yields no dimension at all, so the
    // event is still emitted — one narrower key instead of nothing.
    expect(readDiscoverySurface({ [DISCOVERY_SURFACE_ENV]: "npm" })).toBeUndefined()
  })
})

describe("§21 the stored surface reaches the wire", () => {
  it("stamps the surface onto every event, like the installation id", () => {
    const seen: Record<string, unknown>[] = []
    const emitter = buildCliEmitter({}, {
      sink: { write: (e) => void seen.push(e as unknown as Record<string, unknown>) },
      consented: true,
      installationId: "cli-anon-3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      discoverySurface: "mcp-registry",
    })
    emitter.emit({ eventName: "preflight_completed" })
    emitter.emit({ eventName: "decision_safe", result: "SAFE" })
    expect(seen).toHaveLength(2)
    for (const e of seen) expect(e.discoverySurface).toBe("mcp-registry")
  })

  it("emits nothing extra when unattributed — absence is not an empty string", () => {
    /* `""` is the D1 STORAGE default and is deliberately not wire-legal. Emitting it would
     * make an unattributed run indistinguishable from a schema violation. */
    const seen: Record<string, unknown>[] = []
    const emitter = buildCliEmitter({}, {
      sink: { write: (e) => void seen.push(e as unknown as Record<string, unknown>) },
      consented: true,
      installationId: "cli-anon-3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    })
    emitter.emit({ eventName: "preflight_completed" })
    expect(seen).toHaveLength(1)
    expect("discoverySurface" in seen[0]).toBe(false)
  })

  it("is inert while the gate is closed — attribution is not a consent bypass", () => {
    /* A stored surface must not cause emission on its own. The default CLI tier is gated
     * off, and this asserts that adding a dimension did not add a reason to emit. */
    const seen: unknown[] = []
    const emitter = buildCliEmitter({}, {
      sink: { write: (e) => void seen.push(e) },
      discoverySurface: "mcp-registry",
    })
    const outcome = emitter.emit({ eventName: "install_completed" })
    expect(outcome.status).toBe("gated")
    expect(seen).toHaveLength(0)
  })
})

describe("§21 state — capture once, clear on rotation", () => {
  let dir: string
  const saved = { ...process.env }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "calllint-surface-"))
    // Redirect the state file into a temp dir; both platform branches are set so the test
    // is not silently a no-op on whichever OS it runs on.
    process.env.XDG_CONFIG_HOME = dir
    process.env.LOCALAPPDATA = dir
  })

  afterEach(() => {
    process.env = { ...saved }
    rmSync(dir, { recursive: true, force: true })
  })

  it("captures the surface when the identity is created", async () => {
    const { enableTelemetry } = await import("../src/state.js")
    const state = await enableTelemetry({ [DISCOVERY_SURFACE_ENV]: "mcp-registry" })
    expect(state.discoverySurface).toBe("mcp-registry")
    expect(state.anonymousInstallationId).toBeTruthy()
  })

  it("persists it across loads, so later runs need no environment", async () => {
    const { enableTelemetry, loadState } = await import("../src/state.js")
    await enableTelemetry({ [DISCOVERY_SURFACE_ENV]: "agent-harness" })
    // Reload with a DELIBERATELY EMPTY environment — the value must come from disk. This
    // is the whole reason capture happens at enable time rather than per run.
    const reloaded = await loadState()
    expect(reloaded.discoverySurface).toBe("agent-harness")
  })

  it("does NOT re-attribute an existing install on a second enable", async () => {
    const { enableTelemetry } = await import("../src/state.js")
    await enableTelemetry({ [DISCOVERY_SURFACE_ENV]: "mcp-registry" })
    const again = await enableTelemetry({ [DISCOVERY_SURFACE_ENV]: "marketplace" })
    expect(again.discoverySurface).toBe("mcp-registry")
  })

  it("CLEARS the surface when the identity rotates", async () => {
    /* The load-bearing privacy assertion. A surface that survived rotation would be a
     * stable low-cardinality attribute spanning the boundary, narrowing the candidate set
     * on both sides and making a "fresh" identity linkable to the old one. */
    const { enableTelemetry, resetTelemetry } = await import("../src/state.js")
    const before = await enableTelemetry({ [DISCOVERY_SURFACE_ENV]: "mcp-registry" })
    const after = await resetTelemetry()
    expect(after.discoverySurface).toBeUndefined()
    expect(after.anonymousInstallationId).not.toBe(before.anonymousInstallationId)
  })

  it("ignores a hand-edited off-vocabulary value in the state file", async () => {
    /* The state file is user-writable plain JSON. An invalid value read back would reach
     * the emitter and drop every event, so the read path re-validates rather than trusting
     * that the write path validated. */
    const { saveState, loadState } = await import("../src/state.js")
    await saveState({
      telemetryEnabled: true,
      anonymousInstallationId: "cli-anon-3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      discoverySurface: "totally-made-up",
    })
    expect((await loadState()).discoverySurface).toBeUndefined()
  })
})
