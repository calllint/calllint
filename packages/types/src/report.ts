import type { Confidence, Finding } from "./finding.js"
import type {
  Fingerprints,
  Reproducibility,
  CapabilityFingerprint,
} from "./fingerprint.js"
import type { CompactDecision } from "./decision.js"
import type { RecommendedPolicy } from "./policy.js"
import type { RiskClass, RiskSymbol } from "./symbols.js"
import type { Verdict } from "./verdict.js"
import type { GatewayEvidence } from "./trustGateway.js"

export const TARGET_KINDS = [
  "cursor-mcp-config",
  "claude-settings",
  "vscode-mcp-config",
  "windsurf-mcp-config",
  "npm",
  "github",
  "inline",
  "project-docs",
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
 * The single source of truth for all CallLint output.
 * CLI, JSON, IDE and Web reports all render from this.
 */
export interface ScanReport {
  schemaVersion: "calllint.report.v0"
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
  /**
   * Optional new4 L1 projection (ADR 0018/0019). Additive — existing consumers
   * ignore it. Populated when the scan derives a capability fingerprint.
   */
  fingerprint?: CapabilityFingerprint
  /**
   * Optional new4 L2 projection (ADR 0018/0020). The compact decision derived
   * from this report. Additive — existing consumers ignore it.
   */
  decision?: CompactDecision
}

/**
 * A summary report for a whole config file containing multiple servers.
 * The aggregate verdict is the most severe child verdict.
 */
export interface ConfigSummaryReport {
  schemaVersion: "calllint.report.v0"
  reportKind: "config-summary"
  configPath: string
  verdict: Verdict
  publicVerdictLabel: string
  counts: Record<Verdict, number>
  reports: ScanReport[]
  diagnostics: Diagnostic[]
  generatedAt: string
  /**
   * Optional external scanner evidence attached via `scan --evidence <file>`
   * (ADR 0034). Provenance-preserved and never re-scored: it is a supporting
   * projection shown side-by-side in the joint Trust Packet, NOT a verdict input
   * — the CallLint verdict above is computed exactly as without evidence. Absent
   * (undefined) unless evidence was explicitly attached, so default scan output
   * stays byte-identical. External SAFE never upgrades a CallLint verdict.
   */
  evidence?: GatewayEvidence[]
}
