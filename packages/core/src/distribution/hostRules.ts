import { RELEVANT_SURFACES, UNIVERSAL_AGENT_RULE } from "./agentRule.js"

// ---------------------------------------------------------------------------
// Per-host rule rendering (P3.2). Each target wraps the ONE universal rule
// (agentRule.ts) with host-appropriate framing — frontmatter, filename, intro.
// No risk logic; pure text composition. `gen-rule` writes these to disk.
// ---------------------------------------------------------------------------

export const RULE_HOSTS = [
  "claude",
  "agents",
  "cursor",
  "copilot",
  "codex",
  "gemini",
  "windsurf",
  "cline",
  "command",
] as const

export type RuleHost = (typeof RULE_HOSTS)[number]

export interface RuleTarget {
  host: RuleHost
  /** Recommended output path, relative to the repo root. */
  path: string
  label: string
}

export const RULE_TARGETS: Record<RuleHost, RuleTarget> = {
  claude: { host: "claude", path: "CLAUDE.md", label: "Claude Code / Claude Desktop" },
  agents: { host: "agents", path: "AGENTS.md", label: "Generic coding/IDE/CI agents" },
  cursor: { host: "cursor", path: ".cursor/rules/calllint.mdc", label: "Cursor" },
  copilot: {
    host: "copilot",
    path: ".github/copilot-instructions.md",
    label: "VS Code / GitHub Copilot",
  },
  codex: { host: "codex", path: ".codex/AGENTS.md", label: "OpenAI Codex" },
  gemini: { host: "gemini", path: ".gemini/GEMINI.md", label: "Gemini CLI" },
  windsurf: { host: "windsurf", path: ".windsurf/rules/calllint.md", label: "Windsurf" },
  cline: { host: "cline", path: ".clinerules/calllint.md", label: "Cline" },
  command: { host: "command", path: ".claude/commands/calllint.md", label: "Claude slash command" },
}

function surfaceList(): string {
  return RELEVANT_SURFACES.map((s) => `- ${s}`).join("\n")
}

/** Indent each line of the universal rule by removing nothing — used verbatim. */
function rule(): string {
  return UNIVERSAL_AGENT_RULE
}

function markdownBody(intro: string): string {
  return `# CallLint Agent Tool Safety Rule

${intro}

Relevant files include:

${surfaceList()}

${rule()}
`
}

/** Render the full file content for a host. */
export function renderHostRule(host: RuleHost): string {
  switch (host) {
    case "claude":
      return markdownBody(
        "Treat MCP and agent-tool configuration as security-sensitive infrastructure in this repository.",
      )

    case "agents":
      return markdownBody(
        "This rule applies to all coding agents, IDE agents, CI agents, and automation agents working in this repository. Treat MCP and agent-tool configuration as security-sensitive infrastructure.",
      )

    case "copilot":
      return markdownBody(
        "When working in this repository, treat MCP and agent-tool configuration as security-sensitive infrastructure.",
      )

    case "codex":
    case "gemini":
    case "windsurf":
    case "cline":
      return markdownBody(
        `Treat MCP and agent-tool configuration as security-sensitive infrastructure (${RULE_TARGETS[host].label}).`,
      )

    case "cursor":
      return `---
description: Require CallLint before MCP or agent-tool permission changes
alwaysApply: true
---

Treat MCP and agent-tool configuration as security-sensitive infrastructure.

Relevant files include:

${surfaceList()}

${rule()}
`

    case "command":
      return `# /calllint

Run CallLint against MCP and agent-tool configuration in this repository.

Steps:

1. Find relevant files:

${surfaceList()}

2. For each, run \`npx -y calllint check <file>\` (or \`calllint scan-all\` for the whole repo).
3. Apply the decision policy below.

${rule()}
`
  }
}
