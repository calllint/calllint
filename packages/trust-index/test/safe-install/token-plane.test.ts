// ---------------------------------------------------------------------------
// Workstream P Batch 4 — L0 token plane tests (new15 §4.2 PR P-4; ADR 0058 §1/§4).
//
// P-1 proved COPY reaches no digest; P-3 proved the same of LAYOUT. This suite makes a
// weaker-sounding but differently-shaped claim about TOKENS: L0 is the level that is "not
// reachable into any digest, and appears only in CSS", so the plane must be measurably
// populated, measurably harmless, and measurably tied to the visual language it mirrors.
//
// Five questions, each falsifiable:
//
//   1. POPULATED — `l0Digest` moved off sha256({}), and L1/L2/presentationDigest did NOT.
//      Orthogonality is asserted rather than assumed: `sectionsAtLevel` projects by level,
//      so a bug that leaked the tokens section into another level would be invisible to a
//      test that only checked L0 went up.
//   2. INV-P2 BEHAVIOR ISOLATION — under any `tokens` mutation, every digest, the verdict,
//      the installability, the next action, and the rendered HTML are byte-identical.
//      Baselines come from a never-mutated control twin, per the P-3 lesson: a baseline
//      read off the object under test can only detect non-idempotent damage.
//   3. DRIFT PIN — every `:root` name present in BOTH apps/web/styles/tokens.css and the
//      served apps/web/public/styles.css holds a byte-identical value. §4 forbids editing
//      the served sheet, so the duplication is forced; pinning is what keeps it measured.
//   4. SELECTOR COVERAGE — every `install-*` class the renderer really emits has a rule.
//      The class set is parsed from rendered HTML, never hardcoded, so it tracks the
//      renderer instead of agreeing with a list this repo wrote twice.
//   5. HYGIENE — no @import/url()/!important/http, one :root, no duplicate names, and
//      nothing that could HIDE a decision group. A stylesheet cannot compute a verdict,
//      but it can make one invisible, and an invisible disposition is a safety regression
//      wearing a theme.
//
// The file reads happen here (test = an I/O edge, like the lock script); every measurement
// goes through `tokenPlane.ts`, so the lock and this suite cannot disagree about what the
// plane contains.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest"
import {
  CANONICAL_FIXTURES,
  DEFAULT_PRESENTATION,
  EMPTY_PRESENTATION_CONTENT,
  FORBIDDEN_CSS_CONSTRUCTS,
  LEVEL_BY_SECTION,
  canonicalProjectionInput,
  countCssRules,
  emittedInstallClasses,
  emptyPresentationDigest,
  forbiddenCssConstructs,
  parseClassSelectors,
  parseRootTokens,
  parseStyledClasses,
  presentationDigest,
  renderSafeInstall,
  resolvePresentation,
  safeInstallProjection,
  suppressionViolations,
  tokenDrift,
  validatePresentationContent,
  type PresentationContentV1,
} from "../../src/index.js"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..")
const facts = JSON.parse(fs.readFileSync(path.join(repoRoot, "project-facts.json"), "utf8")) as {
  forbiddenPhrases: string[]
  trustPageForbiddenPhrases: string[]
}
const ctx = {
  verdictLabels: VERDICT_PUBLIC_LABEL,
  stateCtas: DEFAULT_PRESENTATION.primaryCta,
  forbiddenPhrases: [...facts.forbiddenPhrases, ...facts.trustPageForbiddenPhrases],
}

/** The L0 plane, and the served sheet it mirrors. Read once; never written. */
const PLANE_PATH = path.join(repoRoot, "apps", "web", "styles", "tokens.css")
const SERVED_PATH = path.join(repoRoot, "apps", "web", "public", "styles.css")
const planeCss = fs.readFileSync(PLANE_PATH, "utf8")
const servedCss = fs.readFileSync(SERVED_PATH, "utf8")

/** The committed catalog — the document the bake actually resolves. */
const CATALOG_PATH = path.join(repoRoot, "apps", "web", "content", "safe-install", "presentation.v1.json")
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")) as PresentationContentV1

/** The digest of the empty object — what `l0Digest` held from P-1 through P-3. */
const EMPTY_OBJECT_DIGEST = "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"

