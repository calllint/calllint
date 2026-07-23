/**
 * PR-D4 — the Evidence Manifest projection (`calllint.evidence-manifest.v1`).
 *
 * The manifest is a PURE PROJECTION of a baked Trust Page: it must carry the verdict,
 * authority, completeness, and digests VERBATIM (ADR 0053 §2), be byte-reproducible
 * (so the committed sibling holds the reproducibility gate), keep the four dimensions
 * independent (§5), never use forbidden overclaim language, and round-trip through the
 * shipped ed25519 signer while the committed body stays `signature: null`.
 */
import { describe, it, expect } from "vitest"
import { generateKeypair } from "@calllint/signature"
import {
  bakeTrustPage,
  buildEvidenceManifest,
  evidenceManifestBodyDigest,
  signEvidenceManifest,
  verifyEvidenceManifest,
  fixtureCohort,
  TRUST_PAGE_FORBIDDEN_PHRASES,
  type BakedTrustPage,
} from "../src/index.js"

/** Bake every fixture once — the same cohort the committed tree is baked from.
 *  Parse-error fixtures (e.g. malformed.json) are excluded: they bake to no page. */
const pages: BakedTrustPage[] = fixtureCohort()
  .filter((e) => e.case.expect !== "parse-error")
  .map((e) => bakeTrustPage(e.input))
const byName = (needle: string) => pages.find((p) => p.canonicalName.includes(needle))!

describe("buildEvidenceManifest — pure projection over a baked page", () => {
  it("carries the verdict, digests, and completeness VERBATIM (never re-scored)", () => {
    for (const page of pages) {
      const m = buildEvidenceManifest(page)
      expect(m.schema).toBe("calllint.evidence-manifest.v1")
      expect(m.verdict).toBe(page.verdict) // verbatim, not recomputed
      expect(m.subject.artifactDigest).toBe(page.artifactDigest)
      expect(m.subject.canonicalName).toBe(page.canonicalName)
      expect(m.reproducibility.pageDigest).toBe(page.pageDigest)
      expect(m.generatedAt).toBe(page.observedAt)
      expect(m.completeness).toBe(page.preparation.authority?.completeness ?? "partial")
    }
  })

  it("projects the shipped authority inventory verbatim (shipped action×resource vocab)", () => {
    const page = byName("block-observed-payment")
    const m = buildEvidenceManifest(page)
    const authority = page.preparation.authority!
    expect(m.authority.digest).toBe(authority.digest)
    expect(m.authority.capabilityCount).toBe(authority.capabilities.length)
    expect(m.authority.approvalRequired).toEqual(authority.approval.required)
    // Each projected capability equals its source's decision-relevant slice, in order.
    m.authority.capabilities.forEach((c, i) => {
      const src = authority.capabilities[i]!
      expect(c.action).toBe(src.action)
      expect(c.resource).toBe(src.resource)
      expect(c.mutability).toBe(src.mutability)
      expect(c.reversibility).toBe(src.reversibility)
      expect(c.approvalRequirement).toBe(src.approvalRequirement)
    })
  })

  it("emits the committed body with signature: null and no engine.version", () => {
    const m = buildEvidenceManifest(byName("block-observed-payment"))
    expect(m.signature).toBeNull()
    expect(m.engine).toEqual({ name: "calllint" })
    expect("version" in m.engine).toBe(false)
  })

  it("carries policyDigest as honest null for a config-only page (no fabricated decision)", () => {
    // Baked pages stop at AUTHORITY_NORMALIZED — no decision, so policyDigest is null.
    for (const page of pages) {
      expect(buildEvidenceManifest(page).policyDigest).toBeNull()
    }
  })

  it("keeps the four status dimensions independent (never a combined score)", () => {
    const m = buildEvidenceManifest(byName("block-observed-payment"))
    expect(m.status.verdict).toBe(m.verdict)
    expect(m.status.completeness).toBe(m.completeness)
    expect(m.status.evidenceLevel).toBe(m.evidenceLevel)
    expect(m.status.reproducibility).toEqual(m.reproducibility)
    // No collapsed rating field ever appears.
    for (const forbidden of ["score", "grade", "rating", "trustScore"] as const) {
      expect(forbidden in (m as unknown as Record<string, unknown>)).toBe(false)
      expect(forbidden in (m.status as unknown as Record<string, unknown>)).toBe(false)
    }
  })

  it("reflects the authorityClaimed overlay without touching the verdict", () => {
    const page = byName("block-observed-payment")
    const unclaimed = buildEvidenceManifest(page)
    const claimed = buildEvidenceManifest(page, { authorityClaimed: true })
    expect(unclaimed.status.authorityClaimed).toBe(false)
    expect(claimed.status.authorityClaimed).toBe(true)
    expect(claimed.verdict).toBe(unclaimed.verdict) // claim never moves a verdict
  })

  it("is deterministic — two builds are byte-identical", () => {
    for (const page of pages) {
      const a = JSON.stringify(buildEvidenceManifest(page))
      const b = JSON.stringify(buildEvidenceManifest(page))
      expect(a).toBe(b)
    }
  })

  it("uses no forbidden overclaim language (ADR 0038 §2 boundary)", () => {
    for (const page of pages) {
      const text = JSON.stringify(buildEvidenceManifest(page)).toLowerCase()
      for (const phrase of TRUST_PAGE_FORBIDDEN_PHRASES) {
        expect(text.includes(phrase.toLowerCase())).toBe(false)
      }
    }
  })
})

describe("signEvidenceManifest / verifyEvidenceManifest — detached signing over the body", () => {
  const keypair = generateKeypair("test-manifest-key")

  it("round-trips: a freshly signed manifest verifies", () => {
    const signed = signEvidenceManifest(buildEvidenceManifest(byName("safe")), keypair)
    expect(signed.signature).not.toBeNull()
    expect(signed.signature!.algorithm).toBe("ed25519")
    expect(verifyEvidenceManifest(signed, keypair.publicKey)).toBe(true)
  })

  it("fails closed for an unsigned manifest (nothing to verify)", () => {
    const unsigned = buildEvidenceManifest(byName("safe"))
    expect(verifyEvidenceManifest(unsigned, keypair.publicKey)).toBe(false)
  })

  it("rejects a tampered body (verdict flipped after signing)", () => {
    const signed = signEvidenceManifest(buildEvidenceManifest(byName("block-observed-payment")), keypair)
    const tampered = { ...signed, verdict: "SAFE" as const }
    expect(verifyEvidenceManifest(tampered, keypair.publicKey)).toBe(false)
  })

  it("rejects verification under the wrong key", () => {
    const signed = signEvidenceManifest(buildEvidenceManifest(byName("safe")), keypair)
    const other = generateKeypair("other-key")
    expect(verifyEvidenceManifest(signed, other.publicKey)).toBe(false)
  })

  it("signs over the body MINUS the signature (bodyDigest is signature-independent)", () => {
    const m = buildEvidenceManifest(byName("safe"))
    const before = evidenceManifestBodyDigest(m)
    const after = evidenceManifestBodyDigest(signEvidenceManifest(m, keypair))
    expect(after).toBe(before) // attaching a signature does not change the body digest
  })

  it("the signature `value` is deterministic for the same body + key", () => {
    // ed25519 over a fixed hash is deterministic (signed_at differs, value must not).
    const m = buildEvidenceManifest(byName("safe"))
    const a = signEvidenceManifest(m, keypair).signature!.value
    const b = signEvidenceManifest(m, keypair).signature!.value
    expect(a).toBe(b)
  })
})
