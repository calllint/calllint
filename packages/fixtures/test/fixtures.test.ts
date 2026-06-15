import { describe, it, expect } from "vitest"
import { GOLDEN_CASES, readGolden } from "../src/index.js"

describe("golden fixtures load", () => {
  it("every non-malformed fixture is valid JSON; malformed is not", () => {
    for (const c of GOLDEN_CASES) {
      const raw = readGolden(c.file)
      expect(raw.length).toBeGreaterThan(0)
      if (c.expect === "parse-error") {
        expect(() => JSON.parse(raw)).toThrow()
      } else {
        expect(() => JSON.parse(raw)).not.toThrow()
      }
    }
  })

  it("the verdict contract covers all four verdicts plus parse-error", () => {
    const expects = new Set(GOLDEN_CASES.map((c) => c.expect))
    expect(expects.has("SAFE")).toBe(true)
    expect(expects.has("REVIEW")).toBe(true)
    expect(expects.has("BLOCK")).toBe(true)
    expect(expects.has("UNKNOWN")).toBe(true)
    expect(expects.has("parse-error")).toBe(true)
  })
})
