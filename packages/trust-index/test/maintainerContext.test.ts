/**
 * PR-13 acceptance — Signed Maintainer Context (C-4) + drift notification (C-5),
 * ADR 0047 §3/§5, new11 §6.4/§6.5.
 *
 * Load-bearing properties proven here:
 *  - A context carries NO verdict authority: `assertNoVerdictAuthority` fails closed on
 *    a verdict-like `kind` or any smuggled verdict/severity/result/score field, and a
 *    verdict-bearing claim is not "valid" even with a good signature (INV3 / ADR 0047
 *    "Claiming never changes a verdict").
 *  - No version-unbound permanent claim: a context is CURRENT only for its pinned
 *    digest (§6.4); the moment the page digest moves it is stale.
 *  - Sign/verify is a real Ed25519 round-trip; tamper and wrong-key both fail closed.
 *  - The drift notification REUSES the shipped DriftEntry taxonomy (no second engine),
 *    is built by allowlist, fails closed on a forbidden field, and returns null when
 *    there is nothing to say. It is a payload, never a send.
 */
import { describe, it, expect } from "vitest"
import { generateKeypair } from "@calllint/signature"
import type { DriftEntry } from "@calllint/types"
import {
  assertNoVerdictAuthority,
  validateMaintainerContext,
  signMaintainerContext,
  verifyMaintainerContext,
  isContextCurrentForDigest,
  buildDriftNotification,
  MAINTAINER_CONTEXT_KINDS,
  type MaintainerContextClaim,
} from "../src/index.js"

const PINNED = `sha256:${"a".repeat(64)}` as const
const MOVED = `sha256:${"b".repeat(64)}` as const
const PAGE = "https://calllint.com/trust/npm/example"

const baseClaim: MaintainerContextClaim = {
  schema: "calllint.maintainer-context.v0",
  canonicalName: "npm/example",
  owner: "octocat",
  artifactDigest: PINNED,
  kind: "acknowledged",
  statement: "Known false positive; the shell call is gated behind an internal flag.",
}

describe("C-4 verdict authority guard (INV3 — claiming never changes a verdict)", () => {
  it("accepts every allowed non-verdict kind", () => {
    for (const kind of MAINTAINER_CONTEXT_KINDS) {
      expect(() => assertNoVerdictAuthority({ ...baseClaim, kind })).not.toThrow()
    }
  })

  it("rejects an off-vocabulary kind", () => {
    expect(() =>
      assertNoVerdictAuthority({ ...baseClaim, kind: "endorsed" as never }),
    ).toThrow(/unknown kind/)
  })

  it("rejects a verdict-like kind", () => {
    for (const bad of ["safe", "approved", "trusted", "BLOCK"]) {
      expect(() =>
        assertNoVerdictAuthority({ ...baseClaim, kind: bad as never }),
      ).toThrow()
    }
  })

  it("rejects any smuggled verdict/severity/result/score field", () => {
    for (const f of ["verdict", "severity", "result", "score"]) {
      const smuggled = { ...baseClaim, [f]: "SAFE" } as MaintainerContextClaim
      expect(() => assertNoVerdictAuthority(smuggled)).toThrow(new RegExp(f))
    }
  })

  it("a signed context object exposes no verdict-bearing key", () => {
    const kp = generateKeypair("test-key")
    const signed = signMaintainerContext(baseClaim, kp)
    for (const f of ["verdict", "severity", "result", "score"]) {
      expect(f in signed).toBe(false)
    }
  })
})

describe("C-4 structural validation + PII guard", () => {
  it("rejects a wrong schema", () => {
    expect(() =>
      validateMaintainerContext({ ...baseClaim, schema: "x" as never }),
    ).toThrow(/schema/)
  })

  it("rejects an email-like owner (PII)", () => {
    expect(() =>
      validateMaintainerContext({ ...baseClaim, owner: "me@example.com" }),
    ).toThrow(/email/)
  })

  it("rejects a malformed artifact digest", () => {
    expect(() =>
      validateMaintainerContext({ ...baseClaim, artifactDigest: "sha256:nothex" as never }),
    ).toThrow(/artifactDigest/)
  })
})

