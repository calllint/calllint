import type { CapabilityFingerprint, NormalizedMcpServer } from "@calllint/types"
import { extractGenericMcpJson } from "./genericMcpJson.js"
import { extractInstallSnippet } from "./installSnippet.js"

// ---------------------------------------------------------------------------
// P2.5 — OpenClaw gateway extractor (new4 Tier-3 — ADR 0018 / 0023).
//
// OpenClaw is an agent GATEWAY runtime, not an ordinary IDE. It is expressed as
// `openclaw mcp add/serve/configure/login` command snippets or an export JSON.
// This extractor surfaces it as a fingerprint with kind=gateway_runtime; the
// risk is then named by the GENERIC reason codes (LONG_RUNNING_GATEWAY_RUNTIME,
// OAUTH_SCOPE_*, UNKNOWN_REMOTE, …). NO openclawRisk.ts — no per-host engine.
// ---------------------------------------------------------------------------

export interface GatewayExtraction {
  servers: NormalizedMcpServer[]
  /** Always gateway_runtime — drives ADR 0023 reason code. */
  kind: CapabilityFingerprint["kind"]
}

const OPENCLAW_SNIPPET = /\bopenclaw\s+(mcp\s+add|serve|configure|login)\b/

export function isOpenClawSnippet(text: string): boolean {
  return OPENCLAW_SNIPPET.test(text)
}

/**
 * Extract from an OpenClaw command snippet or export JSON. Returns servers
 * tagged as a gateway runtime. Throws on an unrecognized snippet → caller
 * reports UNKNOWN (never SAFE; ADR 0010).
 */
export function extractOpenClaw(input: string): GatewayExtraction {
  const text = input.trim()

  // Export JSON: an object with mcpServers / servers.
  if (text.startsWith("{")) {
    return { servers: extractGenericMcpJson(JSON.parse(text), "openclaw-export.json"), kind: "gateway_runtime" }
  }

  // `openclaw mcp add NAME -- npx -y pkg` → reuse the install-snippet extractor
  // for the inner command; the gateway kind is what distinguishes it.
  if (isOpenClawSnippet(text)) {
    const dashes = text.indexOf("--")
    if (dashes !== -1) {
      const inner = text.slice(dashes + 2).trim()
      try {
        const { servers } = extractInstallSnippet(inner)
        return { servers, kind: "gateway_runtime" }
      } catch {
        // fall through to the no-inner case
      }
    }
    // A gateway command with no concrete downstream package: a standing gateway
    // with an unexamined tool surface. Synthesize a placeholder server so the
    // pipeline produces a fingerprint; identity stays unknown.
    return {
      servers: [gatewayPlaceholder()],
      kind: "gateway_runtime",
    }
  }

  throw new Error("No OpenClaw gateway capability recognized in input")
}

function gatewayPlaceholder(): NormalizedMcpServer {
  return {
    name: "openclaw-gateway",
    sourceConfigPath: "openclaw",
    transport: "unknown",
    command: "openclaw",
    args: [],
    envKeys: [],
    env: {},
    providedTools: [],
    raw: { gateway: "openclaw" },
  }
}
