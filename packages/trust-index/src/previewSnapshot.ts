// ---------------------------------------------------------------------------
// Workstream P PR P-6 — the PREVIEW & SNAPSHOT harness (new15 §14).
//
// §14 declares four acceptance-gate blocks and, until this module, nothing ran any
// of them: Config 完整性 · 页面一致性 · 安全隔离 · 视觉回归. This is the observer half
// of the shipped observer/evaluator split — PURE measurement, no filesystem, no
// clock, no fixtures read from disk. `scripts/preview-snapshot.ts` does every read
// and hands the bytes here, which is what makes each block unit-testable without a
// bake and what stops the harness from becoming a second renderer.
//
// WHAT "SNAPSHOT" MEANS HERE. Not a vitest snapshot — the repo has none, and a
// self-written expectation file would certify itself. It means the house idiom: a
// committed, drift-checked artifact plus a `<name>` / `<name>:write` / `<name>:gate`
// triple. The artifact makes the measurement reviewable; the gate makes it binding.
//
// WHY ONE MODULE FOR FOUR BLOCKS. The four blocks share one corpus (the five
// canonical fixtures) and one honesty rule: every check names what it observed, and
// every exclusion carries its own assertion instead of being smoothed away. Four
// separate scripts would need four workflow bindings, four artifacts, and four
// chances for one to fall out of the `ci:local` chain.
//
// WHAT THIS MODULE DOES NOT MEASURE. Glyph rasterization. 视觉回归 here is
// declaration resolution plus ONE arithmetic reflow prediction, because the shipped
// stylesheet has zero `@media` and `resolveDeclarations` is a flat rule walk with no
// nesting support. That scope is stated rather than implied, and the zero-`@media`
// premise is asserted (`gradeVisualRegression`) rather than assumed — adding a media
// query would both spend a served-byte license this batch does not have and silently
// mis-parse.
// ---------------------------------------------------------------------------

import { VERDICTS, VERDICT_PUBLIC_LABEL, REASON_CODES, REASON_CODE_META } from "@calllint/types"
import {
  ADOPTION_AUTHORITIES,
  OBSERVED_CONSEQUENCE,
  ABSENCE_CONSEQUENCE,
} from "./selectDecisionAuthorities.js"
import { AGENT_GUIDANCE, MUST_ASK_TOKENS } from "./agentAdoptionContract.js"
import { CTA_DOC_HREF, DEEP_LINK_STATES, altRouteHref } from "./renderSafeInstall.js"
import { renderedForms } from "./presentationAudit.js"
import { ABOVE_FOLD_SECTION_IDS, SECTION_GROUPS } from "./safe-install/layoutStructure.js"
import {
  CONFIG_VERSION_PATTERN,
  EMPTY_PRESENTATION_CONTENT,
  type PresentationContentV1,
} from "./safe-install/presentationContent.js"
import { emptyPresentationDigest, presentationDigest } from "./safe-install/presentationDigest.js"
import {
  emittedInstallClasses,
  parseStyledClasses,
  resolveDeclarations,
  type CssToken,
} from "./safe-install/tokenPlane.js"
import { PRIMARY_CTA, type Installability, type SafeInstallProjection } from "./safeInstallProjection.js"
import { htmlAllowsOnlyInstallCopyScript, type HumanCapsuleStructure } from "./phase24Eval.js"

/** One graded observation. `observed` is what was actually seen, so a red gate is diagnosable. */
export interface PreviewCheck {
  readonly id: string
  readonly pass: boolean
  readonly observed: string
}

/** One of §14's four blocks. */
export interface PreviewBlock {
  /** The §14 block name, in the document's own vocabulary. */
  readonly block: string
  readonly checks: readonly PreviewCheck[]
  readonly pass: boolean
}

const ok = (id: string, observed: string): PreviewCheck => ({ id, pass: true, observed })
const bad = (id: string, observed: string): PreviewCheck => ({ id, pass: false, observed })
const check = (id: string, pass: boolean, observed: string): PreviewCheck => ({ id, pass, observed })

/** Deterministic, readable rendering of a small set. */
function list(xs: readonly string[]): string {
  return xs.length === 0 ? "none" : [...xs].sort().join(", ")
}

// ---------------------------------------------------------------------------
// 视觉回归 — viewports and the one reflow that depends on them
// ---------------------------------------------------------------------------

/**
 * The three viewports, chosen so the prediction has a real transition to get wrong.
 *
 * They straddle both shipped boundaries: the CTA row reflows from one column to two
 * at 452 px of available width (see {@link predictCtaColumns}), and `main`'s
 * `max-width: 720px` caps growth above 760 px of viewport. 390 sits below the
 * reflow, 768 just above it, 1280 above the cap — so a harness that always returned
 * the same column count would disagree with at least one of them.
 */
export const PREVIEW_VIEWPORTS: readonly number[] = Object.freeze([390, 768, 1280])

/**
 * The shipped layout constants the reflow arithmetic is derived from, named rather
 * than inlined so a stylesheet edit shows up as a NUMBER that moved in the artifact.
 *
 * All four are read off the committed `tokens.css`:
 *   `body { padding: 32px 20px }`            → 40 px of horizontal padding
 *   `main { max-width: 720px; margin: 0 auto }` → the 720 px cap
 *   `.install-cta-row { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px }`
 */
export const CTA_REFLOW_RULES = Object.freeze({
  bodyHorizontalPadding: 40,
  mainMaxWidth: 720,
  ctaMinTrack: 220,
  ctaGap: 12,
})

/**
 * How many columns `.install-cta-row` resolves to at a given viewport width.
 *
 * `repeat(auto-fit, minmax(220px, 1fr))` fits as many 220 px tracks as the available
 * width allows, with a 12 px gap between them; the available width is the viewport
 * minus `body`'s horizontal padding, capped by `main`'s max-width. With `items`
 * children the answer is bounded by `items` — a grid cannot produce more columns
 * than it has things to put in them, which is why the CTA row on a deep-link page
 * (2 children) never reaches 3 even at 1280 px.
 *
 * This is the WHOLE of the viewport dependency in the shipped plane, because the
 * stylesheet contains no `@media`. That is asserted, not assumed.
 */
export function predictCtaColumns(viewport: number, items: number): number {
  if (items <= 0) return 0
  const available = Math.min(
    CTA_REFLOW_RULES.mainMaxWidth,
    viewport - CTA_REFLOW_RULES.bodyHorizontalPadding,
  )
  let columns = 1
  while (
    columns < items &&
    available >= (columns + 1) * CTA_REFLOW_RULES.ctaMinTrack + columns * CTA_REFLOW_RULES.ctaGap
  ) {
    columns += 1
  }
  return columns
}

// ---------------------------------------------------------------------------
// 页面一致性 — the structural signature and its CTA-route partition
// ---------------------------------------------------------------------------

/**
 * The two CTA-route partitions.
 *
 * `dispositionBlock` emits two structurally different branches, and
 * {@link DEEP_LINK_STATES} is the exact predicate that chooses between them. So the
 * partition is DERIVED from the renderer's own condition — a hand-kept list here
 * could fall out of step with the branch it claims to describe, and the version that
 * was wrong would be the one asserting agreement.
 *
 * Grading one global signature across all five states would be dishonest in the
 * other direction: it would either fail on a real, intended difference or be relaxed
 * until it measured nothing.
 */
export const CTA_ROUTE_PARTITIONS = Object.freeze({
  deepLinked: "deep-linked",
  docsPrimary: "docs-primary",
})

