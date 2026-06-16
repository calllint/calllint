import type {
  Diagnostic,
  NormalizedMcpServer,
  ScanReport,
  ScanTarget,
  TargetKind,
} from "@calllint/types"
import { VERDICT_PUBLIC_LABEL, VERDICT_SEVERITY } from "@calllint/types"
import { resolveRuntimeBinding } from "@calllint/resolver"
import { analyzeServerConfig } from "@calllint/static-analyzer"
import { assessServer } from "@calllint/risk-engine"
import { applyPolicy } from "@calllint/policy"
import { computeFingerprints } from "@calllint/fingerprint"
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
  const { policy, now, generatedAt, extraFindings } = resolveScanOptions(opts)
  const { server } = input

  const binding = resolveRuntimeBinding(server)
  const staticFindings = analyzeServerConfig(server)
  const injected = extraFindings[server.name] ?? []
  // Merge in any injected findings for this server (e.g. --online npm facts).
  const findings = [...staticFindings, ...injected]
  const assessment = assessServer(findings, binding)

  // --- Online no-downgrade invariant (enforced, not just convention). ---
  // Online enrichment is advisory: it may surface more risk, never less. We
  // recompute the offline-only verdict and require the enriched verdict to be
  // at least as severe. A regression here means an injected finding somehow
  // lowered the verdict, which must never happen — fail loudly.
  if (injected.length > 0) {
    const offlineVerdict = assessServer(staticFindings, binding).verdict
    if (VERDICT_SEVERITY[assessment.verdict] < VERDICT_SEVERITY[offlineVerdict]) {
      throw new Error(
        `Online enrichment downgraded verdict for "${server.name}" ` +
          `(${offlineVerdict} -> ${assessment.verdict}); enrichment must never lower risk.`,
      )
    }
  }

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
    schemaVersion: "calllint.report.v0",
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
