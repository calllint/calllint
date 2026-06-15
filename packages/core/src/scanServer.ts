import type {
  Diagnostic,
  NormalizedMcpServer,
  ScanReport,
  ScanTarget,
  TargetKind,
} from "@mcpguard/types"
import { VERDICT_PUBLIC_LABEL } from "@mcpguard/types"
import { resolveRuntimeBinding } from "@mcpguard/resolver"
import { analyzeServerConfig } from "@mcpguard/static-analyzer"
import { assessServer } from "@mcpguard/risk-engine"
import { applyPolicy } from "@mcpguard/policy"
import { computeFingerprints } from "@mcpguard/fingerprint"
import { resolveScanOptions, type ScanOptions } from "./options.js"
import { summarize } from "./summarize.js"

export interface ScanServerInput {
  server: NormalizedMcpServer
  targetKind?: TargetKind
}

/**
 * The core pipeline for one server:
 *   resolve binding → analyze → assess → fingerprint → apply policy → report.
 * Pure given its options (now/generatedAt injected). Never executes the server.
 */
export function scanServer(input: ScanServerInput, opts?: ScanOptions): ScanReport {
  const { policy, now, generatedAt } = resolveScanOptions(opts)
  const { server } = input

  const binding = resolveRuntimeBinding(server)
  const findings = analyzeServerConfig(server)
  const assessment = assessServer(findings, binding)

  const decision = applyPolicy(
    assessment.verdict,
    server.name,
    findings,
    policy,
    now,
  )
  const verdict = decision.verdict

  const fingerprints = computeFingerprints({
    server,
    binding,
    symbols: assessment.symbols,
    findingIds: findings.map((f) => f.id),
  })

  const diagnostics: Diagnostic[] = []
  if (decision.changed && decision.note) {
    diagnostics.push({ level: "info", code: "policy.applied", message: decision.note })
  }

  const target: ScanTarget = {
    name: server.name,
    kind: input.targetKind ?? "cursor-mcp-config",
    source: binding.packageName ?? binding.remoteUrl,
    version: binding.packageVersionSpec,
    configPath: server.sourceConfigPath,
  }

  return {
    schemaVersion: "mcpguard.report.v0",
    reportKind: "single-target",
    target,
    verdict,
    publicVerdictLabel: VERDICT_PUBLIC_LABEL[verdict],
    policyApplied: decision.changed,
    riskClass: assessment.riskClass,
    symbols: assessment.symbols,
    confidence: assessment.confidence,
    reproducibility: assessment.reproducibility,
    summary: summarize(server.name, verdict, assessment, decision.changed),
    observed: assessment.observed,
    inferred: assessment.inferred,
    findings,
    topFindings: assessment.topFindings,
    policy: assessment.policy,
    fingerprints,
    diagnostics,
    generatedAt,
  }
}
