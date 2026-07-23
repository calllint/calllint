/**
 * Discovery-surface acceptance tests (Q5: a maintainer can't find their page).
 *
 * Two additive, discovery-only surfaces are pinned here at the SOURCE so a future
 * regression fails loudly rather than silently breaking SEO discovery or — worse —
 * the language boundary:
 *
 *   1. `structuredData(page)` — a boundary-safe JSON-LD block in each Trust Page's
 *      `<head>`. It is a `TechArticle` (dated technical document), NEVER a Review,
 *      Rating, Product, or Certification, because modeling a verdict as a rating would
 *      encode the "CallLint graded/approved this" overclaim the language boundary
 *      forbids (ADR 0038 §2 / 0053 §3). It publishes WHAT + WHEN, never a score.
 *   2. `renderSitemap(pages)` — a deterministic `trust/sitemap.xml` listing the CLEAN
 *      (extensionless) URL of each baked page. The `.html` artifact 308-redirects to
 *      that form at the edge, so a sitemap must list the final URL, never the redirect.
 *
 * Both are pure projections of already-public facts: they never touch a page digest,
 * the sidecar, the manifest, or the index (an observation/claim stays immutable). The
 * emit tests below prove that — the reproducibility surface is unchanged; only new
 * `.html` bytes + one `sitemap.xml` appear.
 *
 * Pure: no I/O, no clock, no network.
 */
import { describe, it, expect } from "vitest"
import {
  bakeTrustPage,
  fixtureCohort,
  renderHtml,
  renderSidecar,
  renderSitemap,
  structuredData,
  pageUrl,
  emitAllCohorts,
  SITE_ORIGIN,
  TRUST_PAGE_FORBIDDEN_PHRASES,
  type RegistrySnapshot,
} from "../src/index.js"

const cohort = fixtureCohort()
const verdictCases = cohort.filter((e) => e.case.expect !== "parse-error")
const anyCase = verdictCases[0]!
const safeCase = verdictCases.find((e) => e.case.expect === "SAFE")!

// A minimal real-resource cohort: two mappable Official-MCP-Registry entries. Used to
// prove the sitemap lists REAL resources (mcp-registry/*) while excluding the synthetic
// `calllint-fixtures/*` reproducibility goldens (a maintainer never claims a fixture).
const registrySnapshot: RegistrySnapshot = {
  schema: "calllint.trust-snapshot.v0",
  source: "official-mcp-registry",
  endpoint: "e",
  fetchedAt: "2026-02-02T00:00:00.000Z",
  count: 2,
  entries: [
    { name: "io.a/thing", description: "d", version: "1.0.0", repositoryUrl: null, packages: [{ registryType: "npm", identifier: "a", version: "1.0.0", transport: null }], remotes: [], status: "active", publishedAt: null },
    { name: "io.b/thing", description: "d", version: "1.0.0", repositoryUrl: null, packages: [], remotes: [{ type: "http", url: "https://b.dev" }], status: "active", publishedAt: null },
  ],
}

