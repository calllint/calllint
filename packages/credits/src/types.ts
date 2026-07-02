/**
 * Credit calculation types (internal use only)
 * @packageDocumentation
 */

/**
 * Receipt-like object with minimal fields needed for credit calculation
 */
export interface CreditableReceipt {
  verdict: 'SAFE' | 'REVIEW' | 'BLOCK' | 'UNKNOWN'
  finding_refs: Array<{ rule_id: string; severity: string }>
}

/**
 * Credit usage record (internal metering)
 */
export interface CreditUsage {
  /** Base credits for the scan */
  base: number
  /** Credits for findings */
  findings: number
  /** Verdict multiplier applied */
  verdictMultiplier: number
  /** Total credits consumed */
  total: number
}
