// ---------------------------------------------------------------------------
// Workstream P Batch 7 — the preview & snapshot harness (new15 §14 PR P-6).
//
// §14 declared four acceptance-gate blocks and nothing ran them: 配置完整性 · 页面一致性 ·
// 安全隔离 · 视觉回归. `previewSnapshot.ts` is the pure half that grades them; this suite
// grades the grader.
//
// The discipline throughout: every check gets a NEGATIVE CONTROL. A block that only ever
// sees passing input cannot distinguish "measured and correct" from "measured nothing",
// and a harness whose failure path was never executed is a harness whose failure path may
// not work. So each mutation must fail BY NAME — the check id is asserted, not merely
// `pass === false`, because a mutation that trips a different check would otherwise read
// as success.
//
// Two controls are load-bearing beyond the rest:
//
//   • CROSS-PARTITION INEQUALITY. `structuralSignature` collapsed to a constant would
//     satisfy "identical within a partition" perfectly while measuring nothing. The
//     inequality is the only assertion that separates a real signature from one that
//     agrees with itself.
//   • THE 530 px BOUNDARY. `predictCtaColumns` is the WHOLE of the viewport dependency in
//     a stylesheet with zero `@media`, so the reflow transition is crossed in BOTH
//     directions rather than sampled on one side. 452 px of content + 40 px body padding
//     + 38 px of `.install-disposition` chrome. That last term was missing until the model
//     was corrected, which put the predicted flip at 492 against a browser-observed 530;
//     a regression test now pins the whole [492, 529] window that used to be wrong.
//
// The corpus is the five canonical fixtures, not the served tree: measured, the 19 served
// pages carry exactly ONE structural signature and two verdicts, so grading route
// consistency against them would pass while never exercising BLOCK, UNKNOWN or
// UNSUPPORTED.
//
// PURE — no filesystem, no clock. Everything the blocks need arrives as a parameter,
// which is what makes the four §14 blocks testable without running a bake.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import {
  AGENT_GUIDANCE,
  CANONICAL_FIXTURES,
  CONDITIONAL_SITES,
  CTA_REFLOW_RULES,
  CTA_ROUTE_PARTITIONS,
  DEEP_LINK_STATES,
  DEFAULT_GROUP_ORDER,
  EMPTY_PRESENTATION_CONTENT,
  LEVEL_BY_SECTION,
  MAX_DECISION_AUTHORITY_FACTS,
  PRESENTATION_CONTENT_VERSION,
  PREVIEW_BLOCK_NAMES,
  PRIMARY_CTA,
  PUBLISHER_INJECTION_BLURBS,
  WIRED_SLOTS,
  canonicalProjection,
  ctaRoutePartition,
  emptyPresentationDigest,
  evaluateHumanCapsule,
  gradeConfigIntegrity,
  gradePageConsistency,
  gradePreviewSnapshot,
  gradeRollback,
  gradeSecurityIsolation,
  gradeVisualRegression,
  predictCtaColumns,
  presentationDigest,
  previousDeploy,
  renderSafeInstall,
  renderedForms,
  restoreByDigest,
  signatureConditionals,
  structuralSignature,
  validatePresentationContent,
  type ConfigIntegrityInput,
  type InjectionSample,
  type PageSample,
  type PresentationContentV1,
  type PreviewBlock,
  type RollbackCorpusMember,
  type RollbackInput,
  type SecurityIsolationInput,
  type SentinelSample,
  type VisualRegressionInput,
} from "../../src/index.js"

// ---------------------------------------------------------------------------
// Shared corpus — the five canonical states, rendered once with publisher text
// present so the quarantined block is exercised rather than skipped.
// ---------------------------------------------------------------------------

const PUBLISHER_TEXT = "Publisher-supplied marketing blurb."

const pages: readonly PageSample[] = CANONICAL_FIXTURES.map((f) => {
  const projection = canonicalProjection(f, PUBLISHER_TEXT)
  const html = renderSafeInstall(projection)
  return {
    id: f.id,
    installability: projection.installability,
    projection,
    html,
    capsule: evaluateHumanCapsule(projection, html),
  }
})

/** Which check ids failed — asserted directly, so a control cannot pass by tripping another check. */
const failedIds = (block: PreviewBlock): readonly string[] =>
  block.checks.filter((c) => !c.pass).map((c) => c.id)

/** One check's `observed` string, for asserting that a result NAMES its measurement. */
const observedOf = (block: PreviewBlock, id: string): string =>
  block.checks.find((c) => c.id === id)?.observed ?? `<no such check: ${id}>`

const deepLinked = pages.filter(
  (p) => ctaRoutePartition(p.installability) === CTA_ROUTE_PARTITIONS.deepLinked,
)
const docsPrimary = pages.filter(
  (p) => ctaRoutePartition(p.installability) === CTA_ROUTE_PARTITIONS.docsPrimary,
)

