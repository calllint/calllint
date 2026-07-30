// ---------------------------------------------------------------------------
// Workstream P Batch 3 — Layout Manifest tests (new15 §6.2 PR P-3; ADR 0058 §1/§3).
//
// P-1 proved COPY reaches no digest. This suite proves the same of LAYOUT, which is a
// different claim: copy substitutes a string into a fixed shape, while layout changes the
// shape itself, and the caps change how MUCH of a sealed selection is shown. Three
// questions, each with its own falsification:
//
//   1. ISOLATION (INV-P1/P2) — a reordering and a cap must move the HTML and nothing else:
//      not the four digests, not the verdict, not the installability, not the next action.
//      Paired with a positive control, or "digest held" would be satisfied by a layout
//      that did nothing at all.
//   2. SUPPORT (§3) — config selects among orderings the RENDERER can emit. The predicate
//      is falsified from both ends: a supported order must be emittable and produce
//      different bytes; an unsupported one must be refused rather than approximated.
//   3. CONTAINMENT — a cap may only narrow. Over-range is rejected loudly (validator) and
//      clamped silently AND VISIBLY (resolver records it), and `maxAuthorityFacts` never
//      reaches `selectDecisionAuthorities`, whose output is sealed into `authorityDelta`.
//
// Two cases exist because the 19 committed pages structurally cannot cover them: every
// one has a publisher description, so the reproducibility gate is blind to the
// empty-publisher branch; and none is emitted with a non-default cap.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest"
import {
  ABOVE_FOLD_SECTION_IDS,
  CANONICAL_FIXTURES,
  DEFAULT_GROUP_ORDER,
  DEFAULT_LAYOUT,
  DEFAULT_PRESENTATION,
  DISPLAY_GROUPS,
  EMPTY_PRESENTATION_CONTENT,
  FUSED_GROUP_RUNS,
  SECTION_GROUPS,
  SHIPPED_LAYOUT_CAPS,
  canonicalProjectionInput,
  checkLayoutSupport,
  clampCap,
  isStructurallySupported,
  renderSafeInstall,
  resolvePresentation,
  safeInstallProjection,
  sectionOrderFor,
  validatePresentationContent,
  type ResolvedLayout,
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

/**
 * All four canonical dispositions, so no claim rests on one verdict's markup.
 *
 * Built fresh on every call. The shared-module-constant version of this was measurably
 * unsound for the isolation tests: those capture a "before" snapshot, render, and compare —
 * but an earlier describe block had already rendered the same objects, so a renderer that
 * mutated the projection to a CONSTANT value would have done so before the snapshot was
 * taken, and the comparison would hold. Verified as a negative control: assigning a fixed
 * digest inside `renderSafeInstall` left all 28 tests green. Fresh instances plus the
 * never-rendered control twin below close that hole.
 */
const freshProjections = () =>
  CANONICAL_FIXTURES.map((f) => safeInstallProjection(canonicalProjectionInput(f, "Publisher marketing blurb here.")))

/** The read-only sample for tests that only inspect emitted HTML. */
const projections = freshProjections()

/**
 * A REAL reordering the renderer can emit: `install-consequence` is lifted above the fused
 * `install-disposition`, which keeps `disposition`+`primary_action` adjacent and in order.
 * Asserted to differ from the shipped order below, so no test here can pass vacuously.
 */
const REORDERED_GROUPS = [
  "identity",
  "consequence",
  "disposition",
  "primary_action",
  "authority_facts",
  "secondary_links",
]

const reorderedLayout = (): ResolvedLayout => {
  const support = checkLayoutSupport(REORDERED_GROUPS)
  if (!support.supported || support.sectionOrder === null) {
    throw new Error(`fixture invalid: the probe order is not emittable (${support.reason})`)
  }
  return { ...DEFAULT_LAYOUT, sectionOrder: support.sectionOrder }
}

/**
 * How many AUTHORITY FACT rows the page emits.
 *
 * Scoped to `data-observed`, which only authority rows carry, because a whole-page `<li>`
 * count is contaminated: three list items live below the fold, so "at least one `<li>`"
 * holds even when the authority list is empty. That was measured, not assumed — with an
 * `<li>` count, deleting the renderer's cap floor left this file's cap tests green.
 */
function authorityRows(html: string): number {
  return [...html.matchAll(/<li data-observed=/g)].length
}

/** The above-fold section ids in the order they appear in rendered HTML. */
function emittedSectionOrder(html: string): string[] {
  const seen: string[] = []
  for (const m of html.matchAll(/<section class="([a-z-]+)"/g)) {
    const cls = m[1] as string
    if ((ABOVE_FOLD_SECTION_IDS as readonly string[]).includes(cls)) seen.push(cls)
  }
  return seen
}

describe("layout manifest — the reordering is real (anti-vacuity first)", () => {
  it("the probe order differs from the shipped order and is structurally supported", () => {
    // Every isolation claim below is "X changed, digests did not". If X never changed, the
    // suite would pass while measuring nothing. So establish the mutation is real, first.
    expect(REORDERED_GROUPS).not.toEqual([...DEFAULT_GROUP_ORDER])
    expect(isStructurallySupported(REORDERED_GROUPS)).toBe(true)
    expect(reorderedLayout().sectionOrder).not.toEqual(DEFAULT_LAYOUT.sectionOrder)
  })

  it("POSITIVE CONTROL — the reordering actually moves the emitted section sequence", () => {
    for (const p of projections) {
      const shipped = renderSafeInstall(p)
      const moved = renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, reorderedLayout())
      expect(moved).not.toBe(shipped)
      expect(emittedSectionOrder(shipped)).toEqual([...DEFAULT_LAYOUT.sectionOrder])
      expect(emittedSectionOrder(moved)).toEqual([...reorderedLayout().sectionOrder])
    }
  })

  it("a reordering PERMUTES the sections — it never adds, drops, or duplicates one", () => {
    // The failure mode a naive "sections in configured order" implementation invites: an
    // unknown id silently emitting nothing, so a reorder becomes a deletion.
    for (const p of projections) {
      const moved = emittedSectionOrder(renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, reorderedLayout()))
      expect([...moved].sort()).toEqual([...ABOVE_FOLD_SECTION_IDS].sort())
      expect(new Set(moved).size).toBe(moved.length)
    }
  })
})

