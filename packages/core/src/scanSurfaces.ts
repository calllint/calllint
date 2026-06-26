import type { DocumentSurface, ScanReport } from "@calllint/types"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import { analyzeDocumentSurfaces } from "@calllint/static-analyzer"

/**
 * Build a project-level ScanReport from local document surfaces (ADR 0015), or
 * undefined when there is nothing to report (no surfaces, or no findings). Pure:
 * the CLI reads the files; this only scans the text it is handed.
 *
 * The surface report is REVIEW at most (the analyzer emits a non-blocker finding),
 * so appending it can only hold or raise the aggregate verdict — never lower it —
 * and an empty/clean surface adds no report (no spurious UNKNOWN).
 */
export function scanDocumentSurfaces(
  surfaces: readonly DocumentSurface[],
  configPath: string,
  generatedAt: string,
): ScanReport | undefined {
  if (surfaces.length === 0) return undefined

  const findings = analyzeDocumentSurfaces(surfaces)
  if (findings.length === 0) return undefined

  const truncated = surfaces.some((s) => s.truncated)

  return {
    schemaVersion: "calllint.report.v0",
    reportKind: "single-target",
    target: {
      name: "project-docs",
      kind: "project-docs",
      configPath,
    },
    verdict: "REVIEW",
    publicVerdictLabel: VERDICT_PUBLIC_LABEL.REVIEW,
    riskClass: "S2",
    symbols: ["PROMPT"],
    confidence: "medium",
    reproducibility: {
      level: "HIGH",
      reasons: ["Static scan of local documents; deterministic given the same files."],
    },
    summary:
      "Project documents contain model-directed or hidden prompt-surface content; review the cited files.",
    observed: findings,
    inferred: [],
    findings,
    topFindings: findings,
    policy: {
      autonomousUse: "warn",
      manualApproval: "recommended",
      sandbox: "recommended",
    },
    fingerprints: {
      configHash: "",
      targetSpecHash: "",
      riskSurfaceHash: "",
    },
    diagnostics: truncated
      ? [
          {
            level: "info",
            code: "surface.truncated",
            message:
              "One or more project documents exceeded the scan size cap and were truncated.",
          },
        ]
      : [],
    generatedAt,
  }
}