/**
 * A tokens block that DIFFERS from the committed one, for the isolation tests.
 *
 * Asserted different below before anything relies on it: an isolation claim reads
 * "X changed, the decision did not", and if X never changed the suite would pass while
 * measuring nothing.
 */
const MUTATED_TOKENS = { tokensVersion: "isolation-probe", stylesheetHref: "/styles/other.css" } as const

/** Built fresh per call, so a renderer that mutated a projection cannot hide in a shared object. */
const freshProjections = () =>
  CANONICAL_FIXTURES.map((f) => safeInstallProjection(canonicalProjectionInput(f, "Publisher marketing blurb here.")))

describe("L0 token plane — populated (the level is no longer indistinguishable from broken)", () => {
  it("the committed catalog carries a tokens block, and it validates", () => {
    expect(catalog.tokens).toBeDefined()
    expect(catalog.tokens?.tokensVersion).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
    expect(validatePresentationContent(catalog, ctx)).toEqual([])
  })

  it("tokens is declared at L0 — the level this batch populates", () => {
    expect(LEVEL_BY_SECTION.tokens).toBe("L0")
  })

  it("l0Digest MOVED off the digest of {} — and the empty document still produces it", () => {
    // Both halves matter. The first is the batch's central measurement; the second proves
    // the constant is the real predecessor rather than a hex string that happens to differ.
    expect(emptyPresentationDigest().l0Digest).toBe(EMPTY_OBJECT_DIGEST)
    const digests = presentationDigest(catalog)
    expect(digests.l0Digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(digests.l0Digest).not.toBe(EMPTY_OBJECT_DIGEST)
    expect(digests.sections).toContain("tokens")
  })

  it("L0 is ORTHOGONAL — adding or changing tokens moves l0Digest and NOTHING else", () => {
    // Asserted, not assumed. `sectionsAtLevel` projects by level, so a leak that put the
    // tokens section into the L1 or L2 projection would be invisible to a test that only
    // checked l0Digest went up.
    const withoutTokens = { ...catalog }
    delete (withoutTokens as { tokens?: unknown }).tokens
    const base = presentationDigest(withoutTokens)
    const withTokens = presentationDigest(catalog)
    const altered = presentationDigest({ ...catalog, tokens: MUTATED_TOKENS })

    expect(base.l0Digest).toBe(EMPTY_OBJECT_DIGEST) // no other section is at L0 today
    expect(withTokens.l0Digest).not.toBe(base.l0Digest)
    expect(altered.l0Digest).not.toBe(withTokens.l0Digest)

    for (const d of [withTokens, altered]) {
      expect(d.l1Digest).toBe(base.l1Digest)
      expect(d.l2Digest).toBe(base.l2Digest)
    }
    // `presentationDigest` is over the WHOLE canonical document, so it MUST move — the
    // level digests are what isolate. Pinning this direction too keeps the four-digest
    // split honest: if the aggregate stopped moving, l0Digest would be unreachable from it.
    expect(withTokens.presentationDigest).not.toBe(base.presentationDigest)
    expect(altered.presentationDigest).not.toBe(withTokens.presentationDigest)
  })

  it("the declared stylesheetHref names the file that exists, and is site-absolute", () => {
    // P-4 RECORDS the href without emitting it, so nothing checks it at runtime this
    // batch — which is why it is checked here. A stale value would surface for the first
    // time in P-4b, as a 404 on a served page.
    const href = catalog.tokens?.stylesheetHref
    expect(href).toBeDefined()
    expect(href).toMatch(/^\/styles\/[a-z0-9./-]+\.css$/)
    expect(href).not.toMatch(/^https?:|^\/\//) // no scheme, no host: never a third-party origin
    expect(fs.existsSync(path.join(repoRoot, "apps", "web", (href as string).replace(/^\//, "")))).toBe(true)
  })

  it("the plane is NOT served — it lives outside apps/web/public/", () => {
    // The structural half of ADR 0058 §4. Not a promise about the renderer: the deploy step
    // publishes `public` only, so a path outside it cannot reach a visitor.
    const rel = path.relative(path.join(repoRoot, "apps", "web", "public"), PLANE_PATH)
    expect(rel.startsWith("..")).toBe(true)
    // And no served install page references any stylesheet yet.
    const installRoot = path.join(repoRoot, "apps", "web", "public", "install")
    const pages: string[] = []
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === "index.html") pages.push(p)
      }
    }
    walk(installRoot)
    expect(pages.length).toBeGreaterThan(0) // anti-vacuity
    for (const p of pages) {
      const html = fs.readFileSync(p, "utf8")
      expect(html).not.toMatch(/rel="stylesheet"/)
      expect(html).not.toMatch(/<style[\s>]/)
    }
  })
})

describe("L0 token plane — INV-P2 behavior isolation", () => {
  it("the probe tokens differ from the committed block (anti-vacuity first)", () => {
    expect(MUTATED_TOKENS.tokensVersion).not.toBe(catalog.tokens?.tokensVersion)
    expect(JSON.stringify(MUTATED_TOKENS)).not.toBe(JSON.stringify(catalog.tokens))
  })

  it("mutating tokens moves NO digest on any projection", () => {
    // Read each digest from where it actually lives, and assert each IS a digest before
    // comparing — otherwise a wrong path compares undefined to undefined and passes.
    const digests = (p: ReturnType<typeof freshProjections>[number]) => ({
      contract: p.agentContract.contract.contractDigest,
      snapshot: p.agentContract.contract.snapshotDigest,
      artifact: p.agentContract.subject.artifactDigest,
      evidence: p.agentContract.publicObservation.evidenceDigest,
      registry: p.agentContract.trustedSources.registrySnapshotDigest,
    })
    // Two independent builds of the same inputs: one is rendered under a mutated token
    // plane, the other is never touched. Comparing against the untouched twin is what makes
    // a constant-valued mutation detectable (the P-3 lesson).
    const rendered = freshProjections()
    const control = freshProjections()
    for (const [i, p] of rendered.entries()) {
      const before = digests(control[i]!)
      for (const [name, value] of Object.entries(before)) {
        expect(value, `${name} digest must be real for this test to mean anything`).toMatch(/^sha256:[0-9a-f]{64}$/)
      }
      // Resolve a document carrying the mutated tokens and render through it. Tokens reach
      // no renderer argument at all today, which is the claim — so this must be inert.
      const resolved = resolvePresentation({ ...catalog, tokens: MUTATED_TOKENS })
      renderSafeInstall(p, resolved.sectionTitles, resolved.layout)
      expect(digests(p)).toEqual(before)
    }
  })

  it("verdict, installability and next-action kind are token-invariant", () => {
    for (const f of CANONICAL_FIXTURES) {
      const input = canonicalProjectionInput(f, "Blurb.")
      const p = safeInstallProjection(input)
      expect(p.publicObservation.verdict).toBe(f.expectVerdict)
      expect(p.installability).toBe(f.expectInstallability)
      const kind = p.agentContract.recommendedNextAction.kind

      const resolved = resolvePresentation({ ...catalog, tokens: MUTATED_TOKENS })
      const again = safeInstallProjection(input)
      renderSafeInstall(again, resolved.sectionTitles, resolved.layout)
      expect(again.publicObservation.verdict).toBe(f.expectVerdict)
      expect(again.installability).toBe(f.expectInstallability)
      expect(again.agentContract.recommendedNextAction.kind).toBe(kind)
    }
  })

  it("the rendered HTML is BYTE-IDENTICAL under any tokens block", () => {
    // The strongest form of "P-4 changes no served byte": not a digest that held, the
    // actual bytes. If a later PR wires tokens into the renderer without also moving the
    // reproducibility gate, this fails first.
    const rendered = freshProjections()
    const control = freshProjections()
    for (const [i, p] of rendered.entries()) {
      const baseline = renderSafeInstall(control[i]!)
      for (const tokens of [undefined, catalog.tokens, MUTATED_TOKENS]) {
        const doc = { ...catalog, tokens } as PresentationContentV1
        const resolved = resolvePresentation(doc)
        expect(renderSafeInstall(p, resolved.sectionTitles, resolved.layout)).toBe(baseline)
      }
    }
  })

  it("the resolver treats tokens as a NON-SLOT — it is not overridden, and not rejected", () => {
    // L0 appears only in CSS, so no resolver slot consumes it. Recording that explicitly
    // matters: were `tokens` to appear in `unwiredSlots`, the lock would fail (a key that
    // validates and then does nothing), and were it to appear in `overriddenSlots`, it
    // would be claiming to reach a renderer it does not reach.
    const r = resolvePresentation({ ...EMPTY_PRESENTATION_CONTENT, tokens: MUTATED_TOKENS })
    expect(r.overriddenSlots.filter((s) => s.startsWith("tokens"))).toEqual([])
    expect(r.unwiredSlots.filter((s) => s.startsWith("tokens"))).toEqual([])
    expect(r.rejectedSlots.filter((s) => s.startsWith("tokens"))).toEqual([])
    // And a malformed tokens block cannot take the document down with it (INV-P3).
    const bad = resolvePresentation({ ...EMPTY_PRESENTATION_CONTENT, tokens: "dark-mode" as never })
    expect(bad.sectionTitles).toEqual(DEFAULT_PRESENTATION.sectionTitles)
    expect(bad.layout).toEqual(DEFAULT_PRESENTATION.layout)
  })
})

describe("L0 token plane — the drift pin against the served sheet", () => {
  it("the plane declares exactly one :root block, with no duplicate names", () => {
    const parsed = parseRootTokens(planeCss)
    expect(parsed.rootBlockCount).toBe(1)
    expect(parsed.duplicateNames).toEqual([])
    expect(parsed.tokens.length).toBeGreaterThan(0)
  })

  it("every SHARED token name holds a byte-identical value", () => {
    const plane = parseRootTokens(planeCss).tokens
    const served = parseRootTokens(servedCss).tokens
    const drift = tokenDrift(plane, served)
    // Anti-vacuity, and it is the load-bearing guard here: a file that mirrored NOTHING
    // would satisfy "no drift" perfectly while pinning nothing at all.
    expect(drift.sharedNames.length).toBeGreaterThan(0)
    expect(drift.drifted).toEqual([])
    // Stronger: the plane mirrors the served palette in FULL, not a convenient subset.
    // Copying nine of eleven tokens and leaving two behind is exactly the split this pin
    // exists to prevent, and a shared-names-only comparison cannot see it.
    expect(drift.sharedNames).toEqual(served.map((t) => t.name).sort())
  })

  it("POSITIVE CONTROL — the pin detects a changed value and a dropped name", () => {
    // Without this, "drifted is empty" could mean the comparison is broken rather than the
    // palette agreeing. Both real failure modes are exercised on synthetic inputs.
    const plane = parseRootTokens(planeCss).tokens
    const served = parseRootTokens(servedCss).tokens
    const tampered = plane.map((t) => (t.name === "--brand" ? { ...t, value: "#000000" } : t))
    expect(tokenDrift(tampered, served).drifted.map((d) => d.name)).toEqual(["--brand"])
    const dropped = plane.filter((t) => t.name !== "--brand")
    expect(tokenDrift(dropped, served).sharedNames).not.toContain("--brand")
    expect(tokenDrift(dropped, served).sharedNames.length).toBe(plane.length - 1)
  })
})

describe("L0 token plane — selector coverage over the REAL emitted surface", () => {
  /** Every install-* class the renderer emits, across all four dispositions. */
  const emitted = (() => {
    const out = new Set<string>()
    for (const p of freshProjections()) {
      for (const cls of emittedInstallClasses(renderSafeInstall(p))) out.add(cls)
    }
    return [...out].sort()
  })()

  it("the emitted class set is non-empty and parsed from real HTML", () => {
    expect(emitted.length).toBeGreaterThan(0)
    for (const cls of emitted) expect(cls.startsWith("install-")).toBe(true)
  })

  it("every emitted install-* class is the SUBJECT of a rule, not merely mentioned", () => {
    // `parseStyledClasses`, not `parseClassSelectors`: a descendant-only mention such as
    // `.install-authority code` styles the `code` element, so counting it as coverage would
    // let the rule that actually styles `.install-authority` be deleted with this
    // assertion still passing. That is the exact hole the mention-based measure had.
    const styled = parseStyledClasses(planeCss)
    expect(emitted.filter((c) => !styled.includes(c))).toEqual([])
    expect(countCssRules(planeCss)).toBeGreaterThan(emitted.length) // :root + per-class + states
  })

  it("POSITIVE CONTROL — coverage distinguishes a real rule from a descendant mention", () => {
    const css = ".install-authority code { color: red }"
    expect(parseClassSelectors(css)).toContain("install-authority") // mentioned…
    expect(parseStyledClasses(css)).not.toContain("install-authority") // …but not styled
    expect(parseStyledClasses(".install-cta:hover { color: red }")).toContain("install-cta")
    expect(parseStyledClasses(".a, .b > .c { color: red }")).toEqual(["a", "c"])
  })

  it("the plane declares no install-* class the renderer never emits", () => {
    // The other direction: a rule for a class nobody emits is dead configuration, and it
    // would make the coverage number above read better than the reality it describes.
    const declared = parseClassSelectors(planeCss).filter((c) => c.startsWith("install-"))
    expect(declared.filter((c) => !emitted.includes(c))).toEqual([])
  })

  it("a publisher-less page emits fewer classes, and all of them are still covered", () => {
    // The empty-publisher branch the 19 committed pages cannot cover (every one has a
    // description), so coverage is measured on both shapes rather than the common one.
    const selectors = parseStyledClasses(planeCss)
    for (const f of CANONICAL_FIXTURES) {
      const bare = safeInstallProjection(canonicalProjectionInput(f, null))
      const classes = emittedInstallClasses(renderSafeInstall(bare))
      expect(classes).not.toContain("install-publisher")
      expect(classes.filter((c) => !selectors.includes(c))).toEqual([])
    }
  })
})

describe("L0 token plane — hygiene (styling is permitted; hiding and fetching are not)", () => {
  it("contains no forbidden construct", () => {
    expect(forbiddenCssConstructs(planeCss)).toEqual([])
    // Named individually so a failure says WHICH construct and why, not just "not empty".
    for (const { pattern } of FORBIDDEN_CSS_CONSTRUCTS) {
      expect(planeCss.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain(pattern)
    }
  })

  it("POSITIVE CONTROL — the construct scan detects each forbidden pattern", () => {
    for (const { pattern } of FORBIDDEN_CSS_CONSTRUCTS) {
      expect(forbiddenCssConstructs(`.install-cta { x: ${pattern} }`)).toContain(pattern)
    }
    // And a construct inside a COMMENT is not a finding — otherwise this file's own header,
    // which names every forbidden pattern in prose, could never pass its own gate.
    expect(forbiddenCssConstructs("/* never use @import or url( here */\n.a{color:red}")).toEqual([])
  })

  it("cannot HIDE a decision group", () => {
    // The one real power a stylesheet has over a safety surface. An install page whose
    // disposition is display:none still passes every digest check and tells the user nothing.
    expect(suppressionViolations(planeCss)).toEqual([])
  })

  it("POSITIVE CONTROL — the suppression scan fires inside an install rule, and only there", () => {
    expect(suppressionViolations(".install-disposition { display: none }").length).toBe(1)
    expect(suppressionViolations(".install-cta{visibility:hidden}").length).toBe(1)
    // Scoped: the marketing surface is not this batch's business, so a display rule
    // elsewhere is not a finding. Without this half, the scan could be over-broad and the
    // "no violations" result above would be luck rather than a boundary.
    expect(suppressionViolations(".hero { display: none }")).toEqual([])
  })

  it("every colour and radius resolves through a mirrored token", () => {
    // The mechanism behind the drift pin: if a rule hardcoded #c41e3a instead of
    // var(--brand), a marketing palette change would leave it stale and the pin could not
    // see it, because the pin compares :root values only.
    const body = planeCss.replace(/\/\*[\s\S]*?\*\//g, "")
    const rules = body.slice(body.indexOf("}", body.indexOf(":root")) + 1)
    expect(rules.length).toBeGreaterThan(0)
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/) // no hex outside :root
    expect(rules).not.toMatch(/\brgba?\(/) // no colour literals outside :root
    const names = new Set(parseRootTokens(planeCss).tokens.map((t) => t.name))
    for (const m of rules.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      expect(names, `var(${m[1]}) is not a mirrored token`).toContain(m[1] as string)
    }
  })

  it("declares no @media, @supports, or attribute selector on a decision hook", () => {
    // `data-observed` and `data-primary-action` are what agents read. A stylesheet must not
    // be able to select on them: styling keyed to a verdict is how a theme starts asserting
    // one, and it would also let a rule target exactly the row it wants to suppress.
    const body = planeCss.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(body).not.toMatch(/\[data-observed/)
    expect(body).not.toMatch(/\[data-primary-action/)
  })
})