describe("structuredData — boundary-safe JSON-LD (ADR 0038 §2 / 0053 §3)", () => {
  it("is valid, parseable JSON-LD with the schema.org context", () => {
    const page = bakeTrustPage(anyCase.input)
    const block = structuredData(page)
    expect(block).toContain('type="application/ld+json"')
    // Extract and parse the JSON body (un-escape the `<` guard first).
    const json = block.replace(/^[\s\S]*?>\n/, "").replace(/\n\s*<\/script>$/, "").replace(/\\u003c/g, "<")
    const ld = JSON.parse(json)
    expect(ld["@context"]).toBe("https://schema.org")
  })

  it("models the page as a TechArticle, NOT a Review/Rating/Product/Certification", () => {
    const page = bakeTrustPage(anyCase.input)
    const ld = JSON.parse(
      structuredData(page).replace(/^[\s\S]*?>\n/, "").replace(/\n\s*<\/script>$/, "").replace(/\\u003c/g, "<"),
    )
    expect(ld["@type"]).toBe("TechArticle")
    // The overclaim-shaped schema types must never appear — a verdict is not a grade.
    const raw = structuredData(page)
    for (const t of ["Review", "Rating", "AggregateRating", "Product", "Certification", "Recommendation"]) {
      expect(raw, `JSON-LD must not use schema type ${t}`).not.toContain(`"${t}"`)
    }
    // No numeric-score properties either.
    for (const p of ["ratingValue", "reviewRating", "aggregateRating", "bestRating"]) {
      expect(raw).not.toContain(p)
    }
  })

  it("publishes WHAT + WHEN (verdict label, digest, observedAt) and carries the disclaimer", () => {
    const page = bakeTrustPage(anyCase.input)
    const raw = structuredData(page)
    expect(raw).toContain(page.artifactDigest)
    expect(raw).toContain(page.observedAt)
    // The standing boundary travels with any machine-extracted summary.
    expect(raw).toContain("not a certification")
    expect(raw).toContain("guarantee of safety")
  })

  it("uses no forbidden overclaim phrase and no claim vocabulary", () => {
    for (const entry of verdictCases) {
      const raw = structuredData(bakeTrustPage(entry.input)).toLowerCase()
      for (const phrase of TRUST_PAGE_FORBIDDEN_PHRASES) {
        expect(raw, `${entry.case.file}: "${phrase}"`).not.toContain(phrase.toLowerCase())
      }
      // Discovery metadata must never leak the claim overlay vocabulary (check 19).
      expect(raw).not.toContain("verified publisher")
      expect(raw).not.toContain("github.com/apps/calllint-trust")
    }
  })

  it("carries no email-like token (check 17 PII-free)", () => {
    const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    for (const entry of verdictCases) {
      expect(EMAIL.test(structuredData(bakeTrustPage(entry.input)))).toBe(false)
    }
  })

  it("is deterministic (byte-identical across renders — reproducibility gate)", () => {
    const page = bakeTrustPage(anyCase.input)
    expect(structuredData(page)).toBe(structuredData(bakeTrustPage(anyCase.input)))
  })
})

describe("canonical URL — the clean, non-redirecting form", () => {
  it("pageUrl is the extensionless clean URL (never the .html that 308-redirects)", () => {
    const page = bakeTrustPage(anyCase.input)
    expect(pageUrl(page)).toBe(`${SITE_ORIGIN}/trust/${page.canonicalName}`)
    expect(pageUrl(page)).not.toContain(".html")
  })

  it("renderHtml emits a <link rel=\"canonical\"> to that clean URL", () => {
    const page = bakeTrustPage(anyCase.input)
    expect(renderHtml(page)).toContain(`<link rel="canonical" href="${pageUrl(page)}" />`)
  })

  it("the canonical link + JSON-LD live in the HTML only — the sidecar is untouched", () => {
    const page = bakeTrustPage(anyCase.input)
    const sidecar = renderSidecar(page)
    expect(sidecar).not.toContain("application/ld+json")
    expect(sidecar).not.toContain("rel=\"canonical\"")
    // The sidecar carries no absolute site origin (it is digest-addressed, host-agnostic).
    expect(sidecar).not.toContain(SITE_ORIGIN)
  })
})

describe("renderSitemap — deterministic, clean URLs, final-URL-only", () => {
  const pages = verdictCases.map((e) => {
    const p = bakeTrustPage(e.input)
    return { canonicalName: p.canonicalName, observedAt: p.observedAt }
  })

  it("is a well-formed urlset listing one <loc> per page", () => {
    const xml = renderSitemap(pages)
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect((xml.match(/<loc>/g) ?? []).length).toBe(pages.length)
  })

  it("lists only clean URLs — never the .html form that 308-redirects", () => {
    const xml = renderSitemap(pages)
    expect(xml).not.toContain(".html")
    for (const p of pages) expect(xml).toContain(`<loc>${SITE_ORIGIN}/trust/${p.canonicalName}</loc>`)
  })

  it("uses each page's pinned observedAt as <lastmod> (no clock read)", () => {
    const xml = renderSitemap(pages)
    for (const p of pages) expect(xml).toContain(`<lastmod>${p.observedAt}</lastmod>`)
  })

  it("is order-stable regardless of input order (sorted by canonicalName)", () => {
    const forward = renderSitemap(pages)
    const reversed = renderSitemap([...pages].reverse())
    expect(reversed).toBe(forward)
  })
})

