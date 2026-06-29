import { extractForHost, type HostExtraction } from "./hostExtractor.js"

// P2.4 — OpenAI Codex. Thin wrapper over the generic mcp-TOML mapper (config.toml
// `[mcp_servers.*]`) with the Codex scope hint. No risk logic (ADR 0018 §15.12).
export function extractCodex(
  input: string,
  sourceConfigPath?: string,
): HostExtraction {
  return extractForHost("codex", input, sourceConfigPath)
}
