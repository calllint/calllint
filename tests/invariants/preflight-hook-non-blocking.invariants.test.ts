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
// The plugin ships plain .mjs (no build step); import the pure core directly.
import {
  isConfigSurface,
  targetPathOf,
  recommendation,
  preflightFor,
} from "../../plugins/calllint/hooks/preflight-core.mjs"

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

describe("ADR 0051 — the real hook script exits 0 and never denies", () => {
  it("a config edit → exit 0, emits a non-blocking recommendation (no deny)", () => {
    const event = { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: ".cursor/mcp.json" } }
    const r = runHook(JSON.stringify(event))
    expect(r.status).toBe(0) // NOT 2 — never blocks
    const out = JSON.parse(r.stdout)
    expect(out.systemMessage).toMatch(/CallLint/)
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined()
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
