import { describe, it, expect } from "vitest"
import { mkdtempSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../src/run.js"
import { goldenPath } from "@calllint/fixtures"
import { buildCliEmitter, emitCommandSignal, _VERDICT_EVENT, _ALLOWED_EVENTS } from "../src/telemetry.js"
import { memorySink } from "@calllint/telemetry-emit"
import { RESULTS } from "@calllint/telemetry-contract"

/**
 * Phase B — telemetry DARK wiring proof (new11 §3.5 / M1).
 *
 * The emit layer is now wired into the CLI dispatch. These tests lock the three
 * invariants that make "wired" safe:
 *   1. Verdict decoupling — CLI output (stdout/stderr/exitCode) is byte-identical
 *      with the production (gated-off) emitter present vs. no emitter at all.
 *   2. Gated-off — the local `cli` tier with no consent emits NOTHING, even with a
 *      real sink attached (the production resting state).
 *   3. Mapping — with consent + an injected sink (tests only), each verdict maps to
 *      exactly its `decision_*` event, sanitized; a forbidden field is DROPPED, never
 *      emitted and never thrown.
 */

const BASE = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
}

function deps(dir: string, stdin: string, extra: Record<string, unknown> = {}) {
  return { cwd: dir, readStdin: () => stdin, ...BASE, ...extra }
}

const VERDICT_FIXTURES: { file: string; verdict: (typeof RESULTS)[number] }[] = [
  { file: "safe-time.json", verdict: "SAFE" },
  { file: "review-financial.json", verdict: "REVIEW" },
  { file: "block-filesystem.json", verdict: "BLOCK" },
  { file: "unknown-remote.json", verdict: "UNKNOWN" },
]

describe("telemetry wiring — verdict decoupling (INV: output byte-identical)", () => {
  for (const { file } of VERDICT_FIXTURES) {
    it(`${file}: production emitter present vs absent → identical stdout/stderr/exitCode`, () => {
      const dir = mkdtempSync(join(tmpdir(), "cl-tel-"))
      try {
        const text = readFileSync(goldenPath(file), "utf8")
        const argv = ["scan", "--stdin", "--no-emoji"]

        // No emitter at all.
        const bare = run(argv, deps(dir, text, { writeCacheFile: false }))
        // The production emitter: gated-off local cli tier, default noopSink.
        const withEmitter = run(
          argv,
          deps(dir, text, { writeCacheFile: false, emitter: buildCliEmitter({}) }),
        )

        expect(withEmitter.stdout).toBe(bare.stdout)
        expect(withEmitter.stderr).toBe(bare.stderr)
        expect(withEmitter.exitCode).toBe(bare.exitCode)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})

describe("telemetry wiring — gated off by default (cli tier, no consent)", () => {
  it("a scan with a real sink but no consent emits NOTHING", () => {
    const dir = mkdtempSync(join(tmpdir(), "cl-tel-"))
    try {
      const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
      const sink = memorySink()
      // Emitter built exactly like production (source:cli, no consent) but with a
      // sink so we could observe any leak. The gate must keep it empty.
      const emitter = buildCliEmitter({}, { sink })
      run(["scan", "--stdin", "--no-emoji"], deps(dir, text, { writeCacheFile: false, emitter }))
      expect(sink.events).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("the universal CALLLINT_TELEMETRY kill-switch also yields no emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "cl-tel-"))
    try {
      const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
      const sink = memorySink()
      // Even WITH consent, the env kill-switch wins.
      const emitter = buildCliEmitter({ CALLLINT_TELEMETRY: "0" }, { sink, consented: true })
      run(["scan", "--stdin", "--no-emoji"], deps(dir, text, { writeCacheFile: false, emitter }))
      expect(sink.events).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("telemetry wiring — mapping (consent + injected sink, test-only)", () => {
  for (const { file, verdict } of VERDICT_FIXTURES) {
    it(`${file}: emits decision_${verdict.toLowerCase()} with result=${verdict}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "cl-tel-"))
      try {
        const text = readFileSync(goldenPath(file), "utf8")
        const sink = memorySink()
        const emitter = buildCliEmitter({}, { sink, consented: true })
        run(["scan", "--stdin", "--no-emoji"], deps(dir, text, { writeCacheFile: false, emitter }))
        expect(sink.events).toHaveLength(1)
        const ev = sink.events[0]!
        expect(ev.eventName).toBe(_VERDICT_EVENT[verdict])
        expect(ev.result).toBe(verdict)
        expect(ev.source).toBe("cli")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }

  it("a forbidden field is DROPPED (never emitted, never thrown)", () => {
    const sink = memorySink()
    const emitter = buildCliEmitter({}, { sink, consented: true })
    // Directly exercise the emit helper with a poisoned raw input. It must not throw
    // and must not write anything (the sanitizer rejects the forbidden key).
    expect(() =>
      emitter.emit({ eventName: "decision_safe", result: "SAFE", secret: "sk-LEAK" } as never),
    ).not.toThrow()
    expect(sink.events).toHaveLength(0)
  })

  it("emitCommandSignal never throws and no-ops with no emitter/signal", () => {
    expect(() => emitCommandSignal(undefined, { verdict: "SAFE" }, "1.7.2")).not.toThrow()
    const sink = memorySink()
    const emitter = buildCliEmitter({}, { sink, consented: true })
    expect(() => emitCommandSignal(emitter, undefined, "1.7.2")).not.toThrow()
    expect(sink.events).toHaveLength(0)
  })
})

describe("telemetry wiring — the verdict→event map covers the whole vocabulary", () => {
  it("every RESULTS verdict maps to an ALLOWED decision_* event", () => {
    for (const v of RESULTS) {
      const ev = _VERDICT_EVENT[v]
      expect(_ALLOWED_EVENTS).toContain(ev)
      expect(ev).toBe(`decision_${v.toLowerCase()}`)
    }
  })
})
