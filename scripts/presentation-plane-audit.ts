#!/usr/bin/env tsx
/**
 * Workstream P Batch 0 — presentation-plane reality audit (new15 §6.2 PR P-0;
 * ADR 0058 §1/§5).
 *
 * A THIN observer. It measures three things and computes no policy:
 *   1. PLANE STAGES — is each targeted directory at the stage its PR expects, and do the
 *      served pages carry the stylesheet their stage requires? P-0 asserted both planes
 *      greenfield; P-2 creates the content plane, so the expectation is per-plane and
 *      bidirectional (see `TARGET_DIRS`). PR P-4b INVERTS the install half: through P-4
 *      no install page could carry CSS, and now every one must carry exactly the plane's
 *      own href. Inverting is stronger than relaxing — a missing stylesheet now fails.
 *   2. INVENTORY — every hardcoded copy site on the Safe-install surface, counted
 *      from source, so each lift has a denominator instead of a vibe.
 *   3. REACHABILITY — the mutation probe from `presentationAudit.ts`: which copy
 *      values can reach `contractDigest`. This is what makes an ADR 0058 level a
 *      MEASUREMENT rather than an opinion, and it is the gate that keeps
 *      PR P-2..P-7 from quietly moving an L3 string into a config file.
 *
 * Modes (same contract as `pnpm eval:phase-2.4`):
 *   (default) --check : the committed artifact must be byte-identical to a fresh run.
 *   --write           : (re)generate it.
 *   --gate            : ENFORCEMENT. Exit 2 unless every probe passes.
 *
 * Exit codes: 0 ok · 1 drift (--check) · 2 gate failed (--gate) / unexpected error.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import {
  ABSENCE_CONSEQUENCE,
  AGENT_GUIDANCE,
  CANONICAL_FIXTURES,
  DEFAULT_TOKENS,
  OBSERVED_CONSEQUENCE,
  PRIMARY_CTA,
  SECTION_TITLES,
  canonicalProjectionInput,
  overrideKey,
  runPresentationAudit,
} from "../packages/trust-index/src/index.js"

/**
 * The `displayName` value the P-5 row probes — synthetic, and deliberately NOT read from
 * the committed catalog.
 *
 * Reading it from the catalog would be the obvious move and it would be wrong, for a reason
 * worth writing down because it is the same trap twice. The catalog's one override entry
 * RESTATES the shipped derived display name verbatim — that is what keeps P-5 at zero served
 * bytes. But the derived name is `packageName ?? canonicalName`, both of which are sealed, so
 * it is present in 19 of 19 committed contracts. A probe carrying it would find it in the
 * sealed bytes, set `contractDigestMoved` by containment, measure "decision", and fail the
 * row — reporting a boundary violation that does not exist.
 *
 * So the row probes a string a document COULD configure and no contract contains. The
 * catalog's actual value is measured elsewhere and better: the lock asserts the override's
 * effective display name equals the shipped derived value, which is the byte-identity claim
 * this row cannot make.
 */
const PROBED_OVERRIDE_DISPLAY_NAME = "Configured Display Name (P-5 probe)"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outPath = path.join(repoRoot, "artifacts", "phase-2.4", "presentation-plane-audit.json")

/** Repo-relative source files that own Safe-install copy today (new15 §4.2 P2). */
const COPY_SOURCES = [
  "packages/trust-index/src/renderSafeInstall.ts",
  "packages/trust-index/src/safeInstallProjection.ts",
  "packages/trust-index/src/selectDecisionAuthorities.ts",
  "packages/trust-index/src/agentAdoptionContract.ts",
  "packages/trust-index/src/language.ts",
  "packages/core/src/gateway/continuousProtection.ts",
  // PR P-5 — the relay copy slice. A source that OWNS copy belongs in the inventory in the
  // commit that creates it; adding it later would make the count look like it drifted.
  "packages/trust-index/src/safe-install/agentRelay.ts",
] as const

