/**
 * new11 P2 PR-10 — agent trigger taxonomy contract.
 *
 * These tests are the safety floor for the taxonomy: they assert it maps ONLY
 * onto the shipped RiskSymbol vocabulary (ADR 0049 §2 / ADR 0041, no fork) and
 * covers the ten action classes new11 §5 requires a preflight before.
 */
import { describe, it, expect } from "vitest"
import { RISK_SYMBOLS, type RiskSymbol } from "@calllint/types"
import {
  TRIGGER_IDS,
  TRIGGERS,
  allTriggers,
  triggerById,
  triggersForSymbols,
} from "../src/index.js"

describe("trigger taxonomy (new11 §5)", () => {
  it("defines exactly the ten action classes new11 §5 requires", () => {
    expect(TRIGGER_IDS).toHaveLength(10)
  })

  it("every trigger id has a matching definition with the same id", () => {
    for (const id of TRIGGER_IDS) {
      const def = TRIGGERS[id]
      expect(def).toBeDefined()
      expect(def.id).toBe(id)
    }
  })

  it("allTriggers() returns definitions in canonical TRIGGER_IDS order", () => {
    expect(allTriggers().map((t) => t.id)).toEqual([...TRIGGER_IDS])
  })
})

describe("BINDING RULE — maps only onto shipped RiskSymbols (no forked vocab)", () => {
  const shipped = new Set<RiskSymbol>(RISK_SYMBOLS)

  it("every symbol referenced by every trigger exists in @calllint/types RISK_SYMBOLS", () => {
    for (const t of allTriggers()) {
      expect(t.symbols.length).toBeGreaterThan(0)
      for (const s of t.symbols) {
        expect(shipped.has(s)).toBe(true)
      }
    }
  })

  it("introduces no risk vocabulary of its own", () => {
    const used = new Set<string>()
    for (const t of allTriggers()) for (const s of t.symbols) used.add(s)
    // Every used symbol is a shipped one; the taxonomy adds none.
    for (const s of used) expect(shipped.has(s as RiskSymbol)).toBe(true)
  })
})

describe("triggersForSymbols() — pure set intersection", () => {
  it("returns triggers whose surface an observed symbol activates, in canonical order", () => {
    const activated = triggersForSymbols(["EXEC"])
    expect(activated.map((t) => t.id)).toContain("grant-shell-exec")
    // Ordering follows TRIGGER_IDS.
    const ids = activated.map((t) => t.id)
    const canonicalIndex = ids.map((id) => TRIGGER_IDS.indexOf(id))
    expect(canonicalIndex).toEqual([...canonicalIndex].sort((a, b) => a - b))
  })

  it("returns empty for an empty symbol set (negative fixture)", () => {
    expect(triggersForSymbols([])).toEqual([])
  })

  it("MONEY activates the financial-action trigger", () => {
    expect(triggersForSymbols(["MONEY"]).map((t) => t.id)).toContain("financial-action")
  })
})

describe("triggerById() — total, never throws", () => {
  it("returns the definition for a known id", () => {
    expect(triggerById("grant-network")?.id).toBe("grant-network")
  })
  it("returns null for an unknown id (negative fixture)", () => {
    expect(triggerById("not-a-trigger")).toBeNull()
  })
})