export type CtaRoutePartition = (typeof CTA_ROUTE_PARTITIONS)[keyof typeof CTA_ROUTE_PARTITIONS]

/** Which partition a state's page belongs to. Reads the renderer's own predicate. */
export function ctaRoutePartition(installability: Installability): CtaRoutePartition {
  return DEEP_LINK_STATES.has(installability)
    ? CTA_ROUTE_PARTITIONS.deepLinked
    : CTA_ROUTE_PARTITIONS.docsPrimary
}

/**
 * Sections whose PRESENCE is a function of the projection rather than of the route.
 *
 * Each is a legitimate structural variance measured in the shipped corpus, and each
 * is recorded as `present|absent` in the signature WITH the condition that produced
 * it asserted separately (see `gradePageConsistency`). Nothing is dropped from the
 * signature because it was inconvenient: an unexplained absence and an intended one
 * look identical to a checker that simply ignores the class.
 */
export const CONDITIONAL_SITES = Object.freeze([
  {
    cls: "install-canonical",
    /** Emitted only when the resolved identity differs from the publisher's own name. */
    condition: "canonicalName !== displayName",
    holds: (p: SafeInstallProjection) => p.canonicalName !== p.displayName,
  },
  {
    cls: "install-publisher",
    /** The quarantined block is absent when the publisher supplied no description. */
    condition: "publisherDescription is a non-empty string",
    holds: (p: SafeInstallProjection) => {
      const d = p.subject.publisherDescription
      return d !== null && d !== undefined && d !== ""
    },
  },
  {
    cls: "install-reason-empty",
    /** The third authority-block shape: no reason codes were projected at this digest. */
    condition: "publicObservation.reasonCodes.length === 0",
    holds: (p: SafeInstallProjection) => p.agentContract.publicObservation.reasonCodes.length === 0,
  },
  {
    cls: "install-alt-route",
    /**
     * The opt-out link needs an https-resolvable upstream. The UNSUPPORTED fixture
     * carries `version: null`, so `canonicalProjectionInput` gives it a null
     * `sourceLocator` and the link is absent. Recorded here rather than excluded,
     * because "no link" and "a link we forgot to render" are the same bytes to a
     * checker that does not name the condition — and the condition is READ from the
     * renderer's own `altRouteHref` rather than restated, so the two cannot disagree.
     */
    condition: "altRouteHref(projection) !== null",
    holds: (p: SafeInstallProjection) => altRouteHref(p) !== null,
  },
])

/** The class names `CONDITIONAL_SITES` owns — asserted per page, so never compared. */
const CONDITIONAL_CLASSES: ReadonlySet<string> = new Set(CONDITIONAL_SITES.map((s) => s.cls))

/**
 * The ordered `install-*` class sequence inside the disposition section, with the
 * CONDITIONAL classes removed.
 *
 * Two of the conditional sites (`install-alt-route`, `install-reason-empty`) render INSIDE
 * this span, so leaving them in would smuggle projection-dependent presence back into a
 * route-level comparison — measured: the two `docs-primary` fixtures differ in exactly
 * `install-alt-route` and in nothing else. They are asserted against their own predicate in
 * `gradePageConsistency` and recorded by `signatureConditionals`, so removing them here
 * narrows what is COMPARED without narrowing what is CHECKED.
 */
function dispositionClassSequence(html: string): readonly string[] {
  const start = html.indexOf('class="install-disposition"')
  if (start === -1) return []
  const end = html.indexOf("</section>", start)
  const body = html.slice(start, end === -1 ? html.length : end)
  const out: string[] = []
  for (const m of body.matchAll(/class="([^"]+)"/g)) {
    const classes = (m[1] as string).split(/\s+/).filter((c) => c.startsWith("install-"))
    if (classes.some((c) => CONDITIONAL_CLASSES.has(c))) continue
    const value = classes.join(" ")
    if (value !== "") out.push(value)
  }
  return out
}

/**
 * A page's structural signature: what a reader's eye lands on, in order, with every
 * conditional site's presence recorded explicitly.
 *
 * Derived from the SAME `ABOVE_FOLD_SECTION_IDS` / `SECTION_GROUPS` tables the
 * renderer's own section table is keyed by, so a section added to the model without a
 * signature entry cannot pass by being invisible to this function.
 *
 * Deliberately OUTSIDE the signature: text. `<h1>` carries the version, and the
 * UNSUPPORTED fixture has none — a text-sensitive signature would report that as a
 * structural difference, which it is not. Structure is sections, their order, the
 * groups each carries, and the disposition's ordered class sequence.
 *
 * Also outside it: the CONDITIONAL sites. They are a function of the PROJECTION, not of the
 * route — within one partition, `install-reason-empty` appears exactly when a page has no
 * reason codes and `install-alt-route` disappears when the entry has no version to link.
 * Folding them in would make "same route ⇒ same structure" false for reasons that are
 * correct behaviour, and the honest response is not to loosen the comparison but to move
 * those sites to a check that names the predicate each one answers to
 * (`conditional/<page>/<class>` in `gradePageConsistency`). So each conditional site is
 * asserted against `holds(projection)` per page, and the signature compares what the route
 * alone determines. `signatureConditionals` still RECORDS presence for the artifact, so
 * nothing becomes invisible — it is reported, just not compared.
 */
export function structuralSignature(html: string): string {
  const sections = ABOVE_FOLD_SECTION_IDS.filter((id) => html.includes(`class="${id}"`)).map(
    (id) => `${id}[${SECTION_GROUPS[id].join("+")}]`,
  )
  return [
    `sections:${sections.join(">")}`,
    `disposition:${dispositionClassSequence(html).join(">")}`,
  ].join(" | ")
}

/**
 * Each conditional site's presence, RECORDED (not compared). Keeps the four tolerated
 * variances visible in the artifact while `gradePageConsistency` asserts each against the
 * projection condition that produced it.
 */
export function signatureConditionals(html: string): readonly string[] {
  return CONDITIONAL_SITES.map(
    (s) => `${s.cls}=${html.includes(`class="${s.cls}"`) ? "present" : "absent"}`,
  )
}

// ---------------------------------------------------------------------------
// Block 1 — Config 完整性
// ---------------------------------------------------------------------------

/** What the script measures off the raw catalog bytes and hands in. */
export interface CatalogFacts {
  /** Per-object duplicate keys, found in the RAW bytes: `JSON.parse` collapses them last-wins. */
  readonly duplicateKeys: readonly string[]
  /** Keys that validated and then reached nothing — read from the resolver, not recomputed. */
  readonly unwiredSlots: readonly string[]
  /** Keys the resolver refused. A rejection that no one reports is a silent dead key. */
  readonly rejectedSlots: readonly string[]
}

/** Per-host guard copy, read through `persistentComponentFor` (the uninstall string is derived). */
export interface HostCopyFacts {
  readonly host: string
  readonly label: string
  readonly artifactPath: string
  readonly uninstallCommand: string
}

/** The three host vocabularies, so the split is recorded with its measured intersections. */
export interface HostVocabularyFacts {
  readonly guardHostIds: readonly string[]
  readonly ruleHosts: readonly string[]
  readonly hostAdapters: readonly string[]
}

export interface ConfigIntegrityInput {
  readonly catalog: CatalogFacts
  readonly hostCopy: readonly HostCopyFacts[]
  readonly vocabularies: HostVocabularyFacts
  /** Every `Installability` the corpus covers — the domain `CTA_DOC_HREF` must be total over. */
  readonly installabilityStates: readonly Installability[]
  /** The threshold the eval artifact declares, so it is GRADED rather than self-certifying. */
  readonly declaredMaxAuthorityFacts: number
  /** Measured authority-fact counts per fixture, against that threshold. */
  readonly measuredAuthorityFactCounts: readonly { readonly id: string; readonly facts: number }[]
}

