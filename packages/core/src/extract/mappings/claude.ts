import { extractForHost, type HostExtraction } from "./hostExtractor.js"

// P2.4 — Claude. Thin wrapper: delegates to the generic mcp-json mapper with the
// Claude scope hint. No risk logic (ADR 0018 §15.12).
export function extractClaude(
  input: string | unknown,
  sourceConfigPath?: string,
): HostExtraction {
  return extractForHost("claude", input, sourceConfigPath)
}
