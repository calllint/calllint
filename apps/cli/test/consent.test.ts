/**
 * First-run telemetry consent prompt (policy option B).
 *
 * The properties that make a consent prompt safe are all NEGATIVE — the interesting cases
 * are the ones where it must NOT fire, and the one where a decline must not become
 * nagware. So each veto gets its own test with only that condition flipped: a single
 * "happy path with everything wrong" test would pass while four of five vetoes were dead.
 *
 * ISOLATION: both `LOCALAPPDATA` (win32) and `XDG_CONFIG_HOME` (posix) are redirected.
 * Setting only one silently loses isolation on the other platforms — and CI runs all
 * three — which would make these tests read and WRITE the runner's (or a developer's)
 * real `state.json`. For a consent test that would mean flipping the real answer.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import {
  shouldPromptConsent,
  askConsent,
  recordConsent,
  maybePromptConsent,
} from "../src/consent.js"
import { loadState } from "../src/state.js"
import { getStatePath } from "../src/paths.js"
import { isValidInstallationId } from "@calllint/telemetry-contract"

/** All five conditions satisfied — the ONLY shape that may prompt. */
const ALLOWED = { stdinIsTty: true, env: {} as Record<string, string | undefined>, jsonMode: false }

function answer(text: string): NodeJS.ReadableStream {
  return Readable.from([text]) as unknown as NodeJS.ReadableStream
}

describe("consent — when it may prompt at all", () => {
  let testDir: string
  const saved: Record<string, string | undefined> = {}

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "calllint-consent-"))
    for (const k of ["LOCALAPPDATA", "XDG_CONFIG_HOME"]) saved[k] = process.env[k]
    process.env.LOCALAPPDATA = testDir
    process.env.XDG_CONFIG_HOME = testDir
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await rm(testDir, { recursive: true, force: true })
  })

  it("prompts on a fresh interactive install (the positive control)", () => {
    // Without this, every veto test below would pass on a function that always returns
    // false — including a `return false` stub.
    expect(existsSync(getStatePath())).toBe(false)
    expect(shouldPromptConsent(ALLOWED)).toBe(true)
  })

  it("does NOT prompt when stdin is not a TTY", () => {
    expect(shouldPromptConsent({ ...ALLOWED, stdinIsTty: false })).toBe(false)
  })

  it("does NOT prompt in CI", () => {
    expect(shouldPromptConsent({ ...ALLOWED, env: { CI: "true" } })).toBe(false)
  })

  it("does NOT prompt in --json / --sarif mode", () => {
    expect(shouldPromptConsent({ ...ALLOWED, jsonMode: true })).toBe(false)
  })

  // The whole documented vocabulary, not just "0". Asserting one value would pass against
  // a hand-rolled `v === "0"` check, which is exactly the second definition of the
  // kill-switch this code avoids by importing the gate's own predicate.
  for (const v of ["0", "false", "off", "no", "OFF", " no "]) {
    it(`does NOT prompt under CALLLINT_TELEMETRY=${JSON.stringify(v)}`, () => {
      expect(shouldPromptConsent({ ...ALLOWED, env: { CALLLINT_TELEMETRY: v } })).toBe(false)
    })
  }

  it("a value that is not a disable word does not itself suppress the prompt", () => {
    // Guards the inverse error: treating ANY value of the variable as "off" would make
    // `CALLLINT_TELEMETRY=1` silently prevent the question from ever being asked.
    expect(shouldPromptConsent({ ...ALLOWED, env: { CALLLINT_TELEMETRY: "1" } })).toBe(true)
  })

  it("does NOT prompt once a state file exists (already answered)", async () => {
    await recordConsent(false, () => {}, {})
    expect(existsSync(getStatePath())).toBe(true)
    expect(shouldPromptConsent(ALLOWED)).toBe(false)
  })
})