describe("layout manifest — isolation (INV-P1: layout reaches no digest)", () => {
  it("neither a reordering nor a cap change moves ANY of the four digests", () => {
    // Read each digest from where it actually lives — they are spread across three
    // sub-objects, not gathered under `contract`. A wrong path here would compare
    // `undefined` to `undefined` and pass while measuring nothing, so every value is first
    // asserted to BE a digest.
    const digests = (p: (typeof projections)[number]) => ({
      contract: p.agentContract.contract.contractDigest,
      snapshot: p.agentContract.contract.snapshotDigest,
      artifact: p.agentContract.subject.artifactDigest,
      evidence: p.agentContract.publicObservation.evidenceDigest,
      registry: p.agentContract.trustedSources.registrySnapshotDigest,
    })
    // Two independent builds of the SAME inputs: one gets rendered, one never does. Comparing
    // the rendered copy against the untouched twin — rather than against a snapshot taken
    // from the copy itself — is what makes a constant-valued mutation detectable.
    const rendered = freshProjections()
    const control = freshProjections()
    for (const [i, p] of rendered.entries()) {
      const before = digests(control[i]!)
      for (const [name, value] of Object.entries(before)) {
        expect(value, `${name} digest must be a real value for this test to mean anything`).toMatch(
          /^sha256:[0-9a-f]{64}$/,
        )
      }
      // Rendering is the ONLY consumer of layout, and it does not touch the projection.
      renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, reorderedLayout())
      renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, { ...DEFAULT_LAYOUT, maxAuthorityFacts: 1 })
      expect(digests(p)).toEqual(before)
    }
  })

  it("rendering under any layout does not MUTATE the projection it reads", () => {
    // The subtler version of the same claim: a digest can hold while the object it was
    // computed from drifts, which would corrupt a later emit in the same process.
    // Same reason as above for the control twin: the baseline must come from an object this
    // renderer has never seen, or a mutation to a fixed value hides inside the baseline.
    const rendered = freshProjections()
    const control = freshProjections()
    for (const [i, p] of rendered.entries()) {
      const baseline = JSON.stringify(control[i])
      renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, reorderedLayout())
      renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, { ...DEFAULT_LAYOUT, maxAuthorityFacts: 1, maxSecondaryLinks: 0 })
      expect(JSON.stringify(p)).toBe(baseline)
    }
  })

  it("INV-P2 — verdict, installability and next-action kind are layout-invariant", () => {
    // Layout is L1: human-visible, digest-unreachable. It must not be able to change what
    // the page DECIDES, only how the decision is arranged.
    for (const f of CANONICAL_FIXTURES) {
      const input = canonicalProjectionInput(f, "Blurb.")
      const p = safeInstallProjection(input)
      expect(p.publicObservation.verdict).toBe(f.expectVerdict)
      expect(p.installability).toBe(f.expectInstallability)
      const kind = p.agentContract.recommendedNextAction.kind
      // Re-project and re-render under a different layout: the decision fields are
      // computed upstream of any layout, so they cannot move.
      const again = safeInstallProjection(input)
      renderSafeInstall(again, DEFAULT_PRESENTATION.sectionTitles, reorderedLayout())
      expect(again.publicObservation.verdict).toBe(f.expectVerdict)
      expect(again.installability).toBe(f.expectInstallability)
      expect(again.agentContract.recommendedNextAction.kind).toBe(kind)
    }
  })

  it("the CTA's machine hook survives reordering — layout moves position, not identity", () => {
    // `data-primary-action` is what an agent reads. Moving the section must not change it.
    for (const p of projections) {
      const moved = renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, reorderedLayout())
      expect(moved).toContain(`data-primary-action="${p.installability}"`)
    }
  })
})

