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
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
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

/* ────────────────────────────────────────────────────────────────────────────────
 * The CURSOR edge. Same ADR 0051 floor, restated in Cursor's blocking vocabulary,
 * because the levers are different: on Cursor `preToolUse` is the one hook that can
 * veto a write, and it does so with a `permission: "deny"` field or exit code 2.
 * `permissionDecision` — the field the Claude layer above forbids — is not a thing
 * here, so asserting its absence would be a control that cannot fail.
 * ──────────────────────────────────────────────────────────────────────────────── */
const CURSOR_HOOK = fileURLToPath(
  new URL("../../plugins/calllint/hooks/preflight-cursor.mjs", import.meta.url),
)

function runCursorHook(stdin: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CURSOR_HOOK], { input: stdin, encoding: "utf8" })
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("ADR 0051 — the Cursor edge exits 0 and never denies", () => {
  it("a config edit → exit 0, Cursor's envelope, and NO permission field", () => {
    const event = {
      hook_event_name: "preToolUse",
      tool_name: "Write",
      tool_input: { file_path: ".cursor/mcp.json" },
    }
    const r = runCursorHook(JSON.stringify(event))
    expect(r.status).toBe(0) // NOT 2 — Cursor equates 2 with a deny
    const out = JSON.parse(r.stdout)
    expect(out.user_message).toMatch(/CallLint/)
    expect(out.agent_message).toMatch(/calllint trust prepare/)
    // The two blocking levers, and the silent-mutation lever, must all be absent.
    expect(out.permission, "the Cursor edge emitted a permission verdict").toBeUndefined()
    expect(out.updated_input, "the Cursor edge rewrote the agent's input").toBeUndefined()
    // Exhaustive, not just spot-checked: a field added later cannot slip past the
    // three assertions above by having a name none of them mention.
    expect(Object.keys(out).sort()).toEqual(["agent_message", "user_message"])
  })

  it("emits Cursor's field names, not Claude's — a wrong envelope is silently dropped", () => {
    /* THE FAULT THIS PINS is not a crash. Cursor ignores unknown top-level fields,
     * so shipping Claude's `systemMessage` / `hookSpecificOutput` here would compute
     * the whole recommendation and then say NOTHING to the user, on every edit,
     * forever — with exit 0 and empty stderr, so no test that only checks "did it
     * run" would notice. That is the repo's dominant fault class (a guard that
     * cannot observe its subject) reached through a wiring detail. */
    const event = {
      hook_event_name: "preToolUse",
      tool_name: "Write",
      tool_input: { file_path: ".cursor/mcp.json" },
    }
    const out = JSON.parse(runCursorHook(JSON.stringify(event)).stdout)
    expect(out.systemMessage, "Claude's envelope leaked into the Cursor edge").toBeUndefined()
    expect(out.hookSpecificOutput, "Claude's envelope leaked into the Cursor edge").toBeUndefined()
  })

  it("never asserts SAFE, and says UNKNOWN is never SAFE", () => {
    const event = {
      hook_event_name: "preToolUse",
      tool_name: "Write",
      tool_input: { file_path: ".cursor/mcp.json" },
    }
    const out = JSON.parse(runCursorHook(JSON.stringify(event)).stdout)
    expect(out.user_message).toMatch(/UNKNOWN is never SAFE/)
    expect(out.agent_message).toMatch(/Do not treat UNKNOWN as SAFE/)
  })

  it("writes NO file when run — captures, never applies", () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-cursor-hook-"))
    try {
      const before = readdirSync(dir)
      const event = {
        hook_event_name: "preToolUse",
        tool_name: "Write",
        tool_input: { file_path: ".cursor/mcp.json" },
      }
      const r = spawnSync(process.execPath, [CURSOR_HOOK], {
        input: JSON.stringify(event),
        encoding: "utf8",
        cwd: dir,
      })
      expect(r.status).toBe(0)
      expect(readdirSync(dir)).toEqual(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("a non-config edit → exit 0, no output (silent)", () => {
    const event = {
      hook_event_name: "preToolUse",
      tool_name: "Write",
      tool_input: { file_path: "src/index.ts" },
    }
    const r = runCursorHook(JSON.stringify(event))
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe("")
  })

  it("malformed and empty stdin → exit 0, no output (never breaks the agent loop)", () => {
    for (const bad of ["{ not json", ""]) {
      const r = runCursorHook(bad)
      expect(r.status, `stdin ${JSON.stringify(bad)} did not exit 0`).toBe(0)
      expect(r.stdout.trim()).toBe("")
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────────────
 * The WIRING. Both edges are reached through a hooks file, and a correct script that
 * no host invokes is indistinguishable from no script at all.
 *
 * WHY TWO FILES AND NOT ONE. A single hooks.json carrying both `PreToolUse` (Claude)
 * and `preToolUse` (Cursor) was the obvious shape and it is REJECTED: measured
 * 2026-08-25, `claude plugin tag` fails with `hooks.preToolUse: Invalid key in
 * record` — Claude validates the hook-event keys against an enum, so Cursor's
 * spelling is not an ignorable extra. Hence Claude keeps `hooks/hooks.json` (the
 * path it discovers by default) and Cursor is pointed at `hooks/cursor-hooks.json`
 * through its manifest's `hooks` field. Neither host can see the other's file.
 *
 * The fault this whole block guards against is silent: Cursor's own template
 * validator only checks that a hooks file EXISTS and never validates event names, so
 * a Claude-only key would ship a plugin whose hook never fires on Cursor and no tool
 * anywhere would report it.
 * ──────────────────────────────────────────────────────────────────────────────── */
describe("hooks wiring — each host reaches its own edge, and neither sees the other's", () => {
  const readJson = (rel: string) =>
    JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"))

  const claudeHooks = readJson("../../plugins/calllint/hooks/hooks.json") as {
    hooks: Record<string, unknown[]>
  }
  const cursorHooks = readJson("../../plugins/calllint/hooks/cursor-hooks.json") as {
    hooks: Record<string, unknown[]>
  }
  const cursorManifest = readJson("../../plugins/calllint/.cursor-plugin/plugin.json") as {
    hooks?: string
  }

  it("Claude's file declares ONLY PreToolUse — Cursor's spelling fails `claude plugin tag`", () => {
    expect(Object.keys(claudeHooks.hooks)).toEqual(["PreToolUse"])
  })

  it("Cursor's file declares ONLY preToolUse", () => {
    expect(Object.keys(cursorHooks.hooks)).toEqual(["preToolUse"])
  })

  it("Cursor's manifest points at Cursor's file (without it, nothing is discovered)", () => {
    expect(cursorManifest.hooks).toBe("hooks/cursor-hooks.json")
  })

  it("points each host at the edge built for it", () => {
    const claude = JSON.stringify(claudeHooks.hooks.PreToolUse)
    const cursor = JSON.stringify(cursorHooks.hooks.preToolUse)
    expect(claude).toContain("preflight.mjs")
    expect(claude).not.toContain("preflight-cursor.mjs")
    expect(cursor).toContain("preflight-cursor.mjs")
  })

  it("uses each host's own path convention, so neither resolves to nothing", () => {
    /* Claude interpolates ${CLAUDE_PLUGIN_ROOT}; Cursor does not, and resolves a
     * relative command against the plugin directory. Each spelling is inert on the
     * other host — which is why they cannot share one entry. */
    expect(JSON.stringify(claudeHooks.hooks.PreToolUse)).toContain("${CLAUDE_PLUGIN_ROOT}")
    expect(
      JSON.stringify(cursorHooks.hooks.preToolUse),
      "a Claude-only variable in Cursor's entry expands to nothing and the hook never runs",
    ).not.toContain("CLAUDE_PLUGIN_ROOT")
  })

  it("does not set failClosed on Cursor's entry (a recommender fails OPEN)", () => {
    /* Cursor's default is false; setting it true would make a crash or timeout in a
     * display-only hook block the user's write — the exact posture ADR 0051 forbids,
     * reachable through config rather than code. */
    for (const entry of cursorHooks.hooks.preToolUse as Record<string, unknown>[]) {
      expect(entry.failClosed, "failClosed:true turns the recommender into a blocker").toBeFalsy()
    }
  })
})

