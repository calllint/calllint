import type { NormalizedMcpServer } from "@calllint/types"
import { parseSnippet } from "../../surface/snippet.js"

// ---------------------------------------------------------------------------
// P2.3 — Install-snippet extractor (new4 L1 coverage — ADR 0018 §15.12).
//
// Thin adapter over parseSnippet (P1.6): `claude mcp add`, `npx`/`uvx`/`bunx`,
// `docker run` install snippets → normalized servers. Acceptance: a snippet
// yields the SAME fingerprint as the equivalent config file (proven in tests),
// because both flow through synthesizeNpmConfig → normalizeMcpServers.
// ---------------------------------------------------------------------------

export interface ExtractedSnippet {
  servers: NormalizedMcpServer[]
  packageSpec: string
}

/**
 * Extract normalized servers from an install snippet. Throws when no agent-tool
 * package is recognized — the caller reports UNKNOWN, never SAFE (ADR 0010).
 */
export function extractInstallSnippet(text: string): ExtractedSnippet {
  const { parsed, packageSpec } = parseSnippet(text)
  return { servers: parsed.servers, packageSpec }
}
