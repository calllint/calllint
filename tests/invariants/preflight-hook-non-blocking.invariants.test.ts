/**
 * ADR 0051 INVARIANT — the CallLint Claude-plugin PreToolUse hook is preflight
 * recommend / display-only and NON-BLOCKING (new11 P2, PR-12).
 *
 * Two layers of assertion:
 *  1. Pure core (preflight-core.mjs): classifies config surfaces + builds a
 *     recommendation that carries NO permissionDecision and never asserts SAFE.
 *  2. The real hook script (preflight.mjs) executed as Claude Code would run it:
 *     JSON on stdin → it must exit 0 (never 2), emit no deny, for both a config
 *     edit and a non-config edit and malformed input.
 *
 * The hook must never break the agent loop, and installing it must never turn
 * into a runtime blocker (blocking stays deferred to ADR 0042 / H3).
 */
import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The plugin ships plain .mjs (no build step); import the pure core directly.
import {
  isConfigSurface,
  targetPathOf,
  recommendation,
  preflightFor,
  installCapture,
  RECOMMENDATIONS,
} from "../../plugins/calllint/hooks/preflight-core.mjs"
// The single source of truth for the recommendation vocabulary. The dependency-
// free plugin mirrors it; this import lets us pin the mirror identical (no drift).
import { RECOMMENDATIONS as SOURCE_RECOMMENDATIONS } from "@calllint/agent-triggers"

const HOOK = fileURLToPath(new URL("../../plugins/calllint/hooks/preflight.mjs", import.meta.url))

