import type { CompactDecision } from "@calllint/types"
import type { ParsedConfig } from "@calllint/config-parser"
import { resolveRuntimeBinding } from "@calllint/resolver"
import { analyzeServerConfig } from "@calllint/static-analyzer"
import { scanServer } from "../scanServer.js"
import { buildFingerprint, type SurfaceOrigin } from "../extract/fingerprint.js"
import { toCompactDecision } from "./decide.js"
import { resolveScanOptions, type ScanOptions } from "../options.js"

// ---------------------------------------------------------------------------
// L0–L2 orchestrator (new4 — ADR 0018). Given a parsed surface, produce one
// compact decision per server, reusing the existing pipeline for the verdict
// (scanServer) and adding the capability fingerprint (ADR 0019) + reason-code
// projection (ADR 0020). The rich ScanReport stays available for the Evidence
// layer (--explain), but the default output is these compact decisions.
// ---------------------------------------------------------------------------

export interface SurfaceDecision {
  decision: CompactDecision
  /** The underlying report, for --explain / --json --full (Evidence layer). */
  report: ReturnType<typeof scanServer>
}

/**
 * Decide for every server in a parsed surface. Pure given options. Never
 * executes a server (ADR 0003) and never touches the network on this path.
 */
export function checkParsed(
  parsed: ParsedConfig,
  surface: string,
  origin: SurfaceOrigin,
  opts?: ScanOptions,
): SurfaceDecision[] {
  // Resolve options so generatedAt/now are deterministic, consistent with scanServer.
  resolveScanOptions(opts)
  return parsed.servers.map((server) => {
    const binding = resolveRuntimeBinding(server)
    const findings = analyzeServerConfig(server)
    const report = scanServer({ server, targetKind: parsed.kind }, opts)
    const fingerprint = buildFingerprint({ server, binding, findings, origin })
    const decision = toCompactDecision(report, surface, fingerprint)
    return { decision: { ...decision }, report: { ...report, fingerprint, decision } }
  })
}
