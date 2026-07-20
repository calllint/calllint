/**
 * new11 PR-03 — release read-back reconcile (pure core) tests.
 * No network: every case feeds recorded observations/errors into the pure judge.
 */
import { describe, it, expect } from "vitest"
import {
  reconcilePlatform,
  reconcileAll,
  isActionable,
  renderIssueBody,
  READBACK_STATUS,
  READBACK_ISSUE_MARKER,
} from "../../scripts/lib/readback-reconcile.mjs"

const expected = { package: "calllint", repository: "github.com/calllint/calllint", domain: "calllint.com", version: "1.6.0" }
const npm = { id: "npm", ownershipMethod: "npm", expectedPackage: "calllint", supportsAutomatedReadback: true, manualActionRequired: false }
const gh = { id: "github-release", ownershipMethod: "github", supportsAutomatedReadback: true, manualActionRequired: false }
const manual = { id: "mcp-registry", ownershipMethod: "github", supportsAutomatedReadback: false, manualActionRequired: true }

describe("reconcilePlatform", () => {
  it("npm latest matching expected version → MATCH", () => {
    const r = reconcilePlatform({ expected, platform: npm, observed: { versionExists: true, latestVersion: "1.6.0" } })
    expect(r.status).toBe(READBACK_STATUS.MATCH)
  })

  it("npm latest ahead of expected → STALE (actionable)", () => {
    const r = reconcilePlatform({ expected, platform: npm, observed: { versionExists: true, latestVersion: "1.7.0" } })
    expect(r.status).toBe(READBACK_STATUS.STALE)
    expect(isActionable(r.status)).toBe(true)
    expect(r.observed).toBe("1.7.0")
  })

  it("npm package absent → MISSING (actionable)", () => {
    const r = reconcilePlatform({ expected, platform: npm, observed: { versionExists: false, latestVersion: null } })
    expect(r.status).toBe(READBACK_STATUS.MISSING)
    expect(isActionable(r.status)).toBe(true)
  })

  it("a fetch error is UNREACHABLE, never MATCH and never STALE (no false-clean)", () => {
    const r = reconcilePlatform({ expected, platform: npm, fetchError: { message: "ETIMEDOUT" } })
    expect(r.status).toBe(READBACK_STATUS.UNREACHABLE)
    expect(isActionable(r.status)).toBe(false)
  })

  it("github release tag carrying the version → MATCH", () => {
    const r = reconcilePlatform({ expected, platform: gh, observed: { tagName: "v1.6.0" } })
    expect(r.status).toBe(READBACK_STATUS.MATCH)
  })

  it("github release tag missing the version → STALE", () => {
    const r = reconcilePlatform({ expected, platform: gh, observed: { tagName: "v1.5.1" } })
    expect(r.status).toBe(READBACK_STATUS.STALE)
  })

  it("no github release → MISSING", () => {
    const r = reconcilePlatform({ expected, platform: gh, observed: {} })
    expect(r.status).toBe(READBACK_STATUS.MISSING)
  })

  it("manual platform → MANUAL_REVIEW (never auto-fails)", () => {
    const r = reconcilePlatform({ expected, platform: manual, observed: {} })
    expect(r.status).toBe(READBACK_STATUS.MANUAL_REVIEW)
    expect(isActionable(r.status)).toBe(false)
  })

  // --- Wave 4: the ownershipMethod:"manual" directory path (±fixture) --------
  // The four directory listings (github-marketplace/forge/pulsemcp/mcpservers-org)
  // have no anonymous read-back endpoint; they are ownershipMethod "manual".

  it("a manual-ownership directory → MANUAL_REVIEW, not actionable (positive)", () => {
    const forge = {
      id: "forge",
      ownershipMethod: "manual",
      supportsAutomatedReadback: false,
      manualActionRequired: true,
    }
    const r = reconcilePlatform({ expected, platform: forge, observed: {} })
    expect(r.status).toBe(READBACK_STATUS.MANUAL_REVIEW)
    expect(isActionable(r.status)).toBe(false)
  })

  it("a manual directory NEVER becomes MATCH even if a stray observed slips in (guard)", () => {
    const pulse = {
      id: "pulsemcp",
      ownershipMethod: "manual",
      supportsAutomatedReadback: false,
      manualActionRequired: true,
    }
    // Even handed an observed object that would MATCH an npm/github reconciler,
    // the manual branch short-circuits first — no false-clean for a listing we
    // can only verify by hand.
    const r = reconcilePlatform({
      expected,
      platform: pulse,
      observed: { versionExists: true, latestVersion: "1.7.1", tagName: "v1.7.1" },
    })
    expect(r.status).toBe(READBACK_STATUS.MANUAL_REVIEW)
    expect(r.status).not.toBe(READBACK_STATUS.MATCH)
  })
})

describe("reconcileAll + issue body", () => {
  it("summarizes and finds actionable drift", () => {
    const { results, actionable, summary } = reconcileAll({
      expected,
      platforms: [npm, gh, manual],
      observations: {
        npm: { observed: { versionExists: true, latestVersion: "1.7.0" } },
        "github-release": { observed: { tagName: "v1.6.0" } },
        "mcp-registry": { observed: {} },
      },
    })
    expect(results).toHaveLength(3)
    expect(actionable).toHaveLength(1)
    expect(summary.STALE).toBe(1)
    expect(summary.MATCH).toBe(1)
    expect(summary.MANUAL_REVIEW).toBe(1)
  })

  it("issue body carries the dedup marker and is deterministic", () => {
    const args = {
      results: [{ id: "npm", status: "STALE", detail: "npm latest is 1.7.0, expected 1.6.0" }],
      actionable: [{ id: "npm" }],
      generatedAtIso: "2026-07-20T00:00:00.000Z",
    }
    const a = renderIssueBody(args)
    const b = renderIssueBody(args)
    expect(a).toBe(b)
    expect(a).toContain(READBACK_ISSUE_MARKER)
    expect(a).toContain("| npm | STALE |")
  })
})
