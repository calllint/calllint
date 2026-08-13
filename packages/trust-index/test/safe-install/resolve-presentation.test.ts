/**
 * Workstream P Batch 2 — tests for the presentation RESOLVER and the COMMITTED copy
 * catalog (new15 §6.2 PR P-2; ADR 0058 §2/§3/§4/§5).
 *
 * P-2's central claim is a byte claim: "lifting this copy into `apps/web/content/**`
 * changes no served byte." A claim like that is worth nothing asserted and everything
 * measured, so this file measures it four ways and then tries to break each one:
 *
 *   IDENTITY   — the committed document resolves DEEP-EQUAL to the shipped defaults,
 *                and the full emit through the configured path is byte-identical to the
 *                emit through the default path. Not "equivalent"; identical.
 *   INV-P1     — configured copy cannot reach `contractDigest` (nor any of the other
 *                three sealed digests). Falsified by mutating the copy and asserting the
 *                digests hold still while the HTML moves.
 *   INV-P2     — configured copy cannot move verdict / installability / next-action kind.
 *   INV-P3     — fail-open, per slot: absent, malformed, hostile, and partial documents
 *                all resolve to a COMPLETE copy set. A blank button is a worse outcome
 *                than an ignored edit, so the resolver must never produce one.
 *
 * The anti-vacuity discipline from `presentation-audit.test.ts` applies throughout: every
 * isolation assertion is paired with a positive control proving the mutation was real
 * (the HTML moved, the slot was recorded). An isolation test whose mutation never
 * reached the page would pass for the most useless possible reason.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ABSENCE_CONSEQUENCE,
  AGENT_RELAY_SLOTS,
  CANONICAL_FIXTURES,
  CODE_OWNED_SLOTS,
  DEFAULT_AGENT_RELAY_COPY,
  WIRED_AGENT_RELAY,
  DEFAULT_LAYOUT,
  DEFAULT_TOKENS,
  DEFAULT_PRESENTATION,
  EMPTY_CLAIM_STORE,
  LEVEL_BY_SECTION,
  OBSERVED_CONSEQUENCE,
  PRESENTATION_CONTENT_VERSION,
  PRESENTATION_STATES,
  PRIMARY_CTA,
  SECTION_TITLES,
  UNWIRED_SECTION_TITLES,
  WIRED_SECTION_TITLES,
  WIRED_SLOTS,
  canonicalProjectionInput,
  decodeOverrideKey,
  emitAllCohorts,
  overrideKey,
  parseClaimStore,
  parseEvidenceSnapshot,
  parseSnapshot,
  renderSafeInstall,
  resolvePresentation,
  safeInstallProjection,
  validatePresentationContent,
  type EvidenceSnapshot,
  type PresentationSection,
  type RegistrySnapshot,
  type ResolvedPresentation,
} from "../../src/index.js"
import { DEFAULT_GUARD_OFFER_COPY } from "@calllint/core"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, "..", "..")
const repoRoot = resolve(pkgRoot, "..", "..")

/**
 * The committed catalog, read from the SAME path `bake.ts` reads. Built from path
 * SEGMENTS, never a module specifier — ADR 0058 §2 forbids importing the config plane
 * from anywhere under `packages`, and the lock's import-boundary scan covers this test
 * tree too, so importing the document here would fail the gate. (The scan is textual, so
 * even a specifier quoted inside a comment counts; do not write one.)
 */
const DOC_PATH = resolve(repoRoot, "apps", "web", "content", "safe-install", "presentation.v1.json")
const docText = existsSync(DOC_PATH) ? readFileSync(DOC_PATH, "utf8") : null
const doc: unknown = docText === null ? null : JSON.parse(docText)

const inputs = CANONICAL_FIXTURES.map((f) => canonicalProjectionInput(f))

// --- the committed document ---------------------------------------------------

describe("the committed copy catalog", () => {
  it("exists at the path the bake reads", () => {
    expect(docText, `${DOC_PATH} is missing — the content plane is P-2's deliverable`).not.toBeNull()
  })

  it("is valid against the P-1 schema + vocabulary rules", () => {
    const facts = JSON.parse(readFileSync(resolve(repoRoot, "project-facts.json"), "utf8")) as {
      forbiddenPhrases: string[]
      trustPageForbiddenPhrases: string[]
    }
    const errors = validatePresentationContent(doc, {
      verdictLabels: VERDICT_PUBLIC_LABEL,
      stateCtas: PRIMARY_CTA,
      forbiddenPhrases: [...facts.forbiddenPhrases, ...facts.trustPageForbiddenPhrases],
    })
    expect(errors).toEqual([])
  })

  it("declares the shipped schema tag", () => {
    expect((doc as { schema: string }).schema).toBe(PRESENTATION_CONTENT_VERSION)
  })

  it("is stored LF-only with a trailing newline (the .gitattributes pin, verified)", () => {
    // A CRLF checkout would move `presentationDigest` and false-fail the lock on Windows
    // only — the exact trap the bake hit in #240. Asserting it here means the pin is
    // measured on every OS in CI rather than trusted.
    expect(docText).not.toContain("\r")
    expect(docText?.endsWith("\n")).toBe(true)
  })

  it("does NOT configure a slot no renderer consumes yet", () => {
    // `sectionTitles.boundary` is schema-valid and deliberately unwired. Configuring it
    // would be an edit that validates and then does nothing — the drift a lock exists
    // to catch, so the document must not carry it until a renderer does.
    const titles = (doc as { sectionTitles?: Record<string, unknown> }).sectionTitles ?? {}
    for (const slot of UNWIRED_SECTION_TITLES) {
      expect(titles[slot], `${slot} is unwired; configuring it would do nothing`).toBeUndefined()
    }
    for (const slot of WIRED_SECTION_TITLES) {
      expect(typeof titles[slot], `${slot} is wired but absent from the catalog`).toBe("string")
    }
  })
})