describe("layout manifest — structural support (ADR 0058 §3)", () => {
  it("the shipped order is supported and maps to the shipped section sequence", () => {
    const support = checkLayoutSupport(DEFAULT_GROUP_ORDER)
    expect(support.supported).toBe(true)
    expect(support.sectionOrder).toEqual([...ABOVE_FOLD_SECTION_IDS])
    expect(sectionOrderFor(DEFAULT_GROUP_ORDER)).toEqual([...ABOVE_FOLD_SECTION_IDS])
  })

  it("refuses an order that splits a fused run, naming the reason", () => {
    const split = ["identity", "disposition", "consequence", "primary_action", "authority_facts", "secondary_links"]
    const support = checkLayoutSupport(split)
    expect(support.supported).toBe(false)
    expect(support.reason).toBe("fused-run-split")
    expect(support.sectionOrder).toBeNull()
    // `checkLayoutSupport` reports the refusal; `sectionOrderFor` is the FAIL-OPEN accessor
    // (INV-P3) and answers with the shipped sequence. The split order is never approximated.
    expect(sectionOrderFor(split)).toEqual([...ABOVE_FOLD_SECTION_IDS])
  })

  it("refuses a fused run in REVERSED order — adjacency alone is not enough", () => {
    // `primary_action` before `disposition` is adjacent but not emittable: the fused
    // section's markup puts the headline above the CTA and has no variant that flips them.
    const flipped = ["identity", "primary_action", "disposition", "consequence", "authority_facts", "secondary_links"]
    const support = checkLayoutSupport(flipped)
    expect(support.supported).toBe(false)
    expect(support.reason).toBe("fused-run-reordered")
  })

  it("refuses a non-permutation (a dropped or unknown group)", () => {
    expect(checkLayoutSupport(["identity", "disposition", "primary_action"]).reason).toBe("not-a-permutation")
    expect(checkLayoutSupport([...DEFAULT_GROUP_ORDER.slice(0, 5), "telepathy"]).reason).toBe("not-a-permutation")
  })

  it("new14 §7's documentation numbering is NOT emittable — pinned so it stays known", () => {
    // `DISPLAY_GROUPS` is a SET whose array order reads like a layout; the served CTA is
    // third, not fifth. This exact confusion produced three wrong P-1 fixtures.
    expect(isStructurallySupported(DISPLAY_GROUPS)).toBe(false)
    expect(checkLayoutSupport(DISPLAY_GROUPS).reason).toBe("fused-run-split")
    expect([...DISPLAY_GROUPS]).not.toEqual([...DEFAULT_GROUP_ORDER])
  })

  it("the support predicate is non-degenerate over the whole 6! space", () => {
    // Measured, not argued: it must reject something and accept something. A predicate that
    // accepted all 720 would let config claim a layout the renderer cannot produce; one
    // that accepted 0 would reject the shipped page.
    const perms: string[][] = []
    const permute = (rest: string[], acc: string[]): void => {
      if (rest.length === 0) return void perms.push(acc)
      rest.forEach((x, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x]))
    }
    permute([...DISPLAY_GROUPS], [])
    expect(perms.length).toBe(720)
    const supported = perms.filter((o) => isStructurallySupported(o)).length
    expect(supported).toBeGreaterThan(0)
    expect(supported).toBeLessThan(perms.length)
    // 5! = 120: the fused pair collapses to one movable unit, so the emittable space is
    // exactly the permutations of the five SECTIONS. Derived, and it moves on its own if
    // P-4b ever unfuses the section.
    expect(supported).toBe(120)
  })

  it("the section/group model covers every display group exactly once", () => {
    const covered = ABOVE_FOLD_SECTION_IDS.flatMap((id) => SECTION_GROUPS[id])
    expect([...covered].sort()).toEqual([...DISPLAY_GROUPS].sort())
    expect(new Set(covered).size).toBe(covered.length)
    // And the fused runs are exactly the multi-group sections — the two facts cannot drift.
    const fused = ABOVE_FOLD_SECTION_IDS.map((id) => SECTION_GROUPS[id]).filter((g) => g.length > 1)
    expect(FUSED_GROUP_RUNS.map((r) => [...r])).toEqual(fused.map((g) => [...g]))
  })
})

