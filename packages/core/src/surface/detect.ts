// ---------------------------------------------------------------------------
// P1.5 — Surface trigger (new4 L0 — ADR 0018).
//
// "Does this input change agent tool capability?" Returns SCAN for agent-tool
// surfaces, NOOP for everything else. A guard, not a scanner: ordinary source
// edits and node_modules always return NOOP so the tool never nags.
// ---------------------------------------------------------------------------

export type SurfaceVerdict = "NOOP" | "SCAN"

/** Basenames that are MCP configs across hosts. */
const MCP_CONFIG_BASENAMES = new Set([
  ".mcp.json",
  "mcp.json",
  "claude_desktop_config.json",
  "mcp_config.json",
])

/** Path fragments that indicate a host MCP config location. */
const MCP_PATH_HINTS = [
  "/.cursor/mcp.json",
  "/.vscode/mcp.json",
  "\\.cursor\\mcp.json",
  "\\.vscode\\mcp.json",
]

/** Snippet markers that install or launch an agent tool. */
const SNIPPET_MARKERS = [
  /\bclaude\s+mcp\s+add\b/,
  /\bnpx\s+-y?\b/,
  /\buvx\b/,
  /\bbunx\b/,
  /\bdocker\s+run\b/,
  /\bopenclaw\s+mcp\b/,
]

function normalize(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase()
}

function basename(path: string): string {
  const n = normalize(path)
  const i = n.lastIndexOf("/")
  return i === -1 ? n : n.slice(i + 1)
}

/**
 * Classify a path (and optional content) as NOOP or SCAN.
 *
 * node_modules and lockfiles are ALWAYS NOOP (new4 §3 default-path guarantee).
 * Content, when provided, can promote an otherwise-plain file (README, a config
 * with mcpServers) to SCAN.
 */
export function classifySurface(path: string, content?: string): SurfaceVerdict {
  const n = normalize(path)

  // Hard NOOP: never descend into dependencies or lockfiles.
  if (n.includes("/node_modules/") || n.startsWith("node_modules/")) return "NOOP"
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(n)) return "NOOP"

  const base = basename(path)

  // Known MCP config filenames / locations.
  if (MCP_CONFIG_BASENAMES.has(base)) return "SCAN"
  if (MCP_PATH_HINTS.some((h) => normalize(path).includes(normalize(h)))) return "SCAN"

  // Codex config.toml only when it actually declares mcp servers.
  if (base === "config.toml" && content && /\[mcp_servers?\.[^\]]+\]/.test(content)) {
    return "SCAN"
  }

  // settings.json (VS Code / others) only when it declares mcpServers.
  if (base === "settings.json" && content && /"mcpServers"\s*:/.test(content)) {
    return "SCAN"
  }

  // README / markdown install blocks with an agent-tool install snippet.
  if (/\.(md|markdown)$/.test(n) && content && SNIPPET_MARKERS.some((r) => r.test(content))) {
    return "SCAN"
  }

  // GitHub Actions workflow that runs an agent tool.
  if (/\/\.github\/workflows\/[^/]+\.ya?ml$/.test(n) && content && SNIPPET_MARKERS.some((r) => r.test(content))) {
    return "SCAN"
  }

  // A bare snippet handed in as content (no meaningful path), e.g. stdin.
  if ((path === "-" || path === "" || base === "stdin") && content && SNIPPET_MARKERS.some((r) => r.test(content))) {
    return "SCAN"
  }

  return "NOOP"
}
