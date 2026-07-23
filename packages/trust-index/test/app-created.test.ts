/**
 * Acceptance tests for the post-install claim-funnel landing page (ADR 0047/0048 §2).
 *
 * `renderAppCreatedPage` is the target of the GitHub App's `redirect_url`
 * (`https://calllint.com/trust/app-created.html`). It is emitted by `emitAllCohorts`
 * into `apps/web/public/trust/`, so it is walked by `scripts/check-public-copy.mjs`
 * (checks 15–20) exactly like every other served page. These tests pin the load-bearing
 * invariants at the SOURCE so a future copy regression fails here loudly rather than
 * silently breaking the served-page guard:
 *
 *   1. It carries the required boundary framing (check 16): the "not a certification …
 *      guarantee of safety" disclaimer AND a "Report a correction" link.
 *   2. It is a POST-INSTALL (claimed) page (check 19): it shows the "Verified Publisher"
 *      framing with the "not a safety claim" boundary, and it MUST NOT carry the App
 *      install funnel URL — it never re-solicits an install.
 *   3. It never emits a forbidden overclaim phrase (check 15).
 *   4. It states no verdict, so it must not carry the SAFE label (check 20 → skipped).
 *   5. It is emitted as site chrome, NOT a resource: exactly one `app-created.html`, and
 *      it adds NO entry to `index.json` (so the index + completeness count are unchanged).
 *   6. It is deterministic (a re-render is byte-identical — the reproducibility gate).
 *
 * Pure: no I/O, no clock, no network.
 */
import { describe, it, expect } from "vitest"
import {
  renderAppCreatedPage,
  emitAllCohorts,
  CLAIM_APP_URL,
  CORRECTION_URL,
  TRUST_PAGE_FORBIDDEN_PHRASES,
} from "../src/index.js"

const SAFE_LABEL = "No blockers observed"

describe("renderAppCreatedPage — boundary framing (check 16)", () => {
  const html = renderAppCreatedPage()
  it("carries the 'not a certification … guarantee of safety' disclaimer", () => {
    expect(html).toContain("not a certification")
    expect(html).toContain("guarantee of safety")
  })
  it("carries a correction link pointing at CORRECTION_URL", () => {
    expect(html).toContain("Report a correction")
    expect(html).toContain(CORRECTION_URL)
  })
})

describe("renderAppCreatedPage — claim-funnel state (check 19)", () => {
  const html = renderAppCreatedPage()
  it("is a claimed/post-install page: shows the Verified Publisher framing", () => {
    expect(html).toContain("Verified Publisher")
  })
  it("frames the claim as control, not safety", () => {
    expect(html).toContain("not a safety claim")
  })
  it("MUST NOT re-solicit an install — the funnel URL is absent", () => {
    // The security crux for this page: a post-install page carrying the install funnel
    // would trip check 19's claimed-page branch (claimed AND funnel = contradiction).
    expect(html).not.toContain(CLAIM_APP_URL)
    expect(html).not.toContain("github.com/apps/calllint-trust")
  })
})

describe("renderAppCreatedPage — no overclaim (check 15) / no bare SAFE (check 20)", () => {
  const html = renderAppCreatedPage()
  const lc = html.toLowerCase()
  for (const phrase of TRUST_PAGE_FORBIDDEN_PHRASES) {
    it(`does not contain the forbidden phrase "${phrase}"`, () => {
      expect(lc).not.toContain(phrase.toLowerCase())
    })
  }
  it("states no verdict, so it does not carry the SAFE label", () => {
    expect(html).not.toContain(SAFE_LABEL)
  })
})

describe("renderAppCreatedPage — reuses the marketing chrome + is deterministic", () => {
  it("links the shared stylesheet (same site as the redirect origin)", () => {
    expect(renderAppCreatedPage()).toContain('<link rel="stylesheet" href="/styles.css" />')
  })
  it("is noindex (a transactional redirect target, not content to rank)", () => {
    expect(renderAppCreatedPage()).toContain('<meta name="robots" content="noindex" />')
  })
  it("is byte-identical across renders (reproducibility gate)", () => {
    expect(renderAppCreatedPage()).toBe(renderAppCreatedPage())
  })
})

describe("emitAllCohorts — the landing page is chrome, not a resource", () => {
  it("emits exactly one app-created.html", () => {
    const { files } = emitAllCohorts()
    const matches = files.filter((f) => f.path === "app-created.html")
    expect(matches).toHaveLength(1)
    expect(matches[0]!.content).toBe(renderAppCreatedPage())
  })

  it("adds NO entry to index.json (index + completeness count unchanged)", () => {
    const { files } = emitAllCohorts()
    const index = JSON.parse(files.find((f) => f.path === "index.json")!.content)
    const names = (index.entries as { canonicalName: string }[]).map((e) => e.canonicalName)
    expect(names).not.toContain("app-created")
    expect(names).not.toContain("app-created.html")
  })

  it("emits the page even with no snapshot (fixtures-only bake)", () => {
    const { files } = emitAllCohorts(null)
    expect(files.some((f) => f.path === "app-created.html")).toBe(true)
  })
})