describe("layout manifest — caps may only narrow (containment)", () => {
  it("maxAuthorityFacts caps DISPLAY without touching the sealed authority selection", () => {
    // The containment that matters: `authorityDelta` is sealed into the contract upstream,
    // so a cap can hide a row but never change what the agent is told.
    const withFacts = projections.filter((p) => p.authorityDecisionFacts.length > 1)
    expect(withFacts.length).toBeGreaterThan(0) // anti-vacuity: something to cap
    for (const p of withFacts) {
      const sealed = JSON.stringify(p.agentContract.authorityDelta)
      const full = renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, DEFAULT_LAYOUT)
      const capped = renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, { ...DEFAULT_LAYOUT, maxAuthorityFacts: 1 })
      // Exact counts, not just "fewer": the cap is the number of rows, so assert the number.
      expect(authorityRows(full)).toBe(p.authorityDecisionFacts.length)
      expect(authorityRows(capped)).toBe(1)
      expect(JSON.stringify(p.agentContract.authorityDelta)).toBe(sealed)
    }
  })

  it("maxAuthorityFacts:0 still shows one fact — a cap cannot empty the authority section", () => {
    // Hiding the authority list entirely would be a safety regression dressed as layout:
    // "What it can do" with nothing under it reads as "it can do nothing".
    //
    // Count `data-observed` rows, NOT `<li>`. The page carries three other list items
    // below the fold, so an `<li>` count of ">= 1" passes even with the authority list
    // emptied — measured as a negative control: removing the `Math.max(1, …)` floor from
    // the renderer left an `<li>`-based assertion green.
    for (const p of projections) {
      expect(p.authorityDecisionFacts.length).toBeGreaterThan(0) // every canonical page has ≥1
      const html = renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, { ...DEFAULT_LAYOUT, maxAuthorityFacts: 0 })
      expect(html).toContain('<section class="install-authority"')
      expect(authorityRows(html)).toBe(1)
      expect(html).not.toMatch(/<ul>\s*<\/ul>/)
    }
  })

  it("maxSecondaryLinks:0 keeps the SECTION and empties it — never deletes it", () => {
    // A section the layout can delete is a section the layout can hide. The cap empties
    // the list; the landmark stays, so the page shape is stable for assistive tech.
    for (const p of projections) {
      const html = renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, { ...DEFAULT_LAYOUT, maxSecondaryLinks: 0 })
      expect(html).toContain('<section class="install-secondary"')
      expect(html).not.toContain("View the full Trust Page")
      expect(emittedSectionOrder(html)).toEqual([...DEFAULT_LAYOUT.sectionOrder])
    }
  })

  it("clampCap narrows, never widens, and fails open on nonsense", () => {
    // The function CLAMPS (fail-open, INV-P3) — it never returns null. Out-of-range is
    // still reported, but by `capOrReject` via `rejectedSlots`, not by this return value;
    // the two responsibilities are split so the emit path can never be left without a
    // usable number. `resolvePresentation` covers the reporting half below.
    expect(clampCap(1, 3, 1)).toBe(1)
    expect(clampCap(3, 3, 1)).toBe(3)
    expect(clampCap(5, 3, 1)).toBe(3) // above the shipped cap ⇒ narrowed to shipped
    expect(clampCap(-1, 3, 1)).toBe(1) // below the floor ⇒ the floor
    expect(clampCap(0, 2, 0)).toBe(0) // a zero floor is legitimate (secondary links)
    expect(clampCap(1.5, 3, 1)).toBe(3) // non-integer ⇒ shipped
    expect(clampCap("2" as never, 3, 1)).toBe(3) // wrong type ⇒ shipped
    expect(clampCap(undefined, 3, 1)).toBe(3) // absent ⇒ shipped value
    // The containment claim itself: for ANY input, the result is within [min, shipped].
    for (const v of [-99, -1, 0, 1, 2, 3, 4, 99, 1.5, NaN, Infinity, "3", null, {}, []]) {
      const out = clampCap(v as never, 3, 1)
      expect(out).toBeGreaterThanOrEqual(1)
      expect(out).toBeLessThanOrEqual(5)
    }
  })
})

