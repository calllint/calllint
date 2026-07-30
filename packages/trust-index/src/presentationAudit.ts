// ---------------------------------------------------------------------------
// Workstream P Batch 0 — presentation-plane reality audit (new15 §4.2/§6.2 P-0;
// ADR 0058 §1). PURE + deterministic: no I/O, no clock, no RNG, no LLM.
//
// The one question this module answers mechanically, so nobody has to answer it
// by opinion in a review:
//
//     can this copy value reach `contractDigest`?
//
// ADR 0058 §1 defines a configuration LEVEL by exactly that reachability. Reachable
// ⇒ L3 behavioral semantics, owned by code/schema/ADR, never editable from
// `apps/web/content/**` (editing it would invalidate `expectedContractDigest` in
// every sealed install plan). Unreachable and visible only in human HTML ⇒ L1/L2
// presentation, safe to lift into configuration.
//
// The measurement is a MUTATION PROBE, not an assertion: perturb the copy value at
// the shipped seam, re-project, and compare digests. Two directions are graded,
// because a probe that only ever confirms isolation proves nothing —
//   • an L1/L2 probe must leave every decision digest byte-identical AND must still
//     change the rendered HTML (otherwise the mutation was vacuous — it never
//     reached the page either, so the probe measured nothing);
//   • an L3 probe must MOVE `contractDigest` (the negative control: it shows the
//     probe can detect reachability when reachability exists).
// ---------------------------------------------------------------------------

import { hashJson } from "@calllint/fingerprint"
import { renderSafeInstall, SECTION_TITLES } from "./renderSafeInstall.js"
import { DEFAULT_LAYOUT } from "./safe-install/layoutStructure.js"
import { safeInstallProjection, type SafeInstallProjectionInput } from "./safeInstallProjection.js"
import type { SafeInstallProjection } from "./safeInstallProjection.js"
import {
  buildAgentAdoptionContract,
  sealAgentAdoptionContract,
} from "./agentAdoptionContract.js"
import {
  selectDecisionAuthorities,
  type DecisionAuthoritySelection,
} from "./selectDecisionAuthorities.js"

/** The sentinel a probe substitutes for real copy. Never a real phrase. */
export const PROBE_SENTINEL = "PROBE_MUTATED_COPY_SENTINEL"

/**
 * Which plane a copy site belongs to, as DECLARED by the audit table. The probe
 * measures reachability; this records what a human claimed, so a mismatch between
 * the claim and the measurement is a failure rather than a silent correction.
 */
export type CopyPlane = "presentation" | "decision"

/** A copy site under audit: where it lives and what is claimed about it. */
export interface CopySiteDeclaration {
  /** Constant name as it appears in source, e.g. `OBSERVED_CONSEQUENCE`. */
  readonly constant: string
  /** Repo-relative source path that owns it. */
  readonly source: string
  /** ADR 0058 §1 level: L0 tokens · L1 cognitive · L2 security copy · L3 behavior. */
  readonly declaredLevel: "L0" | "L1" | "L2" | "L3"
  /** The claim under test: does this value reach the decision plane? */
  readonly declaredPlane: CopyPlane
  /** Where the value is allowed to live once Workstream P lands. */
  readonly configurableTo: string | null
  /** Why the level is what it is — one sentence, for the audit artifact. */
  readonly rationale: string
}

/** What one mutation probe observed. Every field is a measurement, not a claim. */
export interface CopyProbeResult {
  readonly constant: string
  readonly source: string
  readonly declaredLevel: "L0" | "L1" | "L2" | "L3"
  readonly declaredPlane: CopyPlane
  readonly configurableTo: string | null
  readonly rationale: string
  /** How the value was perturbed at the shipped seam. */
  readonly mutation: string
  /** MEASURED: did `contractDigest` move under the mutation? */
  readonly contractDigestMoved: boolean
  /** MEASURED: did the rendered human HTML move? Guards against a vacuous probe. */
  readonly htmlMoved: boolean
  /** MEASURED: did any of verdict / installability / next-action kind move? */
  readonly decisionRouteMoved: boolean
  /** The plane the MEASUREMENT implies, derived from `contractDigestMoved`. */
  readonly measuredPlane: CopyPlane
  /** True when the measurement matches the declaration and the probe was not vacuous. */
  readonly pass: boolean
  /** Present only on failure — what specifically disagreed. */
  readonly failures: readonly string[]
  /** How the reachability was established, so the artifact is self-describing. */
  readonly method: "containment" | "containment+mutation"
}