// --- IDENTITY: committing the catalog moves no served byte (ADR 0058 §4) ------

describe("resolver identity — the committed catalog resolves to the shipped defaults", () => {
  const resolved = resolvePresentation(doc)

  it("is deep-equal to the code defaults in every copy slot", () => {
    expect(resolved.primaryCta).toEqual(DEFAULT_PRESENTATION.primaryCta)
    expect(resolved.authority).toEqual(DEFAULT_PRESENTATION.authority)
    expect(resolved.sectionTitles).toEqual(DEFAULT_PRESENTATION.sectionTitles)
  })

  it("is not inert — it really did supply every slot it claims to", () => {
    // Without this, the equality above could hold because the resolver ignored the
    // document entirely. The override set is the positive control.
    expect(resolved.overriddenSlots.length).toBeGreaterThan(0)
    expect(resolved.unwiredSlots).toEqual([])
    for (const state of PRESENTATION_STATES) {
      expect(resolved.overriddenSlots).toContain(`decisionCopy.states.${state}.primaryAction`)
    }
    for (const slot of WIRED_SECTION_TITLES) {
      expect(resolved.overriddenSlots).toContain(`sectionTitles.${slot}`)
    }
    for (const authority of Object.keys(OBSERVED_CONSEQUENCE)) {
      expect(resolved.overriddenSlots).toContain(`authorityCopy.observedPhrases.${authority}`)
    }
    for (const authority of Object.keys(ABSENCE_CONSEQUENCE)) {
      expect(resolved.overriddenSlots).toContain(`authorityCopy.absencePhrases.${authority}`)
    }
  })

  it("is deterministic (pure: same input ⇒ deep-equal output)", () => {
    expect(resolvePresentation(doc)).toEqual(resolvePresentation(doc))
  })

  it("emits a byte-identical served tree through the configured path", () => {
    // The load-bearing test of the whole batch. Not "the copy matches" — the EMIT
    // matches, through the same function the bin calls, with and without the document.
    const SNAPSHOT = resolve(pkgRoot, "snapshots", "official-mcp-registry.json")
    const CLAIMS = resolve(pkgRoot, "claims", "claim-store.json")
    const EVIDENCE = resolve(pkgRoot, "snapshots", "evidence-snapshot.json")
    const engineVersion = (
      JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8")) as { version: string }
    ).version
    const snapshot: RegistrySnapshot | null = existsSync(SNAPSHOT)
      ? parseSnapshot(readFileSync(SNAPSHOT, "utf8"))
      : null
    const claims = existsSync(CLAIMS) ? parseClaimStore(readFileSync(CLAIMS, "utf8")) : EMPTY_CLAIM_STORE
    const evidence: EvidenceSnapshot | null = existsSync(EVIDENCE)
      ? parseEvidenceSnapshot(readFileSync(EVIDENCE, "utf8"))
      : null

    const withDefaults = emitAllCohorts(snapshot, claims, evidence, [], engineVersion)
    const withDocument = emitAllCohorts(snapshot, claims, evidence, [], engineVersion, resolved)

    expect(withDocument.installFiles).toEqual(withDefaults.installFiles)
    expect(withDocument.files).toEqual(withDefaults.files)
    // Positive control: the comparison is over real bytes, not two empty arrays.
    expect(withDefaults.installFiles.length).toBeGreaterThan(1)
  })
})

// --- INV-P1 / INV-P2: configured copy reaches neither digest nor route ---------

/** A resolved presentation whose every wired slot is a recognizable sentinel. */
const MUTATED: ResolvedPresentation = {
  primaryCta: Object.fromEntries(
    PRESENTATION_STATES.map((s) => [s, `CTA_SENTINEL_${s}`]),
  ) as ResolvedPresentation["primaryCta"],
  authority: {
    observed: Object.fromEntries(
      Object.keys(OBSERVED_CONSEQUENCE).map((a) => [a, `OBSERVED_SENTINEL_${a}`]),
    ) as ResolvedPresentation["authority"]["observed"],
    absence: Object.fromEntries(
      Object.keys(ABSENCE_CONSEQUENCE).map((a) => [a, `ABSENCE_SENTINEL_${a}`]),
    ) as ResolvedPresentation["authority"]["absence"],
  },
  sectionTitles: Object.fromEntries(
    Object.keys(SECTION_TITLES).map((k) => [k, `TITLE_SENTINEL_${k}`]),
  ) as ResolvedPresentation["sectionTitles"],
  // The layout is deliberately the SHIPPED one here: this fixture exists to mutate
  // COPY and prove copy reaches no digest and no route. Layout gets its own isolation
  // probe in `layout-manifest.test.ts` (PR P-3), because a reordered page and a
  // reworded page fail in different ways and a combined mutation could not tell which
  // one moved a digest.
  layout: DEFAULT_LAYOUT,
  // Tokens are the SHIPPED ones for the same reason as layout: an href is not copy, it
  // is a fetch target, and it fails differently. PR P-4b gives it its own probes — the
  // resolver's `usableStylesheetHref` rejection tests below, plus the plane audit's
  // foreign-href check over the served pages.
  tokens: DEFAULT_TOKENS,
  // Guard and relay copy are the SHIPPED ones, and that is the correct fixture here: this
  // probe mutates copy that reaches a PAGE, and neither of those reaches one — the guard
  // offer renders to a terminal, the relay line to an MCP `notes[]`. Sentinel values here
  // would make the page-mutation assertion below pass for a reason unrelated to what it
  // claims to measure. Their own isolation is measured where they render: gate 2.4-F's
  // disclosure-invariance check, and `configured-copy-plane.test.ts`'s zero-containment
  // scan over all 19 pages and all 19 sealed contracts.
  guardConversion: DEFAULT_GUARD_OFFER_COPY,
  agentRelay: DEFAULT_AGENT_RELAY_COPY,
  overrides: { resources: {} },
  overriddenSlots: [],
  unwiredSlots: [],
  rejectedSlots: [],
}

