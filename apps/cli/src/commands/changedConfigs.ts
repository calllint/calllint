import { basename, resolve } from "node:path"
import { existsSync } from "node:fs"
import { DEFAULT_CONFIG_PATHS } from "./resolveInput.js"

/**
 * Return absolute paths of agent-tool config files that appear in a git diff
 * and exist on disk.  The diff is injected so this function stays pure and
 * testable without a real git repo.
 *
 * @param cwd  Working directory — changed paths are resolved relative to it.
 * @param diff Returns newline-separated relative file paths (e.g. from
 *             `git diff --name-only HEAD`).  An empty string or a thrown
 *             error both mean "no changed files".
 */
export function changedConfigPaths(cwd: string, diff: () => string): string[] {
  let raw: string
  try {
    raw = diff()
  } catch {
    return []
  }

  // Build a quick lookup: both the full relative pattern AND the basename, so
  // nested paths like `.cursor/mcp.json` inside a sub-directory also match.
  const knownLeaves = new Set(DEFAULT_CONFIG_PATHS.map((p) => basename(p)))
  const knownPaths = new Set(DEFAULT_CONFIG_PATHS)

  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (f) =>
        f.length > 0 &&
        (knownPaths.has(f) ||
          DEFAULT_CONFIG_PATHS.some((p) => f.endsWith("/" + p)) ||
          knownLeaves.has(basename(f))),
    )
    .map((f) => resolve(cwd, f))
    .filter((abs) => existsSync(abs))
}