describe("preview harness — corpus preconditions", () => {
  it("spans one fixture per installability, so no state is graded by proxy", () => {
    expect(pages).toHaveLength(5)
    expect(new Set(pages.map((p) => p.installability)).size).toBe(5)
  })

  it("splits 2 deep-linked / 3 docs-primary, derived from the renderer's own predicate", () => {
    expect(deepLinked).toHaveLength(2)
    expect(docsPrimary).toHaveLength(3)
    // The partition must READ `DEEP_LINK_STATES` rather than restate it: a hand-kept copy
    // could fall out of step with the branch it claims to describe, and the version
    // asserting agreement would be the wrong one.
    for (const p of pages) {
      const expected = DEEP_LINK_STATES.has(p.installability)
        ? CTA_ROUTE_PARTITIONS.deepLinked
        : CTA_ROUTE_PARTITIONS.docsPrimary
      expect(ctaRoutePartition(p.installability)).toBe(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// 视觉回归 — the reflow arithmetic and its boundary
// ---------------------------------------------------------------------------

describe("视觉回归 — predictCtaColumns", () => {
  const twoColumnFloor = 2 * CTA_REFLOW_RULES.ctaMinTrack + CTA_REFLOW_RULES.ctaGap
  /* The viewport at which that content floor is first met. Derived from the constants, not
   * typed as a literal, so a stylesheet edit moves the assertion with the rule instead of
   * reding a test that is still describing the shipped page correctly. The chrome term is
   * the one that was missing: the row lives inside `section.install-disposition`, so the
   * viewport must also pay for that section's padding and border. */
  const viewportFloor =
    twoColumnFloor +
    CTA_REFLOW_RULES.bodyHorizontalPadding +
    CTA_REFLOW_RULES.dispositionHorizontalChrome

  it("crosses the 530 px boundary in BOTH directions", () => {
    expect(twoColumnFloor).toBe(452)
    /* 452 of content + 40 body padding + 38 disposition chrome. Independently observed in a
     * real browser at 530, which is the check on the arithmetic — the 38 is READ from
     * `.install-disposition { padding: 18px; border: 1px }`, not fitted to this number. */
    expect(viewportFloor).toBe(530)
    expect(predictCtaColumns(390, 2)).toBe(1)
    expect(predictCtaColumns(768, 2)).toBe(2)
    expect(predictCtaColumns(1280, 2)).toBe(2)
    // Exactly at the boundary it fits; one pixel under, it does not. Sampling one side
    // only would pass for a predictor with the comparison inverted.
    expect(predictCtaColumns(viewportFloor, 2)).toBe(2)
    expect(predictCtaColumns(viewportFloor - 1, 2)).toBe(1)
  })

  /*
   * REGRESSION LOCK on the divergence this pass closed.
   *
   * The model used to compute from `vp − 40`, ignoring the 38 px of chrome on the section
   * that wraps the row. It therefore reported two columns from viewport 492 while the
   * browser flipped at 530 — a 38 px window in which every graded artifact recorded a
   * column count the page never had. The failure was silent: the three graded viewports
   * (390/768/1280) all sit outside the window and agreed either way.
   *
   * These assertions are inside the window, which is the only place the two models differ.
   */
  it("reports one column across the whole [492, 529] window the old model got wrong", () => {
    for (const vp of [492, 493, 500, 515, 529]) {
      expect(predictCtaColumns(vp, 2), `viewport ${vp} must be 1 column`).toBe(1)
    }
    expect(predictCtaColumns(530, 2)).toBe(2)
  })

  it("is bounded by the item count — a grid cannot make columns out of nothing", () => {
    // At 1280 the width admits two tracks, so 0/1 items are bounded by the item count and
    // not by the width. That is the direction this test exists to pin.
    expect(predictCtaColumns(1280, 0)).toBe(0)
    expect(predictCtaColumns(1280, 1)).toBe(1)
    expect(predictCtaColumns(1280, 2)).toBe(2)
  })

  /*
   * The usable measure inside `main` is 720 − 38 = 682, and three tracks need
   * 3 × 220 + 2 × 12 = 684. It misses by two pixels, so `main` tops out at TWO columns
   * however many items are supplied and however wide the window is.
   *
   * This is a consequence of the chrome correction, not an independent claim: before it,
   * the model measured against 720 and reported three. Two pixels is uncomfortably close,
   * so the boundary is asserted from the constants rather than the literal 682/684 — a
   * future gap or track change moves both sides together.
   */
  it("tops out at two columns inside main — the cap is main's width, not the viewport", () => {
    const threeTrackFloor = 3 * CTA_REFLOW_RULES.ctaMinTrack + 2 * CTA_REFLOW_RULES.ctaGap
    const usableInsideMain =
      CTA_REFLOW_RULES.mainMaxWidth - CTA_REFLOW_RULES.dispositionHorizontalChrome
    expect(threeTrackFloor).toBe(684)
    expect(usableInsideMain).toBe(682)
    expect(usableInsideMain).toBeLessThan(threeTrackFloor)

    // Same answer at 760 (exactly main + body padding) and at 4000: past the cap the
    // viewport stops being an input at all. A predictor that measured the screen instead
    // of `main` would diverge between these two.
    for (const items of [3, 4, 12]) {
      expect(predictCtaColumns(4000, items), `${items} items at 4000`).toBe(2)
      expect(
        predictCtaColumns(
          CTA_REFLOW_RULES.mainMaxWidth + CTA_REFLOW_RULES.bodyHorizontalPadding,
          items,
        ),
        `${items} items at the cap`,
      ).toBe(2)
    }
  })
})

// ---------------------------------------------------------------------------
// 页面一致性 — the signature, its partition, and the collapse control
// ---------------------------------------------------------------------------

describe("页面一致性 — structuralSignature", () => {
  it("is identical within a partition and DIFFERENT across partitions", () => {
    const deepSignatures = new Set(deepLinked.map((p) => structuralSignature(p.html)))
    const docsSignatures = new Set(docsPrimary.map((p) => structuralSignature(p.html)))
    expect(deepSignatures.size, `deep-linked holds ${deepSignatures.size} signatures`).toBe(1)
    expect(docsSignatures.size, `docs-primary holds ${docsSignatures.size} signatures`).toBe(1)
    expect([...deepSignatures][0]).not.toBe([...docsSignatures][0])
  })

  it("passes the whole block on the shipped corpus", () => {
    const block = gradePageConsistency({ pages })
    expect(failedIds(block)).toEqual([])
    expect(block.pass).toBe(true)
  })

  it("NEGATIVE — a signature collapsed to a constant fails the cross-partition check", () => {
    // The load-bearing control. Identical HTML across both partitions is what a
    // constant-returning signature looks like from the inside: within-partition identity
    // is perfect, and only the inequality notices.
    const collapsed = pages.map((p) => ({ ...p, html: deepLinked[0]!.html }))
    const block = gradePageConsistency({ pages: collapsed })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("partition/signatures-differ")
    expect(observedOf(block, "partition/signatures-differ")).toContain("collapsed signature")
  })

  it("NEGATIVE — swapping a page between partitions breaks within-partition identity", () => {
    // A deep-linked page's bytes served under a docs-primary state: the route says one
    // structure, the markup says the other.
    const swapped = pages.map((p) => (p === docsPrimary[0] ? { ...p, html: deepLinked[0]!.html } : p))
    const block = gradePageConsistency({ pages: swapped })
    expect(block.pass).toBe(false)
    const id = `partition/${CTA_ROUTE_PARTITIONS.docsPrimary}/one-signature`
    expect(failedIds(block)).toContain(id)
    expect(observedOf(block, id)).toContain("distinct signatures")
  })

  it("NEGATIVE — a one-sided corpus fails rather than passing with nothing to compare", () => {
    const block = gradePageConsistency({ pages: deepLinked })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("partition/both-populated")
  })

  it("keeps conditional sections OUT of the compared signature but RECORDED", () => {
    for (const p of pages) {
      const recorded = signatureConditionals(p.html)
      expect(recorded).toHaveLength(CONDITIONAL_SITES.length)
      for (const site of CONDITIONAL_SITES) {
        expect(recorded.some((r) => r === `${site.cls}=present` || r === `${site.cls}=absent`)).toBe(
          true,
        )
        // Recorded, never compared: presence is a function of the PROJECTION, so folding it
        // into a route-level comparison would fail on correct behaviour.
        expect(structuralSignature(p.html)).not.toContain(site.cls)
      }
    }
  })

  it("asserts each conditional site against the projection condition that produced it", () => {
    const block = gradePageConsistency({ pages })
    // Every page × every site is named individually, so no variance is tolerated without a
    // check standing behind it.
    for (const p of pages) {
      for (const site of CONDITIONAL_SITES) {
        const id = `conditional/${p.id}/${site.cls}`
        expect(block.checks.some((c) => c.id === id), `missing ${id}`).toBe(true)
      }
      expect(block.checks.some((c) => c.id === `authority-shape/${p.id}`)).toBe(true)
    }
  })

  it("NEGATIVE — every conditional site fails by name when presence contradicts its predicate", () => {
    // Injecting a conditional class into a page whose predicate says ABSENT must fail — that is
    // the whole reason these four sites are asserted per page instead of folded into the
    // signature. The target page is DERIVED per site rather than hardcoded: measured,
    // `install-canonical` and `install-publisher` hold on all 5 canonical fixtures (every one
    // sets `canonicalName !== displayName` and carries publisher text), so a control naming
    // either of them would find no absent page and grade nothing. `install-reason-empty` is
    // absent on 3 fixtures and `install-alt-route` on 1.
    //
    // A site with no absent fixture is therefore SKIPPED with its reason recorded, not silently
    // passed over — and the loop asserts at least one site was actually exercised, so the day a
    // fixture change makes every site total, this control fails instead of quietly measuring
    // nothing.
    const exercised: string[] = []
    for (const site of CONDITIONAL_SITES) {
      const target = pages.find((p) => !site.holds(p.projection))
      if (target === undefined) continue // total across the corpus — nothing to contradict
      const mutated = pages.map((p) =>
        p === target
          ? { ...p, html: p.html.replace("<main", `<main><span class="${site.cls}">x</span>`) }
          : p,
      )
      const block = gradePageConsistency({ pages: mutated })
      expect(block.pass, `${site.cls} injected into ${target.id} but the block passed`).toBe(false)
      expect(failedIds(block)).toContain(`conditional/${target.id}/${site.cls}`)
      exercised.push(site.cls)
    }
    expect(
      exercised.length,
      "no conditional site is absent on any fixture — this control graded nothing",
    ).toBeGreaterThan(0)
  })

  it("records each conditional site's presence in agreement with its own predicate", () => {
    // `signatureConditionals` RECORDS presence while the signature omits it. If the recorded
    // presence and the predicate could disagree, the artifact would document one thing while the
    // checks graded another — so the two are compared directly, on real rendered bytes.
    for (const p of pages) {
      const recorded = signatureConditionals(p.html)
      for (const site of CONDITIONAL_SITES) {
        const expected = `${site.cls}=${site.holds(p.projection) ? "present" : "absent"}`
        expect(recorded, `${p.id} · ${site.cls}`).toContain(expected)
      }
    }
  })

  it("NEGATIVE — the empty-authority shape appearing with non-empty reason codes fails", () => {
    const target = pages.find(
      (p) => p.projection.agentContract.publicObservation.reasonCodes.length > 0,
    )!
    const mutated = pages.map((p) =>
      p === target
        ? { ...p, html: p.html.replace("<main", '<main><p class="install-reason-empty">x</p>') }
        : p,
    )
    const block = gradePageConsistency({ pages: mutated })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain(`authority-shape/${target.id}`)
  })

  it("NEGATIVE — a second primary CTA fails the reused capsule check", () => {
    const target = pages[0]!
    const html = target.html.replace("<main", '<main><a class="install-cta" href="/x">y</a>')
    const mutated = pages.map((p) =>
      p === target
        ? { ...p, html, capsule: evaluateHumanCapsule(target.projection, html) }
        : p,
    )
    const block = gradePageConsistency({ pages: mutated })
    expect(block.pass).toBe(false)
    expect(
      failedIds(block).some(
        (id) => id.endsWith("exactly-one-primary-cta") || id.endsWith("one-cta-scheme"),
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 配置完整性 — totality, raw-byte duplicates, and the graded threshold
// ---------------------------------------------------------------------------

/** A passing config-integrity input, so each control perturbs exactly one field. */
function configInput(over: Partial<ConfigIntegrityInput> = {}): ConfigIntegrityInput {
  return {
    catalog: { duplicateKeys: [], unwiredSlots: [], rejectedSlots: [] },
    hostCopy: [
      { host: "claude-code", label: "Claude Code", artifactPath: "p", uninstallCommand: "u" },
    ],
    vocabularies: {
      guardHostIds: ["claude-code"],
      ruleHosts: ["claude-code", "cursor"],
      hostAdapters: ["claude-code"],
    },
    installabilityStates: pages.map((p) => p.installability),
    declaredMaxAuthorityFacts: MAX_DECISION_AUTHORITY_FACTS,
    measuredAuthorityFactCounts: pages.map((p) => ({
      id: p.id,
      facts: p.projection.authorityDecisionFacts.length,
    })),
    ...over,
  }
}

describe("配置完整性", () => {
  it("passes on the shipped domains", () => {
    const block = gradeConfigIntegrity(configInput())
    expect(failedIds(block)).toEqual([])
    expect(block.pass).toBe(true)
  })

  it("records the measurement on a PASS, not only on a failure", () => {
    const block = gradeConfigIntegrity(configInput())
    const observed = observedOf(block, "threshold/max-authority-facts-graded")
    // A green check showing `declared 5; measured …=5` is reviewable; a bare green is
    // indistinguishable from a check that measured an empty corpus.
    expect(observed).toContain(`declared ${MAX_DECISION_AUTHORITY_FACTS}`)
    for (const p of pages) expect(observed).toContain(p.id)
    expect(block.checks.every((c) => c.observed !== "")).toBe(true)
  })

  it("NEGATIVE — restoring §14's 3-fact cap fails, because the fixtures measure 5", () => {
    // Why the cap was INVERTED rather than deleted: the number is graded now, and the
    // measurement proves a 3 is unsatisfiable rather than merely stale.
    const block = gradeConfigIntegrity(configInput({ declaredMaxAuthorityFacts: 3 }))
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("threshold/max-authority-facts-graded")
    expect(observedOf(block, "threshold/max-authority-facts-graded")).toContain("declared 3")
  })

  it("NEGATIVE — an empty corpus fails rather than passing vacuously", () => {
    const block = gradeConfigIntegrity(configInput({ measuredAuthorityFactCounts: [] }))
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("threshold/max-authority-facts-graded")
  })

  it("NEGATIVE — a corpus leaving an Installability unexercised fails by name", () => {
    // `CTA_DOC_HREF`'s domain comes from `PRIMARY_CTA`'s keys, NOT from the corpus, so
    // dropping a fixture cannot silently shrink the domain being graded.
    const block = gradeConfigIntegrity(
      configInput({ installabilityStates: pages.slice(1).map((p) => p.installability) }),
    )
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("domain-total/cta-corpus-covers-every-state")
    expect(observedOf(block, "domain-total/cta-corpus-covers-every-state")).toContain(
      pages[0]!.installability,
    )
  })

  it("grades the five compiler-total domains by enumeration", () => {
    const block = gradeConfigIntegrity(configInput())
    for (const id of [
      "domain-total/verdict-public-label",
      "domain-total/reason-code-meta",
      "domain-total/authority-consequences",
      "domain-total/cta-doc-href",
      "domain-total/must-ask-sentence",
    ]) {
      expect(block.checks.find((c) => c.id === id)?.pass, id).toBe(true)
    }
  })

  it("holds MUST_ASK_TOKENS and AGENT_GUIDANCE.mustAskBefore to ONE list", () => {
    // The compiler is the load-bearing check (`MUST_ASK_SENTENCE` is a total
    // `Record<MustAskToken, string>` over the exported list `mustAskBefore` references).
    // This is its reviewable restatement.
    const block = gradeConfigIntegrity(configInput())
    expect(observedOf(block, "domain-total/must-ask-sentence")).toContain(
      "references the same list",
    )
    expect(AGENT_GUIDANCE.mustAskBefore.length).toBeGreaterThan(0)
  })

  it("NEGATIVE — a duplicate catalog key fails; a parsed check would be blind to it", () => {
    // `JSON.parse` collapses true duplicates last-wins, which is why the script measures
    // this over raw bytes.
    const block = gradeConfigIntegrity(
      configInput({
        catalog: { duplicateKeys: ["/agentRelayCopy/adds"], unwiredSlots: [], rejectedSlots: [] },
      }),
    )
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("catalog/no-duplicate-keys")
    expect(observedOf(block, "catalog/no-duplicate-keys")).toContain("/agentRelayCopy/adds")
  })

  it("NEGATIVE — a slot that validates and reaches nothing fails by name", () => {
    const block = gradeConfigIntegrity(
      configInput({
        catalog: { duplicateKeys: [], unwiredSlots: ["agentRelayCopy.adds"], rejectedSlots: [] },
      }),
    )
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("catalog/no-unwired-slots")
  })

  it("NEGATIVE — a rejected slot fails, so a refusal is never silent", () => {
    const block = gradeConfigIntegrity(
      configInput({
        catalog: { duplicateKeys: [], unwiredSlots: [], rejectedSlots: ["overrides.resources.x"] },
      }),
    )
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("catalog/no-rejected-slots")
  })

  it("NEGATIVE — an incomplete guard host fails and names the host", () => {
    const block = gradeConfigIntegrity(
      configInput({
        hostCopy: [{ host: "claude-code", label: "", artifactPath: "p", uninstallCommand: "u" }],
      }),
    )
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("host-copy/complete")
    expect(observedOf(block, "host-copy/complete")).toContain("claude-code")
  })

  it("NEGATIVE — an empty host-copy plane fails rather than reading as complete", () => {
    const block = gradeConfigIntegrity(configInput({ hostCopy: [] }))
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("host-copy/complete")
  })

  it("records the three-way host vocabulary split rather than demanding it agree", () => {
    // The install plane names no host at all — adding host copy to the page would add
    // served bytes — so the split is RECORDED with its intersections, not closed.
    const observed = observedOf(gradeConfigIntegrity(configInput()), "host-copy/vocabulary-split")
    expect(observed).toContain("guard=1")
    expect(observed).toContain("rule=2")
    expect(observed).toContain("adapter=1")
  })
})

// ---------------------------------------------------------------------------
// 安全隔离 — the three zero-counts that had no grader
// ---------------------------------------------------------------------------

const ROUTE_KEY = "PREPARE_AVAILABLE|SAFE|prompt-injection"
const SENTINEL_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

/** A passing security-isolation input; each control perturbs exactly one sample. */
function securityInput(over: Partial<SecurityIsolationInput> = {}): SecurityIsolationInput {
  const injections: InjectionSample[] = pages.map((p, i) => ({
    fixtureId: p.id,
    blurb: PUBLISHER_INJECTION_BLURBS[i % PUBLISHER_INJECTION_BLURBS.length] as string,
    html: p.html,
    agentGuidance: JSON.parse(JSON.stringify(AGENT_GUIDANCE)),
    routeKey: ROUTE_KEY,
  }))
  const sentinels: SentinelSample[] = pages.map((p) => ({
    fixtureId: p.id,
    baselineSemanticDigest: SENTINEL_DIGEST,
    sentinelSemanticDigest: SENTINEL_DIGEST,
    baselineRouteKey: ROUTE_KEY,
    sentinelRouteKey: ROUTE_KEY,
    sentinelReachedSurface: true,
    baselineFreeOfSentinel: true,
  }))
  const baselineRouteKeys: Record<string, string> = {}
  for (const p of pages) baselineRouteKeys[p.id] = ROUTE_KEY
  return { injections, sentinels, baselineRouteKeys, ...over }
}

describe("安全隔离", () => {
  it("passes on the shipped corpus with every injection blurb reprojected", () => {
    const block = gradeSecurityIsolation(securityInput())
    expect(failedIds(block)).toEqual([])
    expect(block.pass).toBe(true)
  })

  it("NEGATIVE — a publisher blurb rendered into a decision group fails by name", () => {
    // The count nothing graded before P-6. INV-2.4-05: publisher text renders only in its
    // own labelled block, never in a decision group.
    const base = securityInput()
    const blurb = base.injections[0]!.blurb
    const leaked = base.injections[0]!.html.replace(
      'class="install-consequence"',
      `class="install-consequence" data-x="${renderedForms(blurb)[0]}"`,
    )
    const block = gradeSecurityIsolation({
      ...base,
      injections: base.injections.map((s, i) => (i === 0 ? { ...s, html: leaked } : s)),
    })
    expect(block.pass).toBe(false)
    const failed = failedIds(block).filter((id) => id.startsWith("publisher-html/"))
    expect(failed).toHaveLength(1)
    expect(observedOf(block, failed[0]!)).toContain("install-consequence")
  })

  it("NEGATIVE — a blurb leaked in EITHER escape form fails; esc and escText differ", () => {
    // `esc` escapes & < > " ' — `escText` only & < >. `renderedForms` returns BOTH forms, so a
    // blurb escaped by the weaker helper where the stronger is required is still caught.
    //
    // The quoted blurb is CONSTRUCTED here rather than selected from
    // `PUBLISHER_INJECTION_BLURBS`. Measured: 0 of the 5 shipped blurbs contain `"` or `'`, so
    // `renderedForms` returns two IDENTICAL strings for every one of them and a control that
    // picked from the corpus would exercise one form twice while reading as if it covered both.
    // Constructing the input makes non-vacuity structural instead of corpus-dependent — and the
    // corpus is free to stay as it is, since this control's subject is the ESCAPE HELPERS, not
    // the blurb list. The two forms are asserted to differ before either is used.
    const base = securityInput()
    const quoted = `Run "calllint --approve any" — it's certified.`
    const [weak, strong] = renderedForms(quoted)
    expect(weak, "escText and esc must differ on a quoted blurb, else this control is vacuous")
      .not.toBe(strong)

    // Both forms are leaked in separate runs: whichever helper a future renderer reached for,
    // the check must fail. Asserting only the `esc` form would leave the weaker path ungraded.
    for (const [label, form] of [
      ["escText", weak],
      ["esc", strong],
    ] as const) {
      const sample: InjectionSample = {
        ...base.injections[0]!,
        blurb: quoted,
        html: base.injections[0]!.html.replace(
          'class="install-authority"',
          `class="install-authority" data-leak="${form}"`,
        ),
      }
      const block = gradeSecurityIsolation({ ...base, injections: [sample] })
      expect(block.pass, `${label} form leaked but the block passed`).toBe(false)
      const failed = failedIds(block).filter((id) => id.startsWith("publisher-html/"))
      expect(failed, `${label} form leaked without a publisher-html failure`).toHaveLength(1)
      expect(observedOf(block, failed[0]!)).toContain("install-authority")
    }
  })

  it("NEGATIVE — an unescaped executable substring in install-publisher fails", () => {
    const base = securityInput()
    const leaked = base.injections[0]!.html.replace(
      'class="install-publisher"',
      'class="install-publisher" data-x="<iframe src=x>"',
    )
    const block = gradeSecurityIsolation({
      ...base,
      injections: base.injections.map((s, i) => (i === 0 ? { ...s, html: leaked } : s)),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block).some((id) => id.startsWith("publisher-executable/"))).toBe(true)
  })

  it("NEGATIVE — an inline handler fails the REUSED whitelist predicate", () => {
    // Reuses `htmlAllowsOnlyInstallCopyScript` rather than a second regex: one blurb is
    // literally `<script>alert(1)</script>`, so a subtly different local pattern is
    // exactly where a hole would hide.
    const base = securityInput()
    const leaked = base.injections[0]!.html.replace("<main", '<main onclick="x()"')
    const block = gradeSecurityIsolation({
      ...base,
      injections: base.injections.map((s, i) => (i === 0 ? { ...s, html: leaked } : s)),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block).some((id) => id.startsWith("publisher-script-whitelist/"))).toBe(true)
  })

  it("NEGATIVE — a hostile publisher string moving the decision route fails", () => {
    const base = securityInput()
    const block = gradeSecurityIsolation({
      ...base,
      injections: base.injections.map((s, i) =>
        i === 0 ? { ...s, routeKey: "BLOCKED|BLOCK|prompt-injection" } : s,
      ),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block).some((id) => id.startsWith("publisher-route/"))).toBe(true)
  })

  it("NEGATIVE — a missing baseline route key fails instead of comparing against nothing", () => {
    const block = gradeSecurityIsolation({ ...securityInput(), baselineRouteKeys: {} })
    expect(block.pass).toBe(false)
    const failed = failedIds(block).filter((id) => id.startsWith("publisher-route/"))
    expect(failed).toHaveLength(pages.length)
    expect(observedOf(block, failed[0]!)).toContain("vacuous")
  })

  it("NEGATIVE — configured copy reaching a protocol trigger fails (ADR 0058 §6)", () => {
    // Relay copy may never add or remove a `mustAskBefore` / `mustStopWhen` trigger.
    const base = securityInput()
    const tampered = JSON.parse(JSON.stringify(AGENT_GUIDANCE)) as { mustAskBefore: string[] }
    tampered.mustAskBefore = [...tampered.mustAskBefore, "injected_trigger"]
    const block = gradeSecurityIsolation({
      ...base,
      injections: base.injections.map((s, i) => (i === 0 ? { ...s, agentGuidance: tampered } : s)),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block).some((id) => id.startsWith("agent-guidance/"))).toBe(true)
  })

  it("NEGATIVE — a DROPPED protocol trigger fails too, not only an added one", () => {
    // A shared-key comparison is blind to a removed key; deep-equality is not.
    const base = securityInput()
    const tampered = JSON.parse(JSON.stringify(AGENT_GUIDANCE)) as { mustStopWhen: string[] }
    tampered.mustStopWhen = tampered.mustStopWhen.slice(1)
    const block = gradeSecurityIsolation({
      ...base,
      injections: base.injections.map((s, i) => (i === 0 ? { ...s, agentGuidance: tampered } : s)),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block).some((id) => id.startsWith("agent-guidance/"))).toBe(true)
  })

  it("NEGATIVE — configured copy moving the semantic contract digest fails", () => {
    // Both sides are derived through the SAME constructor from a sentinel: a hardcoded
    // literal cannot detect its own subject changing.
    const base = securityInput()
    const block = gradeSecurityIsolation({
      ...base,
      sentinels: base.sentinels.map((s, i) =>
        i === 0 ? { ...s, sentinelSemanticDigest: "sha256:moved" } : s,
      ),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain(`semantic-digest/${pages[0]!.id}`)
  })

  it("NEGATIVE — a sentinel that reached NO surface fails, so the invariance cannot be vacuous", () => {
    // The defect negative control #13 actually found, and it was in the harness rather than in
    // the subject: the sentinel document was derived from `EMPTY_PRESENTATION_CONTENT`
    // (`{schema, locale}`), so "replace every string leaf" filled nothing. Both sides then
    // resolved to the shipped defaults, every digest matched, and the block passed while
    // measuring a value against itself. Counting samples cannot see that — only a witness that
    // the sentinel is observable downstream can, which is what this grades.
    const base = securityInput()
    const block = gradeSecurityIsolation({
      ...base,
      sentinels: base.sentinels.map((s, i) => (i === 0 ? { ...s, sentinelReachedSurface: false } : s)),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain(`sentinel-reached/${pages[0]!.id}`)
    expect(observedOf(block, `sentinel-reached/${pages[0]!.id}`)).toContain("reached no surface")
  })

  it("NEGATIVE — a baseline that ALREADY contains the sentinel fails, since absence proves nothing", () => {
    // The other half of the witness. If the sentinel string is present in the baseline too,
    // "present in the reprojection" is not evidence the configured plane reached anything.
    const base = securityInput()
    const block = gradeSecurityIsolation({
      ...base,
      sentinels: base.sentinels.map((s, i) => (i === 0 ? { ...s, baselineFreeOfSentinel: false } : s)),
    })
    expect(block.pass).toBe(false)
    expect(observedOf(block, `sentinel-reached/${pages[0]!.id}`)).toContain("BASELINE")
  })

  it("NEGATIVE — an empty digest on both sides fails rather than matching itself", () => {
    const base = securityInput()
    const block = gradeSecurityIsolation({
      ...base,
      sentinels: base.sentinels.map((s) => ({
        ...s,
        baselineSemanticDigest: "",
        sentinelSemanticDigest: "",
      })),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block).some((id) => id.startsWith("semantic-digest/"))).toBe(true)
  })

  it("NEGATIVE — sentinel copy moving the decision route fails", () => {
    const base = securityInput()
    const block = gradeSecurityIsolation({
      ...base,
      sentinels: base.sentinels.map((s, i) =>
        i === 0 ? { ...s, sentinelRouteKey: "BLOCKED|BLOCK|" } : s,
      ),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain(`semantic-route/${pages[0]!.id}`)
  })

  it("NEGATIVE — an empty corpus fails rather than reporting clean zero-counts", () => {
    const block = gradeSecurityIsolation({ injections: [], sentinels: [], baselineRouteKeys: {} })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("injection/non-vacuous")
    expect(failedIds(block)).toContain("sentinel/non-vacuous")
  })
})

// ---------------------------------------------------------------------------
// 视觉回归 — the block, including the zero-@media assertion
// ---------------------------------------------------------------------------

const BASELINE_CSS = [
  ":root{--ink:#111;--gap:12px}",
  "body{padding:32px 20px;color:var(--ink)}",
  "main{max-width:720px;margin:0 auto}",
].join("\n")

/** A passing visual-regression input, built from the classes the corpus actually emits. */
function visualInput(over: Partial<VisualRegressionInput> = {}): VisualRegressionInput {
  // Every emitted class gets a rule, so the coverage check has a real subject:
  // `emittedInstallClasses` is derived from the bytes, which is why coverage cannot drift
  // away from what is rendered.
  const emitted = new Set<string>()
  for (const p of pages) {
    for (const m of p.html.matchAll(/class="([^"]+)"/g)) {
      for (const c of (m[1] as string).split(/\s+/)) if (c.startsWith("install-")) emitted.add(c)
    }
  }
  const css = [BASELINE_CSS, ...[...emitted].sort().map((c) => `.${c}{gap:var(--gap)}`)].join("\n")
  const tokens = [
    { name: "--ink", value: "#111" },
    { name: "--gap", value: "12px" },
  ]
  const ctaRowItems: Record<string, number> = {}
  for (const p of pages) {
    ctaRowItems[p.id] =
      ctaRoutePartition(p.installability) === CTA_ROUTE_PARTITIONS.deepLinked ? 2 : 1
  }
  return {
    stylesheets: [
      { path: "apps/web/styles/tokens.css", css, tokens },
      { path: "apps/web/public/styles/tokens.css", css, tokens },
    ],
    pages,
    ctaRowItems,
    ...over,
  }
}

describe("视觉回归", () => {
  it("passes on a matched stylesheet pair", () => {
    const block = gradeVisualRegression(visualInput())
    expect(failedIds(block)).toEqual([])
    expect(block.pass).toBe(true)
  })

  it("records one observation per state × viewport", () => {
    const block = gradeVisualRegression(visualInput())
    expect(block.observations).toHaveLength(pages.length * 3)
    expect(new Set(block.observations.map((o) => o.viewport))).toEqual(new Set([390, 768, 1280]))
    expect(block.declarationCoverage).toHaveLength(pages.length)
  })

  it("NEGATIVE — an @media block fails, because the flat parser cannot see nesting", () => {
    // Two problems in one mutation, and that is the point: `resolveDeclarations` is a flat
    // rule walk, so `@media` would BOTH mis-parse and spend a served-byte license this
    // batch does not have.
    const base = visualInput()
    const block = gradeVisualRegression({
      ...base,
      stylesheets: base.stylesheets.map((s, i) =>
        i === 0 ? { ...s, css: `${s.css}\n@media (min-width:600px){body{padding:0}}` } : s,
      ),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("stylesheet/apps/web/styles/tokens.css/no-media-queries")
  })

  it("NEGATIVE — the source and served copies resolving differently fails", () => {
    const base = visualInput()
    const block = gradeVisualRegression({
      ...base,
      stylesheets: base.stylesheets.map((s, i) =>
        i === 1
          ? { ...s, tokens: [{ name: "--ink", value: "#222" }, { name: "--gap", value: "12px" }] }
          : s,
      ),
    })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("stylesheet/copies-resolve-identically")
  })

  it("NEGATIVE — a single stylesheet copy fails; there is nothing to compare against", () => {
    const base = visualInput()
    const block = gradeVisualRegression({ ...base, stylesheets: base.stylesheets.slice(0, 1) })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("stylesheet/copies-resolve-identically")
  })

  it("NEGATIVE — an emitted class nothing styles fails, and names the class", () => {
    const base = visualInput()
    const stripped = base.stylesheets.map((s) => ({
      ...s,
      css: s.css.replace(".install-cta{gap:var(--gap)}\n", ""),
    }))
    const block = gradeVisualRegression({ ...base, stylesheets: stripped })
    expect(block.pass).toBe(false)
    const failed = failedIds(block).filter((id) => id.startsWith("declarations/"))
    expect(failed.length).toBeGreaterThan(0)
    expect(observedOf(block, failed[0]!)).toContain("install-cta")
  })

  it("NEGATIVE — no page holding ≥2 CTA items makes the reflow check vacuous", () => {
    // Measured: only the two deep-linked states carry a multi-item row. If that ever drops
    // to zero the prediction is still computed but tests nothing, so it must fail.
    const ctaRowItems: Record<string, number> = {}
    for (const p of pages) ctaRowItems[p.id] = 1
    const block = gradeVisualRegression({ ...visualInput(), ctaRowItems })
    expect(block.pass).toBe(false)
    expect(failedIds(block)).toContain("reflow/non-vacuous")
  })

  it("asserts the boundary crossing per multi-item page, not only globally", () => {
    const block = gradeVisualRegression(visualInput())
    for (const p of deepLinked) {
      const id = `reflow/${p.id}/crosses-boundary`
      expect(block.checks.find((c) => c.id === id)?.pass, id).toBe(true)
      expect(observedOf(block, id)).toContain("390px ⇒ 1 column(s)")
    }
  })
})

// ---------------------------------------------------------------------------
// 可回滚性 — §14's fifth block (PR P-7)
// ---------------------------------------------------------------------------
//
// The corpus here is SYNTHETIC and that is deliberate. `scripts/preview-snapshot.ts`
// builds the real 8-member corpus from `git show`; this suite proves the grader over
// documents it constructs, which is the whole payoff of taking the corpus as a parameter:
// the round-trip is testable without a repository, and therefore also on CI's depth-1
// clone where the historical blobs do not exist at all.
//
// The load-bearing control is `restore/round-trip` under a CONSTANT `restoreByDigest`.
// A stub that returns the newest document for every input satisfies "restorable" and
// "distinct" and only fails the round trip — on every member but one. That asymmetry is
// the only thing separating a real restore from a lookup that agrees with itself.

/**
 * Documents that differ in each of the three levels plus identity, so no digest collides.
 *
 * Each successive entry moves a DIFFERENT level, which is what makes the round trip a real
 * test rather than four comparisons of the same shape: [0] moves L1 off the empty document,
 * [1] moves L0 by introducing `tokens`, [2] moves L1 again, [3] moves the AGGREGATE ONLY by
 * adding the identity key.
 *
 * `[0]` must NOT be the bare `{schema, locale}` pair. That pair is exactly
 * `EMPTY_PRESENTATION_CONTENT`, so its digest equals the floor member's and the corpus
 * silently acquires a duplicate — measured: `restore/digests-distinct` and
 * `restore/previous-version-defined` both fail, the latter because `findIndex` on a
 * duplicated digest resolves to the FLOOR and that member then has no computable
 * predecessor. The grader was right and the fixture was wrong; the collision is left
 * described here because a future edit could reintroduce it in one keystroke.
 */
const ROLLBACK_DOCS: readonly PresentationContentV1[] = [
  { schema: PRESENTATION_CONTENT_VERSION, locale: "en-US", sectionTitles: { valueLine: "Install with evidence" } },
  {
    schema: PRESENTATION_CONTENT_VERSION,
    locale: "en-US",
    sectionTitles: { valueLine: "Install with evidence" },
    tokens: { tokensVersion: "r-one" },
  },
  {
    schema: PRESENTATION_CONTENT_VERSION,
    locale: "en-US",
    tokens: { tokensVersion: "r-two" },
    layout: { groupOrder: [...DEFAULT_GROUP_ORDER], maxSecondaryLinks: 2 },
  },
  {
    schema: PRESENTATION_CONTENT_VERSION,
    locale: "en-US",
    tokens: { tokensVersion: "r-two" },
    layout: { groupOrder: [...DEFAULT_GROUP_ORDER], maxSecondaryLinks: 2 },
    configVersion: "2026.08.01-p7",
  },
]

const rollbackCorpus = (): RollbackCorpusMember[] => {
  const empty = emptyPresentationDigest()
  const floor: RollbackCorpusMember = {
    commit: "aaaaaaa",
    at: "2026-07-01T00:00:00Z",
    presentationDigest: empty.presentationDigest,
    l0Digest: empty.l0Digest,
    l1Digest: empty.l1Digest,
    l2Digest: empty.l2Digest,
    configVersion: null,
    sections: empty.sections,
    document: null,
  }
  return [
    floor,
    ...ROLLBACK_DOCS.map((document, i) => {
      const d = presentationDigest(document)
      return {
        commit: `c${String(i)}${"0".repeat(6)}`,
        at: `2026-07-0${String(i + 2)}T00:00:00Z`,
        presentationDigest: d.presentationDigest,
        l0Digest: d.l0Digest,
        l1Digest: d.l1Digest,
        l2Digest: d.l2Digest,
        configVersion: document.configVersion ?? null,
        sections: d.sections,
        document,
      }
    }),
  ]
}

const LIVE_DOC = ROLLBACK_DOCS[ROLLBACK_DOCS.length - 1]!

const rollbackInput = (over: Partial<RollbackInput> = {}): RollbackInput => ({
  corpus: rollbackCorpus(),
  liveDocument: LIVE_DOC,
  ledgerFaults: [],
  ledgerEntryCount: 5,
  deployWorkflowRecordsDigest: true,
  deployWorkflowPermissionsReadOnly: true,
  // The schema's property list is FILE data, so it arrives as a parameter here exactly as
  // it does in production. `scripts/preview-snapshot.ts` passes the real
  // `schemas/calllint.presentation-content.v1.schema.json` keys; this suite passes a list
  // whose only graded property is that `configVersion` is in it, keeping the module pure.
  schemaPropertyNames: [...Object.keys(LEVEL_BY_SECTION), "schema", "locale", "configVersion"],
  validatorKnownKeys: [...Object.keys(LEVEL_BY_SECTION), "schema", "locale", "configVersion"],
  resolverSlotNames: Object.values(WIRED_SLOTS).flat() as readonly string[],
  // Run through the REAL validator, not a hand-written list: the claim is that a prose
  // version is rejected by the shipped rule, and a literal `["config-version"]` here could
  // not detect the rule being deleted. `forbiddenPhrases: []` is sufficient and honest —
  // that context field feeds the overclaim rule, which this document does not touch.
  malformedVersionRules: validatePresentationContent(
    { ...EMPTY_PRESENTATION_CONTENT, configVersion: "August 2026 rebuild" },
    { verdictLabels: VERDICT_PUBLIC_LABEL, stateCtas: PRIMARY_CTA, forbiddenPhrases: [] },
  ).map((e) => e.rule),
  // Served pages that do NOT carry the version — the shipped state. Non-empty on purpose:
  // an empty list is graded as a vacuous search, asserted separately below.
  servedInstallPages: [
    { slug: "mcp-registry/a", html: "<!doctype html><meta name=\"robots\" content=\"index,follow\" />" },
    { slug: "mcp-registry/b", html: "<!doctype html><h1>Add a thing with CallLint</h1>" },
  ],
  ...over,
})

describe("gradeRollback — 有版本", () => {
  it("passes on a catalog carrying a machine version, and names it", () => {
    const block = gradeRollback(rollbackInput())
    expect(block.pass, JSON.stringify(failedIds(block))).toBe(true)
    expect(block.block).toBe("可回滚性")
    expect(observedOf(block, "version/present")).toContain("2026.08.01-p7")
  })

  it("NEGATIVE — a catalog with no configVersion fails present, by name", () => {
    const { configVersion: _drop, ...noVersion } = LIVE_DOC
    const block = gradeRollback(rollbackInput({ liveDocument: noVersion as PresentationContentV1 }))
    expect(failedIds(block)).toContain("version/present")
    expect(observedOf(block, "version/present")).toContain("no configVersion")
  })

  it("NEGATIVE — a prose version fails the non-prose pattern (control #6)", () => {
    const block = gradeRollback(
      rollbackInput({ liveDocument: { ...LIVE_DOC, configVersion: "August 2026 rebuild" } }),
    )
    expect(failedIds(block)).toContain("version/non-prose")
  })

  it("NEGATIVE — undeclared in the schema, or unknown to the validator, each fail by name", () => {
    expect(failedIds(gradeRollback(rollbackInput({ schemaPropertyNames: ["schema", "locale"] })))).toContain(
      "version/declared-in-schema",
    )
    expect(failedIds(gradeRollback(rollbackInput({ validatorKnownKeys: ["schema", "locale"] })))).toContain(
      "version/accepted-by-validator",
    )
  })

  it("NEGATIVE — a validator that ACCEPTS a prose version fails malformed-is-rejected", () => {
    // The check that stops the pattern from being decorative: without it, a validator
    // could stop enforcing the shape and every other version check would still pass.
    const block = gradeRollback(rollbackInput({ malformedVersionRules: [] }))
    expect(failedIds(block)).toContain("version/malformed-is-rejected")
  })

  it("NEGATIVE — wiring the version as a resolver slot fails (control #7)", () => {
    const block = gradeRollback(
      rollbackInput({ resolverSlotNames: [...Object.values(WIRED_SLOTS).flat(), "configVersion"] }),
    )
    expect(failedIds(block)).toContain("version/not-a-resolver-slot")
  })

  // --- control #21, as a graded check rather than a habit ---------------------
  //
  // #21 was RUN and it exposed a gap: a `<meta>` tag carrying the catalog's configVersion
  // drifted all 19 served pages, yet 900 trust-index tests, `check:public-copy`, the plane
  // audit, the lock's `configuredCopy` containment (it searches only the 9 guard/relay
  // slots) and all five gate-H blocks stayed green. `git status -- apps/web/public/` was
  // the only detector — and that is a reviewer's habit, silent on a stale tree and
  // re-baselined by every `:write`. These three tests are that habit turned into a check.

  it("passes when no served page carries the version, and says how many it searched", () => {
    const block = gradeRollback(rollbackInput())
    expect(failedIds(block)).not.toContain("version/reaches-no-served-byte")
    expect(observedOf(block, "version/reaches-no-served-byte")).toContain("searched 2 served page(s)")
    expect(observedOf(block, "version/reaches-no-served-byte")).toContain("hits: none")
  })

  it("NEGATIVE — a served page carrying the version fails, and NAMES the page (control #21)", () => {
    // The mutation #21 actually made: the value in a head <meta>, reached by a renderer
    // reading the document directly — no resolver slot involved, which is why
    // `not-a-resolver-slot` cannot stand in for this check.
    const block = gradeRollback(
      rollbackInput({
        servedInstallPages: [
          { slug: "mcp-registry/a", html: "<!doctype html><meta name=\"robots\" content=\"index,follow\" />" },
          {
            slug: "mcp-registry/leaky",
            html: `<!doctype html><meta name="calllint-config-version" content="${LIVE_DOC.configVersion}" />`,
          },
        ],
      }),
    )
    expect(failedIds(block)).toContain("version/reaches-no-served-byte")
    expect(observedOf(block, "version/reaches-no-served-byte")).toContain("mcp-registry/leaky")
  })

  it("NEGATIVE — an empty corpus of pages is a VACUOUS search, not a pass", () => {
    // Without this, deleting the served tree (or mis-wiring the reader) would make the
    // check above pass by having looked at nothing — the same vacuity trap the lock's
    // containment check guards with its non-empty-strings assertion.
    const block = gradeRollback(rollbackInput({ servedInstallPages: [] }))
    expect(failedIds(block)).toContain("version/reaches-no-served-byte")
    expect(observedOf(block, "version/reaches-no-served-byte")).toContain("vacuous")
  })

  it("grades the identity signature derivationally: the aggregate moves, all three levels hold", () => {
    const block = gradeRollback(rollbackInput())
    expect(observedOf(block, "version/identity-digest-signature")).toBe(
      "aggregate moves: true, l0/l1/l2 hold: true",
    )
    expect(observedOf(block, "version/carries-no-level")).toContain("sections with:")
  })

  it("NEGATIVE — a document whose version changes nothing fails the signature (control #1's shape)", () => {
    // A version that did not reach the digest at all — the failure a levelled or ignored
    // key would produce. Derived through `presentationDigest`, never compared to a literal,
    // so this assertion cannot go blind when the catalog changes.
    const block = gradeRollback(rollbackInput({ liveDocument: ROLLBACK_DOCS[0]! }))
    expect(failedIds(block)).toContain("version/identity-digest-signature")
    expect(observedOf(block, "version/identity-digest-signature")).toContain("aggregate moves: false")
  })
})

describe("gradeRollback — 每次 deploy 记录 presentationDigest", () => {
  it("NEGATIVE — any ledger fault surfaces here, quoted (controls #8/#9)", () => {
    const block = gradeRollback(
      rollbackInput({ ledgerFaults: ["deploys[3] (b5a8818c): recorded l1Digest … != recomputed …"] }),
    )
    expect(failedIds(block)).toContain("ledger/valid")
    expect(observedOf(block, "ledger/valid")).toContain("b5a8818c")
  })

  it("NEGATIVE — an empty ledger fails rather than passing vacuously", () => {
    const block = gradeRollback(rollbackInput({ ledgerEntryCount: 0 }))
    expect(failedIds(block)).toContain("ledger/non-empty")
  })

  it("NEGATIVE — changing the catalog without recording fails newest-is-current (control #10)", () => {
    // §14's second line as an enforceable obligation: the newest recorded document must be
    // the one that exists now.
    const block = gradeRollback(
      rollbackInput({ liveDocument: { ...LIVE_DOC, configVersion: "2026.09.01-unrecorded" } }),
    )
    expect(failedIds(block)).toContain("ledger/newest-is-current")
    expect(observedOf(block, "ledger/newest-is-current")).toContain(" vs live ")
  })

  it("NEGATIVE — dropping the deploy-web.yml step fails the workflow binding (control #11)", () => {
    const block = gradeRollback(rollbackInput({ deployWorkflowRecordsDigest: false }))
    expect(failedIds(block)).toContain("ledger/deploy-workflow-records")
  })

  it("NEGATIVE — a deploy workflow that gained write permission fails (control #18)", () => {
    const block = gradeRollback(rollbackInput({ deployWorkflowPermissionsReadOnly: false }))
    expect(failedIds(block)).toContain("ledger/deploy-workflow-is-read-only")
    expect(observedOf(block, "ledger/deploy-workflow-is-read-only")).toContain("contents: read")
  })
})

describe("gradeRollback — 可按 digest 恢复上一版本", () => {
  it("round-trips every corpus member: digest → document → the same digest", () => {
    const corpus = rollbackCorpus()
    for (const m of corpus) {
      const restored = restoreByDigest(corpus, m.presentationDigest)
      expect(restored, m.commit).not.toBeNull()
      expect(presentationDigest(restored!).presentationDigest, m.commit).toBe(m.presentationDigest)
    }
    const block = gradeRollback(rollbackInput())
    expect(observedOf(block, "restore/round-trip")).toContain(`all ${corpus.length} member(s)`)
  })

  it("NEGATIVE — a CONSTANT restore fails on every member but one (control #12)", () => {
    // The one control that separates a real restore from a stub. Simulated by handing the
    // grader a corpus whose members all claim the newest document: the digests stay
    // distinct, every lookup succeeds, and the round trip fails n-1 times.
    const corpus = rollbackCorpus()
    const constant = corpus.map((m) => ({ ...m, document: LIVE_DOC }))
    const block = gradeRollback(rollbackInput({ corpus: constant, liveDocument: LIVE_DOC }))
    expect(failedIds(block)).toContain("restore/round-trip")
    const observed = observedOf(block, "restore/round-trip")
    expect(observed).toContain(`${corpus.length - 1} failure(s)`)
  })

  it("NEGATIVE — an aggregate-only restore is caught by the level digests", () => {
    // A member whose recorded l1 disagrees with its own document: the aggregate matches,
    // so only the per-level comparison can see it.
    const corpus = rollbackCorpus()
    const damaged = corpus.map((m, i) => (i === 2 ? { ...m, l1Digest: "sha256:" + "f".repeat(64) } : m))
    const block = gradeRollback(rollbackInput({ corpus: damaged }))
    expect(failedIds(block)).toContain("restore/round-trip")
    expect(observedOf(block, "restore/round-trip")).toContain("level digests disagree")
  })

  it("NEGATIVE — a member whose recorded configVersion disagrees with its document fails", () => {
    const corpus = rollbackCorpus()
    const damaged = corpus.map((m, i) => (i === 3 ? { ...m, configVersion: "2026.01.01-wrong" } : m))
    const block = gradeRollback(rollbackInput({ corpus: damaged }))
    expect(failedIds(block)).toContain("restore/round-trip")
    expect(observedOf(block, "restore/round-trip")).toContain("configVersion disagrees")
  })

  it("refuses an unknown digest instead of returning a nearest match (control #13)", () => {
    const corpus = rollbackCorpus()
    expect(restoreByDigest(corpus, "sha256:" + "e".repeat(64))).toBeNull()
    expect(restoreByDigest(corpus, "")).toBeNull()
    // A digest one character off a real one must also refuse — nearest-match is the failure
    // mode a content hash exists to prevent.
    const real = corpus[2]!.presentationDigest
    expect(restoreByDigest(corpus, real.slice(0, -1) + (real.endsWith("a") ? "b" : "a"))).toBeNull()
  })

  it("NEGATIVE — a nearest-match restore fails unknown-digest-refuses", () => {
    // Simulated by a corpus member claiming the sentinel digest: if any lookup answered an
    // unrecorded digest, this check would be the one to name it.
    const corpus = rollbackCorpus()
    const leaky = [...corpus, { ...corpus[1]!, presentationDigest: "sha256:" + "e".repeat(64) }]
    const block = gradeRollback(rollbackInput({ corpus: leaky }))
    expect(failedIds(block)).toContain("restore/unknown-digest-refuses")
  })

  it("resolves the empty predecessor through the corpus, not a branch (control #14)", () => {
    const corpus = rollbackCorpus()
    const empty = emptyPresentationDigest()
    const restored = restoreByDigest(corpus, empty.presentationDigest)
    expect(restored).toEqual(EMPTY_PRESENTATION_CONTENT)
    expect(presentationDigest(restored!).presentationDigest).toBe(empty.presentationDigest)
    const block = gradeRollback(rollbackInput())
    expect(observedOf(block, "restore/empty-predecessor")).toContain("no document")
  })

  it("NEGATIVE — a corpus with no empty floor fails the predecessor check", () => {
    const block = gradeRollback(rollbackInput({ corpus: rollbackCorpus().slice(1) }))
    expect(failedIds(block)).toContain("restore/empty-predecessor")
  })

  it("NEGATIVE — two members sharing a digest make restore ambiguous, and fail", () => {
    const corpus = rollbackCorpus()
    const dup = [...corpus, { ...corpus[2]!, commit: "dddddd0" }]
    const block = gradeRollback(rollbackInput({ corpus: dup }))
    expect(failedIds(block)).toContain("restore/digests-distinct")
  })

  it("computes 上一版本 for every member but the floor", () => {
    const corpus = rollbackCorpus()
    expect(previousDeploy(corpus, corpus[0]!.presentationDigest)).toBeNull()
    for (let i = 1; i < corpus.length; i++) {
      expect(previousDeploy(corpus, corpus[i]!.presentationDigest)?.commit).toBe(corpus[i - 1]!.commit)
    }
    expect(previousDeploy(corpus, "sha256:" + "e".repeat(64))).toBeNull()
    expect(failedIds(gradeRollback(rollbackInput()))).not.toContain("restore/previous-version-defined")
  })

  it("NEGATIVE — an empty corpus fails rather than passing vacuously", () => {
    const block = gradeRollback(rollbackInput({ corpus: [] }))
    expect(failedIds(block)).toContain("restore/corpus-non-empty")
    expect(failedIds(block)).toContain("ledger/newest-is-current")
    expect(failedIds(block)).toContain("restore/empty-predecessor")
  })
})

// ---------------------------------------------------------------------------
// The whole harness
// ---------------------------------------------------------------------------

describe("gradePreviewSnapshot", () => {
  const passing = () => ({
    configIntegrity: configInput(),
    pageConsistency: { pages },
    securityIsolation: securityInput(),
    visualRegression: visualInput(),
    rollback: rollbackInput(),
  })

  it("grades all five §14 blocks and passes on the shipped corpus", () => {
    const result = gradePreviewSnapshot(passing())
    expect(result.failures).toEqual([])
    expect(result.pass).toBe(true)
    expect(result.blocks.map((b) => b.block)).toEqual([
      "配置完整性",
      "页面一致性",
      "安全隔离",
      "视觉回归",
      "可回滚性",
    ])
  })

  it("pins the block order to PREVIEW_BLOCK_NAMES, which the artifact wiring is positional on", () => {
    // `scripts/preview-snapshot.ts` reads `result.blocks[0]` … `blocks[4]` by index, so a
    // block appended without a matching artifact key would be graded and then discarded.
    // Asserting against the exported constant is what makes control #20 a failing test.
    const result = gradePreviewSnapshot(passing())
    expect(result.blocks.map((b) => b.block)).toEqual([...PREVIEW_BLOCK_NAMES])
    expect(result.blocks).toHaveLength(PREVIEW_BLOCK_NAMES.length)
  })

  it("flattens a rollback failure into `failures[]` under its own block name", () => {
    const result = gradePreviewSnapshot({
      ...passing(),
      rollback: rollbackInput({ deployWorkflowRecordsDigest: false }),
    })
    expect(result.pass).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain("可回滚性")
    expect(result.failures[0]).toContain("ledger/deploy-workflow-records")
  })

  it("flattens a failure into `failures[]` with its block, id and measurement", () => {
    const result = gradePreviewSnapshot({
      ...passing(),
      configIntegrity: configInput({ declaredMaxAuthorityFacts: 3 }),
    })
    expect(result.pass).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain("配置完整性")
    expect(result.failures[0]).toContain("threshold/max-authority-facts-graded")
    expect(result.failures[0]).toContain("declared 3")
  })

  it("carries the visual block's observations alongside the flat blocks", () => {
    // The visual block appears in `blocks` as a plain PreviewBlock AND in `visual` with its
    // observations, so the artifact records the reflow without grading it twice.
    const result = gradePreviewSnapshot(passing())
    expect(result.visual.observations).toHaveLength(pages.length * 3)
    expect(result.blocks[3]!.checks).toEqual(result.visual.checks)
  })
})