describe("INV-P1 — configured copy cannot reach any sealed digest", () => {
  it("holds all four digests still while the page changes", () => {
    let anyHtmlMoved = false
    for (const input of inputs) {
      const base = safeInstallProjection(input)
      const mutated = safeInstallProjection({
        ...input,
        presentation: { primaryCta: MUTATED.primaryCta, authority: MUTATED.authority },
      })
      // All four sealed digests, each read from the field it actually lives on — the
      // binding digests sit under `trustedSources`, not on `contract`. Reaching for
      // `contract.registrySnapshotDigest` type-checks nowhere and compares
      // `undefined === undefined` at runtime, which is a green assertion measuring
      // nothing; `pnpm typecheck` is what catches that, so the paths below are the
      // ones the type says exist.
      expect(mutated.agentContract.contract.contractDigest).toBe(base.agentContract.contract.contractDigest)
      expect(mutated.agentContract.contract.snapshotDigest).toBe(base.agentContract.contract.snapshotDigest)
      expect(mutated.agentContract.trustedSources.registrySnapshotDigest).toBe(
        base.agentContract.trustedSources.registrySnapshotDigest,
      )
      expect(mutated.agentContract.publicObservation.evidenceDigest).toBe(
        base.agentContract.publicObservation.evidenceDigest,
      )
      // Anti-vacuity for the four lines above: a digest comparison between two
      // undefineds passes for free, so assert each side is a real sha256.
      for (const d of [
        base.agentContract.contract.contractDigest,
        base.agentContract.contract.snapshotDigest,
        base.agentContract.trustedSources.registrySnapshotDigest,
        base.agentContract.publicObservation.evidenceDigest,
      ]) {
        expect(d).toMatch(/^sha256:[0-9a-f]{64}$/)
      }
      // The sealed bytes themselves, not just their hash — a hash collision is not the
      // failure mode being ruled out here; a leaked sentence is.
      expect(JSON.stringify(mutated.agentContract)).toBe(JSON.stringify(base.agentContract))
      expect(JSON.stringify(mutated.agentContract)).not.toContain("SENTINEL")

      const baseHtml = renderSafeInstall(base, DEFAULT_PRESENTATION.sectionTitles)
      const mutatedHtml = renderSafeInstall(mutated, MUTATED.sectionTitles)
      if (mutatedHtml !== baseHtml) anyHtmlMoved = true
    }
    // Anti-vacuity: if no page ever moved, the mutation reached nothing and this test
    // measured nothing.
    expect(anyHtmlMoved, "no page changed under mutation — the probe was vacuous").toBe(true)
  })

  it("puts every wired slot on some page (so the isolation above is a real result)", () => {
    // Across a page SET, not one page, and with a publisher description supplied:
    // `publisherBlock` is the label on the quarantined description, so it renders only
    // for a subject that HAS one — and `canonicalProjectionInput` defaults that field to
    // null. Demanding all three titles on a description-less page would fail for a reason
    // with nothing to do with the boundary. The union over the set is also the honest test
    // of "wired": each slot must reach a renderer somewhere under SOME input the shipped
    // emit can produce, or it belongs in UNWIRED_SECTION_TITLES instead.
    const pages = CANONICAL_FIXTURES.map((f) =>
      renderSafeInstall(
        safeInstallProjection({
          ...canonicalProjectionInput(f, "A publisher-supplied description."),
          presentation: { primaryCta: MUTATED.primaryCta, authority: MUTATED.authority },
        }),
        MUTATED.sectionTitles,
      ),
    )
    expect(pages.some((h) => h.includes("CTA_SENTINEL_"))).toBe(true)
    for (const slot of WIRED_SECTION_TITLES) {
      expect(
        pages.some((h) => h.includes(`TITLE_SENTINEL_${slot}`)),
        `${slot} is declared wired but reaches no rendered page`,
      ).toBe(true)
    }
  })
})

describe("INV-P2 — configured copy cannot move the decision route", () => {
  it("leaves verdict / installability / next-action kind invariant", () => {
    for (const input of inputs) {
      const base = safeInstallProjection(input)
      const mutated = safeInstallProjection({
        ...input,
        presentation: { primaryCta: MUTATED.primaryCta, authority: MUTATED.authority },
      })
      expect(mutated.publicObservation.verdict).toBe(base.publicObservation.verdict)
      expect(mutated.installability).toBe(base.installability)
      expect(mutated.agentContract.recommendedNextAction.kind).toBe(
        base.agentContract.recommendedNextAction.kind,
      )
    }
  })
})

// --- INV-P3: fail open, per slot ----------------------------------------------