/**
 * 配置完整性 — every copy domain a page reads from is TOTAL, and no configured key is
 * dead or duplicated.
 *
 * Five of the six domains are already `Record<Domain, …>` in shipped code, so the
 * compiler proves their totality and this block's job is to make it reviewable by
 * enumeration. The sixth (`MUST_ASK_SENTENCE`) was the one real gap, and P-6 closed
 * it in the type system rather than here — a seventh `mustAskBefore` token without a
 * sentence is now a typecheck error, which fails earlier and harder than any gate.
 */
export function gradeConfigIntegrity(input: ConfigIntegrityInput): PreviewBlock {
  const checks: PreviewCheck[] = []

  // --- the five compiler-total domains, enumerated so the artifact shows the domain ---
  const missingVerdictLabel = VERDICTS.filter((v) => (VERDICT_PUBLIC_LABEL[v] ?? "") === "")
  checks.push(
    check(
      "domain-total/verdict-public-label",
      missingVerdictLabel.length === 0,
      `${VERDICTS.length} verdict(s), missing: ${list(missingVerdictLabel)}`,
    ),
  )

  const missingReasonMeta = REASON_CODES.filter((c) => REASON_CODE_META[c] === undefined)
  checks.push(
    check(
      "domain-total/reason-code-meta",
      missingReasonMeta.length === 0,
      `${REASON_CODES.length} reason code(s), missing: ${list(missingReasonMeta)}`,
    ),
  )

  const missingObserved = ADOPTION_AUTHORITIES.filter((a) => (OBSERVED_CONSEQUENCE[a] ?? "") === "")
  const missingAbsence = ADOPTION_AUTHORITIES.filter((a) => (ABSENCE_CONSEQUENCE[a] ?? "") === "")
  checks.push(
    check(
      "domain-total/authority-consequences",
      missingObserved.length === 0 && missingAbsence.length === 0,
      `${ADOPTION_AUTHORITIES.length} authority(ies), missing observed: ${list(missingObserved)}, ` +
        `missing absence: ${list(missingAbsence)}`,
    ),
  )

  // The CTA domain is graded over `PRIMARY_CTA`'s key set, NOT over the states the
  // corpus happens to cover. `Installability` is a bare union with no runtime list, so a
  // corpus-derived domain would shrink with the corpus: drop a fixture and the check
  // would keep passing over four states while the fifth went unmeasured. `PRIMARY_CTA`
  // is a second, independently-maintained `Record<Installability, string>`, so using its
  // keys means a new state must be added to BOTH tables or this check names the gap.
  const ctaDomain = Object.keys(PRIMARY_CTA) as Installability[]
  const missingCta = ctaDomain.filter((s) => (CTA_DOC_HREF[s] ?? "") === "")
  const uncoveredByCorpus = ctaDomain.filter((s) => !input.installabilityStates.includes(s))
  checks.push(
    check(
      "domain-total/cta-doc-href",
      ctaDomain.length > 0 && missingCta.length === 0,
      `${ctaDomain.length} state(s) in PRIMARY_CTA, missing an href: ${list(missingCta)}`,
    ),
  )
  checks.push(
    check(
      "domain-total/cta-corpus-covers-every-state",
      uncoveredByCorpus.length === 0,
      `corpus covers ${input.installabilityStates.length}/${ctaDomain.length}; ` +
        `unexercised: ${list(uncoveredByCorpus)}`,
    ),
  )

  // The closure P-6 made compiler-enforced. Graded here too, because the artifact is
  // where a reviewer looks — but the load-bearing check is the type, not this line.
  const guidanceTokens = [...AGENT_GUIDANCE.mustAskBefore]
  const tokenSetMatches =
    guidanceTokens.length === MUST_ASK_TOKENS.length &&
    guidanceTokens.every((t, i) => t === MUST_ASK_TOKENS[i])
  checks.push(
    check(
      "domain-total/must-ask-sentence",
      tokenSetMatches,
      `${MUST_ASK_TOKENS.length} token(s); AGENT_GUIDANCE.mustAskBefore ${
        tokenSetMatches ? "references the same list" : `diverged: ${list(guidanceTokens)}`
      }`,
    ),
  )

  // --- host name/help completeness, graded on the plane where the copy actually is ---
  const incompleteHosts = input.hostCopy.filter(
    (h) => h.label === "" || h.artifactPath === "" || h.uninstallCommand === "",
  )
  checks.push(
    check(
      "host-copy/complete",
      input.hostCopy.length > 0 && incompleteHosts.length === 0,
      `${input.hostCopy.length} guard host(s), incomplete: ${list(incompleteHosts.map((h) => h.host))}`,
    ),
  )

  // The three-way vocabulary split, RECORDED with its measured intersections. The
  // install plane names no host at all — adding host copy to the page would add served
  // bytes, so its silence is by design and this check records the split rather than
  // demanding the three lists agree.
  const v = input.vocabularies
  const guardAndRule = v.guardHostIds.filter((h) => v.ruleHosts.includes(h))
  const guardAndAdapter = v.guardHostIds.filter((h) => v.hostAdapters.includes(h))
  checks.push(
    ok(
      "host-copy/vocabulary-split",
      `guard=${v.guardHostIds.length} rule=${v.ruleHosts.length} adapter=${v.hostAdapters.length}; ` +
        `guard∩rule=${list(guardAndRule)}; guard∩adapter=${list(guardAndAdapter)}`,
    ),
  )

  // --- 无未引用配置 · 无重复 key, measured over RAW bytes ---
  checks.push(
    check(
      "catalog/no-duplicate-keys",
      input.catalog.duplicateKeys.length === 0,
      `duplicate key(s) in raw bytes: ${list(input.catalog.duplicateKeys)}`,
    ),
  )
  checks.push(
    check(
      "catalog/no-unwired-slots",
      input.catalog.unwiredSlots.length === 0,
      `slot(s) that validate and reach nothing: ${list(input.catalog.unwiredSlots)}`,
    ),
  )
  checks.push(
    check(
      "catalog/no-rejected-slots",
      input.catalog.rejectedSlots.length === 0,
      `slot(s) the resolver refused: ${list(input.catalog.rejectedSlots)}`,
    ),
  )

  // --- the declared threshold, GRADED. Before P-6 nothing read it. ---
  const overCap = input.measuredAuthorityFactCounts.filter(
    (m) => m.facts > input.declaredMaxAuthorityFacts,
  )
  checks.push(
    check(
      "threshold/max-authority-facts-graded",
      input.measuredAuthorityFactCounts.length > 0 && overCap.length === 0,
      `declared ${input.declaredMaxAuthorityFacts}; measured ${list(
        input.measuredAuthorityFactCounts.map((m) => `${m.id}=${m.facts}`),
      )}`,
    ),
  )

  return { block: "配置完整性", checks, pass: checks.every((c) => c.pass) }
}

// ---------------------------------------------------------------------------
// Block 2 — 页面一致性
// ---------------------------------------------------------------------------

/** One state's rendered page plus the projection that produced it. */
export interface PageSample {
  readonly id: string
  readonly installability: Installability
  readonly projection: SafeInstallProjection
  readonly html: string
  /** The shipped 8-check structural capsule, so this block reuses rather than reimplements. */
  readonly capsule: HumanCapsuleStructure
}

