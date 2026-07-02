/**
 * Credit calculation for signed receipts (internal metering only)
 *
 * This module calculates credits for internal billing/metering purposes.
 * NO public pricing documentation, NO user-facing UI.
 *
 * Formula (internal):
 *   base = 10
 *   per_finding = 5
 *   verdict_multiplier = { SAFE: 1.0, REVIEW: 1.2, BLOCK: 1.5, UNKNOWN: 0.8 }
 *   total = (base + findings.length * per_finding) * verdict_multiplier
 *
 * @packageDocumentation
 */

import type { CreditableReceipt, CreditUsage } from './types.js'

/**
 * Credit constants (internal only, not exposed publicly)
 */
const BASE_CREDITS = 10
const PER_FINDING_CREDITS = 5

const VERDICT_MULTIPLIERS: Record<CreditableReceipt['verdict'], number> = {
  SAFE: 1.0,
  REVIEW: 1.2,
  BLOCK: 1.5,
  UNKNOWN: 0.8,
}

/**
 * Calculate credits for a receipt (internal metering)
 *
 * @param receipt - Receipt or receipt-like object with verdict and finding_refs
 * @returns Credit usage breakdown
 */
export function calculateCredits(receipt: CreditableReceipt): CreditUsage {
  const findingCount = receipt.finding_refs.length
  const verdictMultiplier = VERDICT_MULTIPLIERS[receipt.verdict]

  const base = BASE_CREDITS
  const findings = findingCount * PER_FINDING_CREDITS
  const subtotal = base + findings
  const total = Math.ceil(subtotal * verdictMultiplier)

  return {
    base,
    findings,
    verdictMultiplier,
    total,
  }
}

/**
 * Calculate total credits for a batch of receipts
 *
 * @param receipts - Array of receipts
 * @returns Total credits
 */
export function calculateBatchCredits(receipts: CreditableReceipt[]): number {
  return receipts.reduce((sum, receipt) => sum + calculateCredits(receipt).total, 0)
}