describe("INV-P3 — a bad or partial document degrades to the shipped copy, never to nothing", () => {
  const total = (r: ResolvedPresentation, why: string): void => {
    for (const state of PRESENTATION_STATES) {
      expect(r.primaryCta[state], `${why}: CTA ${state}`).toBeTruthy()
    }
    for (const a of Object.keys(OBSERVED_CONSEQUENCE)) {
      expect(r.authority.observed[a as keyof typeof OBSERVED_CONSEQUENCE], `${why}: observed ${a}`).toBeTruthy()
    }
    for (const a of Object.keys(ABSENCE_CONSEQUENCE)) {
      expect(r.authority.absence[a as keyof typeof ABSENCE_CONSEQUENCE], `${why}: absence ${a}`).toBeTruthy()
    }
    for (const k of Object.keys(SECTION_TITLES)) {
      expect(r.sectionTitles[k as keyof typeof SECTION_TITLES], `${why}: title ${k}`).toBeTruthy()
    }
  }

  it("resolves an absent document to exactly the defaults", () => {
    for (const empty of [null, undefined]) {
      expect(resolvePresentation(empty)).toEqual(DEFAULT_PRESENTATION)
    }
  })

  it("resolves structurally wrong documents to the defaults", () => {
    for (const junk of [42, "a string", true, [], [{ schema: "x" }]]) {
      expect(resolvePresentation(junk)).toEqual(DEFAULT_PRESENTATION)
    }
  })

  it("ignores an unusable value per slot and keeps every other slot", () => {
    const partial = {
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      decisionCopy: {
        states: {
          // one good, one blank, one whitespace-only, one non-string, one over-long,
          // one markup-bearing — each must fall back INDEPENDENTLY.
          PREPARE_AVAILABLE: { primaryAction: "Adopt it" },
          REVIEW_REQUIRED: { primaryAction: "" },
          BLOCKED: { primaryAction: "   " },
          LOCAL_PREFLIGHT_REQUIRED: { primaryAction: 7 },
          UNSUPPORTED: { primaryAction: "x".repeat(401) },
        },
      },
      sectionTitles: { provenance: "<b>Where it came from</b>" },
    }
    const r = resolvePresentation(partial)
    total(r, "partial document")
    expect(r.primaryCta.PREPARE_AVAILABLE).toBe("Adopt it")
    expect(r.primaryCta.REVIEW_REQUIRED).toBe(PRIMARY_CTA.REVIEW_REQUIRED)
    expect(r.primaryCta.BLOCKED).toBe(PRIMARY_CTA.BLOCKED)
    expect(r.primaryCta.LOCAL_PREFLIGHT_REQUIRED).toBe(PRIMARY_CTA.LOCAL_PREFLIGHT_REQUIRED)
    expect(r.primaryCta.UNSUPPORTED).toBe(PRIMARY_CTA.UNSUPPORTED)
    expect(r.sectionTitles.provenance).toBe(SECTION_TITLES.provenance)
    // Exactly the one usable slot was recorded as overridden.
    expect(r.overriddenSlots).toEqual(["decisionCopy.states.PREPARE_AVAILABLE.primaryAction"])

    // ...and each fallback was RECORDED, not merely performed. Until ADR 0078's follow-up
    // this block asserted only the five lines above, so `rejectedSlots` was `[]` here and a
    // silently-dropped copy value had no witness at all (D4). The four rules are named
    // separately because one message covering all of them would not distinguish an
    // over-long value from a deleted one, which need opposite fixes.
    const rejectedFor = (slot: string): string => {
      const hit = r.rejectedSlots.filter((s) => s.startsWith(`${slot}:`))
      expect(hit, `nothing recorded for ${slot}`).toHaveLength(1)
      return hit[0] as string
    }
    expect(rejectedFor("decisionCopy.states.REVIEW_REQUIRED.primaryAction")).toContain(
      "blank after trim",
    )
    expect(rejectedFor("decisionCopy.states.BLOCKED.primaryAction")).toContain("blank after trim")
    expect(rejectedFor("decisionCopy.states.LOCAL_PREFLIGHT_REQUIRED.primaryAction")).toContain(
      "not a string (number)",
    )
    expect(rejectedFor("decisionCopy.states.UNSUPPORTED.primaryAction")).toContain(
      "401 characters, over the 400 cap",
    )
    expect(rejectedFor("sectionTitles.provenance")).toContain("carries `<` or `>`")
    // Each entry is SLOT + RULE and stops there. The "fell back to the shipped value"
    // consequence is `presentation-lock.ts:564`'s to add, once, for every rejected slot;
    // repeating it here printed it twice in the gate's own output.
    for (const s of r.rejectedSlots) {
      expect(s).not.toContain("fell back to the shipped value")
    }
    // The offending TEXT never travels: these strings reach a committed artifact and a CI
    // log, and the slot plus the rule is what a reviewer needs.
    expect(r.rejectedSlots.join("\n")).not.toContain("x".repeat(50))
    expect(r.rejectedSlots.join("\n")).not.toContain("<b>")
  })

  it("records a copy fallback at EVERY mergeSlots call site, not just the CTA one", () => {
    // ADR 0078 asked for a control per call site, because `rejected` is threaded in by hand
    // six times and a missed argument is invisible: the slot would still fall back correctly
    // and still be absent from `rejectedSlots` — the exact defect this closes. Each entry
    // pairs one document with the slot path its own call site must emit.
    const cases: readonly { slot: string; doc: Record<string, unknown> }[] = [
      {
        slot: "decisionCopy.states.BLOCKED.primaryAction",
        doc: { decisionCopy: { states: { BLOCKED: { primaryAction: "" } } } },
      },
      {
        slot: "authorityCopy.observedPhrases.shell_execution",
        doc: { authorityCopy: { observedPhrases: { shell_execution: "" } } },
      },
      {
        slot: "authorityCopy.absencePhrases.shell_execution",
        doc: { authorityCopy: { absencePhrases: { shell_execution: "" } } },
      },
      { slot: "sectionTitles.provenance", doc: { sectionTitles: { provenance: "" } } },
      { slot: "guardConversion.acceptLabel", doc: { guardConversion: { acceptLabel: "" } } },
      { slot: "agentRelayCopy.headline", doc: { agentRelayCopy: { headline: "" } } },
      {
        slot: "overrides.resources.io.example-mcp.displayName",
        doc: { overrides: { resources: { "io.example-mcp": { displayName: "" } } } },
      },
    ]
    for (const { slot, doc } of cases) {
      const r = resolvePresentation({
        schema: PRESENTATION_CONTENT_VERSION,
        locale: "en-US",
        ...doc,
      })
      total(r, slot)
      expect(
        r.rejectedSlots.filter((s) => s.startsWith(`${slot}:`)),
        `${slot} fell back without being recorded — its mergeSlots call is likely missing \`rejected\``,
      ).toHaveLength(1)
      // The fallback itself is unchanged: recording must not turn INV-P3 fail-open into a throw.
      expect(r.overriddenSlots).toEqual([])
    }
  })

  it("cannot coin a state, an authority token, or a title key", () => {
    // ADR 0058 §3: configuration SELECTS among what code implements; it never invents.
    const r = resolvePresentation({
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      decisionCopy: { states: { TOTALLY_NEW_STATE: { primaryAction: "Do the new thing" } } },
      authorityCopy: { observedPhrases: { INVENTED_AUTHORITY: "It can do a new thing." } },
      sectionTitles: { inventedSection: "Invented" },
    })
    // Every RESOLVED value is the shipped default — nothing was coined.
    expect(r.primaryCta).toEqual(DEFAULT_PRESENTATION.primaryCta)
    expect(r.authority).toEqual(DEFAULT_PRESENTATION.authority)
    expect(r.sectionTitles).toEqual(DEFAULT_PRESENTATION.sectionTitles)
    expect(r.layout).toEqual(DEFAULT_PRESENTATION.layout)
    expect(r.tokens).toEqual(DEFAULT_PRESENTATION.tokens)
    expect(JSON.stringify(r.sectionTitles)).not.toContain("Invented")
    expect(JSON.stringify(r.primaryCta)).not.toContain("new thing")
    // All THREE coined keys are now REPORTED rather than silently dropped, and each report
    // carries the measured reason it reached nothing. P-4b generalized `unwiredSlots` from
    // the deferral list to "configured but not wired" for ONE section; P-5 made it total
    // over all eight, which is what brings the coined STATE and AUTHORITY token in.
    //
    // This assertion previously read `["sectionTitles.inventedSection"]`, and the comment
    // here recorded that the other two "stay silent: those are enum-keyed merges where an
    // unknown key cannot be distinguished from a stale one". That reading is now FALSE and
    // is inverted rather than removed: an enum-keyed merge CAN distinguish them, because
    // `WIRED_SLOTS` enumerates the legal state and authority keys concretely, so a key
    // outside that enumeration is reported by the same mechanism that reports a bad title.
    // A key that does nothing is drift whether it is a planned deferral, a coinage, or a
    // typo, and `unwiredSlots` is a lock failure — so all three surface in CI rather than
    // in a diff nobody reads.
    expect(r.unwiredSlots).toEqual([
      "authorityCopy.observedPhrases.INVENTED_AUTHORITY: matches no known slot — check the spelling against the schema",
      "decisionCopy.states.TOTALLY_NEW_STATE.primaryAction: matches no known slot — check the spelling against the schema",
      "sectionTitles.inventedSection: matches no known slot — check the spelling against the schema",
    ])
  })

  it("reports a configured-but-unwired slot instead of silently ignoring it", () => {
    // P-4b wired `boundary`, the last unwired slot, so this test lost its subject. Keeping it
    // as-is would have left it passing while measuring nothing — the exact defect the
    // unwired-slot mechanism exists to catch, reproduced in the test for that mechanism.
    //
    // So it becomes a SYNTHETIC positive control: an unwired name is injected here rather
    // than found in the schema, which proves the detection still works and will report the
    // NEXT real deferral. The empty-list assertion over the real catalog lives above.
    expect(UNWIRED_SECTION_TITLES).toEqual([]) // no real deferral remains ...
    const r = resolvePresentation({
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      sectionTitles: { notASlot: "What this does not tell you" } as never,
    })
    // ... and an unknown title key is still caught rather than silently dropped. P-5 added
    // the reason clause: a slot in NEITHER table is a misspelling, and saying so is what
    // makes the report actionable instead of just non-empty.
    expect(r.unwiredSlots).toEqual([
      "sectionTitles.notASlot: matches no known slot — check the spelling against the schema",
    ])
    // And the wording did NOT reach the resolved copy, since nothing consumes it.
    expect(JSON.stringify(r.sectionTitles)).not.toContain("does not tell you")
  })

  it("keeps the emit total even when handed a hostile document", () => {
    const hostile = resolvePresentation({
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      decisionCopy: { states: null },
      authorityCopy: { observedPhrases: [], absencePhrases: "nope" },
      sectionTitles: 3,
    })
    total(hostile, "hostile document")
    expect(hostile).toEqual(DEFAULT_PRESENTATION)
  })
})