export interface PageConsistencyInput {
  readonly pages: readonly PageSample[]
}

/**
 * 页面一致性 — same route ⇒ same structure, different route ⇒ different structure.
 *
 * The second half is the load-bearing one. A signature that collapsed to a constant
 * would satisfy "identical within a partition" perfectly while measuring nothing, so
 * the cross-partition INEQUALITY is what distinguishes a real signature from one that
 * passes by agreeing with itself.
 */
export function gradePageConsistency(input: PageConsistencyInput): PreviewBlock {
  const checks: PreviewCheck[] = []
  const byPartition = new Map<string, PageSample[]>()
  for (const page of input.pages) {
    const key = ctaRoutePartition(page.installability)
    const bucket = byPartition.get(key)
    if (bucket === undefined) byPartition.set(key, [page])
    else bucket.push(page)
  }

  // Both partitions must be populated, or one of the two halves below is vacuous.
  const partitionNames = [...byPartition.keys()].sort()
  checks.push(
    check(
      "partition/both-populated",
      byPartition.size === 2,
      `partitions: ${list(
        partitionNames.map((n) => `${n}=${(byPartition.get(n) ?? []).length}`),
      )}`,
    ),
  )

  const signatureOf = new Map<string, string>()
  for (const name of partitionNames) {
    const pages = byPartition.get(name) ?? []
    const signatures = [...new Set(pages.map((p) => structuralSignature(p.html)))]
    signatureOf.set(name, signatures[0] ?? "")
    checks.push(
      check(
        `partition/${name}/one-signature`,
        signatures.length === 1,
        signatures.length === 1
          ? `${pages.length} page(s), signature ${signatures[0] ?? ""}`
          : `${signatures.length} distinct signatures: ${signatures.join("  ≠  ")}`,
      ),
    )

    // 同一 Host 的 CTA 一致 — one primary CTA (reusing the shipped check) and one href
    // scheme per partition. The scheme, not the full href: the deep link legitimately
    // carries per-target digests, so requiring identical hrefs would fail on a real page.
    const ctaCounts = pages.map(
      (p) => p.capsule.checks.find((c) => c.id === "exactly-one-primary-cta")?.pass === true,
    )
    checks.push(
      check(
        `partition/${name}/exactly-one-primary-cta`,
        ctaCounts.length > 0 && ctaCounts.every(Boolean),
        `${ctaCounts.filter(Boolean).length}/${ctaCounts.length} page(s) carry exactly one .install-cta`,
      ),
    )

    const schemes = [...new Set(pages.map((p) => ctaHrefScheme(p.html)))]
    checks.push(
      check(
        `partition/${name}/one-cta-scheme`,
        schemes.length === 1,
        `scheme(s): ${list(schemes)}`,
      ),
    )
  }

  // The negative control: the two partitions exist because the markup differs, so
  // their signatures MUST differ.
  if (partitionNames.length === 2) {
    const a = signatureOf.get(partitionNames[0] as string) ?? ""
    const b = signatureOf.get(partitionNames[1] as string) ?? ""
    checks.push(
      check(
        "partition/signatures-differ",
        a !== b && a !== "",
        a !== b
          ? `${partitionNames[0]} ≠ ${partitionNames[1]} (as the two disposition branches require)`
          : `both partitions produced the SAME signature — a collapsed signature cannot detect drift: ${a}`,
      ),
    )
  }

  // Every conditional site's recorded presence must match the condition that produced
  // it. This is what keeps the four (five, with alt-route) tolerated variances honest
  // rather than merely excluded.
  for (const page of input.pages) {
    for (const site of CONDITIONAL_SITES) {
      const present = page.html.includes(`class="${site.cls}"`)
      const expected = site.holds(page.projection)
      checks.push(
        check(
          `conditional/${page.id}/${site.cls}`,
          present === expected,
          `${present ? "present" : "absent"}; condition (${site.condition}) is ${expected}`,
        ),
      )
    }
    // The third authority-block shape, named as its own rule.
    const emptyReasons = page.projection.agentContract.publicObservation.reasonCodes.length === 0
    checks.push(
      check(
        `authority-shape/${page.id}`,
        page.html.includes('class="install-reason-empty"') === emptyReasons,
        `reasonCodes=${page.projection.agentContract.publicObservation.reasonCodes.length}, ` +
          `install-reason-empty ${page.html.includes('class="install-reason-empty"') ? "present" : "absent"}`,
      ),
    )
  }

  return { block: "页面一致性", checks, pass: checks.every((c) => c.pass) }
}

/** The primary CTA's href SCHEME — `calllint://` or the docs origin. */
function ctaHrefScheme(html: string): string {
  const m = /class="install-cta"[^>]*?href="([^"]*)"/s.exec(html)
  const href = m?.[1] ?? ""
  if (href === "") return "none"
  const scheme = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)/i.exec(href)
  return scheme?.[1] ?? "relative"
}

// ---------------------------------------------------------------------------
// Block 3 — 安全隔离
// ---------------------------------------------------------------------------

/** One hostile-publisher reprojection: the blurb, and what it produced. */
export interface InjectionSample {
  readonly fixtureId: string
  readonly blurb: string
  readonly html: string
  /** The reprojected contract's frozen guidance block, for the protocol-trigger check. */
  readonly agentGuidance: unknown
  /** The reprojected decision route, so a blurb that moved it is named. */
  readonly routeKey: string
}

/** The sentinel-copy invariance sample: a full sentinel presentation + sentinel tokens. */
export interface SentinelSample {
  readonly fixtureId: string
  /** Derived through the SAME constructor from a sentinel — never asserted against a literal. */
  readonly baselineSemanticDigest: string
  readonly sentinelSemanticDigest: string
  readonly baselineRouteKey: string
  readonly sentinelRouteKey: string
  /**
   * Proof the sentinel actually REACHED a surface: it is observable in the reprojection's
   * rendered HTML, and absent from the baseline's.
   *
   * Without this the invariance is unfalsifiable. A sentinel document that filled nothing
   * resolves to the shipped defaults, so the reprojection equals the baseline and every digest
   * comparison passes by comparing a value against itself — which is exactly how negative
   * control #13 failed to fire. Counting samples cannot see that; only a witness that the
   * sentinel is present downstream can.
   */
  readonly sentinelReachedSurface: boolean
  readonly baselineFreeOfSentinel: boolean
}

export interface SecurityIsolationInput {
  readonly injections: readonly InjectionSample[]
  readonly sentinels: readonly SentinelSample[]
  /** The route key per fixture WITHOUT any hostile blurb, to compare against. */
  readonly baselineRouteKeys: Readonly<Record<string, string>>
}

/** The decision groups a publisher string may never reach (INV-2.4-05). */
const DECISION_GROUP_CLASSES: readonly string[] = Object.freeze([
  "install-identity",
  "install-disposition",
  "install-consequence",
  "install-authority",
  "install-secondary",
  "install-agent-reads",
  "install-provenance",
])

/**
 * Raw executable substrings a blurb could contribute, checked in the UNESCAPED form.
 *
 * The script/handler whitelist itself is NOT restated here — `htmlAllowsOnlyInstallCopyScript`
 * is the shipped predicate for "exactly one external copy-assist script, no inline body,
 * no `on*` attribute", and the check below calls it. These patterns are the narrower
 * question of whether a *hostile publisher string* survived unescaped, which is why they
 * are matched against the publisher section's raw bytes rather than the whole page.
 */