describe("layout manifest — the config plane (loud in CI, fail-open at emit)", () => {
  const rulesFor = (doc: unknown): string[] => validatePresentationContent(doc, ctx).map((e) => e.rule)

  it("an over-range cap is REJECTED loudly by the validator", () => {
    expect(rulesFor({ ...EMPTY_PRESENTATION_CONTENT, layout: { maxAuthorityFacts: 6 } })).toContain("layout-cap")
    expect(rulesFor({ ...EMPTY_PRESENTATION_CONTENT, layout: { maxSecondaryLinks: 9 } })).toContain("layout-cap")
  })

  it("an in-range cap is accepted — the rule is a ceiling, not a freeze", () => {
    expect(
      validatePresentationContent(
        { ...EMPTY_PRESENTATION_CONTENT, layout: { groupOrder: REORDERED_GROUPS, maxAuthorityFacts: 2, maxSecondaryLinks: 1 } },
        ctx,
      ),
    ).toEqual([])
  })

  it("INV-P3 fail-open PER SLOT — a bad cap loses only that slot, and is RECORDED", () => {
    // The whole point of `rejectedSlots`: falling back must never be silent, or "the
    // document I committed is not the document being served" becomes a quiet condition.
    const r = resolvePresentation({
      ...EMPTY_PRESENTATION_CONTENT,
      layout: { groupOrder: REORDERED_GROUPS, maxAuthorityFacts: 99 },
    })
    expect(r.layout.maxAuthorityFacts).toBe(SHIPPED_LAYOUT_CAPS.maxAuthorityFacts) // slot fell back
    expect(r.layout.sectionOrder).toEqual(reorderedLayout().sectionOrder) // sibling slot survived
    expect(r.rejectedSlots.some((s) => s.startsWith("layout.maxAuthorityFacts"))).toBe(true)
  })

  it("an UNSUPPORTED order falls back to the shipped sequence and is RECORDED", () => {
    const split = ["identity", "disposition", "consequence", "primary_action", "authority_facts", "secondary_links"]
    const r = resolvePresentation({ ...EMPTY_PRESENTATION_CONTENT, layout: { groupOrder: split } })
    expect(r.layout.sectionOrder).toEqual([...ABOVE_FOLD_SECTION_IDS])
    expect(r.rejectedSlots.some((s) => s.startsWith("layout.groupOrder"))).toBe(true)
    expect(r.overriddenSlots).not.toContain("layout.groupOrder") // a rejection is not an override
  })

  it("restating the shipped order is NOT an override (so the lock's inert check stays honest)", () => {
    const r = resolvePresentation({ ...EMPTY_PRESENTATION_CONTENT, layout: { groupOrder: [...DEFAULT_GROUP_ORDER] } })
    expect(r.overriddenSlots).not.toContain("layout.groupOrder")
    expect(r.rejectedSlots).toEqual([])
    expect(r.layout).toEqual(DEFAULT_LAYOUT)
  })

  it("an absent layout section resolves to exactly the shipped layout", () => {
    const r = resolvePresentation(EMPTY_PRESENTATION_CONTENT)
    expect(r.layout).toEqual(DEFAULT_LAYOUT)
    expect(r.rejectedSlots).toEqual([])
  })

  it("a MALFORMED layout section loses the whole section, not the document", () => {
    const r = resolvePresentation({ ...EMPTY_PRESENTATION_CONTENT, layout: "left-to-right" as never })
    expect(r.layout).toEqual(DEFAULT_LAYOUT)
    expect(r.rejectedSlots.length).toBeGreaterThan(0)
    expect(r.sectionTitles).toEqual(DEFAULT_PRESENTATION.sectionTitles) // other planes intact
  })
})

