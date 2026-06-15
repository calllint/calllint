import type { RiskClass, RiskSymbol } from "./symbols.js"

export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const
export type Severity = (typeof SEVERITIES)[number]

export const CONFIDENCES = ["low", "medium", "high"] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** Whether a finding is direct evidence or an inference drawn from evidence. */
export type EvidenceMode = "OBSERVED" | "INFERRED"

export const DETECTION_METHODS = [
  "config-analysis",
  "arg-analysis",
  "env-analysis",
  "package-metadata",
  "source-text",
  "tool-metadata",
  "runtime-binding",
  "policy",
] as const
export type DetectionMethod = (typeof DETECTION_METHODS)[number]

export const EVIDENCE_TYPES = [
  "config",
  "source",
  "package-metadata",
  "tool-metadata",
  "policy",
  "runtime-binding",
] as const
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]

export interface Evidence {
  type: EvidenceType
  path?: string
  line?: number
  column?: number
  key?: string
  value?: string
  snippet?: string
  hash?: string
}

export interface Finding {
  /** Stable rule id, e.g. "files.broad-path". */
  id: string
  title: string
  severity: Severity
  /** A critical blocker forces a BLOCK verdict. */
  blocker: boolean
  symbol: RiskSymbol
  riskClass: RiskClass
  mode: EvidenceMode
  confidence: Confidence
  detectionMethod: DetectionMethod
  evidence: Evidence[]
  impact: string
  fix: string
  falsePositiveNote?: string
  /**
   * Provenance of the finding. Defaults to offline (the pure analyzers). Online
   * enrichment (--online) marks its findings "online" so reports can show, and
   * reviewers can audit, which findings depend on network metadata. Online
   * findings are advisory: they may add risk but never downgrade a verdict.
   */
  source?: "offline" | "online"
  /** ISO timestamp the online metadata was fetched at (online findings only). */
  fetchedAt?: string
}
