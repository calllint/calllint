/**
 * Human Install renderer + Contract sidecar acceptance tests (Phase 2.4 Batch 2;
 * ADR 0056 §7 / new14-integration §7). These pin, at the SOURCE, the invariants a
 * regression must never silently break:
 *
 *   • ONE fact object drives both surfaces (INV-2.4-01): the HTML's binding digests
 *     (artifact + contract) are byte-identical to the JSON sidecar's.
 *   • Exactly ONE primary CTA, state-correct; BLOCK/UNSUPPORTED never offer a
 *     prepare/apply command (plan §6.7 / INV-2.4-08).
 *   • Six decision groups in semantic DOM order == visual order (§7).
 *   • JS never decides: no <script>, no inline on* handler (§7).
 *   • Publisher text is quarantined + labeled, never in a decision group (INV-2.4-05).
 *   • No forbidden overclaim/coercion copy — BOTH the Trust-Page and Safe-install sets.
 *   • Deterministic: byte-identical re-render.
 *
 * Pure: no I/O, no clock, no network.
 */
import { describe, it, expect } from "vitest"
import {
  fixtureCohort,
  bakeTrustPage,
  safeInstallProjection,
  renderSafeInstall,
  renderSafeInstallContract,
  TRUST_PAGE_FORBIDDEN_PHRASES,
  SAFE_INSTALL_FORBIDDEN_PHRASES,
  type BakedTrustPage,
  type AdoptionSubjectInput,
  type SafeInstallProjection,
  type SafeInstallProjectionInput,
} from "../../src/index.js"

const pages: BakedTrustPage[] = fixtureCohort()
  .filter((e) => e.case.expect !== "parse-error")
  .map((e) => bakeTrustPage(e.input))

function subjectFor(page: BakedTrustPage, over: Partial<AdoptionSubjectInput> = {}): AdoptionSubjectInput {
  const slug = page.canonicalName
  return {
    canonicalName: page.canonicalName,
    canonicalSlug: slug,
    packageType: "npm",
    packageName: "@fixture/" + slug.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
    version: "1.4.2",
    sourceLocator: "npm:@fixture@1.4.2",
    publisherDescription: null,
    ...over,
  }
}

function project(page: BakedTrustPage, over: Partial<SafeInstallProjectionInput> = {}): SafeInstallProjection {
  return safeInstallProjection({
    page,
    subject: subjectFor(page, over.subject),
    snapshotDigest: "sha256:" + "a".repeat(64),
    registrySnapshotDigest: "sha256:" + "b".repeat(64),
    evidenceDigest: "sha256:" + "c".repeat(64),
    engineVersion: "9.9.9",
    ...over,
  })
}

const anyPage = pages[0]!

describe("renderSafeInstall — one fact object drives HTML + JSON (INV-2.4-01)", () => {
  it("the HTML's binding digests are byte-identical to the JSON sidecar's", () => {
    for (const page of pages) {
      const p = project(page)
      const html = renderSafeInstall(p)
      const json = JSON.parse(renderSafeInstallContract(p))
      const artifact = html.match(/Artifact digest: <code>(sha256:[0-9a-f]{64})<\/code>/)?.[1]
      const contract = html.match(/Contract digest: <code>(sha256:[0-9a-f]{64})<\/code>/)?.[1]
      expect(artifact, "HTML must show the artifact digest").toBe(json.subject.artifactDigest)
      expect(contract, "HTML must show the contract digest").toBe(json.contract.contractDigest)
    }
  })

  it("the sidecar is the sealed contract verbatim (canonical, trailing newline)", () => {
    const p = project(anyPage)
    expect(renderSafeInstallContract(p)).toBe(JSON.stringify(p.agentContract, null, 2) + "\n")
  })
})

describe("renderSafeInstall — exactly one primary CTA, state-correct (plan §6.7)", () => {
  it("renders exactly one primary-action anchor per page", () => {
    for (const page of pages) {
      const html = renderSafeInstall(project(page))
      expect((html.match(/data-primary-action=/g) ?? []).length).toBe(1)
      expect((html.match(/class="install-cta"/g) ?? []).length).toBe(1)
    }
  })

  it("the CTA copy matches the projection's humanDisposition (never a generic Install)", () => {
    for (const page of pages) {
      const p = project(page)
      const html = renderSafeInstall(p)
      expect(html).toContain(`>${p.humanDisposition.primaryCta}</a>`)
      expect(html).not.toMatch(/>Install<\/a>/)
    }
  })

  it("BLOCK and UNSUPPORTED CTAs are documentation links — never a prepare/apply command", () => {
    const block = project(pages.find((pg) => pg.verdict === "BLOCK") ?? anyPage)
    const unsupported = project(anyPage, { unsupported: true })
    for (const p of [block, unsupported]) {
      const html = renderSafeInstall(p)
      const href = html.match(/class="install-cta"[\s\S]*?href="([^"]+)"/)?.[1] ?? ""
      expect(href.startsWith("https://calllint.com/docs/")).toBe(true)
      // The human CTA is never a shell command or a live apply.
      expect(href).not.toMatch(/^(npx|calllint|pnpm|npm) /)
    }
  })

  it("an UNSUPPORTED page routes to EXPLAIN_ONLY with no command (INV-2.4-08)", () => {
    const p = project(anyPage, { unsupported: true })
    expect(p.installability).toBe("UNSUPPORTED")
    expect(p.agentContract.recommendedNextAction.kind).toBe("EXPLAIN_ONLY")
    expect(renderSafeInstall(p)).toContain('data-primary-action="UNSUPPORTED"')
  })
})