describe("C-4 Ed25519 sign / verify round-trip", () => {
  it("verifies a genuinely signed context", () => {
    const kp = generateKeypair("test-key")
    const signed = signMaintainerContext(baseClaim, kp)
    expect(verifyMaintainerContext(signed, kp.publicKey)).toBe(true)
  })

  it("fails a tampered statement (fail closed)", () => {
    const kp = generateKeypair("test-key")
    const signed = signMaintainerContext(baseClaim, kp)
    const tampered = { ...signed, statement: "Actually this is totally safe, trust me." }
    expect(verifyMaintainerContext(tampered, kp.publicKey)).toBe(false)
  })

  it("fails against a different public key", () => {
    const kp = generateKeypair("test-key")
    const other = generateKeypair("other-key")
    const signed = signMaintainerContext(baseClaim, kp)
    expect(verifyMaintainerContext(signed, other.publicKey)).toBe(false)
  })

  it("refuses to sign a verdict-bearing claim", () => {
    const kp = generateKeypair("test-key")
    const bad = { ...baseClaim, kind: "safe" as never }
    expect(() => signMaintainerContext(bad, kp)).toThrow()
  })
})

describe("C-4 digest binding (§6.4 — no version-unbound permanent claim)", () => {
  it("is current only for the exact pinned digest", () => {
    expect(isContextCurrentForDigest(baseClaim, PINNED)).toBe(true)
    expect(isContextCurrentForDigest(baseClaim, MOVED)).toBe(false)
  })
})

describe("C-5 drift notification (reuses shipped DriftEntry taxonomy)", () => {
  const drifted: DriftEntry = {
    server: "example",
    status: "package-changed",
    reasons: ["package spec changed (rug-pull signal)", "verdict SAFE -> REVIEW"],
    baselineVerdict: "SAFE",
    currentVerdict: "REVIEW",
    rugPull: true,
  }

  it("returns null when unchanged AND digest still current", () => {
    const unchanged: DriftEntry = { server: "example", status: "unchanged", reasons: [], rugPull: false }
    expect(buildDriftNotification(baseClaim, unchanged, PINNED, PAGE)).toBeNull()
  })

  it("notifies when the digest moved even if taxonomy says unchanged", () => {
    const unchanged: DriftEntry = { server: "example", status: "unchanged", reasons: [], rugPull: false }
    const notice = buildDriftNotification(baseClaim, unchanged, MOVED, PAGE)
    expect(notice).not.toBeNull()
    expect(notice!.pinnedDigest).toBe(PINNED)
    expect(notice!.currentDigest).toBe(MOVED)
  })

  it("builds an allowlist payload carrying only boundary-safe fields", () => {
    const notice = buildDriftNotification(baseClaim, drifted, MOVED, PAGE)!
    expect(notice.schema).toBe("calllint.maintainer-drift-notice.v0")
    expect(notice.status).toBe("package-changed")
    expect(notice.rugPull).toBe(true)
    expect(notice.baselineVerdict).toBe("SAFE")
    expect(notice.currentVerdict).toBe("REVIEW")
    expect(notice.pageUrl).toBe(PAGE)
    const allowed = new Set([
      "schema", "canonicalName", "owner", "pinnedDigest", "currentDigest",
      "status", "reasons", "baselineVerdict", "currentVerdict", "rugPull", "pageUrl",
    ])
    for (const key of Object.keys(notice)) expect(allowed.has(key)).toBe(true)
  })

  it("fails closed if a forbidden field rides on the drift entry", () => {
    const leak = { ...drifted, rawConfig: "{secret:...}" } as unknown as DriftEntry
    expect(() => buildDriftNotification(baseClaim, leak, MOVED, PAGE)).toThrow(/forbidden field/)
  })
})