/**
 * The two directories new15 §18.2 targets, each with the stage it is EXPECTED to be at.
 *
 * P-0 asserted both absent. That assertion was correct then and is false now: P-2 creates
 * the content plane, so a blanket greenfield rule would make the batch that does the work
 * the batch that fails the gate. The fix is not to relax the rule — it is to make it
 * per-plane and bidirectional, which is strictly stronger than what P-0 had:
 *
 *   • `apps/web/content` must now be PRESENT. Deleting it would fail, so the gate now
 *     also protects the plane it used to forbid.
 *   • `apps/web/styles` must now be PRESENT too, as of PR P-4 (same flip, same reason:
 *     P-4 is the batch that creates the token plane, so "absent" would make the batch
 *     doing the work the batch failing the gate).
 *
 * Each entry names the PR that changes its expectation, so the next flip is a one-line
 * edit with its justification already written down rather than a rediscovered argument.
 *
 * Note what the styles flip does NOT relax: `apps/web/styles/` is not served, so the
 * served-bytes floor below is what keeps PR P-4's CSS off the pages. The two measures
 * are independent on purpose — presence of the plane and reference from a page are
 * different facts, and P-4 changes exactly one of them.
 */
const TARGET_DIRS = [
  { dir: "apps/web/content", expect: "present", since: "P-2", why: "the copy catalog lifted by PR P-2" },
  { dir: "apps/web/styles", expect: "present", since: "P-4", why: "the design token plane lifted by PR P-4" },
] as const

/**
 * The served pages that ALREADY carried a stylesheet before Workstream P began — the
 * two Trust-surface pages emitted by `renderLookup.ts` and `renderAppCreated.ts`, both
 * of which reference the marketing `/styles.css` and predate this workstream entirely
 * (`caede1b`, PR #188).
 *
 * They are named here rather than tolerated by a count, because a count cannot tell the
 * difference between "the two pages that were always styled" and "two pages that became
 * styled". PR P-4 widened this measure from an install-only walk to every served
 * trust+install page precisely because the install-only version could not see these two
 * at all: it would have reported 0 while two served pages carried CSS, and a third one
 * appearing would have gone unnoticed.
 *
 * PR P-4b adds the install pages to the styled set. It does NOT add them here: this list
 * stays a statement about what was styled BEFORE the workstream, so it remains the
 * baseline the install expectation is measured against rather than becoming a growing
 * allow-list that absorbs whatever it finds.
 */
const PRE_EXISTING_STYLED_PAGES: readonly string[] = [
  "apps/web/public/trust/app-created.html",
  "apps/web/public/trust/lookup.html",
]

/**
 * The href every served install page must carry (PR P-4b) — the L0 plane's own copy
 * under `public/`, same-origin and committed.
 *
 * Pinned as a literal here, and separately pinned to `DEFAULT_TOKENS.stylesheetHref` by
 * a test, for the reason a shared import would defeat: if this script read the value the
 * renderer emits, then re-pointing the renderer at a third-party sheet would move both
 * sides together and the audit would agree with whatever it was handed. An INDEPENDENT
 * literal is what makes this an assertion about the href rather than a tautology.
 */
const REQUIRED_INSTALL_STYLESHEET = "/styles/tokens.css"

/**
 * Count human-facing sentence literals in a source file. The heuristic is
 * deliberately narrow and stated rather than clever: a double-quoted literal of at
 * least 12 characters that contains a space and a lowercase letter, and that STARTS
 * with a letter. That catches prose ("Requires access to configured secrets.") and
 * skips identifiers, reason codes, paths, and enum members — which is exactly the
 * split PR P-2 must lift.
 *
 * The leading-letter clause earns its place: P-2 added an `escText` helper whose body
 * is a chain of `.replace(/</g, "&lt;")` calls, and the source fragments BETWEEN those
 * arguments (`").replace(/</g, "`) satisfied every other clause. Sorted, they landed
 * ahead of the real prose and pushed it out of the three recorded samples — a committed
 * report that had stopped illustrating what it counts. Prose does not begin with
 * punctuation, so requiring a leading letter is a statement about the target, not a
 * patch aimed at one file.
 *
 * This is an INVENTORY, not a boundary: the boundary is the reachability probe. A
 * count that is slightly off changes a number in a report; it cannot let an L3
 * string escape into configuration.
 */
