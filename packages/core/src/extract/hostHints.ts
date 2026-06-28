import type { SurfaceOrigin } from "./fingerprint.js"

// ---------------------------------------------------------------------------
// P2.4 — Host hints (new4 distribution metadata — ADR 0018 §15.8).
//
// Per-host metadata ONLY: known config paths, dialect, and default scope. No
// risk logic lives here. The host extractors read these hints and delegate to
// the generic JSON/TOML mappers, so every host produces the identical
// fingerprint shape.
// ---------------------------------------------------------------------------

export type HostId =
  | "vscode"
  | "cursor"
  | "claude"
  | "codex"
  | "gemini"
  | "windsurf"
  | "cline"

export type HostDialect = "mcp-json" | "mcp-toml"

export interface HostHint {
  id: HostId
  label: string
  dialect: HostDialect
  /** Workspace-relative config paths this host commonly uses. */
  workspacePaths: string[]
  /** Default scope when the config is found at a workspace path. */
  defaultScope: SurfaceOrigin
}

export const HOST_HINTS: Record<HostId, HostHint> = {
  vscode: {
    id: "vscode",
    label: "VS Code / GitHub Copilot",
    dialect: "mcp-json",
    workspacePaths: [".vscode/mcp.json"],
    defaultScope: "workspace",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    dialect: "mcp-json",
    workspacePaths: [".cursor/mcp.json"],
    defaultScope: "workspace",
  },
  claude: {
    id: "claude",
    label: "Claude Code / Claude Desktop",
    dialect: "mcp-json",
    workspacePaths: [".mcp.json", ".claude/settings.json", "claude_desktop_config.json"],
    defaultScope: "workspace",
  },
  codex: {
    id: "codex",
    label: "OpenAI Codex",
    dialect: "mcp-toml",
    workspacePaths: [".codex/config.toml", "config.toml"],
    defaultScope: "workspace",
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    dialect: "mcp-json",
    workspacePaths: [".gemini/settings.json", "settings.json"],
    defaultScope: "workspace",
  },
  windsurf: {
    id: "windsurf",
    label: "Windsurf",
    dialect: "mcp-json",
    workspacePaths: [".codeium/windsurf/mcp_config.json", "mcp_config.json"],
    defaultScope: "workspace",
  },
  cline: {
    id: "cline",
    label: "Cline / OpenCode",
    dialect: "mcp-json",
    workspacePaths: ["cline_mcp_settings.json", ".clinerules/mcp.json"],
    defaultScope: "workspace",
  },
}