// --- PR P-5: the three sections that were declared, levelled, and dead ---------

/**
 * `LEVEL_BY_SECTION` declared eight sections; the resolver read five. The other three
 * validated clean, were typed, moved `presentationDigest`, appeared in the lock's section
 * list — and reached nothing, tripping no gate. A document carrying all three resolved to
 * `overriddenSlots: []`, `unwiredSlots: []`, `rejectedSlots: []`: a clean bill of health
 * for a document that did nothing.
 *
 * These tests measure the close from both directions. The wired slots must reach the
 * resolved plane; every slot that CANNOT honestly be wired must be reported by name with
 * its own measured reason. A test that only checked the first half would pass just as well
 * against the silent-acceptance behaviour this batch removes.
 */
describe("PR P-5 — guardConversion, agentRelayCopy and overrides resolve", () => {
  const CONFIGURED = {
    schema: PRESENTATION_CONTENT_VERSION,
    locale: "en-US",
    guardConversion: {
      offerHeadline: "Configured headline",
      offerBody: "Configured lead-in:",
      acceptLabel: "Configured accept",
    },
    agentRelayCopy: { guardOffer: "configured relay sentence" },
    overrides: {
      resources: {
        "mcp-registry__io.github.example-example": { displayName: "Configured Name", reason: "a measured reason" },
      },
    },
  }

  it("carries configured guard, relay and override values into the resolved plane", () => {
    const r = resolvePresentation(CONFIGURED)
    expect(r.guardConversion).toEqual(CONFIGURED.guardConversion)
    expect(r.agentRelay.guardOffer).toBe("configured relay sentence")
    expect(r.overrides.resources["mcp-registry__io.github.example-example"]).toEqual({
      displayName: "Configured Name",
      reason: "a measured reason",
    })
  })

  it("records every configured slot in overriddenSlots", () => {
    // The positive control for the whole section: without it, "resolves" could mean the
    // resolver read the block and then dropped it, which is the state P-5 closes.
    const r = resolvePresentation(CONFIGURED)
    for (const slot of ["offerHeadline", "offerBody", "acceptLabel"]) {
      expect(r.overriddenSlots).toContain(`guardConversion.${slot}`)
    }
    expect(r.overriddenSlots).toContain("agentRelayCopy.guardOffer")
    expect(r.overriddenSlots).toContain(
      "overrides.resources.mcp-registry__io.github.example-example.displayName",
    )
    expect(r.overriddenSlots).toContain("overrides.resources.mcp-registry__io.github.example-example.reason")
    expect(r.unwiredSlots).toEqual([])
    expect(r.rejectedSlots).toEqual([])
  })

  it("keeps the five decision-relay slots out of the resolved relay wording it did not configure", () => {
    // Configuring `guardOffer` alone must not blank the others — fail open PER SLOT.
    const r = resolvePresentation(CONFIGURED)
    expect(r.agentRelay.headline).toBe(DEFAULT_AGENT_RELAY_COPY.headline)
    expect(r.agentRelay.approvalQuestion).toBe(DEFAULT_AGENT_RELAY_COPY.approvalQuestion)
  })

  it("falls back per SECTION when a block is malformed, keeping every other block (INV-P3)", () => {
    const r = resolvePresentation({
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      guardConversion: "not an object",
      agentRelayCopy: [],
      overrides: { resources: 7 },
      // A wired slot in an unrelated section proves the fallback is scoped to the bad
      // blocks rather than discarding the document.
      sectionTitles: { provenance: "Still configured" },
    })
    expect(r.guardConversion).toEqual(DEFAULT_GUARD_OFFER_COPY)
    expect(r.agentRelay).toEqual(DEFAULT_AGENT_RELAY_COPY)
    expect(r.overrides).toEqual({ resources: {} })
    expect(r.sectionTitles.provenance).toBe("Still configured")
    expect(r.overriddenSlots).toContain("sectionTitles.provenance")
  })

  it("reports each code-owned slot with its OWN measured reason, not a generic one", () => {
    // The distinctness is the assertion. Five different reasons apply here, and collapsing
    // them into one message would make the report unactionable — a reviewer could not tell
    // "wiring this needs an ADR" from "wiring this would break a security floor".
    const r = resolvePresentation({
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      decisionCopy: {
        states: {
          BLOCKED: { headline: "h", supportingText: "s", secondaryLinkLabel: "l" },
        },
      },
      guardConversion: { declineLabel: "Later" },
      // P-6 INVERTS the relay half of this case rather than deleting it. The five
      // decision-relay slots were code-owned at P-5 ("no consumer exists"); they now compose
      // into the MCP prepare result's `notes[]`, so the same configured block must produce the
      // OPPOSITE measurement — no reason, and the wording reaching the resolved plane. Asserted
      // below, so this case still names the relay slots instead of falling silent about them.
      agentRelayCopy: {
        headline: "h",
        reason: "r",
        adds: "a",
        notObserved: "n",
        approvalQuestion: "q",
      },
      overrides: {
        resources: {
          "mcp-registry__io.github.example-example": {
            scopeAlias: "alias",
            originalSetupUrl: "https://example.com/setup",
            expiresAt: "2030-01-01T00:00:00Z",
          },
        },
      },
    })
    const reasonFor = (slot: string): string => {
      const hit = r.unwiredSlots.find((u) => u.startsWith(`${slot}:`))
      expect(hit, `${slot} was not reported at all`).toBeDefined()
      return (hit as string).slice(slot.length + 2)
    }
    expect(reasonFor("decisionCopy.states.BLOCKED.headline")).toContain("L3")
    expect(reasonFor("decisionCopy.states.BLOCKED.supportingText")).toContain("no shipped counterpart")
    expect(reasonFor("decisionCopy.states.BLOCKED.secondaryLinkLabel")).toContain("no shipped counterpart")
    expect(reasonFor("guardConversion.declineLabel")).toContain("security floor compares it as a literal")
    // The inverted half: WIRED as of P-6, so each of the five must be absent from
    // `unwiredSlots` AND present in `overriddenSlots` with its value on the resolved plane.
    // Absence alone would also hold if the resolver had silently dropped the block, which is
    // why the value is asserted too.
    const RELAYED = ["headline", "reason", "adds", "notObserved", "approvalQuestion"] as const
    const configured: Record<string, string> = {
      headline: "h",
      reason: "r",
      adds: "a",
      notObserved: "n",
      approvalQuestion: "q",
    }
    for (const slot of RELAYED) {
      expect(
        r.unwiredSlots.find((u) => u.startsWith(`agentRelayCopy.${slot}:`)),
        `agentRelayCopy.${slot} is wired at P-6 and must carry no code-owned reason`,
      ).toBeUndefined()
      expect(r.overriddenSlots).toContain(`agentRelayCopy.${slot}`)
      expect(r.agentRelay[slot]).toBe(configured[slot])
    }
    const overrideBase = "overrides.resources.mcp-registry__io.github.example-example"
    expect(reasonFor(`${overrideBase}.scopeAlias`)).toContain("no consumer exists")
    expect(reasonFor(`${overrideBase}.originalSetupUrl`)).toContain("no consumer exists")
    expect(reasonFor(`${overrideBase}.expiresAt`)).toContain("clock-dependent")
    // Distinctness, asserted rather than eyeballed: at least four different reasons appear.
    const distinct = new Set(r.unwiredSlots.map((u) => u.slice(u.indexOf(": ") + 2)))
    expect(distinct.size).toBeGreaterThanOrEqual(4)
    // And none of the CODE-OWNED configuration reached the resolved plane. `guardConversion`
    // still falls back whole (`declineLabel` is compared as a literal by a security floor);
    // the relay block no longer does, because P-6 wired it — asserted slot-by-slot above,
    // and `guardOffer` is untouched here, so the unconfigured slot still defaults.
    expect(r.guardConversion).toEqual(DEFAULT_GUARD_OFFER_COPY)
    expect(r.agentRelay.guardOffer).toBe(DEFAULT_AGENT_RELAY_COPY.guardOffer)
  })

  it("distinguishes a code-owned slot from a MISSPELLED one", () => {
    // Two failure modes, two messages. A slot in `CODE_OWNED_SLOTS` is a deliberate
    // decision with a reason; a slot in neither table is a typo. If both reported the same
    // way, a misspelling would read as a design decision and be left in the document.
    const r = resolvePresentation({
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      guardConversion: { declineLabel: "Later", offerHeadlne: "typo" } as never,
    })
    const typo = r.unwiredSlots.find((u) => u.startsWith("guardConversion.offerHeadlne:"))
    expect(typo).toContain("check the spelling against the schema")
    expect(r.unwiredSlots.find((u) => u.startsWith("guardConversion.declineLabel:"))).not.toContain(
      "check the spelling",
    )
  })
})