/**
 * One projected fixture, pre-serialized so a probe can compare cheaply. `contract`
 * is the sealed contract JSON — the exact bytes whose hash is `contractDigest`, so
 * "the value does not appear in these bytes" is a real statement about the digest.
 */
export interface ProbeSubject {
  readonly canonicalSlug: string
  readonly projection: SafeInstallProjection
  readonly contractJson: string
  readonly html: string
  readonly contractDigest: string
}

/** Project + serialize one fixture input into a probe subject. Pure. */
export function toProbeSubject(input: SafeInstallProjectionInput): ProbeSubject {
  const projection = safeInstallProjection(input)
  return {
    canonicalSlug: projection.canonicalSlug,
    projection,
    contractJson: JSON.stringify(projection.agentContract),
    html: renderSafeInstall(projection),
    contractDigest: projection.agentContract.contract.contractDigest,
  }
}

/**
 * Probe one copy site across every subject.
 *
 * `values` are the literal strings the constant can emit. Reachability is measured
 * by CONTAINMENT in the sealed contract bytes: `contractDigest` is a hash of those
 * bytes, so a string absent from all of them provably cannot have contributed to
 * the digest — for any input, not just the ones probed. That is a stronger claim
 * than a single mutation, and it needs no seam in shipped code.
 *
 * `mutate` is optional and adds real mutation where a seam exists: it re-projects
 * with the copy perturbed and the digest is compared directly. When supplied, both
 * methods must agree.
 */
export function probeCopySite(
  decl: CopySiteDeclaration,
  values: readonly string[],
  subjects: readonly ProbeSubject[],
  mutate?: (s: ProbeSubject) => { contractDigest: string; html: string; routeKey: string },
): CopyProbeResult {
  const failures: string[] = []
  // Only values that actually reach the page can be judged: a constant whose
  // branch never renders for these fixtures would otherwise look "isolated" for
  // the trivial reason that it is absent everywhere.
  const rendered = values.filter((v) =>
    renderedForms(v).some((form) => subjects.some((s) => s.html.includes(form))),
  )
  const inContract = values.filter((v) => subjects.some((s) => s.contractJson.includes(v)))

  let contractDigestMoved = inContract.length > 0
  let htmlMoved = rendered.length > 0
  let decisionRouteMoved = false

  if (mutate !== undefined) {
    for (const s of subjects) {
      const m = mutate(s)
      if (m.contractDigest !== s.contractDigest) contractDigestMoved = true
      if (m.html !== s.html) htmlMoved = true
      if (m.routeKey !== routeKey(s.projection)) decisionRouteMoved = true
    }
  }

  const measuredPlane: CopyPlane = contractDigestMoved ? "decision" : "presentation"
  if (measuredPlane !== decl.declaredPlane) {
    failures.push(
      `declared ${decl.declaredPlane} but measured ${measuredPlane}` +
        (inContract.length > 0 ? ` — value(s) present in sealed contract bytes: ${inContract.join(", ")}` : ""),
    )
  }
  // A presentation-plane claim is only meaningful if the value reaches the page.
  if (decl.declaredPlane === "presentation" && !htmlMoved) {
    failures.push("vacuous probe: no probed value appears in any rendered page, so isolation is untested")
  }
  if (decl.declaredPlane === "presentation" && decisionRouteMoved) {
    failures.push("mutating presentation copy moved verdict / installability / next-action kind (INV-P2)")
  }
  // The negative control: an L3 site must be demonstrably reachable, or the probe
  // cannot detect reachability at all and every other row is worthless.
  if (decl.declaredPlane === "decision" && !contractDigestMoved) {
    failures.push("negative control failed: an L3 site was not detected as reaching the contract")
  }

  return {
    constant: decl.constant,
    source: decl.source,
    declaredLevel: decl.declaredLevel,
    declaredPlane: decl.declaredPlane,
    configurableTo: decl.configurableTo,
    rationale: decl.rationale,
    mutation:
      mutate !== undefined
        ? `containment over ${values.length} value(s) + re-projection with copy replaced by ${PROBE_SENTINEL}`
        : `containment over ${values.length} value(s) in sealed contract bytes`,
    contractDigestMoved,
    htmlMoved,
    decisionRouteMoved,
    measuredPlane,
    pass: failures.length === 0,
    failures,
    method: mutate !== undefined ? "containment+mutation" : "containment",
  }
}

