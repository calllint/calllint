import { describe, test, expect } from 'vitest'
import { calculateCredits, calculateBatchCredits } from '../src/calculate.js'

describe('@calllint/credits', () => {
  describe('calculateCredits', () => {
    test('SAFE verdict with no findings', () => {
      const receipt = {
        verdict: 'SAFE' as const,
        finding_refs: [],
      }

      const result = calculateCredits(receipt)

      expect(result.base).toBe(10)
      expect(result.findings).toBe(0)
      expect(result.verdictMultiplier).toBe(1.0)
      expect(result.total).toBe(10) // (10 + 0) * 1.0 = 10
    })

    test('SAFE verdict with 3 findings', () => {
      const receipt = {
        verdict: 'SAFE' as const,
        finding_refs: [
          { rule_id: 'rule1', severity: 'low' },
          { rule_id: 'rule2', severity: 'medium' },
          { rule_id: 'rule3', severity: 'low' },
        ],
      }

      const result = calculateCredits(receipt)

      expect(result.base).toBe(10)
      expect(result.findings).toBe(15) // 3 * 5
      expect(result.verdictMultiplier).toBe(1.0)
      expect(result.total).toBe(25) // (10 + 15) * 1.0 = 25
    })

    test('REVIEW verdict with 2 findings', () => {
      const receipt = {
        verdict: 'REVIEW' as const,
        finding_refs: [
          { rule_id: 'rule1', severity: 'high' },
          { rule_id: 'rule2', severity: 'medium' },
        ],
      }

      const result = calculateCredits(receipt)

      expect(result.base).toBe(10)
      expect(result.findings).toBe(10) // 2 * 5
      expect(result.verdictMultiplier).toBe(1.2)
      expect(result.total).toBe(24) // (10 + 10) * 1.2 = 24
    })

    test('BLOCK verdict with 5 findings', () => {
      const receipt = {
        verdict: 'BLOCK' as const,
        finding_refs: [
          { rule_id: 'rule1', severity: 'critical' },
          { rule_id: 'rule2', severity: 'high' },
          { rule_id: 'rule3', severity: 'high' },
          { rule_id: 'rule4', severity: 'medium' },
          { rule_id: 'rule5', severity: 'low' },
        ],
      }

      const result = calculateCredits(receipt)

      expect(result.base).toBe(10)
      expect(result.findings).toBe(25) // 5 * 5
      expect(result.verdictMultiplier).toBe(1.5)
      expect(result.total).toBe(53) // (10 + 25) * 1.5 = 52.5 → 53 (rounded up)
    })

    test('UNKNOWN verdict with 1 finding', () => {
      const receipt = {
        verdict: 'UNKNOWN' as const,
        finding_refs: [{ rule_id: 'rule1', severity: 'medium' }],
      }

      const result = calculateCredits(receipt)

      expect(result.base).toBe(10)
      expect(result.findings).toBe(5) // 1 * 5
      expect(result.verdictMultiplier).toBe(0.8)
      expect(result.total).toBe(12) // (10 + 5) * 0.8 = 12
    })

    test('UNKNOWN verdict with no findings', () => {
      const receipt = {
        verdict: 'UNKNOWN' as const,
        finding_refs: [],
      }

      const result = calculateCredits(receipt)

      expect(result.base).toBe(10)
      expect(result.findings).toBe(0)
      expect(result.verdictMultiplier).toBe(0.8)
      expect(result.total).toBe(8) // (10 + 0) * 0.8 = 8
    })

    test('rounds up fractional credits', () => {
      const receipt = {
        verdict: 'BLOCK' as const,
        finding_refs: [{ rule_id: 'rule1', severity: 'high' }],
      }

      const result = calculateCredits(receipt)

      // (10 + 5) * 1.5 = 22.5 → 23
      expect(result.total).toBe(23)
    })

    test('credits are deterministic (same input → same output)', () => {
      const receipt = {
        verdict: 'REVIEW' as const,
        finding_refs: [
          { rule_id: 'a', severity: 'high' },
          { rule_id: 'b', severity: 'medium' },
        ],
      }

      const result1 = calculateCredits(receipt)
      const result2 = calculateCredits(receipt)

      expect(result1).toEqual(result2)
    })
  })

  describe('calculateBatchCredits', () => {
    test('calculates total for multiple receipts', () => {
      const receipts = [
        { verdict: 'SAFE' as const, finding_refs: [] }, // 10
        { verdict: 'REVIEW' as const, finding_refs: [{ rule_id: 'r1', severity: 'high' }] }, // (10+5)*1.2=18
        { verdict: 'BLOCK' as const, finding_refs: [{ rule_id: 'r2', severity: 'critical' }] }, // (10+5)*1.5=23
      ]

      const total = calculateBatchCredits(receipts)

      expect(total).toBe(10 + 18 + 23) // 51
    })

    test('returns 0 for empty batch', () => {
      const total = calculateBatchCredits([])
      expect(total).toBe(0)
    })

    test('handles single receipt', () => {
      const receipts = [{ verdict: 'SAFE' as const, finding_refs: [] }]
      const total = calculateBatchCredits(receipts)
      expect(total).toBe(10)
    })
  })

  describe('edge cases', () => {
    test('handles large number of findings', () => {
      const receipt = {
        verdict: 'REVIEW' as const,
        finding_refs: Array.from({ length: 100 }, (_, i) => ({
          rule_id: `rule${i}`,
          severity: 'medium',
        })),
      }

      const result = calculateCredits(receipt)

      expect(result.findings).toBe(500) // 100 * 5
      expect(result.total).toBe(612) // (10 + 500) * 1.2 = 612
    })

    test('minimum credits (UNKNOWN, no findings)', () => {
      const receipt = {
        verdict: 'UNKNOWN' as const,
        finding_refs: [],
      }

      const result = calculateCredits(receipt)
      expect(result.total).toBe(8) // minimum: (10 + 0) * 0.8
    })
  })
})
