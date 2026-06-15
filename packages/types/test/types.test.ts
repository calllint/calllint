import { describe, it, expect } from "vitest"
import {
  VERDICTS,
  VERDICT_PUBLIC_LABEL,
  VERDICT_CLI_SYMBOL,
  VERDICT_TEXT_SYMBOL,
  mostSevereVerdict,
  RISK_SYMBOLS,
  RISK_SYMBOL_EMOJI,
  RISK_SYMBOL_LABEL,
  RISK_CLASSES,
  RISK_CLASS_LABEL,
  highestRiskClass,
  type Verdict,
} from "../src/index.js"

describe("verdict maps are exhaustive", () => {
  it("every verdict has a public label, cli + text symbol", () => {
    for (const v of VERDICTS) {
      expect(VERDICT_PUBLIC_LABEL[v]).toBeTruthy()
      expect(VERDICT_CLI_SYMBOL[v]).toBeTruthy()
      expect(VERDICT_TEXT_SYMBOL[v]).toBe(v)
    }
  })
})

describe("mostSevereVerdict", () => {
  it("defaults to SAFE for empty", () => {
    expect(mostSevereVerdict([])).toBe("SAFE")
  })

  it("BLOCK beats everything", () => {
    const all: Verdict[] = ["SAFE", "REVIEW", "UNKNOWN", "BLOCK"]
    expect(mostSevereVerdict(all)).toBe("BLOCK")
  })

  it("UNKNOWN outranks REVIEW", () => {
    expect(mostSevereVerdict(["REVIEW", "UNKNOWN"])).toBe("UNKNOWN")
    expect(mostSevereVerdict(["SAFE", "REVIEW"])).toBe("REVIEW")
  })
})

describe("risk symbol maps are exhaustive", () => {
  it("every symbol has emoji + label", () => {
    for (const s of RISK_SYMBOLS) {
      expect(RISK_SYMBOL_EMOJI[s]).toBeTruthy()
      expect(RISK_SYMBOL_LABEL[s]).toBeTruthy()
    }
  })
})

describe("risk class", () => {
  it("every class has a label", () => {
    for (const c of RISK_CLASSES) {
      expect(RISK_CLASS_LABEL[c]).toBeTruthy()
    }
  })

  it("highestRiskClass picks the worst", () => {
    expect(highestRiskClass([])).toBe("S0")
    expect(highestRiskClass(["S1", "S4", "S2"])).toBe("S4")
    expect(highestRiskClass(["S5", "S0"])).toBe("S5")
  })
})
