/**
 * PR-D5 — the two Gate-C page-quality projections (reproduction command + scan
 * history). Both are PURE projections over a baked page: deterministic, boundary-safe,
 * PII-free, and verdict-preserving (they read shipped fields, never re-score).
 */
import { describe, it, expect } from "vitest"
import {
  bakeTrustPage,
  fixtureCohort,
  reproductionCommand,
  scanHistory,
  TRUST_PAGE_FORBIDDEN_PHRASES,
  type BakedTrustPage,
} from "../src/index.js"

const pages: BakedTrustPage[] = fixtureCohort()
  .filter((e) => e.case.expect !== "parse-error")
  .map((e) => bakeTrustPage(e.input))
const anyPage = pages[0]!

describe("reproductionCommand — deterministic, boundary-safe projection", () => {
  it("names the exact scanned source and pins the artifact digest", () => {
    for (const page of pages) {
      const repro = reproductionCommand(page)
      expect(repro.command).toBe(`npx calllint scan ${page.preparation.artifact.source}`)
      expect(repro.artifactDigest).toBe(page.artifactDigest)
      expect(repro.note.length).toBeGreaterThan(0)
    }
  })

  it("is version-agnostic (never pins a release version that would drift)", () => {
    // The command must be the bare `npx calllint scan …` form, never `calllint@X.Y.Z`.
    for (const page of pages) {
      expect(reproductionCommand(page).command).not.toMatch(/calllint@\d/)
    }
  })

  it("uses no forbidden overclaim language (ADR 0038 §2)", () => {
    for (const page of pages) {
      const text = JSON.stringify(reproductionCommand(page)).toLowerCase()
      for (const phrase of TRUST_PAGE_FORBIDDEN_PHRASES) {
        expect(text.includes(phrase.toLowerCase())).toBe(false)
      }
    }
  })

  it("carries no PII (email-like token) — derived from the PII-free source label", () => {
    const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    for (const page of pages) {
      expect(EMAIL.test(JSON.stringify(reproductionCommand(page)))).toBe(false)
    }
  })

  it("is deterministic — two builds are byte-identical", () => {
    for (const page of pages) {
      expect(JSON.stringify(reproductionCommand(page))).toBe(
        JSON.stringify(reproductionCommand(page)),
      )
    }
  })
})

describe("scanHistory — honest single-entry list over the page's own observation", () => {
  it("is a one-entry list carrying the page's observedAt + digests (never fabricated)", () => {
    for (const page of pages) {
      const history = scanHistory(page)
      expect(history).toHaveLength(1)
      expect(history[0]).toEqual({
        observedAt: page.observedAt,
        pageDigest: page.pageDigest,
        artifactDigest: page.artifactDigest,
      })
    }
  })

  it("is deterministic — two builds are byte-identical", () => {
    expect(JSON.stringify(scanHistory(anyPage))).toBe(JSON.stringify(scanHistory(anyPage)))
  })
})
