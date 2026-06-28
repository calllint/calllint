import { synthesizeNpmConfig } from "../targets.js"
import { parseConfigText, type ParsedConfig } from "@calllint/config-parser"

// ---------------------------------------------------------------------------
// P1.6 — Install-snippet parsing (new4 L0 input — ADR 0018).
//
// Turns an install snippet into the same normalized config the pipeline already
// consumes, reusing parseTargetSpec / synthesizeNpmConfig. Supports the common
// shapes: a bare package spec, `npx -y pkg`, `uvx pkg`, `bunx pkg`, and
// `claude mcp add … -- npx -y pkg`.
// ---------------------------------------------------------------------------

export interface ParsedSnippet {
  parsed: ParsedConfig
  /** The package spec we extracted, for diagnostics. */
  packageSpec: string
}

const RUNNER_RE = /\b(?:npx|uvx|bunx|pnpm dlx)\s+(?:-y\s+|--yes\s+)?(@?[\w./-]+(?:@[\w.^~>=<-]+)?)/
const CLAUDE_ADD_RE = /\bclaude\s+mcp\s+add\b.*?--\s+(.+)$/

/** Extract a package spec from a snippet, or undefined if none recognized. */
export function extractPackageSpec(text: string): string | undefined {
  const trimmed = text.trim()

  // `claude mcp add NAME -- npx -y pkg` → recurse on the post-`--` command.
  const claude = CLAUDE_ADD_RE.exec(trimmed)
  if (claude) {
    const inner = extractPackageSpec(claude[1]!)
    if (inner) return inner
  }

  const runner = RUNNER_RE.exec(trimmed)
  if (runner) return runner[1]

  // A bare `@scope/pkg@1.2.3` or `pkg@1.2.3` token on its own.
  if (/^@?[\w./-]+(@[\w.^~>=<-]+)?$/.test(trimmed)) return trimmed

  return undefined
}

/**
 * Parse an install snippet into a scannable config. Throws if no package spec
 * can be recognized (the caller should report UNKNOWN, not SAFE).
 */
export function parseSnippet(text: string): ParsedSnippet {
  const spec = extractPackageSpec(text)
  if (!spec) {
    throw new Error("No agent-tool package recognized in snippet")
  }
  // synthesizeNpmConfig builds a config the offline pipeline understands.
  const { text: configText, configPath } = synthesizeNpmConfig(spec)
  return { parsed: parseConfigText(configText, configPath), packageSpec: spec }
}
