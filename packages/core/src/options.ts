import type { Policy } from "@mcpguard/types"
import { defaultPolicy } from "@mcpguard/policy"

/** Options shared across scan entry points. Injected for determinism/testability. */
export interface ScanOptions {
  policy?: Policy
  /** Epoch ms used for override-expiry checks. Defaults injected by caller. */
  now?: number
  /** ISO timestamp stamped on reports. Defaults injected by caller. */
  generatedAt?: string
}

export interface ResolvedScanOptions {
  policy: Policy
  now: number
  generatedAt: string
}

export function resolveScanOptions(opts: ScanOptions | undefined): ResolvedScanOptions {
  return {
    policy: opts?.policy ?? defaultPolicy(),
    now: opts?.now ?? 0,
    generatedAt: opts?.generatedAt ?? "1970-01-01T00:00:00.000Z",
  }
}
