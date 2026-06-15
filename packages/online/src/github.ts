import type { FetchJson } from "./npm.js"

/** Injectable text fetcher (for raw file contents). Returns undefined on 404/error. */
export type FetchText = (url: string) => Promise<string | undefined>

/** Candidate MCP config paths to probe in a GitHub repo, in priority order. */
export const GITHUB_CONFIG_CANDIDATES = [
  ".cursor/mcp.json",
  ".mcp.json",
  "mcp.json",
  ".vscode/mcp.json",
  ".claude/settings.json",
]

export interface GithubConfigResult {
  /** The raw config text, if a candidate was found. */
  text?: string
  /** The repo-relative path that was found. */
  foundPath?: string
  /** The ref that was used. */
  ref: string
}

function rawUrl(repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${path}`
}

/**
 * Probe a GitHub repo for a known MCP config file and return its raw text.
 * Tries each candidate path at the given ref (default "HEAD"). Pure given the
 * injected fetchText. Network errors yield `text: undefined`.
 */
export async function fetchGithubConfig(
  repo: string,
  fetchText: FetchText,
  ref = "HEAD",
): Promise<GithubConfigResult> {
  for (const path of GITHUB_CONFIG_CANDIDATES) {
    const text = await fetchText(rawUrl(repo, ref, path))
    if (text && text.trim().length > 0) {
      return { text, foundPath: path, ref }
    }
  }
  return { ref }
}

/** Adapt a JSON FetchJson into a FetchText (best-effort, for shared transport). */
export type { FetchJson }