function countCopyLiterals(source: string): { count: number; samples: string[] } {
  const found = new Set<string>()
  for (const m of source.matchAll(/"((?:[^"\\\n]|\\.){12,})"/g)) {
    const v = m[1]
    if (!/ /.test(v)) continue
    if (!/[a-z]/.test(v)) continue
    if (!/^[A-Za-z]/.test(v)) continue // prose starts with a letter, not punctuation
    if (/^(?:https?:|\.{0,2}\/|[a-z-]+\/)/.test(v)) continue // urls & paths
    found.add(v)
  }
  const all = [...found].sort()
  return { count: all.length, samples: all.slice(0, 3) }
}

/**
 * WHICH served pages reference a stylesheet? (the P-4b precondition, ADR 0058 §4)
 *
 * Widened by PR P-4 from a count over `apps/web/public/install` to the exact SET over
 * every served trust+install page. Two reasons, both measured rather than assumed:
 *
 *   1. The install-only walk had a blind spot it could not report. Two served TRUST
 *      pages already carry `/styles.css`, and the old walk never looked at them — so
 *      "pagesWithStylesheet: 0" was true of the directory it scanned and false of the
 *      served tree. A stylesheet added to a third trust page would not have moved it.
 *   2. A count answers "how many", which is the wrong question. The floor is about
 *      IDENTITY: exactly these two pages, the ones that were already styled before the
 *      workstream started. Recording the paths makes a substitution visible — one page
 *      losing CSS while another gains it leaves any count unchanged.
 *
 * Returns `index.html` files (the install/trust page shape) plus any top-level `*.html`
 * under those roots, so a hand-authored page like `trust/lookup.html` is in scope.
 */
function servedStylesheetRefs(): {
  pagesScanned: number
  pagesWithStylesheet: readonly string[]
  installPagesWithStylesheet: number
  installPagesTotal: number
  installPagesMissingRequiredHref: readonly string[]
  installPagesWithForeignStylesheet: readonly string[]
} {
  const pages: string[] = []
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".html")) pages.push(p)
    }
  }
  for (const root of ["install", "trust"]) walk(path.join(repoRoot, "apps", "web", "public", root))

  const withCss = pages
    .filter((p) => {
      const html = fs.readFileSync(p, "utf8")
      return /rel="stylesheet"/.test(html) || /<style[\s>]/.test(html)
    })
    .map((p) => path.relative(repoRoot, p).split(path.sep).join("/"))
    .sort()

  // PR P-4b — the install expectation INVERTED, so it needs the per-page href, not just
  // "has some stylesheet". Two distinct defects live here and they get separate lists:
  // a page MISSING the required sheet (styling silently absent on a served page), and a
  // page referencing a DIFFERENT sheet (the exfiltration-shaped failure, where the plane
  // is wired but pointed somewhere this repo does not commit).
  const installPages = pages
    .map((p) => ({ rel: path.relative(repoRoot, p).split(path.sep).join("/"), html: fs.readFileSync(p, "utf8") }))
    .filter((p) => p.rel.startsWith("apps/web/public/install/"))
  const hrefsOf = (html: string): string[] =>
    [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(
      (m) => /href="([^"]*)"/.exec(m[0])?.[1] ?? "",
    )

  return {
    pagesScanned: pages.length,
    pagesWithStylesheet: withCss,
    installPagesWithStylesheet: withCss.filter((p) => p.startsWith("apps/web/public/install/")).length,
    installPagesTotal: installPages.length,
    installPagesMissingRequiredHref: installPages
      .filter((p) => !hrefsOf(p.html).includes(REQUIRED_INSTALL_STYLESHEET))
      .map((p) => p.rel)
      .sort(),
    installPagesWithForeignStylesheet: installPages
      .filter((p) => hrefsOf(p.html).some((h) => h !== REQUIRED_INSTALL_STYLESHEET))
      .map((p) => p.rel)
      .sort(),
  }
}

