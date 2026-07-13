/**
 * calllint.evidence-provider.v0 — normalized envelope for a third-party scanner's
 * report (SkillSpector, OSV, Semgrep, …). CallLint records external evidence with
 * provenance but NEVER re-scores or renames the provider's own findings/verdict.
 * See ADR 0034 and docs/new7-packet-a-evidence.md.
 */

export type ScanMode = "static" | "llm" | "deep"
export type Completeness = "complete" | "partial" | "degraded" | "failed"

/** A provider-native finding, kept verbatim (never remapped to CallLint severity). */
export interface EvidenceFinding {
  /** The provider's own rule/check id, e.g. "SS-EXFIL-001". Never rewritten. */
  providerRuleId: string
  /** The provider's own severity string, verbatim (not mapped to CallLint's scale). */
  providerSeverity: string
  message?: string
  locations?: string[]
}

export interface EvidenceEnvelope {
  schema_version: "calllint.evidence-provider.v0"
  provider: string
  /** Pinned provider version; "git:<commit>" preferred. "unknown" ⇒ not complete. */
  providerVersion: string
  artifactDigest: `sha256:${string}`
  scanMode: ScanMode
  coverage: string[]
  completeness: Completeness
  findings: EvidenceFinding[]
  rawReportDigest: `sha256:${string}`
  startedAt?: string
  finishedAt?: string
  /** Non-empty ⇒ completeness must be one of partial | degraded | failed. */
  degradedReasons: string[]
}

export const EVIDENCE_SCHEMA_VERSION = "calllint.evidence-provider.v0" as const
