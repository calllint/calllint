import { parseConfigFile, parseConfigText, type ParsedConfig } from "@calllint/config-parser"
import type { SurfaceOrigin } from "../extract/fingerprint.js"

// ---------------------------------------------------------------------------
// P1.6 — Surface load (new4 L0 input — ADR 0018).
//
// Thin wrapper over the existing config-parser. Adds surface-origin inference
// (workspace / user / system / remote / unknown) so the fingerprint can derive
// `scope` without guessing (ADR 0019 Decision 1).
// ---------------------------------------------------------------------------

export interface LoadedSurface {
  parsed: ParsedConfig
  origin: SurfaceOrigin
}

/** Infer where a surface lives from its path. Ambiguous → unknown (never workspace). */
export function inferOrigin(path: string): SurfaceOrigin {
  const n = path.replace(/\\/g, "/").toLowerCase()
  if (n.startsWith("npm:") || n.startsWith("http://") || n.startsWith("https://")) {
    return "remote"
  }
  // User-level host config locations.
  if (
    n.includes("/library/application support/") || // macOS
    n.includes("/.config/") ||
    n.includes("/appdata/") || // Windows
    n.includes("/users/") && n.includes("/.cursor/") === false && n.includes("/.vscode/") === false
  ) {
    // Heuristic: a home-dir config that is not a workspace dotfile is user scope.
    if (!n.includes("/.cursor/") && !n.includes("/.vscode/") && !n.startsWith("./")) {
      return "user"
    }
  }
  // Workspace dotfiles / project-relative configs.
  if (
    n.includes("/.cursor/") ||
    n.includes("/.vscode/") ||
    n.includes("/.github/") ||
    n.startsWith(".cursor/") ||
    n.startsWith(".vscode/") ||
    n.startsWith(".github/") ||
    n === ".mcp.json" ||
    n.startsWith("./")
  ) {
    return "workspace"
  }
  return "unknown"
}

export function loadSurfaceFile(path: string): LoadedSurface {
  return { parsed: parseConfigFile(path), origin: inferOrigin(path) }
}

export function loadSurfaceText(text: string, configPath = "<inline>"): LoadedSurface {
  return { parsed: parseConfigText(text, configPath), origin: inferOrigin(configPath) }
}
