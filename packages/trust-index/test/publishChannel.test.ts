/**
 * PR-D5 — the publish-channel classifier (ADR 0053 §4; new12 §2.6).
 *
 * `publishChannel(page)` is a PURE routing function over shipped fields. These tests
 * pin its behavior on the ADR-locked fixtures (which cover every verdict) plus the
 * committed registry snapshot (real third-party pages), and prove it fails CLOSED and
 * never moves a verdict.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  bakeTrustPage,
  fixtureCohort,
  registryCohort,
  parseSnapshot,
  parseEvidenceSnapshot,
  evidenceMap,
  publishChannel,
  AUTO_PUBLISH_EVIDENCE_LIMITATION,
  type BakedTrustPage,
} from "../src/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = resolve(here, "..", "snapshots", "official-mcp-registry.json")
const EVIDENCE = resolve(here, "..", "snapshots", "evidence-snapshot.json")

const fixtures: BakedTrustPage[] = fixtureCohort()
  .filter((e) => e.case.expect !== "parse-error")
  .map((e) => bakeTrustPage(e.input))
const byName = (needle: string) => fixtures.find((p) => p.canonicalName.includes(needle))!

// Real registry pages, baked exactly as the bin/CI does — from the committed snapshot
// AND the committed evidence snapshot, which is what refines remote UNKNOWN → REVIEW
// (ADR 0050). Without the evidence map the pages bake to their UNKNOWN baseline; with
// it, the 17 remote endpoints become the REVIEW pages the committed tree serves.
const evidence = existsSync(EVIDENCE)
  ? evidenceMap(parseEvidenceSnapshot(readFileSync(EVIDENCE, "utf8")))
  : new Map()
const registry: BakedTrustPage[] = existsSync(SNAPSHOT)
  ? registryCohort(parseSnapshot(readFileSync(SNAPSHOT, "utf8")))
      .filter((p) => p.input !== null)
      .map((p) => bakeTrustPage({ ...p.input!, evidence }))
  : []

describe("publishChannel — routes each verdict to its ADR 0053 §4 channel", () => {
  it("SECURITY_HOLD for every BLOCK page (blocker / active-harm signal)", () => {
    const blocks = fixtures.filter((p) => p.verdict === "BLOCK")
    expect(blocks.length).toBeGreaterThan(0)
    for (const page of blocks) expect(publishChannel(page)).toBe("SECURITY_HOLD")
  })

  it("AUTO_PUBLISH for SAFE and UNKNOWN pages", () => {
    for (const page of fixtures.filter((p) => p.verdict === "SAFE" || p.verdict === "UNKNOWN")) {
      expect(publishChannel(page)).toBe("AUTO_PUBLISH")
    }
  })

  it("REVIEW_HOLD for a high-severity REVIEW that makes a party-negative claim", () => {
    // review-financial (action.financial) and review-unpinned-package
    // (supply.unpinned-package) are high-sev REVIEWs that ARE claims about the artifact
    // — not evidence-limitation self-claims — so they must be held for human review.
    expect(publishChannel(byName("review-financial"))).toBe("REVIEW_HOLD")
    expect(publishChannel(byName("review-unpinned-package"))).toBe("REVIEW_HOLD")
  })

  it("AUTO_PUBLISH for an evidence-limitation high-sev REVIEW (supply.unknown-remote)", () => {
    // Every real registry REVIEW page carries only supply.unknown-remote (high) — an
    // assertion of CallLint's OWN non-verification, which §4 names AUTO_PUBLISH.
    const remoteReviews = registry.filter((p) => p.verdict === "REVIEW")
    expect(remoteReviews.length).toBeGreaterThan(0)
    for (const page of remoteReviews) expect(publishChannel(page)).toBe("AUTO_PUBLISH")
  })

  it("the whole real registry cohort is AUTO_PUBLISH (no party-negative today)", () => {
    for (const page of registry) expect(publishChannel(page)).toBe("AUTO_PUBLISH")
  })

  it("is deterministic and never mutates the page/verdict", () => {
    for (const page of [...fixtures, ...registry]) {
      const before = page.verdict
      const a = publishChannel(page)
      const b = publishChannel(page)
      expect(a).toBe(b)
      expect(page.verdict).toBe(before) // classification never moves a verdict
    }
  })

  it("the AUTO_PUBLISH evidence-limitation allow-set is narrow and explicit", () => {
    // A guard so widening the allow-set is a deliberate, reviewed change — never
    // accidental. supply.unknown-remote is the canonical member.
    expect(AUTO_PUBLISH_EVIDENCE_LIMITATION.has("supply.unknown-remote")).toBe(true)
    expect(AUTO_PUBLISH_EVIDENCE_LIMITATION.has("action.financial")).toBe(false)
    expect(AUTO_PUBLISH_EVIDENCE_LIMITATION.size).toBeLessThanOrEqual(3)
  })
})
