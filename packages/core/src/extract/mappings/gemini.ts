import { extractForHost, type HostExtraction } from "./hostExtractor.js"

// P2.4 — Gemini. Thin wrapper: delegates to the generic mcp-json mapper with the
// Gemini scope hint. No risk logic (ADR 0018 §15.12).
export function extractGemini(
  input: string | unknown,
  sourceConfigPath?: string,
): HostExtraction {
  return extractForHost("gemini", input, sourceConfigPath)
}
