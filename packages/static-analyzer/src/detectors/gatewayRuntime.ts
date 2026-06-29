import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

// ---------------------------------------------------------------------------
// ADR 0023 — LONG_RUNNING_GATEWAY_RUNTIME (#12). A gateway runtime (Hermes,
// OpenClaw, …) is a standing process that proxies/multiplexes many downstream
// MCP servers, with its own auth and a tool surface that can drift after
// approval. The Tier-3 extractors tag such servers with raw.gateway; this
// detector names the standing capability. No per-host engine — generic only.
// Offline: reasons from the extracted config; never starts/enumerates the gateway.
// ---------------------------------------------------------------------------

function gatewayName(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const g = (raw as Record<string, unknown>).gateway
  return typeof g === "string" ? g : undefined
}

export function detectGatewayRuntime(ctx: DetectorContext): Finding[] {
  const gateway = gatewayName(ctx.server.raw)
  if (!gateway) return []

  const evidence: Evidence[] = [{ type: "config", key: "gateway", value: gateway }]

  return [
    {
      id: "runtime.gateway",
      title: "Long-running gateway runtime",
      severity: "medium",
      blocker: false,
      symbol: "ACTION",
      riskClass: "S2",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "config-analysis",
      evidence,
      impact:
        "This is a gateway runtime that proxies and re-exposes many downstream tools under its own process and auth. Its tool surface can change after you approve it.",
      fix: "Treat the gateway as a standing capability: pin its version, review which downstream tools it exposes, and re-verify after upgrades.",
      falsePositiveNote:
        "A gateway you fully control and monitor may be acceptable; the verdict reflects standing capability, not a specific exploit.",
    },
  ]
}
