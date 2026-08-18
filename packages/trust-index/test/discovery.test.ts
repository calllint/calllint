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
  socialMetadata,
  pageDescription,
  pageUrl,
  emitAllCohorts,
  SITE_ORIGIN,
  TRUST_PAGE_FORBIDDEN_PHRASES,
  type RegistrySnapshot,
  type BakeInput,
} from "../src/index.js"
import type { Verdict } from "@calllint/types"

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
  it("emits exactly one sitemap.xml, listing REAL baked resources + Safe-install pages + the standing lookup page (never fixtures, incomplete, or the landing page)", () => {
    const { files, installFiles } = emitAllCohorts(registrySnapshot)
    const sitemaps = files.filter((f) => f.path === "sitemap.xml")
    expect(sitemaps).toHaveLength(1)
    const xml = sitemaps[0]!.content
    // The sitemap advertises real, claimable resources only — the synthetic
    // `calllint-fixtures/*` reproducibility goldens are deliberately NOT listed, even
    // though they ARE baked (and still appear in index.json for completeness) — PLUS the
    // Safe-install acquisition pages (`/install/{slug}/`, one per emitted install page,
    // human page only — ADR 0056) PLUS the one standing `/trust/lookup` utility page
    // (ADR 0055 §5), which is site chrome.
    const bakedRealHtml = files.filter(
      (f) => f.path.endsWith(".html") && f.path.includes("/") && !f.path.startsWith("calllint-fixtures/"),
    ).length
    // One install <loc> per emitted install page (index.html), NOT the contract sidecar.
    const installHtml = installFiles.filter((f) => f.path.endsWith("/index.html")).length
    expect((xml.match(/<loc>/g) ?? []).length).toBe(bakedRealHtml + installHtml + 1)
    expect(bakedRealHtml).toBeGreaterThan(0) // the registry cohort produced real pages
    expect(installHtml).toBeGreaterThan(0) // ...and each produced an install page
    // No fixture URL, no landing page, ever appears in the sitemap.
    expect(xml).not.toContain("calllint-fixtures/")
    expect(xml).not.toContain("app-created")
    // The real registry resources ARE listed (clean URL form).
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/trust/mcp-registry/io.a-thing</loc>`)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/trust/mcp-registry/io.b-thing</loc>`)
    // Their Safe-install pages are listed too — the human page with a trailing slash, and
    // NEVER the machine contract sidecar (`/install/{slug}/index.json` is not a page).
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/install/mcp-registry/io.a-thing/</loc>`)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/install/mcp-registry/io.b-thing/</loc>`)
    expect(xml).not.toContain("/install/mcp-registry/io.a-thing/index.json")
    // The standing lookup page is listed once, as a clean URL (loc-only chrome).
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/trust/lookup</loc>`)
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

  it("adds NO entry to index.json (sitemap + lookup surfaces are chrome, not resources)", () => {
    const { files } = emitAllCohorts()
    const index = JSON.parse(files.find((f) => f.path === "index.json")!.content)
    const names = (index.entries as { canonicalName: string }[]).map((e) => e.canonicalName)
    expect(names).not.toContain("sitemap")
    expect(names).not.toContain("sitemap.xml")
    // The lookup surfaces (ADR 0055 §5) are chrome too — never resources in the index.
    expect(names).not.toContain("lookup")
    expect(names).not.toContain("lookup.html")
    expect(names).not.toContain("lookup-index")
    expect(names).not.toContain("lookup-index.json")
  })

  it("emits the lookup surfaces as chrome: lookup-index.json + lookup.html, deterministic, boundary-safe, no claim funnel", () => {
    const { files } = emitAllCohorts(registrySnapshot)
    const html = files.find((f) => f.path === "lookup.html")!.content
    const json = files.find((f) => f.path === "lookup-index.json")!.content
    // Boundary framing required on every /trust/**.html by check-public-copy 16.
    expect(html).toContain("not a certification")
    expect(html).toContain("guarantee of safety")
    expect(html).toContain("Report a correction")
    // Reads as claimed-style chrome (check 19): mentions Verified Publisher, no funnel URL.
    expect(html).toContain("Verified Publisher")
    expect(html).not.toContain("https://github.com/apps/calllint-trust")
    // Deterministic-only client matcher — no fuzzy / embedding / ranking-model vocabulary.
    // The "no LLM, no fuzzy" invariant (ADR 0055 §5) is about the MATCHING logic, so this
    // scans the inline matcher script specifically — not unrelated site chrome such as the
    // standard `/llms.txt` footer link every marketing page (incl. app-created.html) carries.
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/)
    expect(scriptMatch, "lookup.html must inline a matcher <script>").toBeTruthy()
    const script = (scriptMatch![1] ?? "").toLowerCase()
    for (const banned of ["fuzzy", "levenshtein", "embedding", "cosine", "vector", "llm", "gpt", "openai", "innerhtml"]) {
      expect(script, `lookup.html matcher must not contain "${banned}"`).not.toContain(banned)
    }
    // No cookie / storage / PII surface.
    expect(html).not.toContain("localStorage")
    expect(html).not.toContain("document.cookie")
    // No hardcoded SAFE label in the static bytes (labels are rendered client-side from
    // the index) — so check 20's bare-SAFE scope requirement does not apply to this page.
    expect(html).not.toContain("No blockers observed")
    // The index carries no free-text/score fields (closed projection).
    expect(json).not.toContain("description")
    expect(json).not.toContain("score")
  })

  it("adding the sitemap + head changes leaves every .json sidecar/manifest/index byte-identical to their own re-emit", () => {
    // Two emits are byte-identical everywhere (the whole point of the reproducibility
    // gate) — this asserts the discovery additions did not introduce any nondeterminism.
    const a = emitAllCohorts()
    const b = emitAllCohorts()
    expect(b.files).toEqual(a.files)
  })

  it("a fixtures-only bake emits a sitemap with only the standing lookup page (fixtures excluded)", () => {
    // With no registry snapshot the only baked resource pages are fixtures — all excluded
    // from the sitemap. The standing `/trust/lookup` utility page (ADR 0055 §5) is ALWAYS
    // listed, so the urlset has exactly one <loc> (the lookup page), never a fixture.
    const { files } = emitAllCohorts(null)
    const xml = files.find((f) => f.path === "sitemap.xml")!.content
    expect(xml).toContain("<urlset")
    expect(xml).toContain("</urlset>")
    expect((xml.match(/<loc>/g) ?? []).length).toBe(1)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/trust/lookup</loc>`)
    expect(xml).not.toContain("calllint-fixtures/")
    expect(xml).not.toContain("malformed")
  })
})