/**
 * PR P-5 — the measured keyability of `overrides.resources`, recorded because it is a real
 * schema defect this batch WORKS AROUND rather than fixes.
 *
 * The schema constrains `propertyNames` to `^[a-z0-9][a-z0-9._-]*$`, which admits no `/`.
 * Every canonical slug contains one. So the key space the schema declares does not contain
 * a single real resource, and the section could never have been used as written.
 *
 * The trap — and the reason this is measured rather than described — is that the defect is
 * not merely restrictive, it is WRONG IN A WAY THAT LOOKS RIGHT. The LEAF segment of every
 * slug does match the pattern, so a reader reaching for "the obvious key" writes the leaf,
 * the document validates, and the override silently addresses nothing. The shipped fixture's
 * slash-free `io.github.example-mcp` is exactly why this never surfaced in testing.
 *
 * P-5's answer is an ENCODING, not a schema change: `overrideKey` maps `/` → `__`. This
 * function measures that the encoding is legal, injective and unambiguous over the real
 * corpus rather than trusting the argument. Fixing `propertyNames` needs an ADR, and ADR
 * 0060 is deliberately left free for it.
 */
function overrideKeyability(): {
  readonly slugs: number
  readonly rawSlugsMatchingPattern: number
  readonly leafSegmentsMatchingPattern: number
  readonly encodedKeysMatchingPattern: number
  readonly encodedKeysUnique: number
  readonly rawSlugsContainingSeparator: number
  readonly pattern: string
  readonly separator: string
  readonly $comment: string
} {
  const PATTERN = /^[a-z0-9][a-z0-9._-]*$/
  const manifestPath = path.join(repoRoot, "apps", "web", "public", ".well-known", "calllint.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    resources?: readonly { canonicalSlug: string }[]
  }
  const slugs = (manifest.resources ?? []).map((r) => r.canonicalSlug)
  const encoded = slugs.map(overrideKey)
  return {
    slugs: slugs.length,
    rawSlugsMatchingPattern: slugs.filter((s) => PATTERN.test(s)).length,
    leafSegmentsMatchingPattern: slugs.filter((s) => PATTERN.test(s.split("/").at(-1) ?? "")).length,
    encodedKeysMatchingPattern: encoded.filter((k) => PATTERN.test(k)).length,
    encodedKeysUnique: new Set(encoded).size,
    rawSlugsContainingSeparator: slugs.filter((s) => s.includes("__")).length,
    pattern: "^[a-z0-9][a-z0-9._-]*$",
    separator: "__",
    $comment:
      "MEASURED over the served discovery manifest. rawSlugsMatchingPattern must be 0 and leafSegmentsMatchingPattern must equal slugs: together those two numbers ARE the trap — the schema pattern admits the leaf segment of every slug while admitting no whole slug, so a naive key validates and addresses nothing. encodedKeysMatchingPattern and encodedKeysUnique must both equal slugs (legal + injective), and rawSlugsContainingSeparator must be 0 (unambiguous, so decodeOverrideKey round-trips). The propertyNames defect itself is RECORDED, NOT FIXED by PR P-5 — that is a schema change requiring an ADR, and ADR 0060 is reserved for it.",
  }
}

