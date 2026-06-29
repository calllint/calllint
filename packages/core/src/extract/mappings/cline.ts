import { extractForHost, type HostExtraction } from "./hostExtractor.js"

// P2.4 — Cline. Thin wrapper: delegates to the generic mcp-json mapper with the
// Cline scope hint. No risk logic (ADR 0018 §15.12).
export function extractCline(
  input: string | unknown,
  sourceConfigPath?: string,
): HostExtraction {
  return extractForHost("cline", input, sourceConfigPath)
}
