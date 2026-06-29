import type { NormalizedMcpServer } from "@calllint/types"
import { normalizeMcpServers } from "@calllint/config-parser"

// ---------------------------------------------------------------------------
// P2.1 — Generic MCP JSON extractor (new4 L1 coverage — ADR 0018 §15.12).
//
// The common `{ mcpServers: { name: { command, args, env, url, transport } } }`
// shape used by Cursor, VS Code, Claude, Gemini, Windsurf, Cline. Most hosts are
// thin wrappers over this; per-host files only add path hints + scope.
//
// This adds NO risk logic — it delegates to the existing, tolerant
// normalizeMcpServers so every host yields the identical NormalizedMcpServer
// shape (and therefore the identical fingerprint).
// ---------------------------------------------------------------------------

/** Extract normalized servers from a parsed generic-MCP JSON object. */
export function extractGenericMcpJson(
  json: unknown,
  sourceConfigPath = "<inline>",
): NormalizedMcpServer[] {
  return normalizeMcpServers(json, sourceConfigPath)
}

/** Convenience: parse text then extract. Throws on invalid JSON (caller: UNKNOWN). */
export function extractGenericMcpJsonText(
  text: string,
  sourceConfigPath = "<inline>",
): NormalizedMcpServer[] {
  return extractGenericMcpJson(JSON.parse(text), sourceConfigPath)
}