/**
 * The override key encoding (PR P-5).
 *
 * The corpus here is the COMMITTED lookup index, not the eval fixtures: fixture slugs are
 * sanitized (`[^a-z0-9]+` → `-`) and so contain no slash at all, which would make every
 * assertion below pass without exercising the encoding once. The 19 real canonical slugs
 * are the only corpus that carries the shape the encoding exists for.
 */
const LOOKUP_PATH = resolve(repoRoot, "apps", "web", "public", ".well-known", "calllint.json")
const committedSlugs: readonly string[] = existsSync(LOOKUP_PATH)
  ? ((JSON.parse(readFileSync(LOOKUP_PATH, "utf8")) as { resources: { canonicalSlug: string }[] }).resources ?? []).map(
      (r) => r.canonicalSlug,
    )
  : []

describe("PR P-5 — the override key encoding", () => {
  it("round-trips every committed canonical slug", () => {
    // The measured trap: the schema's `propertyNames` pattern admits no slash, so a canonical
    // slug cannot be a key directly — and the LEAF segment alone DOES satisfy the pattern
    // (measured: 19 of 19), so a naive attempt silently keys the wrong resource and validates
    // clean. A round-trip is the only check that catches that, which is why this asserts
    // `decode(encode(slug)) === slug` rather than just "the key matches the pattern".
    const pattern = /^[a-z0-9][a-z0-9._-]*$/
    let slugsWithSlash = 0
    for (const slug of committedSlugs) {
      if (slug.includes("/")) slugsWithSlash += 1
      const key = overrideKey(slug)
      expect(key, `${slug} encodes to a key the schema would reject`).toMatch(pattern)
      expect(decodeOverrideKey(key)).toBe(slug)
      // The leaf segment also matches the pattern — that is exactly why the round-trip is the
      // assertion. Keying by the leaf would validate and address nothing.
      const leaf = slug.slice(slug.lastIndexOf("/") + 1)
      if (slug.includes("/")) expect(decodeOverrideKey(leaf)).not.toBe(slug)
    }
    // Anti-vacuity, twice over: an empty corpus or a slash-free one would make every
    // assertion above hold without testing the encoding.
    expect(committedSlugs.length).toBeGreaterThan(0)
    expect(slugsWithSlash).toBe(committedSlugs.length)
  })

  it("is injective over the committed corpus, and `__` occurs in no real slug", () => {
    // Injectivity is what makes the encoding safe to use as an address. The second clause is
    // what makes it UNAMBIGUOUS: if a canonical slug ever contained `__`, decode would split
    // it into a path segment and two distinct resources could collide on one key.
    expect(new Set(committedSlugs.map(overrideKey)).size).toBe(committedSlugs.length)
    expect(committedSlugs.filter((s) => s.includes("__"))).toEqual([])
  })

  it("resolves a raw-slash key rather than rejecting it — the gate is the SCHEMA, measured", () => {
    // Measured, and initially assumed otherwise: neither the resolver nor
    // `validatePresentationContent` rejects an un-encoded key. The resolver merges any present
    // key, and the validator is deliberately not a JSON Schema re-implementation (its own
    // docblock says so) — `propertyNames` is shape, and shape is Ajv's, asserted over in
    // `presentation-content.test.ts`.
    //
    // Stated as an inverted assertion rather than deleted, because the behaviour is a real
    // hazard worth pinning: a raw-slash key validates at the value layer, resolves, and is
    // even recorded in `overriddenSlots` — while `emitSafeInstall` looks up by the ENCODED
    // key, so it can never address a resource. That is ADR 0058 §3's named drift exactly. It
    // is caught, one door earlier, by the schema; if a future edit ever makes the resolver
    // itself reject it, this test should be inverted again, not removed.
    const r = resolvePresentation({
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      overrides: { resources: { "mcp-registry/io.github.example-example": { displayName: "Raw slash" } } },
    } as never)
    expect(JSON.stringify(r.overrides)).toContain("Raw slash")
    // And it is NOT reported as unwired — `displayName` is a wired slot, so the mechanism has
    // nothing to complain about. This is the precise reason the schema has to be the gate.
    expect(r.unwiredSlots).toEqual([])
  })
})

