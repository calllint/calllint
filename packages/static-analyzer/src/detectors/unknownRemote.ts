import type { Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

/** Hosts we treat as verified first-party sources. */
const KNOWN_HOSTS = [
  "modelcontextprotocol.io",
  "api.githubcopilot.com",
  "mcp.anthropic.com",
]

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Flags a remote MCP server whose source cannot be verified (T09). This is the
 * primary driver of the UNKNOWN verdict: we can see it points somewhere, but we
 * cannot inspect what it will do, and we will not execute it to find out.
 */
export function detectUnknownRemote(ctx: DetectorContext): Finding[] {
  const { server, binding } = ctx
  if (!binding.remoteUrl) return []

  const host = hostOf(binding.remoteUrl)
  if (host && KNOWN_HOSTS.some((k) => host === k || host.endsWith("." + k))) {
    return []
  }

  return [
    {
      id: "supply.unknown-remote",
      title: "Remote server source cannot be verified",
      severity: "high",
      blocker: false,
      symbol: "NETWORK",
      riskClass: "S1",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "runtime-binding",
      evidence: [
        {
          type: "runtime-binding",
          path: server.sourceConfigPath,
          key: "url",
          value: binding.remoteUrl,
        },
      ],
      impact:
        "The server runs on an unverified remote endpoint. Its tools, permissions, and behavior cannot be inspected statically and may change at any time.",
      fix: "Use a verified first-party endpoint, or run the server from a pinned, inspectable package.",
      falsePositiveNote:
        "A trusted internal endpoint may be fine; add it to the policy allowlist to verify it.",
    },
  ]
}
