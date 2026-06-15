import type { Confidence, Finding } from "./finding.js"
import type { Fingerprints, Reproducibility } from "./fingerprint.js"
import type { RecommendedPolicy } from "./policy.js"
import type { RiskClass, RiskSymbol } from "./symbols.js"
import type { Verdict } from "./verdict.js"

export const TARGET_KINDS = [
  "cursor-mcp-config",
  "claude-settings",
  "npm",
  "github",
  "inline",
] as const
export type TargetKind = (typeof TARGET_KINDS)[number]

export interface ScanTarget {
  name: string
  kind: TargetKind
  source?: string
  version?: string
  configPath?: string
}

export const DIAGNOSTIC_LEVELS = ["info", "warning", "error"] as const
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number]

export interface Diagnostic {
  level: DiagnosticLevel
  code: string
  message: string
}

export type ReportKind = "single-target" | "config-summary"

/**
 * The single source of truth for all MCPGuard output.
 * CLI, JSON, IDE and Web reports all render from this.
 */
export interface ScanReport {
  schemaVersion: "mcpguard.report.v0"
  reportKind: ReportKind
  target: ScanTarget
  verdict: Verdict
  /** Legally careful label, derived from verdict. */
  publicVerdictLabel: string
  /** True when policy changed the verdict away from the engine's raw verdict. */
  policyApplied?: boolean
  riskClass: RiskClass
  symbols: RiskSymbol[]
  confidence: Confidence
  reproducibility: Reproducibility
  summary: string
  /** Findings tagged OBSERVED. */
  observed: Finding[]
  /** Findings tagged INFERRED. */
  inferred: Finding[]
  /** All findings (observed + inferred), the canonical list. */
  findings: Finding[]
  /** The most important findings, for the 5-second view. */
  topFindings: Finding[]
  policy: RecommendedPolicy
  fingerprints: Fingerprints
  diagnostics: Diagnostic[]
  generatedAt: string
}

/**
 * A summary report for a whole config file containing multiple servers.
 * The aggregate verdict is the most severe child verdict.
 */
export interface ConfigSummaryReport {
  schemaVersion: "mcpguard.report.v0"
  reportKind: "config-summary"
  configPath: string
  verdict: Verdict
  publicVerdictLabel: string
  counts: Record<Verdict, number>
  reports: ScanReport[]
  diagnostics: Diagnostic[]
  generatedAt: string
}
