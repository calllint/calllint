# CallLint — Claude Code plugin

Preflight risk linting for MCP & agent tools, as a Claude Code plugin. Before you
add or edit an agent-tool configuration, CallLint recommends scanning the blast
radius and returns **SAFE / REVIEW / BLOCK / UNKNOWN** with evidence.

> **Advisory and non-blocking.** This plugin *recommends*; it never vetoes a tool
> call, never executes the server it judges, and never treats UNKNOWN as SAFE.
> (See ADR 0051 in the CallLint repository.)

## What it does

- **PreToolUse hook** (`hooks/hooks.json` → `hooks/preflight.mjs`): when Claude is
  about to `Write`/`Edit`/`MultiEdit` an agent-tool config surface (`.cursor/mcp.json`,
  `.vscode/mcp.json`, `.mcp.json`, `.claude/settings.json`, `claude_desktop_config.json`,
  `~/.claude.json`, `SKILL.md`), it surfaces a one-line recommendation to run
  `calllint scan` first. It exits `0` in every case — it does **not** block, deny,
  or gate the edit, and it runs no scan itself.

## Boundaries (ADR 0051)

- The hook is **preflight recommend / display-only, non-blocking**. It always exits
  `0`; it never exits `2` and never emits a `permissionDecision`. Your agent's
  control flow is unchanged.
- Neither the hook nor an LLM enters the verdict path. The hook is a *renderer of a
  recommendation to run the deterministic CLI* — it performs no scan of the pending
  action, executes nothing, and connects to nothing (**INV1**).
- Runtime *blocking* is intentionally out of scope; it stays deferred to a future
  necessity-gated design (ADR 0042 / H3). Installing this plugin does not install a
  blocker.

## Install

```
/plugin marketplace add calllint/calllint
/plugin install calllint@calllint
```

Or test locally from a checkout:

```
claude --plugin-dir ./plugins/calllint
```

## The workflow it recommends

This plugin packages the open **secure-agent-install** workflow: run a content
scanner (e.g. SkillSpector) yourself, then ask CallLint whether the requested
*authority* is acceptable, and install only after approval. See
`skills/secure-agent-install/SKILL.md`.

CallLint is offline by default, deterministic, and never executes the server it
judges. SAFE means "no blockers observed under current evidence" — not a proof of
runtime safety.