/** Build the artifact. No clock, no RNG — byte-stable across runs. */
function build(): { json: string; pass: boolean; failures: readonly string[] } {
  const inputs = CANONICAL_FIXTURES.map((f) => canonicalProjectionInput(f))
  const audit = runPresentationAudit(inputs, {
    observedConsequence: Object.values(OBSERVED_CONSEQUENCE),
    absenceConsequence: Object.values(ABSENCE_CONSEQUENCE),
    primaryCta: Object.values(PRIMARY_CTA),
    sectionTitles: Object.values(SECTION_TITLES),
    // The href the renderer really emits, so containment is checked against the shipped
    // value rather than a restatement of it.
    stylesheetHref: [DEFAULT_TOKENS.stylesheetHref],
    // PR P-5 — OVERRIDE-supplied, never the shipped derived `displayName`. The default is
    // `packageName ?? canonicalName`, both sealed, so it is present in 19 of 19 committed
    // contracts and a row probed with it would measure "decision" and fail its own
    // declaration (see the RESOURCE_DISPLAY_NAME row). This value is what a document would
    // configure, which is a string no sealed contract contains.
    resourceDisplayName: [PROBED_OVERRIDE_DISPLAY_NAME],
    verdictLabel: Object.values(VERDICT_PUBLIC_LABEL),
    guidanceSteps: [...AGENT_GUIDANCE.steps],
  })

  const planeStages = TARGET_DIRS.map((d) => {
    const exists = fs.existsSync(path.join(repoRoot, d.dir))
    return {
      dir: d.dir,
      exists,
      expected: d.expect,
      expectedSince: d.since,
      why: d.why,
      ok: exists === (d.expect === "present"),
    }
  })
  const inventory = COPY_SOURCES.map((rel) => {
    const abs = path.join(repoRoot, rel)
    const c = countCopyLiterals(fs.readFileSync(abs, "utf8"))
    return { source: rel, copyLiterals: c.count, samples: c.samples }
  })
  const css = servedStylesheetRefs()
  const keyability = overrideKeyability()

  const failures = [
    ...audit.failures,
    ...planeStages
      .filter((p) => !p.ok)
      .map((p) =>
        p.expected === "present"
          ? `${p.dir} is missing — expected present since ${p.expectedSince} (${p.why})`
          : `${p.dir} exists — expected absent until ${p.expectedSince} (${p.why})`,
      ),
    // The served-bytes floor (ADR 0058 §4). PR P-4b is the ONE Workstream P PR licensed
    // to change served bytes, and this is that change — so the install expectation
    // INVERTS here rather than being deleted. Before: zero install pages may carry CSS.
    // Now: every install page must carry EXACTLY the plane's own href.
    //
    // Inverting is strictly stronger than relaxing. A deleted check would let a page
    // silently lose its stylesheet again; this one fails on absence, and separately on a
    // FOREIGN href — the difference between "styling missing" and "styling sourced from
    // somewhere this repo does not commit", which is the failure that would end the
    // offline-verifiable-provenance claim.
    ...(css.installPagesTotal === 0
      ? ["no served install pages found — the P-4b stylesheet expectation would hold vacuously"]
      : []),
    ...css.installPagesMissingRequiredHref.map(
      (p) =>
        `${p} does not reference ${REQUIRED_INSTALL_STYLESHEET} — PR P-4b links the L0 plane from every install page, and a page without it renders unstyled (ADR 0058 §4)`,
    ),
    ...css.installPagesWithForeignStylesheet.map(
      (p) =>
        `${p} references a stylesheet other than ${REQUIRED_INSTALL_STYLESHEET} — a served trust surface may only load bytes this repo commits`,
    ),
    // The TRUST half evolved at PR P-7 (Registry Distribution Closure P0/P1): Trust Pages
    // now reference /styles.css (the marketing stylesheet), distinct from Install Pages'
    // /styles/tokens.css. The two pre-existing styled pages remain grandfathered.
    ...css.pagesWithStylesheet
      .filter((p) => {
        if (p.startsWith("apps/web/public/install/")) return false // install pages checked separately
        if (PRE_EXISTING_STYLED_PAGES.includes(p)) return false // grandfathered
        if (p.startsWith("apps/web/public/trust/")) {
          // Trust pages may reference /styles.css only
          const html = fs.readFileSync(path.join(repoRoot, p), "utf8")
          const hrefs = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(
            (m) => /href="([^"]*)"/.exec(m[0])?.[1] ?? "",
          )
          return hrefs.some((h) => h !== "/styles.css")
        }
        // Any other non-install page with stylesheet is a violation
        return true
      })
      .map((p) => {
        if (p.startsWith("apps/web/public/trust/")) {
          return `${p} references a stylesheet other than /styles.css — Trust Pages may only reference the marketing stylesheet (ADR 0058 §4, extended by PR P-7)`
        }
        return `${p} references a stylesheet but is not one of the ${PRE_EXISTING_STYLED_PAGES.length} pages already styled before Workstream P — PR P-4b changes the INSTALL surface only (ADR 0058 §4)`
      }),
    ...PRE_EXISTING_STYLED_PAGES.filter((p) => !css.pagesWithStylesheet.includes(p)).map(
      (p) => `${p} no longer references a stylesheet — served bytes moved outside PR P-4b's scope (ADR 0058 §4)`,
    ),
    // PR P-5 — the override key space must stay legal, injective and unambiguous. These are
    // failures, not just recorded numbers: the encoding is what makes `overrides.resources`
    // reachable at all without a schema change, so if a future slug broke any of the three
    // the section would go back to being unkeyable and the audit should say so by name.
    ...(keyability.encodedKeysMatchingPattern === keyability.slugs
      ? []
      : [
          `overrideKey produced ${keyability.slugs - keyability.encodedKeysMatchingPattern} key(s) that the schema's propertyNames pattern rejects — overrides.resources would be unkeyable for those resources (ADR 0060)`,
        ]),
    ...(keyability.encodedKeysUnique === keyability.slugs
      ? []
      : [
          `overrideKey is not injective over the served corpus (${keyability.encodedKeysUnique} unique keys for ${keyability.slugs} slugs) — one override would address two resources`,
        ]),
    ...(keyability.rawSlugsContainingSeparator === 0
      ? []
      : [
          `${keyability.rawSlugsContainingSeparator} canonical slug(s) already contain the "${keyability.separator}" separator — decodeOverrideKey can no longer round-trip, so the encoding is ambiguous`,
        ]),
  ]

  const report = {
    schema: "calllint.presentation-plane-audit.v0",
    $comment:
      "Workstream P presentation-plane reality audit (ADR 0058 §1/§5), re-baselined by PR P-5 (adds the RESOURCE_DISPLAY_NAME row + overrideKeyability; P-4b was the ONE Workstream P PR licensed to change served bytes, and that license is SPENT — P-5 changes zero served bytes). inventoryTotal ROSE at P-5 and that is correct, not a regression: PR P-5 lifted three guard strings out of renderContinuousProtectionOffer into named DEFAULT_GUARD_OFFER_COPY constants, and countCopyLiterals' leading-letter clause could not see them while they were indented inside the template (\"  CallLint can:\"). Naming them unindented makes them COUNTABLE for the first time. It ROSE AGAIN at P-6, 105 → 107, and the cause is measured rather than assumed: both new literals are in the agentRelay.ts row (6 → 8), which was already a COPY_SOURCES row, and they are \"no blocking reason codes\" (a real relay fragment composeRelayNotes emits when a SAFE contract carries no reason code) plus \"cannot describe a write the plan does not contain\" (the approvalPreview discipline quoted in its docblock). Copy was genuinely ADDED, so the inventory should say so. The predicate was not bent to make either number fall — this is an INVENTORY, not a boundary, and the boundary is reachability[] below. reachability[] is MEASURED by mutation/containment probe over the shipped projection, not declared: a row whose declaredPlane disagrees with its measuredPlane fails. The VERDICT_PUBLIC_LABEL and AGENT_GUIDANCE.steps rows are negative controls — they MUST measure as decision-plane, otherwise the probe cannot detect reachability and every other row is meaningless. STYLESHEET_HREF is P-4b's new row and the only presentation site that reaches an ATTRIBUTE rather than a text node. PR P-6 closes the one config-integrity gap a compiler could close and records the one it cannot. CLOSED: MUST_ASK_SENTENCE is now Readonly<Record<MustAskToken, string>> over an exported MUST_ASK_TOKENS domain that AGENT_GUIDANCE.mustAskBefore itself references, so a seventh protocol token without a sentence is a TYPECHECK error rather than a page rendering a raw identifier — previously the two agreed and nothing enforced it. The `?? t` runtime fallback deliberately STAYS: it is the honest floor for a contract read from bytes, since showing an unpolished string is honest while silently omitting one would understate what the agent is bound by. RECORDED, not closed: host copy lives in THREE vocabularies (GUARD_HOST_IDS 7 / RULE_HOSTS 9 / HOST_ADAPTERS 5) and the install plane names none of them; `pnpm audit:preview` records the measured intersections and requires every guard host to carry a non-empty label, artifactPath and uninstall command. The install plane's silence about hosts is BY DESIGN — naming a host on the page would add served bytes, which ADR 0058 §4 no longer licenses. planeStages replaces P-0's blanket greenfield assertion: creating each plane is a specific PR's WORK, so the expectation is per-plane and bidirectional. servedStylesheets INVERTED at P-4b: P-4's rule was that zero install pages carry CSS; the rule is now that EVERY install page carries exactly /styles/tokens.css, and separately that none carries a foreign href. Inverting is stronger than deleting — absence now fails, so a page cannot silently lose its stylesheet. Regenerate with `pnpm audit:presentation:write`; enforce with `pnpm audit:presentation:gate`.",
    workstream: "P",
    pr: "P-7",
    status: failures.length === 0 ? "PASSED" : "FAILED",
    planeStages,
    servedStylesheets: {
      ...css,
      preExistingStyledPages: PRE_EXISTING_STYLED_PAGES,
      requiredInstallStylesheet: REQUIRED_INSTALL_STYLESHEET,
      $comment:
        "PR P-4b INVERTED the install half of this measure. Through P-4 the rule was `installPagesWithStylesheet === 0`: the L0 plane existed at apps/web/styles/tokens.css, outside the deployed directory, so it was unpublishable by construction. P-4b is the single PR ADR 0058 §4 licenses to change served bytes, so now every install page must reference requiredInstallStylesheet and installPagesMissingRequiredHref must be empty — absence is a failure, which a deleted check could not express. installPagesWithForeignStylesheet must also be empty: that is the exfiltration-shaped defect (plane wired, pointed at bytes this repo does not commit), and it is a different failure from styling being absent. The two listed Trust pages predate this workstream (caede1b, #188) and reference the marketing /styles.css. PR P-7 (Registry Distribution Closure P0/P1) extended the constraint: Trust Pages may now reference /styles.css (the marketing stylesheet), distinct from Install Pages' /styles/tokens.css. The two pre-existing styled pages remain grandfathered. The trust half is no longer bidirectional: Trust Pages referencing /styles.css is now the expected state, not a deviation.",
    },
    inventory,
    inventoryTotal: inventory.reduce((n, i) => n + i.copyLiterals, 0),
    overrideKeyability: keyability,
    reachability: {
      sitesProbed: audit.sitesProbed,
      presentationSites: audit.presentationSites,
      decisionSites: audit.decisionSites,
      pass: audit.pass,
      probes: audit.probes,
    },
    failures,
  }
  return { json: JSON.stringify(report, null, 2) + "\n", pass: failures.length === 0, failures }
}

// --- modes -------------------------------------------------------------------

const argv = process.argv.slice(2)
const { json, pass, failures } = build()
const rel = path.relative(repoRoot, outPath)

if (argv.includes("--write")) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, json, "utf8")
  console.log(`wrote ${rel} — ${pass ? "PASSED" : "FAILED"}`)
  process.exit(0)
}

if (argv.includes("--gate")) {
  if (pass) {
    console.log("presentation-plane audit: PASSED — every copy site measured at its declared plane.")
    process.exit(0)
  }
  console.error("presentation-plane audit: FAILED")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(2)
}

// default --check: committed artifact must match a fresh run.
if (!fs.existsSync(outPath)) {
  console.error(`${rel} is missing — run \`pnpm audit:presentation:write\`.`)
  process.exit(1)
}
if (fs.readFileSync(outPath, "utf8") !== json) {
  console.error(`${rel} drifted from a fresh audit — run \`pnpm audit:presentation:write\` and review the diff.`)
  process.exit(1)
}
console.log(`${rel} matches a fresh audit — ${pass ? "PASSED" : "FAILED"}`)
process.exit(0)