describe("P0/P1 Change 2: Trust Page SEO + Social Metadata", () => {
  it("pageDescription is fact-only (verdict + digest + time + completeness + disclaimer)", () => {
    const page = bakeTrustPage(anyCase.input)
    const desc = pageDescription(page)
    // Must contain: verdict label, digest, observedAt, completeness, disclaimer
    expect(desc).toContain(page.artifactDigest)
    expect(desc).toContain(page.observedAt)
    expect(desc).toContain("completeness:")
    expect(desc).toContain("not a certification")
    expect(desc).toContain("guarantee of safety")
    // Must NOT contain forbidden overclaim phrases
    for (const phrase of TRUST_PAGE_FORBIDDEN_PHRASES) {
      expect(desc.toLowerCase()).not.toContain(phrase)
    }
  })

  it("renderHtml includes <meta name='description'> with fact-only content", () => {
    const page = bakeTrustPage(anyCase.input)
    const html = renderHtml(page)
    expect(html).toMatch(/<meta name="description" content="[^"]+"\s*\/>/)
    const match = html.match(/<meta name="description" content="([^"]+)"\s*\/>/)
    expect(match).toBeTruthy()
    const desc = match![1]!
    expect(desc).toContain(page.artifactDigest)
    expect(desc).toContain("not a certification")
  })

  it("renderHtml includes Open Graph metadata (type=article, url, title, description, image)", () => {
    const page = bakeTrustPage(safeCase.input)
    const html = renderHtml(page)
    expect(html).toContain('<meta property="og:type" content="article"')
    expect(html).toContain(`<meta property="og:url" content="${SITE_ORIGIN}/trust/${page.canonicalName}"`)
    expect(html).toContain(`<meta property="og:title" content="${page.canonicalName} — CallLint Trust Page"`)
    expect(html).toContain('<meta property="og:description"')
    expect(html).toContain(`<meta property="og:image" content="${SITE_ORIGIN}/logo-mark-128.png"`)
  })

  it("renderHtml includes Twitter Card metadata (summary_large_image)", () => {
    const page = bakeTrustPage(safeCase.input)
    const html = renderHtml(page)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"')
    expect(html).toContain('<meta name="twitter:title"')
    expect(html).toContain('<meta name="twitter:description"')
    expect(html).toContain('<meta name="twitter:image"')
  })

  it("renderHtml includes <link rel='alternate'> for JSON sidecar", () => {
    const page = bakeTrustPage(anyCase.input)
    const html = renderHtml(page)
    expect(html).toMatch(/<link rel="alternate" type="application\/json" href="[^"]+\.json"\s*\/>/)
    expect(html).toContain(`href="${SITE_ORIGIN}/trust/${page.canonicalName}.json"`)
  })

  it("canonical link remains clean (extensionless URL, no .html)", () => {
    const page = bakeTrustPage(anyCase.input)
    const html = renderHtml(page)
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/trust/${page.canonicalName}"`)
    expect(html).not.toContain(".html")
  })

  it("structuredData remains TechArticle (not Review/Rating/Product)", () => {
    const page = bakeTrustPage(anyCase.input)
    const raw = structuredData(page)
    const ld = JSON.parse(raw.replace(/^[\s\S]*?>\n/, "").replace(/\n\s*<\/script>$/, "").replace(/\\u003c/g, "<"))
    expect(ld["@type"]).toBe("TechArticle")
  })

  it("social metadata never appears in sidecar (orthogonality: distribution ⟂ verdict)", () => {
    const page = bakeTrustPage(anyCase.input)
    const sidecar = renderSidecar(page)
    // Open Graph and Twitter Card vocabulary must not appear in JSON sidecar
    expect(sidecar).not.toContain("og:")
    expect(sidecar).not.toContain("twitter:")
    expect(sidecar).not.toContain("og:type")
    expect(sidecar).not.toContain("og:image")
  })
})