/** The decision route as one comparable key (INV-P2's invariant triple). */
function routeKey(p: SafeInstallProjection): string {
  return [
    p.publicObservation.verdict,
    p.installability,
    p.agentContract.recommendedNextAction.kind,
  ].join("|")
}

/**
 * Every form the renderer can emit a copy value in, so containment is checked against
 * the bytes that actually ship.
 *
 * There are two, and the difference is load-bearing for this probe: the renderer uses an
 * attribute-grade escape for values that may land in an attribute, and a text-grade one
 * (`&`/`<`/`>` only) for element text. A probe that mirrored only the attribute form
 * would under-count — the publisher-block title contains an apostrophe, which the
 * attribute escape turns into `&#39;` and the text escape leaves alone — and would then
 * report a real copy site as "never rendered". Checking both is what keeps `htmlMoved`
 * a measurement rather than an artifact of which escape the probe happened to guess.
 */
function renderedForms(s: string): string[] {
  const text = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return [text, text.replace(/"/g, "&quot;").replace(/'/g, "&#39;")]
}

/** The audit's verdict over every probed site. */
export interface PresentationAuditResult {
  readonly probes: readonly CopyProbeResult[]
  readonly sitesProbed: number
  readonly presentationSites: number
  readonly decisionSites: number
  /** Every probe passed AND at least one negative control was present. */
  readonly pass: boolean
  readonly failures: readonly string[]
}

/**
 * Grade the whole audit. Requires at least one decision-plane row: without a
 * negative control the suite could pass by measuring nothing at all.
 */
export function gradePresentationAudit(probes: readonly CopyProbeResult[]): PresentationAuditResult {
  const failures = probes.flatMap((p) => p.failures.map((f) => `${p.constant}: ${f}`))
  const decisionSites = probes.filter((p) => p.declaredPlane === "decision").length
  if (decisionSites === 0) {
    failures.push("audit has no decision-plane row — the probe's ability to detect reachability is unverified")
  }
  return {
    probes,
    sitesProbed: probes.length,
    presentationSites: probes.filter((p) => p.declaredPlane === "presentation").length,
    decisionSites,
    pass: failures.length === 0,
    failures,
  }
}

// --- the declared copy inventory (ADR 0058 §1; new15 §4.2 P2/P4/P5/P6) --------

/**
 * Every hardcoded copy site on the Safe-install surface, with the level CLAIMED for
 * it. Nothing here is trusted: `probeCopySite` measures each row, and a declaration
 * that disagrees with its measurement fails the audit. This table is therefore a
 * hypothesis under test, not documentation.
 *
 * `configurableTo` is the Workstream P destination from new15 §18.2, or null for a
 * site that stays in code permanently (ADR 0058 §6).
 */
export const COPY_SITES: readonly CopySiteDeclaration[] = [
  {
    constant: "OBSERVED_CONSEQUENCE",
    source: "packages/trust-index/src/selectDecisionAuthorities.ts",
    declaredLevel: "L2",
    declaredPlane: "presentation",
    configurableTo: "apps/web/content/safe-install/presentation.v1.json#/authorityCopy/observedPhrases",
    rationale:
      "Security-explanation wording per shipped reason code. The contract carries the authority TOKEN in authorityDelta.adds, never this sentence.",
  },
  {
    constant: "ABSENCE_CONSEQUENCE",
    source: "packages/trust-index/src/selectDecisionAuthorities.ts",
    declaredLevel: "L2",
    declaredPlane: "presentation",
    configurableTo: "apps/web/content/safe-install/presentation.v1.json#/authorityCopy/absencePhrases",
    rationale:
      "Neutral absence wording. Must stay an observation and is never rendered as denied/absent/impossible (ADR 0058 §3).",
  },
  {
    constant: "PRIMARY_CTA",
    source: "packages/trust-index/src/safeInstallProjection.ts",
    declaredLevel: "L1",
    declaredPlane: "presentation",
    configurableTo: "apps/web/content/safe-install/presentation.v1.json#/decisionCopy/states",
    rationale:
      "Cognitive copy for the single primary action. The ROUTE (installability) is code; only its wording is config.",
  },
  {
    // Added by PR P-2, the batch that LIFTED it. A copy site the audit does not probe is
    // a copy site with no boundary, so the table grows with each lift — never after it.
    constant: "SECTION_TITLES",
    source: "packages/trust-index/src/renderSafeInstall.ts",
    declaredLevel: "L1",
    declaredPlane: "presentation",
    configurableTo: "apps/web/content/safe-install/presentation.v1.json#/sectionTitles",
    rationale:
      "Renderer section headings. Wording is cognitive copy; the POSITION and the key set stay code, so no document can move publisher text into a decision group (INV-2.4-05).",
  },
  {
    // Added by PR P-4b, the batch that WIRED it. Same rule as SECTION_TITLES above: the
    // table grows with each lift, in the lift's own commit, because a copy site the audit
    // does not probe is a copy site with no boundary.
    //
    // This row is different from every other presentation row in one way worth stating: it
    // is the only value that reaches an HTML ATTRIBUTE rather than a text node, so its
    // failure mode is a network request rather than a misleading sentence. The probe still
    // asks the same question — can it reach `contractDigest`? — and the answer is still no.
    // What keeps the ATTRIBUTE risk from being unmeasured is not this row but
    // `usableStylesheetHref` in the resolver plus the plane audit's foreign-href check.
    constant: "STYLESHEET_HREF",
    source: "packages/trust-index/src/safe-install/tokenPlane.ts",
    declaredLevel: "L0",
    declaredPlane: "presentation",
    configurableTo: "apps/web/content/safe-install/presentation.v1.json#/tokens/stylesheetHref",
    rationale:
      "The L0 href the install page links (PR P-4b). Reaches served bytes but no digest: a stylesheet cannot compute a verdict, and the resolver refuses any href that is not a rooted same-origin .css path.",
  },
  {
    constant: "VERDICT_PUBLIC_LABEL",
    source: "packages/types/src/verdict.ts",
    declaredLevel: "L3",
    declaredPlane: "decision",
    configurableTo: null,
    rationale:
      "NEGATIVE CONTROL. Reaches publicObservation.publicLabel inside the sealed contract, so it is bound by contractDigest and unforkable (INV-P4).",
  },
  {
    constant: "AGENT_GUIDANCE.steps",
    source: "packages/trust-index/src/agentAdoptionContract.ts",
    declaredLevel: "L3",
    declaredPlane: "decision",
    configurableTo: null,
    rationale:
      "AgentProtocolPolicy (new15 §20.1). Protocol steps are bound by contractDigest; only AgentRelayCopy is L1-editable.",
  },
]

/**
 * Run the whole audit over the given fixture inputs.
 *
 * The authority-consequence rows get the stronger treatment: a real re-projection
 * through `safeInstallProjection` with the authority selection's consequence
 * sentences replaced by the sentinel. That exercises the shipped seam — the same
 * call the bake makes — so "copy cannot reach the digest" is measured on the real
 * path, not on a hand-built object.
 */
export function runPresentationAudit(
  inputs: readonly SafeInstallProjectionInput[],
  values: {
    readonly observedConsequence: readonly string[]
    readonly absenceConsequence: readonly string[]
    readonly primaryCta: readonly string[]
    readonly sectionTitles: readonly string[]
    readonly stylesheetHref: readonly string[]
    readonly verdictLabel: readonly string[]
    readonly guidanceSteps: readonly string[]
  },
): PresentationAuditResult {
  const subjects = inputs.map(toProbeSubject)
  const byConstant = new Map(COPY_SITES.map((s) => [s.constant, s]))
  const decl = (name: string): CopySiteDeclaration => {
    const d = byConstant.get(name)
    if (d === undefined) throw new Error(`presentationAudit: no declaration for ${name}`)
    return d
  }

  // The real mutation seam. Consequence sentences reach the contract builder ONLY
  // through its `selection` argument, so the honest probe rebuilds and RESEALS the
  // contract from a selection whose sentences are the sentinel. Mutating the
  // projection's output copy while leaving its contract untouched would be circular
  // — it would assume the isolation it is supposed to measure.
  const mutateConsequences = (s: ProbeSubject) => {
    const input = inputs.find((i) => i.subject.canonicalSlug === s.canonicalSlug)
    if (input === undefined) throw new Error(`presentationAudit: lost input for ${s.canonicalSlug}`)
    const real = selectDecisionAuthorities(input.page)
    const sentinelSelection: DecisionAuthoritySelection = {
      ...real,
      consequenceSummary: PROBE_SENTINEL,
      facts: real.facts.map((f) => ({ ...f, consequence: PROBE_SENTINEL })),
    }
    const resealed = sealAgentAdoptionContract(
      buildAgentAdoptionContract({
        page: input.page,
        subject: input.subject,
        selection: sentinelSelection,
        snapshotDigest: input.snapshotDigest,
        registrySnapshotDigest: input.registrySnapshotDigest,
        evidenceDigest: input.evidenceDigest,
        engineVersion: input.engineVersion,
        unsupported: input.unsupported,
      }),
      hashJson,
    )
    // The page side of the same mutation, so `htmlMoved` is measured too.
    const withSentinel: SafeInstallProjection = {
      ...s.projection,
      agentContract: resealed,
      consequenceSummary: PROBE_SENTINEL,
      authorityDecisionFacts: sentinelSelection.facts,
    }
    return {
      contractDigest: resealed.contract.contractDigest,
      html: renderSafeInstall(withSentinel),
      routeKey: routeKey(withSentinel),
    }
  }

  // PRIMARY_CTA has no path into the builder at all — it is not one of
  // `AgentAdoptionContractInput`'s fields, which is itself the structural proof.
  // So the mutation here is render-only, and containment carries the digest claim.
  const mutateCta = (s: ProbeSubject) => {
    const withSentinel: SafeInstallProjection = {
      ...s.projection,
      humanDisposition: { ...s.projection.humanDisposition, primaryCta: PROBE_SENTINEL },
    }
    return {
      contractDigest: withSentinel.agentContract.contract.contractDigest,
      html: renderSafeInstall(withSentinel),
      routeKey: routeKey(withSentinel),
    }
  }

  // SECTION_TITLES is passed to the RENDERER, never to the projection or the builder —
  // so the mutation is applied at the real shipped seam (`renderSafeInstall`'s second
  // argument, the one the emit edge now supplies) and the sealed contract is reused
  // untouched. If a future refactor routed titles through the contract, `inContract`
  // would catch it even though this mutation cannot.
  const mutateSectionTitles = (s: ProbeSubject) => ({
    contractDigest: s.contractDigest,
    html: renderSafeInstall(s.projection, {
      authorityFacts: PROBE_SENTINEL,
      // Wired by R-2 (the visible `mustAskBefore` block), so it is measured like the rest.
      agentReads: PROBE_SENTINEL,
      // Also R-2: the value line above the button. Mutated here so the audit proves this
      // sentence cannot reach the contract digest or the route either — it is the most
      // claim-like copy on the page, so leaving it unprobed would be the wrong omission.
      valueLine: PROBE_SENTINEL,
      // The protection badge (R-2). Probed for the same reason the value line is: it makes
      // the strongest brand claim on the page, so the audit must show that claim cannot
      // reach the contract digest or move the route.
      protectionBadge: PROBE_SENTINEL,
      consequenceHeading: PROBE_SENTINEL,
      consequenceLead: PROBE_SENTINEL,
      reasonCodesHeading: PROBE_SENTINEL,
      provenance: PROBE_SENTINEL,
      publisherBlock: PROBE_SENTINEL,
      // Wired by P-4b, so it is now part of this probe's mutation rather than a
      // deferred slot the sentinel could not reach.
      boundary: PROBE_SENTINEL,
    }),
    routeKey: routeKey(s.projection),
  })

  // STYLESHEET_HREF (PR P-4b) mutates at the renderer's FOURTH argument — the same seam
  // the emit edge supplies — and reuses the sealed contract untouched, exactly as the
  // section-titles probe does. A stylesheet href has no path into
  // `AgentAdoptionContractInput`, which is the structural half of the claim; containment
  // over the shipped href is the measured half.
  const mutateTokens = (s: ProbeSubject) => ({
    contractDigest: s.contractDigest,
    html: renderSafeInstall(s.projection, SECTION_TITLES, DEFAULT_LAYOUT, {
      tokensVersion: PROBE_SENTINEL,
      stylesheetHref: `/${PROBE_SENTINEL}.css`,
    }),
    routeKey: routeKey(s.projection),
  })

  return gradePresentationAudit([
    probeCopySite(decl("OBSERVED_CONSEQUENCE"), values.observedConsequence, subjects, mutateConsequences),
    probeCopySite(decl("ABSENCE_CONSEQUENCE"), values.absenceConsequence, subjects, mutateConsequences),
    probeCopySite(decl("PRIMARY_CTA"), values.primaryCta, subjects, mutateCta),
    probeCopySite(decl("SECTION_TITLES"), values.sectionTitles, subjects, mutateSectionTitles),
    probeCopySite(decl("STYLESHEET_HREF"), values.stylesheetHref, subjects, mutateTokens),
    probeCopySite(decl("VERDICT_PUBLIC_LABEL"), values.verdictLabel, subjects),
    probeCopySite(decl("AGENT_GUIDANCE.steps"), values.guidanceSteps, subjects),
  ])
}