const RAW_EXECUTABLE_SUBSTRINGS: readonly string[] = Object.freeze([
  "<script",
  "javascript:",
  "<iframe",
  "<object",
])

/**
 * 安全隔离 — five zero-counts, all graded. Three of them had no grader before P-6.
 *
 * The publisher→HTML count is the one nothing measured: the five injection blurbs
 * were graded only against the contract's decision scope, which is built by omission,
 * so nothing ever rendered them into HTML and counted. It is checked in BOTH escape
 * forms, because `esc` and `escText` differ on `"` and `'` and a check that guessed
 * one form could report zero occurrences of a string that is on the page.
 */
export function gradeSecurityIsolation(input: SecurityIsolationInput): PreviewBlock {
  const checks: PreviewCheck[] = []

  if (input.injections.length === 0) {
    checks.push(bad("injection/non-vacuous", "no hostile-publisher reprojection was measured"))
  }

  for (const sample of input.injections) {
    const id = `${sample.fixtureId}/${sample.blurb.slice(0, 24)}`

    // 1. The blurb may appear ONLY inside install-publisher, in either escape form.
    const leaks: string[] = []
    for (const cls of DECISION_GROUP_CLASSES) {
      const section = sectionBody(sample.html, cls)
      if (section === "") continue
      for (const form of renderedForms(sample.blurb)) {
        if (form !== "" && section.includes(form)) leaks.push(cls)
      }
    }
    checks.push(
      check(
        `publisher-html/${id}`,
        leaks.length === 0,
        leaks.length === 0
          ? "0 occurrence(s) outside install-publisher, both escape forms"
          : `leaked into: ${list([...new Set(leaks)])}`,
      ),
    )

    // 2. No executable form anywhere. The whitelist half REUSES the shipped predicate
    //    (`htmlAllowsOnlyInstallCopyScript`) rather than re-deriving what "only the copy
    //    script" means — one of the injection blurbs is literally `<script>alert(1)</script>`,
    //    so a second, subtly different regex here is exactly where a hole would hide.
    checks.push(
      check(
        `publisher-script-whitelist/${id}`,
        htmlAllowsOnlyInstallCopyScript(sample.html),
        `script tags = ${(sample.html.match(/<script\b/gi) ?? []).length}; ` +
          `on* attrs = ${(sample.html.match(/\son[a-z]+=/gi) ?? []).length}`,
      ),
    )

    //    …plus the narrower question: did any raw executable substring from the blurb
    //    survive unescaped inside the one block that is allowed to carry publisher text?
    const publisherSection = sectionBody(sample.html, "install-publisher")
    const rawExecutable = RAW_EXECUTABLE_SUBSTRINGS.filter((s) =>
      publisherSection.toLowerCase().includes(s),
    )
    checks.push(
      check(
        `publisher-executable/${id}`,
        rawExecutable.length === 0,
        rawExecutable.length === 0
          ? "0 unescaped executable substring(s) in install-publisher"
          : `unescaped: ${list(rawExecutable)}`,
      ),
    )

    // 3. The blurb must not move the decision route.
    const baseline = input.baselineRouteKeys[sample.fixtureId] ?? ""
    checks.push(
      check(
        `publisher-route/${id}`,
        baseline !== "" && sample.routeKey === baseline,
        baseline === ""
          ? "no baseline route key was supplied, so the comparison is vacuous"
          : `route ${sample.routeKey} vs baseline ${baseline}`,
      ),
    )

    // 4. Protocol triggers are code: the reprojected guidance must be the frozen block,
    //    token for token. Relay copy may never add or remove a trigger (ADR 0058 §6).
    const guidanceMatches =
      JSON.stringify(sample.agentGuidance) === JSON.stringify(AGENT_GUIDANCE)
    checks.push(
      check(
        `agent-guidance/${id}`,
        guidanceMatches,
        guidanceMatches
          ? "agentGuidance deep-equals the frozen AGENT_GUIDANCE"
          : `agentGuidance diverged under hostile publisher text: ${JSON.stringify(sample.agentGuidance)}`,
      ),
    )
  }

  // 5. Configured copy and tokens may not move the sealed semantic digest. Both sides
  //    are derived through the SAME constructor from a sentinel, because a literal
  //    cannot detect its own subject changing.
  if (input.sentinels.length === 0) {
    checks.push(bad("sentinel/non-vacuous", "no sentinel-copy reprojection was measured"))
  }
  for (const s of input.sentinels) {
    // The invariance above is only evidence if the sentinel REACHED something. A sentinel that
    // filled nothing makes both sides the shipped defaults, and the equality then holds for the
    // wrong reason. So the witness is graded first, per fixture, before its digest is believed.
    checks.push(
      check(
        `sentinel-reached/${s.fixtureId}`,
        s.sentinelReachedSurface && s.baselineFreeOfSentinel,
        s.sentinelReachedSurface
          ? s.baselineFreeOfSentinel
            ? "sentinel copy is observable in the reprojected page and absent from the baseline"
            : "the BASELINE page already contains the sentinel, so its absence proves nothing"
          : "sentinel copy reached no surface — the invariance below would compare the shipped defaults against themselves",
      ),
    )
    checks.push(
      check(
        `semantic-digest/${s.fixtureId}`,
        s.baselineSemanticDigest === s.sentinelSemanticDigest && s.baselineSemanticDigest !== "",
        `baseline ${s.baselineSemanticDigest} vs sentinel ${s.sentinelSemanticDigest}`,
      ),
    )
    checks.push(
      check(
        `semantic-route/${s.fixtureId}`,
        s.baselineRouteKey === s.sentinelRouteKey && s.baselineRouteKey !== "",
        `route ${s.baselineRouteKey} vs sentinel ${s.sentinelRouteKey}`,
      ),
    )
  }

  return { block: "安全隔离", checks, pass: checks.every((c) => c.pass) }
}

/** One section's inner bytes, or "" when the section is absent. */
function sectionBody(html: string, cls: string): string {
  const start = html.indexOf(`class="${cls}"`)
  if (start === -1) return ""
  const end = html.indexOf("</section>", start)
  return html.slice(start, end === -1 ? html.length : end)
}

// ---------------------------------------------------------------------------
// Block 4 — 视觉回归
// ---------------------------------------------------------------------------

/** The stylesheet copies, named so a failure says WHICH copy drifted. */
export interface StylesheetSample {
  readonly path: string
  readonly css: string
  readonly tokens: readonly CssToken[]
}

export interface VisualRegressionInput {
  readonly stylesheets: readonly StylesheetSample[]
  readonly pages: readonly PageSample[]
  /** How many children `.install-cta-row` actually holds, per page. Measured, not assumed. */
  readonly ctaRowItems: Readonly<Record<string, number>>
}

/** One state × viewport observation, carried into the artifact so a reviewer sees the reflow. */
export interface ViewportObservation {
  readonly id: string
  readonly viewport: number
  readonly ctaRowItems: number
  readonly predictedColumns: number
}

export interface VisualRegressionResult extends PreviewBlock {
  readonly observations: readonly ViewportObservation[]
  /** Digest inputs: the resolved declarations for the classes each page actually emits. */
  readonly declarationCoverage: readonly { readonly id: string; readonly classes: number; readonly rules: number }[]
}