describe("consent — only an explicit yes counts", () => {
  for (const yes of ["y", "Y", "yes", "YES", " yes "]) {
    it(`${JSON.stringify(yes)} → consent granted`, async () => {
      expect(await askConsent(() => {}, 5_000, answer(`${yes}\n`))).toBe(true)
    })
  }

  // Silence, refusal, and noise all land in the same place. A bare Enter is the default,
  // which is why the prompt reads "[y/N]" — and why non-goal #15 is not violated: nothing
  // short of an affirmative turns collection on.
  for (const no of ["", "n", "no", "N", "maybe", "1", "sure"]) {
    it(`${JSON.stringify(no)} → consent refused`, async () => {
      expect(await askConsent(() => {}, 5_000, answer(`${no}\n`))).toBe(false)
    })
  }

  it("EOF with no answer → refused", async () => {
    // The command that just ran may have drained stdin (`scan --stdin`). An exhausted
    // stream must read as "no", never as an error and never as a yes.
    expect(await askConsent(() => {}, 5_000, answer(""))).toBe(false)
  })

  it("timeout → refused, and says so", async () => {
    const out: string[] = []
    // A stream that never ends and never yields a line: the timeout is the only exit.
    const idle = new Readable({ read() {} }) as unknown as NodeJS.ReadableStream
    expect(await askConsent((t) => out.push(t), 40, idle)).toBe(false)
    expect(out.join("")).toContain("telemetry stays OFF")
  })
})

describe("consent — what the answer persists", () => {
  let testDir: string
  const saved: Record<string, string | undefined> = {}

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "calllint-consent-"))
    for (const k of ["LOCALAPPDATA", "XDG_CONFIG_HOME"]) saved[k] = process.env[k]
    process.env.LOCALAPPDATA = testDir
    process.env.XDG_CONFIG_HOME = testDir
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await rm(testDir, { recursive: true, force: true })
  })

  it("yes → enabled, with a valid installation id", async () => {
    await recordConsent(true, () => {}, {})
    const state = await loadState()
    expect(state.telemetryEnabled).toBe(true)
    expect(isValidInstallationId(state.anonymousInstallationId!)).toBe(true)
  })

  it("no → a state file EXISTS recording the refusal, and no identity is minted", async () => {
    // THE LOAD-BEARING CASE. A decline that wrote nothing would leave the next run seeing
    // "no state file" and asking again — forever, until the user said yes. The file is the
    // consent record; declining must produce one.
    await recordConsent(false, () => {}, {})
    expect(existsSync(getStatePath())).toBe(true)
    const state = await loadState()
    expect(state.telemetryEnabled).toBe(false)
    expect(state.anonymousInstallationId).toBeUndefined()
  })

  it("asked exactly once: a declined install is never prompted again", async () => {
    const out: string[] = []
    const opts = { ...ALLOWED, out: (t: string) => out.push(t), timeoutMs: 5_000 }
    // First run: the question is asked and answered "no".
    expect(shouldPromptConsent(opts)).toBe(true)
    await recordConsent(false, opts.out, {})
    // Second run, same conditions: silent.
    expect(shouldPromptConsent(opts)).toBe(false)
    const before = out.length
    await maybePromptConsent({ ...opts, input: answer("y\n") })
    expect(out.length).toBe(before)
  })

  it("end-to-end: a fresh interactive install asks, and yes enables (positive control)", async () => {
    // Without this, every negative assertion about maybePromptConsent would also hold for
    // a function that never prompts under ANY conditions.
    const out: string[] = []
    await maybePromptConsent({
      ...ALLOWED,
      out: (t: string) => out.push(t),
      timeoutMs: 5_000,
      input: answer("y\n"),
    })
    expect(out.join("")).toContain("Enable anonymous usage telemetry?")
    expect(out.join("")).toContain("Telemetry ON")
    const state = await loadState()
    expect(state.telemetryEnabled).toBe(true)
    expect(isValidInstallationId(state.anonymousInstallationId!)).toBe(true)
  })

  it("end-to-end: declining leaves it off and records the refusal", async () => {
    const out: string[] = []
    await maybePromptConsent({
      ...ALLOWED,
      out: (t: string) => out.push(t),
      timeoutMs: 5_000,
      input: answer("\n"),
    })
    expect(out.join("")).toContain("Enable anonymous usage telemetry?")
    expect(existsSync(getStatePath())).toBe(true)
    expect((await loadState()).telemetryEnabled).toBe(false)
  })

  it("maybePromptConsent writes NOTHING when it must not prompt", async () => {
    const out: string[] = []
    await maybePromptConsent({
      ...ALLOWED,
      env: { CI: "true" },
      out: (t: string) => out.push(t),
      timeoutMs: 5_000,
      input: answer("y\n"),
    })
    expect(out).toEqual([])
    // And it left no state behind: declining to ask is not an answer.
    expect(existsSync(getStatePath())).toBe(false)
  })
})