describe("PR P-5 — the classification is TOTAL and the compiler enforces it", () => {
  it("classifies every section of LEVEL_BY_SECTION in both tables", () => {
    // `satisfies Record<PresentationSection, …>` already makes this a typecheck error, so
    // this test is the runtime witness of that guarantee: it fails loudly if either table
    // is ever widened to a plain object, which would make the compile-time check silently
    // stop applying.
    for (const section of Object.keys(LEVEL_BY_SECTION) as PresentationSection[]) {
      expect(WIRED_SLOTS[section], `${section} missing from WIRED_SLOTS`).toBeDefined()
      expect(CODE_OWNED_SLOTS[section], `${section} missing from CODE_OWNED_SLOTS`).toBeDefined()
    }
    // Eight, not five — the count P-5 moves. Naming it here means a section added without
    // classification fails a test that says WHY rather than only failing a typecheck.
    expect(Object.keys(LEVEL_BY_SECTION)).toHaveLength(8)
  })

  it("has NO code-owned relay slot left at P-6 — all six are wired, and both tables say so", () => {
    // The batch's own closure, named. P-5 made this report total; P-6 makes it empty for this
    // one section. Asserted from BOTH sides on purpose: an empty `CODE_OWNED_SLOTS` entry alone
    // would also be produced by deleting the slots from the schema, so the wired table has to
    // show all six present. `AGENT_RELAY_SLOTS` is the classification domain, so this compares
    // against the schema's own slot list rather than a literal restated here.
    expect(CODE_OWNED_SLOTS.agentRelayCopy).toEqual({})
    expect([...WIRED_SLOTS.agentRelayCopy].sort()).toEqual([...AGENT_RELAY_SLOTS].sort())
    expect([...WIRED_AGENT_RELAY].sort()).toEqual([...AGENT_RELAY_SLOTS].sort())
    expect(WIRED_AGENT_RELAY).toHaveLength(6)
  })

  it("puts no slot in BOTH tables", () => {
    // A slot that is both wired and code-owned would report as code-owned while actually
    // reaching a renderer, which is the most confusing possible state: the lock would tell
    // a reviewer to remove a key that is doing real work.
    for (const section of Object.keys(LEVEL_BY_SECTION) as PresentationSection[]) {
      const wired: readonly string[] = WIRED_SLOTS[section]
      for (const owned of Object.keys(CODE_OWNED_SLOTS[section])) {
        expect(wired, `${section}.${owned} is in both tables`).not.toContain(owned)
      }
    }
  })

  it("covers every slot the committed catalog configures", () => {
    // The pre-flight that keeps this batch from turning the tree red on landing: the
    // shipped document must configure only WIRED slots. Measured against the real catalog
    // rather than a fixture, because that is the document CI resolves.
    expect(resolvePresentation(doc).unwiredSlots).toEqual([])
  })

  // --- PR P-7: an identity key is NOT a slot ---------------------------------
  //
  // Measured, not assumed: adding `configVersion` to an existing section's slot list
  // moves NOTHING — not `overriddenSlots` (which counts slots actually overridden at
  // resolve time, and a phantom entry is never filled), not the plane audit's
  // `inventoryTotal` (which counts hardcoded copy literals in seven `src/` files). So a
  // resolve-time count alone cannot carry this claim. The structural assertion below is
  // what does, and it is enforced by the COMPILER: `WIRED_SLOTS` is
  // `satisfies Record<PresentationSection, readonly string[]>`, so a top-level
  // `configVersion` key is `error TS2353` — `configVersion` is not a PresentationSection.
  // Both halves are asserted because they fail for different reasons.

  it("configVersion appears in NO slot table — identity is validated and digested, never resolved", () => {
    for (const section of Object.keys(WIRED_SLOTS) as PresentationSection[]) {
      const wired: readonly string[] = WIRED_SLOTS[section]
      expect(wired, `${section} wires configVersion`).not.toContain("configVersion")
      expect(Object.keys(CODE_OWNED_SLOTS[section]), `${section} code-owns configVersion`).not.toContain(
        "configVersion",
      )
    }
    // The section vocabularies are disjoint from the identity keys, which is the same
    // claim `presentation-digest.test.ts` makes against LEVEL_BY_SECTION — asserted here
    // too because a slot table and a level table can drift apart independently.
    expect(Object.keys(WIRED_SLOTS)).not.toContain("configVersion")
  })

  it("the live catalog carries a configVersion and STILL overrides exactly 46 slots", () => {
    // The positive control that keeps the test above from passing vacuously: the real
    // document does carry the key (so the resolver is genuinely seeing it), the resolver
    // reports it in no slot, and the total is unmoved from its pre-P-7 value. A count with
    // no witness that the key was present would pass on a catalog that simply lacked it.
    expect(doc).toHaveProperty("configVersion")
    const r = resolvePresentation(doc)
    expect(r.overriddenSlots).toHaveLength(46)
    expect(r.overriddenSlots.filter((s) => s.includes("configVersion"))).toEqual([])
    expect(r.rejectedSlots).toEqual([])
  })

  it("the resolved plane exposes no configVersion — it is not carried onto a rendered surface", () => {
    // §14's zero-served-byte gate, at the seam where a violation would originate: if the
    // key reached the resolved plane, a renderer could read it and the install pages would
    // drift. `resolvePresentation` returns the plane the renderer consumes, so its absence
    // here is the reason the key cannot become copy.
    const { overriddenSlots: _o, unwiredSlots: _u, rejectedSlots: _r, ...plane } = resolvePresentation(doc)
    // The eight resolved surfaces the renderer reads, with the three diagnostic arrays
    // removed — a slot name appearing in `overriddenSlots` is a report, not a surface.
    expect(Object.keys(plane).sort()).toEqual(
      ["agentRelay", "authority", "guardConversion", "layout", "overrides", "primaryCta", "sectionTitles", "tokens"],
    )
    expect(JSON.stringify(plane)).not.toContain("configVersion")
    expect(JSON.stringify(plane)).not.toContain("2026.08.01-p7")
  })
})