/**
 * 视觉回归 — WITHOUT a browser, and the scope is stated rather than implied.
 *
 * What is measured: which declarations apply to the classes each page actually emits
 * (var()-resolved, so a token VALUE change is visible), and how the one grid reflows
 * across three viewports. What is NOT measured: glyph rasterization.
 *
 * The zero-`@media` assertion is what makes that scope sound rather than convenient.
 * `resolveDeclarations` is a flat rule walk with no nesting support, so a media query
 * would be mis-parsed — and adding one would also spend a served-byte license this
 * batch does not have. Turning the constraint into a measurement means a future edit
 * that breaks the premise fails here instead of quietly producing wrong declarations.
 */
export function gradeVisualRegression(input: VisualRegressionInput): VisualRegressionResult {
  const checks: PreviewCheck[] = []

  for (const sheet of input.stylesheets) {
    const mediaCount = (sheet.css.match(/@media/g) ?? []).length
    checks.push(
      check(
        `stylesheet/${sheet.path}/no-media-queries`,
        mediaCount === 0,
        mediaCount === 0
          ? "0 @media block(s) — the flat declaration parser is sound and the reflow is arithmetic"
          : `${mediaCount} @media block(s): resolveDeclarations has no nesting support, so declarations here are mis-parsed`,
      ),
    )
  }

  // Both copies must resolve to the SAME declarations. A byte-compare lives in the
  // lock; this is the resolved-declaration form, which is the visual fact.
  const digests = input.stylesheets.map((s) => ({
    path: s.path,
    resolved: resolveDeclarations(s.css, s.tokens),
  }))
  if (digests.length >= 2) {
    const first = JSON.stringify(digests[0]?.resolved ?? [])
    const diverged = digests.filter((d) => JSON.stringify(d.resolved) !== first).map((d) => d.path)
    checks.push(
      check(
        "stylesheet/copies-resolve-identically",
        diverged.length === 0,
        diverged.length === 0
          ? `${digests.length} cop(ies) resolve to identical declarations`
          : `diverged: ${list(diverged)}`,
      ),
    )
  } else {
    checks.push(bad("stylesheet/copies-resolve-identically", `only ${digests.length} stylesheet copy measured`))
  }

  // Declaration coverage per page: every install-* class the page emits should be
  // reachable in the resolved rules, or the "which declarations apply" claim is partly
  // about classes nothing styles.
  //
  // The styled set comes from the shipped `parseStyledClasses`, which takes the SUBJECT of
  // each selector. That distinction is load-bearing and documented where it lives: a
  // descendant-only mention such as `.install-authority code` styles the `code` element,
  // so counting it as coverage would let the rule that actually styles `.install-authority`
  // be deleted while this number sat unmoved — the precise drift a coverage check exists
  // to catch. A selector-substring walk here would have made exactly that mistake.
  const resolved = digests[0]?.resolved ?? []
  const styled = new Set(parseStyledClasses(input.stylesheets[0]?.css ?? ""))
  const declarationCoverage: { id: string; classes: number; rules: number }[] = []
  for (const page of input.pages) {
    const classes = emittedInstallClasses(page.html)
    const uncovered = classes.filter((c) => !styled.has(c))
    declarationCoverage.push({ id: page.id, classes: classes.length, rules: resolved.length })
    checks.push(
      check(
        `declarations/${page.id}/covered`,
        classes.length > 0 && uncovered.length === 0,
        `${classes.length} emitted class(es), uncovered: ${list(uncovered)}`,
      ),
    )
  }

  // The reflow prediction across three viewports.
  const observations: ViewportObservation[] = []
  for (const page of input.pages) {
    const items = input.ctaRowItems[page.id] ?? 0
    for (const viewport of PREVIEW_VIEWPORTS) {
      observations.push({
        id: page.id,
        viewport,
        ctaRowItems: items,
        predictedColumns: predictCtaColumns(viewport, items),
      })
    }
  }

  // The transition is what makes the three viewports a measurement rather than
  // decoration: a deep-link page holds 2 CTA children, so it MUST be single-column at
  // 390 and two-column at 768. A page whose row holds ≤1 item has no transition to
  // show, and saying so is more honest than grading it as if it did.
  const twoItemPages = input.pages.filter((p) => (input.ctaRowItems[p.id] ?? 0) >= 2)
  checks.push(
    check(
      "reflow/non-vacuous",
      twoItemPages.length > 0,
      `${twoItemPages.length} page(s) hold ≥2 CTA-row items, so the 452 px boundary is exercised`,
    ),
  )
  for (const page of twoItemPages) {
    const at390 = predictCtaColumns(390, input.ctaRowItems[page.id] ?? 0)
    const at768 = predictCtaColumns(768, input.ctaRowItems[page.id] ?? 0)
    checks.push(
      check(
        `reflow/${page.id}/crosses-boundary`,
        at390 === 1 && at768 === 2,
        `390px ⇒ ${at390} column(s), 768px ⇒ ${at768} column(s)`,
      ),
    )
  }

  return {
    block: "视觉回归",
    checks,
    pass: checks.every((c) => c.pass),
    observations,
    declarationCoverage,
  }
}

// ---------------------------------------------------------------------------
// 可回滚性 — §14's fifth block (PR P-7)
// ---------------------------------------------------------------------------
//
// §14 states three obligations and nothing ran them:
//
//     每个 presentation config 有版本          → the `configVersion` identity key
//     每次 deploy 记录 presentationDigest      → the committed deploy ledger
//     可按 digest 恢复上一版本                  → `restoreByDigest` + the round-trip below
//
// They are graded as ONE block because they are one loop. A version nothing records is
// decoration; a ledger keyed on a digest no document can be recovered from is a receipt
// for something unrecoverable; and a restore that cannot name which version it restored
// to is a guess. Breaking any single link makes the other two worthless, so a block that
// passes with one link broken would be a block worth deleting.
//
// WHY THIS GRADER TOUCHES NO GIT. Measured on a depth-1 clone of this very repo — which
// is what `ci.yml`'s bare `actions/checkout@v6` produces — `git cat-file -e` on a
// historical blob reports MISSING and `git merge-base --is-ancestor` exits `fatal: Not a
// valid object name`, i.e. it cannot even fail gracefully. And `audit:preview` runs in CI
// in `--check` mode, which REBUILDS this artifact and byte-compares it against the
// committed copy. A git-reading grader would therefore make that byte-compare fail on
// every CI run, forever, for a reason having nothing to do with the claim.
//
// That measurement forces a stronger conclusion than "keep git out of the grader". If a
// past document's only copy lived in git history, then on a depth-1 clone the past
// documents DO NOT EXIST — §14's 可按 digest 恢复上一版本 would be FALSE there, not merely
// ungraded. So each ledger entry STORES its document, and the ledger is a restore store
// rather than a receipt for something unrecoverable.
//
// So the corpus arrives as a PARAMETER: `scripts/preview-snapshot.ts` reads it out of the
// committed ledger — no git, which is why the graded path runs identically on a full clone
// and on CI's depth-1 checkout — and this function only grades what it is handed. What git
// still buys is AUTHENTICITY (a stored document equals the document at its commit), and
// that check lives in `scripts/presentation-ledger.ts --validate`, on a full clone, outside
// every gate. This is the shipped observer/evaluator split, and it is also what makes the
// round-trip unit-testable without a repository.

/** One recoverable document: a digest and the bytes it must restore to. */
export interface RollbackCorpusMember {
  /** Short commit label, for readable observations. */
  readonly commit: string
  readonly at: string
  readonly presentationDigest: string
  readonly l0Digest: string
  readonly l1Digest: string
  readonly l2Digest: string
  readonly configVersion: string | null
  readonly sections: readonly string[]
  /**
   * The document itself, or `null` when the catalog did not exist at that commit.
   *
   * `null` is a measured state, not a sentinel: the oldest member is the parent of the
   * catalog's first commit, and git proves the absence. Recording it as a member rather
   * than as a special case gives rollback a floor reached by the SAME lookup as every
   * other member — see `emptyPresentationDigest`, whose own docblock reserves this for
   * PR P-7 by name.
   */
  readonly document: PresentationContentV1 | null
}

