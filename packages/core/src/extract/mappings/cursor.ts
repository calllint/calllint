import { extractForHost, type HostExtraction } from "./hostExtractor.js"

// P2.4 — Cursor. Thin wrapper: delegates to the generic mcp-json mapper with the
// Cursor scope hint. No risk logic (ADR 0018 §15.12).
export function extractCursor(
  input: string | unknown,
  sourceConfigPath?: string,
): HostExtraction {
  return extractForHost("cursor", input, sourceConfigPath)
}
