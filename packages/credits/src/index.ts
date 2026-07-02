/**
 * @calllint/credits - Internal credit metering for signed receipts
 *
 * This package calculates credits for internal billing/metering purposes only.
 * NO public pricing documentation, NO user-facing UI.
 *
 * @packageDocumentation
 */

export { calculateCredits, calculateBatchCredits } from './calculate.js'
export type { CreditableReceipt, CreditUsage } from './types.js'