describe("emitAllCohorts — sitemap is chrome; discovery never moves the reproducibility surface", () => {
  it("emits exactly one sitemap.xml, listing only REAL baked resources (never fixtures, incomplete, or the landing page)", () => {
    const { files } = emitAllCohorts(registrySnapshot)
    const sitemaps = files.filter((f) => f.path === "sitemap.xml")
    expect(sitemaps).toHaveLength(1)
    const xml = sitemaps[0]!.content
    // The sitemap advertises real, claimable resources only — the synthetic
    // `calllint-fixtures/*` reproducibility goldens are deliberately NOT listed, even
    // though they ARE baked (and still appear in index.json for completeness).
    const bakedRealHtml = files.filter(
      (f) => f.path.endsWith(".html") && f.path.includes("/") && !f.path.startsWith("calllint-fixtures/"),
    ).length
    expect((xml.match(/<loc>/g) ?? []).length).toBe(bakedRealHtml)
    expect(bakedRealHtml).toBeGreaterThan(0) // the registry cohort produced real pages
    // No fixture URL, no landing page, ever appears in the sitemap.
    expect(xml).not.toContain("calllint-fixtures/")
    expect(xml).not.toContain("app-created")
    // The real registry resources ARE listed (clean URL form).
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/trust/mcp-registry/io.a-thing</loc>`)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/trust/mcp-registry/io.b-thing</loc>`)
  })

  it("still bakes fixture pages + records them in index.json (the filter is discovery-only)", () => {
    const { files } = emitAllCohorts(registrySnapshot)
    // Fixtures are still baked as .html/.json artifacts...
    expect(files.some((f) => f.path === "calllint-fixtures/safe-time.html")).toBe(true)
    // ...and still counted in the index for completeness — only the sitemap omits them.
    const index = JSON.parse(files.find((f) => f.path === "index.json")!.content)
    const names = (index.entries as { canonicalName: string }[]).map((e) => e.canonicalName)
    expect(names).toContain("calllint-fixtures/safe-time")
  })

  it("adds NO entry to index.json (sitemap is not a resource)", () => {
    const { files } = emitAllCohorts()
    const index = JSON.parse(files.find((f) => f.path === "index.json")!.content)
    const names = (index.entries as { canonicalName: string }[]).map((e) => e.canonicalName)
    expect(names).not.toContain("sitemap")
    expect(names).not.toContain("sitemap.xml")
  })

  it("adding the sitemap + head changes leaves every .json sidecar/manifest/index byte-identical to their own re-emit", () => {
    // Two emits are byte-identical everywhere (the whole point of the reproducibility
    // gate) — this asserts the discovery additions did not introduce any nondeterminism.
    const a = emitAllCohorts()
    const b = emitAllCohorts()
    expect(b.files).toEqual(a.files)
  })

  it("a fixtures-only bake emits a valid but empty-bodied sitemap (fixtures excluded)", () => {
    // With no registry snapshot the only baked pages are fixtures — which are all
    // excluded from the sitemap. The sitemap is still emitted and is a valid urlset,
    // just with zero <loc> entries (nothing real to advertise yet).
    const { files } = emitAllCohorts(null)
    const xml = files.find((f) => f.path === "sitemap.xml")!.content
    expect(xml).toContain("<urlset")
    expect(xml).toContain("</urlset>")
    expect((xml.match(/<loc>/g) ?? []).length).toBe(0)
    expect(xml).not.toContain("calllint-fixtures/")
    expect(xml).not.toContain("malformed")
  })
})
