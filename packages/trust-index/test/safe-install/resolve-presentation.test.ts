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
  CANONICAL_FIXTURES,
  DEFAULT_PRESENTATION,
  EMPTY_CLAIM_STORE,
  OBSERVED_CONSEQUENCE,
  PRESENTATION_CONTENT_VERSION,
  PRESENTATION_STATES,
  PRIMARY_CTA,
  SECTION_TITLES,
  UNWIRED_SECTION_TITLES,
  WIRED_SECTION_TITLES,
  canonicalProjectionInput,
  emitAllCohorts,
  parseClaimStore,
  parseEvidenceSnapshot,
  parseSnapshot,
  renderSafeInstall,
  resolvePresentation,
  safeInstallProjection,
  validatePresentationContent,
  type EvidenceSnapshot,
  type RegistrySnapshot,
  type ResolvedPresentation,
} from "../../src/index.js"
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
  overriddenSlots: [],
  unwiredSlots: [],
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
    expect(r).toEqual(DEFAULT_PRESENTATION)
    expect(JSON.stringify(r)).not.toContain("Invented")
    expect(JSON.stringify(r)).not.toContain("new thing")
  })

  it("reports a configured-but-unwired slot instead of silently ignoring it", () => {
    const r = resolvePresentation({
      schema: PRESENTATION_CONTENT_VERSION,
      locale: "en-US",
      sectionTitles: { boundary: "What this does not tell you" },
    })
    expect(r.unwiredSlots).toEqual(["sectionTitles.boundary"])
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
