import type { Finding, Policy } from "@mcpguard/types"
import { defaultPolicy } from "@mcpguard/policy"

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
}

export interface ResolvedScanOptions {
  policy: Policy
  now: number
  generatedAt: string
  extraFindings: Record<string, Finding[]>
}

export function resolveScanOptions(opts: ScanOptions | undefined): ResolvedScanOptions {
  return {
    policy: opts?.policy ?? defaultPolicy(),
    now: opts?.now ?? 0,
    generatedAt: opts?.generatedAt ?? "1970-01-01T00:00:00.000Z",
    extraFindings: opts?.extraFindings ?? {},
  }
}