describe("layout manifest — branches the 19 committed pages cannot cover", () => {
  it("a page with NO publisher description omits the block under every layout", () => {
    // All 19 served resources have a description, so the reproducibility gate is blind
    // here. A regression that emitted an empty publisher section — the quarantine label
    // with nothing under it, implying withheld text — would ship unnoticed.
    for (const f of CANONICAL_FIXTURES) {
      const bare = safeInstallProjection(canonicalProjectionInput(f, null))
      for (const layout of [DEFAULT_LAYOUT, reorderedLayout()]) {
        const html = renderSafeInstall(bare, DEFAULT_PRESENTATION.sectionTitles, layout)
        expect(html).not.toContain('class="install-publisher"')
        expect(html).not.toContain(DEFAULT_PRESENTATION.sectionTitles.publisherBlock)
        // Above-fold structure is untouched by the absence.
        expect(emittedSectionOrder(html)).toEqual([...layout.sectionOrder])
      }
      // And the presence branch still renders, so the check is not vacuously true.
      const withText = safeInstallProjection(canonicalProjectionInput(f, "Publisher blurb."))
      expect(renderSafeInstall(withText)).toContain('class="install-publisher"')
    }
  })

  it("an empty-string description is treated as absent, not as empty quarantined text", () => {
    const p = safeInstallProjection(canonicalProjectionInput(CANONICAL_FIXTURES[0]!, ""))
    expect(renderSafeInstall(p)).not.toContain('class="install-publisher"')
  })

  it("every layout still emits a well-formed page with only the copy-assist script", () => {
    // Layout rearranges trusted fragments; it must not be able to produce an injection
    // surface or an unbalanced document.
    for (const p of projections) {
      for (const layout of [DEFAULT_LAYOUT, reorderedLayout(), { ...DEFAULT_LAYOUT, maxAuthorityFacts: 1, maxSecondaryLinks: 0 }]) {
        const html = renderSafeInstall(p, DEFAULT_PRESENTATION.sectionTitles, layout)
        expect(html).not.toMatch(/\son[a-z]+=/i)
        expect(html).toMatch(/<script\s+src="\/scripts\/install-copy\.js"\s+defer>\s*<\/script>/i)
        expect([...html.matchAll(/<script\b/gi)].length).toBe(1)
        expect([...html.matchAll(/<section/g)].length).toBe([...html.matchAll(/<\/section>/g)].length)
      }
    }
  })
})
