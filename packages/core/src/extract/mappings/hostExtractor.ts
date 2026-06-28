import type { NormalizedMcpServer } from "@calllint/types"
import type { SurfaceOrigin } from "../fingerprint.js"
import type { HostId } from "../hostHints.js"
import { HOST_HINTS } from "../hostHints.js"
import { extractGenericMcpJson } from "./genericMcpJson.js"
import { extractGenericMcpToml } from "./genericMcpToml.js"

// ---------------------------------------------------------------------------
// Shared host-extractor scaffolding (P2.4). Each Tier-1 host file is a thin
// wrapper that names its HostId; the dialect + scope come from HOST_HINTS and
// the parsing is delegated to the generic mappers. No per-host risk logic.
// ---------------------------------------------------------------------------

export interface HostExtraction {
  host: HostId
  servers: NormalizedMcpServer[]
  /** Surface origin/scope hint for fingerprint derivation (ADR 0019). */
  origin: SurfaceOrigin
}

/**
 * Extract for a host. `input` is config text (JSON for mcp-json hosts, TOML for
 * Codex) or an already-parsed object for JSON hosts. The dialect decides the
 * mapper; the scope comes from the host hint.
 */
export function extractForHost(
  host: HostId,
  input: string | unknown,
  sourceConfigPath?: string,
): HostExtraction {
  const hint = HOST_HINTS[host]
  const path = sourceConfigPath ?? hint.workspacePaths[0] ?? "<inline>"

  let servers: NormalizedMcpServer[]
  if (hint.dialect === "mcp-toml") {
    const text = typeof input === "string" ? input : ""
    servers = extractGenericMcpToml(text, path)
  } else {
    const json = typeof input === "string" ? JSON.parse(input) : input
    servers = extractGenericMcpJson(json, path)
  }

  return { host, servers, origin: hint.defaultScope }
}
