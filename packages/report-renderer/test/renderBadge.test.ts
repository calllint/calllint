import { describe, it, expect } from "vitest"
import {
  renderBadge,
  badgeEndpoint,
  BADGE_COLOR,
  GREEN_BADGE_COLORS,
} from "../src/index.js"
import { scanConfigFile } from "@calllint/core"
import { goldenPath } from "@calllint/fixtures"
import { VERDICTS, type Verdict } from "@calllint/types"

const OPTS = { now: Date.parse("2026-06-01T00:00:00Z"), generatedAt: "2026-06-01T00:00:00.000Z" }

// One golden fixture per verdict — the same set the corpus/renderer tests use.
const CASES: { file: string; verdict: Verdict }[] = [
  { file: "safe-time.json", verdict: "SAFE" },
  { file: "review-github.json", verdict: "REVIEW" },
  { file: "block-filesystem.json", verdict: "BLOCK" },
  { file: "unknown-remote.json", verdict: "UNKNOWN" },
]

describe("badge renderer", () => {
  it("emits a valid shields.io endpoint object for each verdict", () => {
    for (const c of CASES) {
      const s = scanConfigFile(goldenPath(c.file), OPTS)
      const out = renderBadge(s)
      expect(() => JSON.parse(out)).not.toThrow()
      const b = JSON.parse(out)
      expect(b.schemaVersion).toBe(1)
      expect(b.label).toBe("CallLint")
      expect(b.message).toBe(c.verdict)
      expect(b.color).toBe(BADGE_COLOR[c.verdict])
      expect(typeof b.cacheSeconds).toBe("number")
    }
  })

  it("is deterministic and emoji-free", () => {
    const s = scanConfigFile(goldenPath("block-filesystem.json"), OPTS)
    const a = renderBadge(s)
    const b = renderBadge(s)
    expect(a).toBe(b)
    expect(/\p{Extended_Pictographic}/u.test(a)).toBe(false)
  })

  // The Phase 6 red line: transparency over false comfort. A non-SAFE verdict
  // must NEVER render a green badge. This is the negative fixture for ADR 0026.
  it("never renders a green badge for a non-SAFE verdict (no-green-only)", () => {
    for (const v of VERDICTS) {
      const color = badgeEndpoint(v).color
      if (v === "SAFE") {
        expect(GREEN_BADGE_COLORS).toContain(color)
      } else {
        expect(GREEN_BADGE_COLORS).not.toContain(color)
      }
    }
  })

  it("assigns a distinct colour to every verdict", () => {
    const colors = VERDICTS.map((v) => BADGE_COLOR[v])
    expect(new Set(colors).size).toBe(colors.length)
  })
})
