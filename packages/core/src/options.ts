import type { DocumentSurface, Finding, GatewayEvidence, Policy } from "@calllint/types"
import { defaultPolicy } from "@calllint/policy"

/** Options shared across scan entry points. Injected for determinism/testability. */
export interface ScanOptions {
  policy?: Policy
  /** Epoch ms used for override-expiry checks. Defaults injected by caller. */
  now?: number
  /** ISO timestamp stamped on reports. Defaults injected by caller. */
  generatedAt?: string
  /**
   * Extra findings to merge in, keyed by server name. Used by --online
   * enrichment (e.g. npm registry facts) so the network layer stays out of the
   * pure analyzers; the findings still flow through the same assessment.
   */
  extraFindings?: Record<string, Finding[]>
  /**
   * Local document surfaces (README / SKILL.md / AGENTS.md / package description)
   * read by the CLI and scanned for prompt-surface risk (ADR 0015). The core never
   * reads files; it scans the text it is handed, keeping analyzers offline. When
   * non-empty and any finding results, a project-level report is appended.
   */
  surfaces?: DocumentSurface[]
  /**
   * External scanner evidence envelope(s) imported by the CLI (`scan --evidence`,
   * ADR 0034). The core never reads or parses the evidence file; the CLI hands it
   * the already-imported envelope. Attached to the report as a supporting
   * projection, never fed into the verdict. Absent unless the user attached it.
   */
  evidence?: GatewayEvidence[]
}

export interface ResolvedScanOptions {
  policy: Policy
  now: number
  generatedAt: string
  extraFindings: Record<string, Finding[]>
  surfaces: DocumentSurface[]
  /** Empty unless the CLI attached evidence (`scan --evidence`). */
  evidence: GatewayEvidence[]
}

export function resolveScanOptions(opts: ScanOptions | undefined): ResolvedScanOptions {
  return {
    policy: opts?.policy ?? defaultPolicy(),
    now: opts?.now ?? 0,
    generatedAt: opts?.generatedAt ?? "1970-01-01T00:00:00.000Z",
    extraFindings: opts?.extraFindings ?? {},
    surfaces: opts?.surfaces ?? [],
    evidence: opts?.evidence ?? [],
  }
}