export interface RollbackInput {
  /** Oldest first. Built from git by `scripts/`, never here. */
  readonly corpus: readonly RollbackCorpusMember[]
  /** The live catalog, as committed. */
  readonly liveDocument: PresentationContentV1
  /** Faults reported by `scripts/presentation-ledger.ts`'s validator — MUST be empty. */
  readonly ledgerFaults: readonly string[]
  /** `deploys[]` length, so an empty ledger is a named failure rather than a vacuous pass. */
  readonly ledgerEntryCount: number
  /**
   * Does `deploy-web.yml` RUN the ledger check? An anchored binding, and the anchor is the
   * invoked command rather than the word `presentationDigest` — that word appears in the
   * step's own comment, so a substring probe for it would keep passing after the command
   * was deleted. This is the `REGRESSION_CHECKS` idiom, used here because no
   * `REGRESSION_CHECKS` row can name that workflow: all 19 bind `ci.yml`#`test`, and
   * `deploy-web.yml`'s single `deploy:` job is graded by nothing.
   */
  readonly deployWorkflowRecordsDigest: boolean
  /** Is `deploy-web.yml` still `contents: read`? A deploy that writes to the repo needs an ADR. */
  readonly deployWorkflowPermissionsReadOnly: boolean
  /** Schema property names, so the version's declaration is graded, not assumed. */
  readonly schemaPropertyNames: readonly string[]
  /** The validator's accepted top-level key set. */
  readonly validatorKnownKeys: readonly string[]
  /** Every slot name the resolver can fill — `configVersion` must appear in none. */
  readonly resolverSlotNames: readonly string[]
  /** Faults the real validator returns for a deliberately malformed version. */
  readonly malformedVersionRules: readonly string[]
}

/**
 * Restore the document a digest names. PURE: the corpus is a parameter.
 *
 * Returns `null` for an unknown digest, and that refusal is the point. A rollback that
 * silently restored a nearest match would be worse than one that refuses — it would
 * deploy the wrong bytes under the right name, which is the failure mode a digest exists
 * to prevent. `undefined` document (the pre-catalog state) is returned as
 * `EMPTY_PRESENTATION_CONTENT` so callers get a real document rather than a branch.
 */
export function restoreByDigest(
  corpus: readonly RollbackCorpusMember[],
  digest: string,
): PresentationContentV1 | null {
  const hit = corpus.find((m) => m.presentationDigest === digest)
  if (hit === undefined) return null
  return hit.document ?? EMPTY_PRESENTATION_CONTENT
}

/**
 * The member deployed immediately before `digest` — §14's 上一版本, made computable.
 *
 * Depends on `deploys[]` being a chain, which the ledger validator enforces with two
 * independent orderings (wall-clock and git ancestry). Without that, "previous" is not a
 * defined notion and this function would be returning an arbitrary neighbour.
 */
export function previousDeploy(
  corpus: readonly RollbackCorpusMember[],
  digest: string,
): RollbackCorpusMember | null {
  const i = corpus.findIndex((m) => m.presentationDigest === digest)
  return i <= 0 ? null : (corpus[i - 1] ?? null)
}

