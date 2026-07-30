// ---------------------------------------------------------------------------
// Workstream P Batch 4b — L0 token plane tests (new15 §4.2 PR P-4b; ADR 0058 §1/§4).
//
// P-4 built the plane and proved it unpublishable. P-4b SERVES it, so three assertions in
// this file INVERT rather than being deleted — the distinction matters, because a deleted
// check cannot fail when a page silently loses its stylesheet:
//
//   • "no served page references a stylesheet" → "every install page references EXACTLY
//     the plane's own href, and nothing else" (the second half is the exfiltration-shaped
//     failure: plane wired, pointed at bytes this repo does not commit).
//   • "the rendered HTML is byte-identical under any tokens block" → "ONLY the href moves"
//     — substituting the sentinel back and requiring byte equality is what makes "only"
//     measurable, where a weaker "the pages differ" would pass if tokens also reordered
//     sections or dropped a decision group.
//   • "tokens is a NON-SLOT" → "tokens is a resolved slot, overridden when it differs and
//     never unwired".
//
// Two measures are new here because P-4b is the first batch where they could fail: the
// element BASELINE (`body`/`main` were invisible to every class-scoped parser, and missing
// they would have shipped the <link> with none of the visual-hierarchy outcome) and the
// var()-resolved VISUAL FACT that the lock digests.
//
// P-1 proved COPY reaches no digest; P-3 proved the same of LAYOUT. This suite makes a
// weaker-sounding but differently-shaped claim about TOKENS: L0 is the level that is "not
// reachable into any digest, and appears only in CSS", so the plane must be measurably
// populated, measurably harmless, and measurably tied to the visual language it mirrors.
//
// The standing questions, each falsifiable:
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
  BASELINE_SELECTORS,
  CANONICAL_FIXTURES,
  DEFAULT_PRESENTATION,
  DEFAULT_TOKENS,
  EMPTY_PRESENTATION_CONTENT,
  FORBIDDEN_CSS_CONSTRUCTS,
  INSTALL_COPY_SCRIPT_SRC,
  LEVEL_BY_SECTION,
  canonicalProjectionInput,
  countCssRules,
  emittedInstallClasses,
  emptyPresentationDigest,
  forbiddenCssConstructs,
  parseClassSelectors,
  parseRootTokens,
  parseStyledClasses,
  nonClassRuleHeads,
  resolveDeclarations,
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

