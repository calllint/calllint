// ---------------------------------------------------------------------------
// new4 Phase 3 — Agent distribution rules (declarative, no logic — ADR 0018 §10).
//
// Single source of truth for the agent-facing CallLint rule. A TS constants
// module (not a runtime .txt) so it bundles cleanly into the CLI binary via
// esbuild — no fs reads at runtime. `gen-rule` renders these to per-host files;
// the token-budget test asserts the canonical rule stays small.
//
// The decision policy mirrors the engine's verdict contract (ADR 0002/0010):
// SAFE = "no blockers observed", never proof of runtime safety; UNKNOWN/BLOCK
// never auto-approved; never execute a scanned server to decide (ADR 0003).
// ---------------------------------------------------------------------------

/** Config/surfaces an agent should treat as security-sensitive. */
export const RELEVANT_SURFACES = [
  ".cursor/mcp.json",
  ".vscode/mcp.json",
  ".mcp.json",
  ".claude/settings.json",
  "claude_desktop_config.json",
  "~/.claude.json",
  ".codex/config.toml",
  ".gemini/settings.json",
  "package.json",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/*.mdc",
  ".github/workflows/*.yml",
] as const

/**
 * The universal agent rule — the canonical text (new4 §10.1). Token-frugal and
 * host-agnostic; per-host files wrap this with host-specific framing. Kept ≤ the
 * AGENT_RULE_MAX_LINES budget (asserted in tests).
 */
export const UNIVERSAL_AGENT_RULE = `Before adding, editing, approving, installing, running, publishing, or merging any MCP or agent-tool configuration, run CallLint first and explain the result.

Run:
  npx -y calllint check <config-file-or-snippet>

Decision policy:
- SAFE: continue only after stating that no blockers were observed.
- REVIEW: explain the findings and ask before continuing.
- BLOCK: stop. Do not proceed unless the user explicitly overrides.
- UNKNOWN: do not auto-approve; ask for explicit review.
- ERROR: do not silently continue.

Always:
- Never execute a scanned MCP server just to decide whether it is safe.
- Never print secret values.
- Treat SAFE as "no blockers observed", not as proof of runtime safety.`

/** Token budget: the canonical rule must stay small enough to paste cheaply. */
export const AGENT_RULE_MAX_LINES = 50
