import { extractForHost, type HostExtraction } from "./hostExtractor.js"

// P2.4 — VS Code / GitHub Copilot. Thin wrapper: delegates to the generic
// mcp-json mapper with the VS Code scope hint. No risk logic (ADR 0018 §15.12).
export function extractVscode(
  input: string | unknown,
  sourceConfigPath?: string,
): HostExtraction {
  return extractForHost("vscode", input, sourceConfigPath)
}