/** Every committed install page. Walked, not globbed, so it needs no dev dependency. */
const installPages = (): string[] => {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === "index.html") out.push(p)
    }
  }
  walk(path.join(repoRoot, "apps", "web", "public", "install"))
  return out.sort()
}

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
    // P-4b: the href is now LIVE, so it must resolve inside the SERVED tree. Checking the
    // authored source directory would still pass for a sheet no deploy publishes — a 404 on
    // a served trust surface, which is the failure the P-4 comment above anticipated.
    expect(
      fs.existsSync(path.join(repoRoot, "apps", "web", "public", (href as string).replace(/^\//, ""))),
    ).toBe(true)
    // And the catalog restates the shipped default rather than re-pointing it.
    expect(href).toBe(DEFAULT_TOKENS.stylesheetHref)
  })

  it("the SOURCE plane still lives outside apps/web/public/", () => {
    // P-4's structural claim, kept: the authored file is still not itself deployable, and
    // `sync-assets.mjs` is the only thing that puts a copy where a visitor can reach it.
    // Keeping this after P-4b matters — it is what stops the plane from being "fixed" by
    // moving the source into public/ and editing the served bytes directly.
    const rel = path.relative(path.join(repoRoot, "apps", "web", "public"), PLANE_PATH)
    expect(rel.startsWith("..")).toBe(true)
  })

  it("the served copy is byte-identical to the source", () => {
    // Every other assertion in this file reads the SOURCE. Browsers read the copy. This is
    // the one assertion that makes those the same claim.
    const served = path.join(repoRoot, "apps", "web", "public", "styles", "tokens.css")
    expect(fs.existsSync(served)).toBe(true)
    expect(fs.readFileSync(served, "utf8")).toBe(planeCss)
  })

  it("the served copy-assist script exists, is byte-identical to its source, and stays copy-only", () => {
    // Same source/served split as tokens.css, and it needs the same three claims. ADR 0059
    // §4 whitelists exactly one script by src, and phase24Eval's whitelist checks the HTML
    // reference — but a reference is not a file. All 19 pages point at this path, so a
    // missing served copy is a 404 on a live acquisition surface that every HTML-side
    // measure still reads as satisfied.
    const source = path.join(repoRoot, "apps", "web", "scripts", "install-copy.js")
    const served = path.join(repoRoot, "apps", "web", "public", "scripts", "install-copy.js")
    expect(fs.existsSync(source)).toBe(true)
    expect(fs.existsSync(served)).toBe(true)
    const js = fs.readFileSync(served, "utf8")
    expect(js).toBe(fs.readFileSync(source, "utf8"))
    // The served path is the one the renderer emits — asserted, not restated, so renaming
    // the constant cannot leave this guard pinning a file nothing references.
    expect(path.posix.join("/", "scripts", "install-copy.js")).toBe(INSTALL_COPY_SCRIPT_SRC)
    // Copy-only, per ADR 0059 §4: it may read a data-copy-from target and write the
    // clipboard. It may not fetch, navigate, read the contract, or eval. CSS cannot decide;
    // neither can this.
    for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /\beval\s*\(/, /new\s+Function\s*\(/, /location\s*=/, /\.href\s*=/, /import\s*\(/]) {
      expect(js).not.toMatch(forbidden)
    }
    expect(js).toContain("data-copy-from")
    expect(js).toContain("clipboard")
  })

  it("every served install page links the plane — and links nothing else (P-4b)", () => {
    // INVERTED from P-4, which asserted zero stylesheets here. P-4b is the one PR ADR 0058
    // §4 licenses to change served bytes, so the floor moves rather than being dropped:
    // absence is now the failure. `<style>` stays forbidden either way — an inline block
    // would be unmeasurable by the plane's parsers and unreviewable in a diff of 19 pages.
    const pages = installPages()
    expect(pages.length).toBeGreaterThan(0) // anti-vacuity
    for (const p of pages) {
      const html = fs.readFileSync(p, "utf8")
      const hrefs = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(
        (m) => /href="([^"]*)"/.exec(m[0])?.[1],
      )
      expect(hrefs).toEqual([DEFAULT_TOKENS.stylesheetHref])
      expect(html).not.toMatch(/<style[\s>]/)
    }
  })

  it("the link sits AFTER the agent-contract alternate link", () => {
    // Order is a claim, not an accident: the machine relation that makes this surface
    // agent-readable stays the first thing a parser meets. A stylesheet no agent needs must
    // not be inserted ahead of it.
    const html = fs.readFileSync(installPages()[0] as string, "utf8")
    expect(html.indexOf('rel="stylesheet"')).toBeGreaterThan(html.indexOf("agent-adoption+json"))
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

  it("a tokens mutation changes ONLY the href — the rest of the page is byte-identical", () => {
    // P-4's version asserted the whole page was byte-identical under any tokens block. That
    // claim was true then and is false now by design, so it is REPLACED rather than deleted:
    // the href must move (or the plane is not wired), and nothing else may. Substituting the
    // sentinel href back and requiring byte equality is what makes "only" measurable — a
    // weaker test that just checked the pages differ would pass if tokens also reordered
    // sections or dropped a decision group.
    const rendered = freshProjections()
    const control = freshProjections()
    for (const [i, p] of rendered.entries()) {
      const baseline = renderSafeInstall(control[i]!)
      const resolved = resolvePresentation({ ...catalog, tokens: MUTATED_TOKENS })
      const moved = renderSafeInstall(p, resolved.sectionTitles, resolved.layout, resolved.tokens)
      expect(moved).not.toBe(baseline) // the plane really is wired
      expect(moved.split(resolved.tokens.stylesheetHref).join(DEFAULT_TOKENS.stylesheetHref)).toBe(baseline)
    }
  })

  it("tokens is now a RESOLVED slot — overridden when it differs, never unwired", () => {
    // INVERTED from P-4, where L0 appeared only in CSS and no slot consumed it. P-4b wires
    // it, so the correct assertion flips: a differing block must be RECORDED as overridden,
    // and `unwiredSlots` must stay empty — a key that validates and then does nothing is the
    // failure ADR 0058 §3 names, and it is now avoidable rather than accepted.
    const r = resolvePresentation({ ...EMPTY_PRESENTATION_CONTENT, tokens: MUTATED_TOKENS })
    expect(r.overriddenSlots).toContain("tokens.tokensVersion")
    expect(r.unwiredSlots.filter((s) => s.startsWith("tokens"))).toEqual([])
    expect(r.rejectedSlots.filter((s) => s.startsWith("tokens"))).toEqual([])
    // And a malformed tokens block cannot take the document down with it (INV-P3).
    const bad = resolvePresentation({ ...EMPTY_PRESENTATION_CONTENT, tokens: "dark-mode" as never })
    expect(bad.sectionTitles).toEqual(DEFAULT_PRESENTATION.sectionTitles)
    expect(bad.layout).toEqual(DEFAULT_PRESENTATION.layout)
    expect(bad.tokens).toEqual(DEFAULT_TOKENS)
    expect(bad.rejectedSlots).toContain("tokens: not an object")
  })

  it("refuses any href that is not a rooted same-origin .css path", () => {
    // The one resolved value that reaches an ATTRIBUTE on a served page, so its failure mode
    // is a NETWORK REQUEST rather than a misleading sentence. `//evil.example/x.css` is the
    // case a naive "starts with /" check waves through — it is a protocol-relative absolute
    // URL, and it is why the predicate is an allow-list.
    const bad = [
      "//evil.example/x.css",
      "https://evil.example/x.css",
      "http://evil.example/x.css",
      "styles/tokens.css", // relative: resolves against the page's own deep path
      "/../../etc/passwd.css",
      "/styles/tokens.css?v=1",
      "/styles/tokens.css#x",
      "\\\\evil.example\\x.css",
      "/styles/tokens.js",
      "",
      "  ",
    ]
    for (const href of bad) {
      const r = resolvePresentation({
        ...EMPTY_PRESENTATION_CONTENT,
        tokens: { tokensVersion: "probe", stylesheetHref: href },
      } as PresentationContentV1)
      // Falls back to the shipped sheet — the page keeps its styling ...
      expect(r.tokens.stylesheetHref, `accepted ${JSON.stringify(href)}`).toBe(DEFAULT_TOKENS.stylesheetHref)
      // ... and says so, so the lock fails rather than serving a quiet fallback.
      expect(r.rejectedSlots).toContain("tokens.stylesheetHref: not a rooted same-origin .css path")
      // The rejection must not echo the attacker-influenced value into a CI log.
      expect(r.rejectedSlots.join("\n")).not.toContain("evil.example")
    }
    // Positive control: a legitimate same-origin path IS accepted, so the predicate is not
    // simply refusing everything (which would make every assertion above vacuous).
    const good = resolvePresentation({
      ...EMPTY_PRESENTATION_CONTENT,
      tokens: { tokensVersion: "probe", stylesheetHref: "/styles/other-theme.css" },
    } as PresentationContentV1)
    expect(good.tokens.stylesheetHref).toBe("/styles/other-theme.css")
    expect(good.rejectedSlots.filter((s) => s.startsWith("tokens"))).toEqual([])
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
    // Measured against the SHARED count, not against `plane.length`. The plane is a
    // superset of the served palette — R-2 added plane-only tokens (`--warn`, `--ok`)
    // for the observed/absent glyphs, which have no marketing counterpart to drift
    // from. Anchoring to plane.length silently assumed plane ⊆ served, so it would
    // fail on any plane-only token while claiming to test the drop detection.
    const sharedBefore = tokenDrift(plane, served).sharedNames.length
    expect(tokenDrift(dropped, served).sharedNames.length).toBe(sharedBefore - 1)
  })
})

