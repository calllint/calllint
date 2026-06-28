import { extractForHost, type HostExtraction } from "./hostExtractor.js"

// P2.4 — Windsurf. Thin wrapper: delegates to the generic mcp-json mapper with the
// Windsurf scope hint. No risk logic (ADR 0018 §15.12).
export function extractWindsurf(
  input: string | unknown,
  sourceConfigPath?: string,
): HostExtraction {
  return extractForHost("windsurf", input, sourceConfigPath)
}