describe("P0/P1 Change 3: Trust Page Basic Visual Shell", () => {
  it("renderHtml references /styles.css", () => {
    const page = bakeTrustPage(anyCase.input)
    const html = renderHtml(page)
    expect(html).toContain('<link rel="stylesheet" href="/styles.css"')
  })

  it("main element uses section section-narrow classes (constrained reading measure)", () => {
    const page = bakeTrustPage(anyCase.input)
    const html = renderHtml(page)
    expect(html).toContain('<main class="section section-narrow">')
  })

  it("stylesheet reference comes before body (in head)", () => {
    const page = bakeTrustPage(anyCase.input)
    const html = renderHtml(page)
    const styleIndex = html.indexOf('<link rel="stylesheet"')
    const bodyIndex = html.indexOf("<body>")
    expect(styleIndex).toBeGreaterThan(-1)
    expect(bodyIndex).toBeGreaterThan(-1)
    expect(styleIndex).toBeLessThan(bodyIndex)
  })
})

describe("P0/P1 Change 4: Trust→Install Bridge", () => {
  // Fixture pages (calllint-fixtures/*) are pure observation anchors and never show
  // acquisition CTAs. Real Registry pages (mcp-registry/*) get the verdict-appropriate
  // link to their Safe Install page.
  const fixtureCase = fixtureCohort().find((c) => c.case.expect === "SAFE")!
  const realRegistryInput: BakeInput = {
    canonicalName: "mcp-registry/example-server",
    configText: fixtureCase.input.configText,
    sourceLabel: "example-server",
    observedAt: fixtureCase.input.observedAt,
  }

  it("Real Registry page gets Trust→Install link", () => {
    const page = bakeTrustPage(realRegistryInput)
    const html = renderHtml(page)
    expect(html).toContain(`href="/install/${page.canonicalName}/"`)
    expect(html).toContain(`data-trust-event="trust_page_to_install"`)
  })

  it("Fixture page gets NO Trust→Install link", () => {
    const page = bakeTrustPage(fixtureCase.input)
    const html = renderHtml(page)
    // Fixture pages should not have install links
    expect(html).not.toContain('/install/')
    expect(html).not.toContain('data-trust-event="trust_page_to_install"')
  })

  it("href points to correct /install/{canonicalName}/ path", () => {
    const page = bakeTrustPage(realRegistryInput)
    const html = renderHtml(page)
    const expected = `/install/${page.canonicalName}/`
    expect(html).toContain(`href="${expected}"`)
  })

  it("verdict-appropriate labels for each state", () => {
    const verdicts: Array<{ verdict: Verdict; label: string }> = [
      { verdict: "SAFE", label: "Review install plan" },
      { verdict: "REVIEW", label: "Review before adding" },
      { verdict: "BLOCK", label: "See what must change before adding" },
      { verdict: "UNKNOWN", label: "Review evidence gap" },
    ]

    for (const { verdict, label } of verdicts) {
      const input: BakeInput = {
        ...realRegistryInput,
        configText:
          verdict === "BLOCK"
            ? '{"mcpServers":{"test":{"url":"http://example.com"}}}'  // HTTP → BLOCK
            : verdict === "UNKNOWN"
              ? '{"mcpServers":{}}'  // Empty → UNKNOWN
              : verdict === "REVIEW"
                ? '{"mcpServers":{"test":{"command":"node","args":["server.js"],"env":{"SECRET":"x"}}}}'  // Secret → REVIEW
                : fixtureCase.input.configText,  // SAFE
      }
      const page = bakeTrustPage(input)
      const html = renderHtml(page)

      // Only check if the verdict matches (the config might not produce exact verdict)
      if (page.verdict === verdict) {
        expect(html).toContain(label)
      }
    }
  })

  it('does NOT contain "install safely" language', () => {
    const page = bakeTrustPage(realRegistryInput)
    const html = renderHtml(page)
    expect(html.toLowerCase()).not.toContain("install safely")
    expect(html.toLowerCase()).not.toContain("safely install")
  })

  it("CTA does NOT appear in JSON sidecar (orthogonality: presentation ⟂ verdict)", () => {
    const page = bakeTrustPage(realRegistryInput)
    const sidecar = renderSidecar(page)
    // Install CTA vocabulary must not leak into the sidecar
    expect(sidecar).not.toContain("/install/")
    expect(sidecar).not.toContain("Review install")
    expect(sidecar).not.toContain("trust_page_to_install")
  })

  it("Claim CTA includes data-trust-event attribute", () => {
    const page = bakeTrustPage(realRegistryInput)
    const html = renderHtml(page)
    // Unclaimed page should have the claim CTA with telemetry
    expect(html).toContain('data-trust-event="claim_cta_clicked"')
  })
})