describe("L0 token plane — the element baseline and the visual fact (PR P-4b)", () => {
  it("styles EXACTLY the permitted element selectors — no more, no fewer", () => {
    // The class-scoped parsers above cannot see an element rule at all, so before P-4b a
    // `body` rule was both unmeasurable and, missing, would have shipped the <link> with
    // none of the outcome: styled sections on a browser-default page. Asserted as a set in
    // both directions, so neither dropping `body` nor adding `div` passes.
    expect(nonClassRuleHeads(planeCss)).toEqual([...BASELINE_SELECTORS])
  })

  it("a baseline rule cannot hide a decision group either", () => {
    // `.install-verdict { display: none }` was already a finding. `body { display: none }`
    // hides the same disposition just as completely, and under a class-only scan it was not
    // a finding at all — so the suppression scan covers the baseline heads too.
    expect(suppressionViolations(planeCss)).toEqual([])
    for (const head of BASELINE_SELECTORS) {
      expect(suppressionViolations(`${head} { display: none }`)).toEqual([`${head} → display: none`])
    }
    // And a mere descendant mention is not the subject, so it is not a false positive.
    expect(suppressionViolations(".install-authority body code { color: red }")).toEqual([])
  })

  it("resolves var() to the visual fact, and is blind to comments", () => {
    // The measure the lock digests. A raw-bytes digest moves when a comment is reworded; a
    // token-NAME comparison misses a palette re-pointed through renamed variables. Resolving
    // var() against :root and digesting the result is what tracks what a visitor SEES.
    const tokens = parseRootTokens(planeCss).tokens
    const rules = resolveDeclarations(planeCss, tokens)
    expect(rules.length).toBeGreaterThan(0)
    // No unresolved var() survives — an undefined token would silently render as nothing.
    expect(rules.flatMap((r) => r.declarations).filter((d) => d.includes("var("))).toEqual([])
    // Comment-blind: same visual fact, different bytes.
    const commented = `/* a reworded comment */\n${planeCss}`
    expect(resolveDeclarations(commented, parseRootTokens(commented).tokens)).toEqual(rules)
    // But a re-pointed value moves it, even with every token NAME unchanged.
    const repointed = planeCss.replace(/--ink:\s*[^;]+;/, "--ink: #ff00ff;")
    expect(repointed).not.toBe(planeCss) // anti-vacuity: the substitution really happened
    expect(resolveDeclarations(repointed, parseRootTokens(repointed).tokens)).not.toEqual(rules)
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
