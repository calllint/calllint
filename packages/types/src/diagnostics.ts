import type { Confidence, EvidenceMode, Severity } from "./finding.js"
import type { Verdict } from "./verdict.js"

/**
 * The diagnostics protocol — an editor / agent-host view of a scan, derived
 * purely from a ScanReport (see ADR 0013). It adds no analysis and changes no
 * verdict: it is a projection, like SARIF. v0 is KEY-PATH-scoped — each entry
 * carries the source file and a config key-path, the location data the pipeline
 * can honestly produce. `line`/`column` are reserved in the shape but emitted
 * `null` in v0 (no key→source-position map exists yet); a future enrichment can
 * populate them without a schema bump.
 */

/** How a finding contributed to its server's verdict. */
export const VERDICT_CONTRIBUTIONS = [
  "blocker",
  "review",
  "inferred",
] as const
export type VerdictContribution = (typeof VERDICT_CONTRIBUTIONS)[number]

export interface DiagnosticEntry {
  /** Stable rule id, e.g. "files.broad-path". */
  ruleId: string
  title: string
  severity: Severity
  /** The server this diagnostic belongs to (configs may hold many servers). */
  server: string
  /** Source config file the finding points at. */
  file: string
  /**
   * Config key-path into the source file, e.g. "mcpServers.fs.args". Derived
   * from evidence.path + evidence.key. This is a config pointer, not a source
   * byte offset.
   */
  keyPath: string | null
  /** Reserved for a future source-position enrichment; null in v0. */
  line: number | null
  /** Reserved for a future source-position enrichment; null in v0. */
  column: number | null
  /** The flagged value or matched snippet, when evidence carries one. */
  observed: string | null
  /** The finding's remediation (finding.fix). */
  remediation: string
  /** OBSERVED (direct evidence) vs INFERRED (heuristic). */
  mode: EvidenceMode
  confidence: Confidence
  /** How this finding contributed to the verdict. */
  verdictContribution: VerdictContribution
}

export interface DiagnosticsReport {
  schemaVersion: "calllint.diagnostics.v0"
  /** The aggregate verdict from the underlying ScanReport — unchanged. */
  verdict: Verdict
  publicVerdictLabel: string
  /** The scanned config file. */
  file: string
  diagnostics: DiagnosticEntry[]
  generatedAt: string
}