export function gradeRollback(input: RollbackInput): PreviewBlock {
  const checks: PreviewCheck[] = []
  const { corpus } = input

  // --- 每个 presentation config 有版本 -------------------------------------
  const version = input.liveDocument.configVersion
  checks.push(
    check(
      "version/present",
      typeof version === "string" && version.length > 0,
      version === undefined ? "the live catalog carries no configVersion" : `configVersion ${JSON.stringify(version)}`,
    ),
  )
  checks.push(
    check(
      "version/non-prose",
      typeof version === "string" && CONFIG_VERSION_PATTERN.test(version),
      `${JSON.stringify(version ?? null)} against ${String(CONFIG_VERSION_PATTERN)}`,
    ),
  )
  checks.push(
    check(
      "version/declared-in-schema",
      input.schemaPropertyNames.includes("configVersion"),
      `schema properties: ${list(input.schemaPropertyNames)}`,
    ),
  )
  checks.push(
    check(
      "version/accepted-by-validator",
      input.validatorKnownKeys.includes("configVersion"),
      `validator known keys: ${list(input.validatorKnownKeys)}`,
    ),
  )
  // A field the schema admits but the validator rejects — or vice versa — is a field that
  // fails on a real catalog. The pair above is graded together for that reason.
  checks.push(
    check(
      "version/malformed-is-rejected",
      input.malformedVersionRules.includes("config-version"),
      `a malformed configVersion yields: ${list(input.malformedVersionRules)}`,
    ),
  )
  // An identity key is validated and digested, NEVER resolved. A version that became a
  // resolver slot would be renderable copy, and copy is what this key must never be.
  checks.push(
    check(
      "version/not-a-resolver-slot",
      !input.resolverSlotNames.includes("configVersion"),
      `${input.resolverSlotNames.length} resolver slot(s), configVersion among them: ${input.resolverSlotNames.includes("configVersion")}`,
    ),
  )
  // The signature that proves it is an IDENTITY key and not a levelled section, derived
  // through `presentationDigest` itself rather than compared to a literal: adding the key
  // must move the aggregate and leave all three level digests untouched.
  {
    const { configVersion: _drop, ...withoutVersion } = input.liveDocument
    const withV = presentationDigest(input.liveDocument)
    const without = presentationDigest(withoutVersion as PresentationContentV1)
    const aggregateMoves = withV.presentationDigest !== without.presentationDigest
    const levelsHold =
      withV.l0Digest === without.l0Digest &&
      withV.l1Digest === without.l1Digest &&
      withV.l2Digest === without.l2Digest
    checks.push(
      check(
        "version/identity-digest-signature",
        aggregateMoves && levelsHold,
        `aggregate moves: ${aggregateMoves}, l0/l1/l2 hold: ${levelsHold}`,
      ),
    )
    checks.push(
      check(
        "version/carries-no-level",
        JSON.stringify(withV.sections) === JSON.stringify(without.sections),
        `sections with: ${list(withV.sections)} / without: ${list(without.sections)}`,
      ),
    )
  }

  // --- 每次 deploy 记录 presentationDigest ---------------------------------
  checks.push(
    check(
      "ledger/valid",
      input.ledgerFaults.length === 0,
      input.ledgerFaults.length === 0
        ? `every entry recomputed against its own commit`
        : `${input.ledgerFaults.length} fault(s): ${input.ledgerFaults.join(" | ")}`,
    ),
  )
  checks.push(
    check("ledger/non-empty", input.ledgerEntryCount > 0, `${input.ledgerEntryCount} recorded deploy(s)`),
  )
  // The newest recorded document must be the one that exists NOW. This is §14's second
  // line as an enforceable obligation: change the catalog without recording, and this
  // check is the one that names it.
  {
    const live = presentationDigest(input.liveDocument).presentationDigest
    const newest = corpus.length === 0 ? null : corpus[corpus.length - 1]!
    checks.push(
      check(
        "ledger/newest-is-current",
        newest !== null && newest.presentationDigest === live,
        newest === null ? "the corpus is empty" : `newest ${newest.presentationDigest.slice(7, 19)}… vs live ${live.slice(7, 19)}…`,
      ),
    )
  }
  checks.push(
    check(
      "ledger/deploy-workflow-records",
      input.deployWorkflowRecordsDigest,
      `deploy-web.yml contains the digest-recording step: ${input.deployWorkflowRecordsDigest}`,
    ),
  )
  checks.push(
    check(
      "ledger/deploy-workflow-is-read-only",
      input.deployWorkflowPermissionsReadOnly,
      `deploy-web.yml permissions remain contents: read — ${input.deployWorkflowPermissionsReadOnly}`,
    ),
  )

  // --- 可按 digest 恢复上一版本 --------------------------------------------
  checks.push(check("restore/corpus-non-empty", corpus.length > 0, `${corpus.length} recoverable version(s)`))

  // Distinctness is what makes a digest a restore KEY. Two members sharing one digest
  // would make `restoreByDigest` ambiguous, and an ambiguous restore is a guess.
  const digests = corpus.map((m) => m.presentationDigest)
  checks.push(
    check(
      "restore/digests-distinct",
      new Set(digests).size === digests.length,
      `${new Set(digests).size} distinct digest(s) across ${digests.length} member(s)`,
    ),
  )

  // THE ROUND TRIP, per member. A constant-returning `restoreByDigest` fails every member
  // but one, which is the only control that separates a real restore from a stub that
  // passes by agreeing with itself.
  const roundTripFailures: string[] = []
  for (const member of corpus) {
    const restored = restoreByDigest(corpus, member.presentationDigest)
    if (restored === null) {
      roundTripFailures.push(`${member.commit}: not restorable`)
      continue
    }
    const recomputed = presentationDigest(restored)
    if (recomputed.presentationDigest !== member.presentationDigest) {
      roundTripFailures.push(`${member.commit}: restored to ${recomputed.presentationDigest.slice(7, 19)}…`)
      continue
    }
    // The level digests and the version must survive the trip too — an aggregate-only
    // check would accept a restore that reconstructed the right whole from wrong parts.
    if (
      recomputed.l0Digest !== member.l0Digest ||
      recomputed.l1Digest !== member.l1Digest ||
      recomputed.l2Digest !== member.l2Digest
    ) {
      roundTripFailures.push(`${member.commit}: level digests disagree`)
      continue
    }
    if ((restored.configVersion ?? null) !== member.configVersion) {
      roundTripFailures.push(`${member.commit}: configVersion disagrees`)
    }
  }
  checks.push(
    check(
      "restore/round-trip",
      roundTripFailures.length === 0,
      roundTripFailures.length === 0
        ? `all ${corpus.length} member(s) round-trip: digest → document → same digest`
        : `${roundTripFailures.length} failure(s): ${roundTripFailures.join(" | ")}`,
    ),
  )

  // A refusal, graded. Silently restoring a nearest match would deploy the wrong bytes
  // under the right name — the exact failure a digest exists to prevent.
  const unknown = "sha256:" + "e".repeat(64)
  checks.push(
    check(
      "restore/unknown-digest-refuses",
      restoreByDigest(corpus, unknown) === null && restoreByDigest(corpus, "") === null,
      `an unrecorded digest returns null rather than a nearest match`,
    ),
  )

  // The floor. The oldest member is the pre-catalog state, reached by the same lookup as
  // every other member — no branch, which is what `emptyPresentationDigest`'s docblock
  // asked PR P-7 to preserve.
  {
    const empty = emptyPresentationDigest()
    const oldest = corpus.length === 0 ? null : corpus[0]!
    const restored = restoreByDigest(corpus, empty.presentationDigest)
    checks.push(
      check(
        "restore/empty-predecessor",
        oldest !== null &&
          oldest.document === null &&
          oldest.presentationDigest === empty.presentationDigest &&
          restored !== null &&
          presentationDigest(restored).presentationDigest === empty.presentationDigest,
        oldest === null
          ? "the corpus is empty"
          : `oldest ${oldest.commit} carries ${oldest.document === null ? "no document" : "a document"}, ` +
            `digest ${oldest.presentationDigest.slice(7, 19)}…, restores: ${restored !== null}`,
      ),
    )
  }

  // 上一版本 — "the previous version" must be computable for every member but the floor,
  // and must be undefined for the floor itself. A ledger that is a set rather than a
  // chain cannot answer this, which is why the validator enforces the ordering.
  {
    const missing = corpus.slice(1).filter((m) => previousDeploy(corpus, m.presentationDigest) === null)
    checks.push(
      check(
        "restore/previous-version-defined",
        missing.length === 0 && previousDeploy(corpus, digests[0] ?? "") === null,
        missing.length === 0
          ? `every version but the floor has a computable predecessor; the floor has none`
          : `${missing.length} member(s) without a predecessor: ${list(missing.map((m) => m.commit))}`,
      ),
    )
  }

  return { block: "可回滚性", checks, pass: checks.every((c) => c.pass) }
}

// ---------------------------------------------------------------------------
// The whole harness
// ---------------------------------------------------------------------------

export interface PreviewSnapshotInput {
  readonly configIntegrity: ConfigIntegrityInput
  readonly pageConsistency: PageConsistencyInput
  readonly securityIsolation: SecurityIsolationInput
  readonly visualRegression: VisualRegressionInput
  readonly rollback: RollbackInput
}

/**
 * §14's five block names, in the order `gradePreviewSnapshot` composes them.
 *
 * Exported so a test can assert that `blocks[]` is exactly this list. The artifact wiring
 * in `scripts/preview-snapshot.ts` is POSITIONAL (`result.blocks[0]` … `result.blocks[4]`),
 * so a block appended here without a matching artifact key would be graded and then
 * discarded — failures reaching no reviewable output. This constant is what lets that be
 * a failing test rather than a silent hole.
 */
export const PREVIEW_BLOCK_NAMES = [
  "配置完整性",
  "页面一致性",
  "安全隔离",
  "视觉回归",
  "可回滚性",
] as const

export interface PreviewSnapshotResult {
  readonly blocks: readonly PreviewBlock[]
  readonly visual: VisualRegressionResult
  /** Flat, human-readable failures — the artifact idiom the lock and plane audit use. */
  readonly failures: readonly string[]
  readonly pass: boolean
}

/**
 * Grade all five §14 blocks.
 *
 * `failures[]` rather than `GateMeasure[]`: this artifact is graded by its own
 * `audit:preview:gate` and is not a `GATE_ARTIFACTS` row, so a row-per-check measures
 * array would duplicate gate-H's arithmetic in a second place that could disagree
 * with it.
 */
export function gradePreviewSnapshot(input: PreviewSnapshotInput): PreviewSnapshotResult {
  const configIntegrity = gradeConfigIntegrity(input.configIntegrity)
  const pageConsistency = gradePageConsistency(input.pageConsistency)
  const securityIsolation = gradeSecurityIsolation(input.securityIsolation)
  const visual = gradeVisualRegression(input.visualRegression)
  const rollback = gradeRollback(input.rollback)
  const blocks: PreviewBlock[] = [
    configIntegrity,
    pageConsistency,
    securityIsolation,
    { block: visual.block, checks: visual.checks, pass: visual.pass },
    rollback,
  ]

  const failures: string[] = []
  for (const block of blocks) {
    for (const c of block.checks) {
      if (!c.pass) failures.push(`${block.block} · ${c.id}: ${c.observed}`)
    }
  }

  return { blocks, visual, failures, pass: failures.length === 0 }
}