function runHook(stdin: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8" })
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("preflight-core — config-surface classification", () => {
  it("recognizes the agent-tool config surfaces", () => {
    expect(isConfigSurface(".cursor/mcp.json")).toBe(true)
    expect(isConfigSurface("/home/u/.vscode/mcp.json")).toBe(true)
    expect(isConfigSurface(".mcp.json")).toBe(true)
    expect(isConfigSurface("claude_desktop_config.json")).toBe(true)
    expect(isConfigSurface("/x/.claude/settings.json")).toBe(true)
    expect(isConfigSurface("skills/foo/SKILL.md")).toBe(true)
  })

  it("does not flag unrelated files, incl. a bare settings.json (negative fixtures)", () => {
    expect(isConfigSurface("src/index.ts")).toBe(false)
    expect(isConfigSurface("README.md")).toBe(false)
    expect(isConfigSurface("settings.json")).toBe(false) // not under .claude/
    expect(isConfigSurface("")).toBe(false)
    expect(isConfigSurface(undefined as unknown as string)).toBe(false)
  })

  it("targetPathOf reads Write/Edit/MultiEdit shapes and tolerates junk", () => {
    expect(targetPathOf({ file_path: "a/mcp.json" })).toBe("a/mcp.json")
    expect(targetPathOf({ path: "b" })).toBe("b")
    expect(targetPathOf(null)).toBeNull()
    expect(targetPathOf({})).toBeNull()
  })
})

describe("ADR 0051 — the recommendation never blocks and never asserts SAFE", () => {
  it("carries no permissionDecision field (cannot deny/ask)", () => {
    const rec = recommendation(".cursor/mcp.json")
    expect(rec.hookSpecificOutput).toBeDefined()
    expect((rec.hookSpecificOutput as Record<string, unknown>).permissionDecision).toBeUndefined()
    expect(rec.hookSpecificOutput.hookEventName).toBe("PreToolUse")
  })

  it("never renders SAFE, and says UNKNOWN is never SAFE", () => {
    const rec = recommendation(".cursor/mcp.json")
    const blob = JSON.stringify(rec)
    expect(blob).toMatch(/UNKNOWN is never SAFE/)
    expect(blob).not.toMatch(/\bis SAFE\b/)
    expect(blob).toMatch(/never executes the server it judges/)
  })

  it("preflightFor returns null for a non-config edit (hook stays silent)", () => {
    expect(preflightFor({ tool_input: { file_path: "src/app.ts" } })).toBeNull()
    expect(preflightFor({})).toBeNull()
  })
})

describe("ADR 0055 §4 — install capture re-adjudicates via the shipped route, never decides/writes", () => {
  it("mirrors the source recommendation vocabulary verbatim (one vocabulary, no drift)", () => {
    // The plugin is dependency-free and cannot import @calllint/agent-triggers at
    // runtime; this pins its local copy identical to the real source of truth.
    expect(RECOMMENDATIONS).toEqual([...SOURCE_RECOMMENDATIONS])
  })

  it("captures the install as UNKNOWN-equivalent (gather-evidence), never SAFE, never blocking", () => {
    const cap = installCapture(".cursor/mcp.json")
    expect(cap.recommendation).toBe("gather-evidence") // == recommendFromVerdict(null)
    expect(RECOMMENDATIONS).toContain(cap.recommendation)
    expect(cap.blocking).toBe(false)
    // Absence of a verdict is never surfaced as SAFE / proceed.
    expect(cap.recommendation).not.toBe("proceed")
    expect(JSON.stringify(cap)).not.toMatch(/\bSAFE\b/)
  })

  it("names the shipped human-in-the-loop Trust-Gateway route verbatim (prepare → apply)", () => {
    const cap = installCapture(".cursor/mcp.json")
    // prepare is READ-ONLY (builds a reviewable plan, executes nothing).
    expect(cap.reAdjudicate[0]).toMatch(/^calllint trust prepare .+ --host <id>$/)
    // apply is the ONLY writer and binds the human approval to the exact plan digest.
    expect(cap.reAdjudicate[1]).toMatch(/^calllint trust apply --plan .+ --approve <plan-digest>$/)
    expect(cap.receiptSchema).toBe("calllint.receipt.v1")
  })

  it("never names a path the hook itself takes to write host config (applyPlan/fs)", () => {
    // The capture is guidance to a human-approved CLI, not something the hook runs.
    const blob = JSON.stringify(installCapture(".cursor/mcp.json"))
    expect(blob).not.toMatch(/applyPlan/)
    expect(blob).not.toMatch(/nodeFsPort|writeFile|ApplyOptions/)
  })

  it("folds the re-adjudication route into additionalContext, adds no gating field", () => {
    const rec = recommendation(".cursor/mcp.json")
    const ctx = rec.hookSpecificOutput.additionalContext
    expect(ctx).toMatch(/calllint trust prepare/)
    expect(ctx).toMatch(/calllint trust apply/)
    expect(ctx).toMatch(/only step that writes host config/)
    // No new top-level or hookSpecificOutput key beyond the shipped shape.
    expect(Object.keys(rec).sort()).toEqual(["hookSpecificOutput", "systemMessage"])
    expect(Object.keys(rec.hookSpecificOutput).sort()).toEqual(["additionalContext", "hookEventName"])
  })
})

describe("ADR 0051 — the real hook script exits 0 and never denies", () => {
  it("a config edit → exit 0, emits a non-blocking recommendation (no deny)", () => {
    const event = { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: ".cursor/mcp.json" } }
    const r = runHook(JSON.stringify(event))
    expect(r.status).toBe(0) // NOT 2 — never blocks
    const out = JSON.parse(r.stdout)
    expect(out.systemMessage).toMatch(/CallLint/)
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined()
    // ADR 0055 §4: the capture branch surfaces the re-adjudication route via the
    // real hook, and it is still just context (no permissionDecision appeared).
    expect(out.hookSpecificOutput.additionalContext).toMatch(/calllint trust prepare/)
    expect(out.hookSpecificOutput.additionalContext).toMatch(/calllint trust apply/)
  })

  it("writes NO file when run — captures, never applies (ADR 0055 §4 / 0051 floor)", () => {
    // The ONLY writer is the human-approved `calllint trust apply`; the hook must
    // reach no writer path. Run it in a scratch cwd and prove it creates nothing.
    const dir = mkdtempSync(join(tmpdir(), "preflight-hook-"))
    try {
      const before = readdirSync(dir)
      const event = { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: ".cursor/mcp.json" } }
      const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), encoding: "utf8", cwd: dir })
      expect(r.status).toBe(0)
      expect(readdirSync(dir)).toEqual(before) // no plan, no receipt, no host config
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("a non-config edit → exit 0, no output (silent)", () => {
    const event = { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/index.ts" } }
    const r = runHook(JSON.stringify(event))
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe("")
  })

  it("malformed stdin → exit 0, no output (never breaks the agent loop)", () => {
    const r = runHook("{ not json")
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe("")
  })

  it("empty stdin → exit 0 (no crash)", () => {
    const r = runHook("")
    expect(r.status).toBe(0)
  })
})