describe("renderSafeInstall — six decision groups, semantic DOM order (§7)", () => {
  it("emits identity → disposition → consequence → authority → secondary in that order", () => {
    const html = renderSafeInstall(project(anyPage))
    const order = [
      "install-identity",
      "install-disposition",
      "install-consequence",
      "install-authority",
      "install-secondary",
    ].map((cls) => html.indexOf(`class="${cls}"`))
    for (const idx of order) expect(idx).toBeGreaterThan(-1)
    const sorted = [...order].sort((a, b) => a - b)
    expect(order).toEqual(sorted)
  })

  it("shows at most three authority facts (plan §6.6)", () => {
    for (const page of pages) {
      const p = project(page)
      const html = renderSafeInstall(p)
      const items = (html.match(/data-observed=/g) ?? []).length
      expect(items).toBe(p.authorityDecisionFacts.length)
      expect(items).toBeLessThanOrEqual(3)
    }
  })
})

describe("renderSafeInstall — JS never decides (§7)", () => {
  it("carries no <script> and no inline on* handler", () => {
    for (const page of pages) {
      const html = renderSafeInstall(project(page))
      expect(html).not.toContain("<script")
      expect(html).not.toMatch(/\son[a-z]+=/i)
    }
  })
})

describe("renderSafeInstall — publisher text quarantined + labeled (INV-2.4-05)", () => {
  const MARK = "Publisher-provided description — not used for CallLint's safety decision."

  it("renders publisher text ONLY under the fixed label, escaped", () => {
    const p = project(anyPage, {
      subject: subjectFor(anyPage, { publisherDescription: "Best & <safest> \"tool\"" }),
    })
    const html = renderSafeInstall(p)
    expect(html).toContain(MARK)
    expect(html).toContain("Best &amp; &lt;safest&gt; &quot;tool&quot;")
    // The label sits AFTER the five decision groups (below the fold).
    expect(html.indexOf(MARK)).toBeGreaterThan(html.indexOf('class="install-secondary"'))
  })

  it("omits the publisher block entirely when there is no description (byte-stable)", () => {
    const html = renderSafeInstall(project(anyPage, { subject: subjectFor(anyPage, { publisherDescription: null }) }))
    expect(html).not.toContain("install-publisher")
    expect(html).not.toContain(MARK)
  })

  it("publisher text never changes the sealed contract digest", () => {
    const bare = project(anyPage, { subject: subjectFor(anyPage, { publisherDescription: null }) })
    const withText = project(anyPage, {
      subject: subjectFor(anyPage, { publisherDescription: "totally safe, trust me" }),
    })
    expect(withText.agentContract.contract.contractDigest).toBe(bare.agentContract.contract.contractDigest)
  })
})

describe("renderSafeInstall — language boundary + framing", () => {
  it("uses no forbidden phrase from EITHER set (Trust-Page + Safe-install)", () => {
    for (const page of pages) {
      const lc = renderSafeInstall(project(page)).toLowerCase()
      for (const phrase of [...TRUST_PAGE_FORBIDDEN_PHRASES, ...SAFE_INSTALL_FORBIDDEN_PHRASES]) {
        expect(lc, `page ${page.canonicalName}: "${phrase}"`).not.toContain(phrase.toLowerCase())
      }
    }
  })

  it("carries the boundary disclaimer + a correction link (public-copy guard 16)", () => {
    const html = renderSafeInstall(project(anyPage))
    expect(html).toContain("not a certification")
    expect(html).toContain("guarantee of safety")
    expect(html).toContain("Report a correction")
  })

  it("carries no email-like PII token (check 17)", () => {
    const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    const p = project(anyPage, {
      subject: subjectFor(anyPage, { publisherDescription: "contact me", sourceLocator: "npm:@x@1.0.0" }),
    })
    expect(EMAIL.test(renderSafeInstall(p))).toBe(false)
  })
})

describe("renderSafeInstall — deterministic (reproducibility gate)", () => {
  it("is byte-identical across renders of the same projection", () => {
    for (const page of pages) {
      const p = project(page)
      expect(renderSafeInstall(p)).toBe(renderSafeInstall(p))
      expect(renderSafeInstallContract(p)).toBe(renderSafeInstallContract(p))
    }
  })
})
