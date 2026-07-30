// ---------------------------------------------------------------------------
// Workstream P Batch 2 — the presentation RESOLVER (new15 §6.2 PR P-2; ADR 0058
// §2/§3/§5). PURE + deterministic: no filesystem, no clock, no RNG, no LLM.
//
// P-1 shipped the content SCHEMA, its validator, and the digest seams but
// deliberately shipped no resolver, on the grounds that there was no caller until
// the first string was lifted. P-2 lifts the first strings, so this is that caller's
// missing half: it turns an untrusted, possibly-absent document into the TOTAL copy
// slices the projection and the renderer consume.
//
// THREE PROPERTIES, each chosen because its opposite is a real failure mode:
//
//   1. FAIL OPEN, PER SLOT. Every slot has a shipped code default. A missing file, a
//      malformed file, a rejected file, or a file that supplies three of five CTAs all
//      resolve to a COMPLETE set. The alternative — treating configuration as
//      authoritative — means a typo in a content file ships a page with a blank
//      button. Presentation must degrade to the shipped wording, never to nothing
//      (ADR 0058 §5 INV-P3).
//
//   2. MERGE PER SLOT, NOT PER SECTION. Supplying `decisionCopy` must not erase the
//      four CTAs it did not mention. Per-section replacement makes every partial
//      document a silent deletion; per-slot merge makes it exactly the edit it looks
//      like.
//
//   3. NARROW WHAT TRAVELS INWARD. The resolver returns small slices, and each
//      consumer is handed only its own. `selectDecisionAuthorities` receives authority
//      wording and cannot see CTAs; the renderer receives titles, layout, and — since
//      PR P-4b — tokens, and cannot see either. The href is the one resolved value that
//      reaches an attribute on a served page, so it gets its own stricter predicate
//      (`usableStylesheetHref`) rather than sharing the text-grade one.
//      Combined with ADR 0058 §2's "configuration is a parameter, never an import",
//      the blast radius of a bad document is bounded by what was handed to whom.
//
// WHAT THIS MODULE REFUSES, AND WHY REFUSING IS NOT THE SAME AS VALIDATING.
// `validatePresentationContent` is the reviewable gate: it runs in the lock script and
// FAILS CI with a precise message. This module runs at emit time on a document that
// already passed, and its rejections are a last-resort structural floor — non-string,
// empty-after-trim, over-long, or markup-bearing values fall back to the shipped
// default rather than reaching a page. Both exist on purpose: the validator makes a bad
// document a loud build failure, and this makes it a harmless one if it ever gets past.
// ---------------------------------------------------------------------------

import { PRIMARY_CTA, type Installability } from "../safeInstallProjection.js"
import { SECTION_TITLES, type SectionTitles } from "../renderSafeInstall.js"
import {
  ADOPTION_AUTHORITIES,
  DEFAULT_AUTHORITY_COPY,
  OBSERVED_CONSEQUENCE,
  ABSENCE_CONSEQUENCE,
  type AdoptionAuthority,
  type AuthorityCopy,
} from "../selectDecisionAuthorities.js"
import { PRESENTATION_STATES, type PresentationContentV1 } from "./presentationContent.js"
import { DEFAULT_TOKENS, type ResolvedTokens } from "./tokenPlane.js"
import {
  ABOVE_FOLD_SECTION_IDS,
  DEFAULT_LAYOUT,
  SHIPPED_LAYOUT_CAPS,
  checkLayoutSupport,
  clampCap,
  type AboveFoldSectionId,
  type ResolvedLayout,
} from "./layoutStructure.js"

export { DEFAULT_LAYOUT, type ResolvedLayout, DEFAULT_TOKENS, type ResolvedTokens }

/**
 * The `sectionTitles` slots the RENDERER actually consumes today.
 *
 * The schema declares four; this names three. `boundary` is schema-valid and
 * digest-bound but not yet wired, because its emitted form carries the renderer's HTML
 * fold indentation — see the `SECTION_TITLES` comment. Declaring the gap here (rather
 * than silently ignoring the key) is what lets `unwiredSectionTitles` report it, so a
 * document can never configure a slot that quietly does nothing.
 */
export const WIRED_SECTION_TITLES: readonly (keyof SectionTitles)[] = [
  "authorityFacts",
  "agentReads",
  "valueLine",
  "protectionBadge",
  "consequenceHeading",
  "consequenceLead",
  "reasonCodesHeading",
  "provenance",
  "publisherBlock",
  "boundary",
]

/**
 * Copy slots declared by the schema but consumed by no renderer.
 *
 * EMPTY since PR P-4b, which wired `boundary` — the slot P-2 deferred because its
 * emitted form was folded across three source lines and unfolding it would have moved
 * served bytes outside the one PR licensed to do that. Every schema slot is now wired.
 *
 * The list stays as a named export rather than being deleted, because it is the
 * mechanism that makes a FUTURE deferral visible: `unwiredSlots` is a lock failure, so
 * a slot added to the schema and not to a renderer fails CI instead of validating and
 * then doing nothing. Its test is now a synthetic positive control — an empty list
 * would otherwise make that test pass by measuring nothing.
 */
export const UNWIRED_SECTION_TITLES: readonly string[] = []

/** Upper bound on one copy value, mirroring the schema's `copyText.maxLength`. */
const MAX_COPY_LENGTH = 400

/** The fully-resolved copy, total in every slot. Safe to hand to a renderer as-is. */
export interface ResolvedPresentation {
  /** L1 — wording for the single primary action, per shipped route state. */
  readonly primaryCta: Record<Installability, string>
  /** L2 — observed/absence consequence wording, per shipped authority token. */
  readonly authority: AuthorityCopy
  /** L1 — the renderer's fixed section titles. */
  readonly sectionTitles: SectionTitles
  /** L1 — section order + render caps (PR P-3). */
  readonly layout: ResolvedLayout
  /**
   * L0 — the token plane's version + the href the page links (PR P-4b). The only
   * resolved value on this surface that reaches an ATTRIBUTE, and the only one that
   * reaches served bytes without passing through a text node.
   */
  readonly tokens: ResolvedTokens
  /** Which slots came from configuration, in stable order. A measurement, for the lock. */
  readonly overriddenSlots: readonly string[]
  /** Configured slots that no renderer consumes yet. Non-empty ⇒ the lock gate fails. */
  readonly unwiredSlots: readonly string[]
  /**
   * Configured slots REJECTED at resolve time, with a cause (PR P-3). A rejection is
   * already a silent fail-open by design (INV-P3), which is exactly why it must be
   * visible: the lock records these, so "the document I committed is not the document
   * being served" cannot be a quiet condition. Empty for every valid document.
   */
  readonly rejectedSlots: readonly string[]
}

/** The shipped defaults, resolved from no document at all. */
export const DEFAULT_PRESENTATION: ResolvedPresentation = Object.freeze({
  primaryCta: PRIMARY_CTA,
  authority: DEFAULT_AUTHORITY_COPY,
  sectionTitles: SECTION_TITLES,
  layout: DEFAULT_LAYOUT,
  tokens: DEFAULT_TOKENS,
  overriddenSlots: Object.freeze([]),
  unwiredSlots: Object.freeze([]),
  rejectedSlots: Object.freeze([]),
})

/**
 * Is this a usable copy value?
 *
 * Rejects non-strings, blank-after-trim (a deletion disguised as an edit), over-long
 * values, and anything carrying `<` or `>`. The markup rule is the load-bearing one:
 * the renderer escapes text, so markup could not inject — it would emit visible
 * entities instead. Refusing here means a stray tag degrades to the shipped sentence
 * rather than shipping `&lt;b&gt;` to a reader.
 */
function usableCopy(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= MAX_COPY_LENGTH &&
    !/[<>]/.test(value)
  )
}

/**
 * Is this a usable STYLESHEET HREF? Stricter than `usableCopy`, and deliberately so.
 *
 * Every other slot this module resolves lands in a text node, where the worst a bad
 * value can do is read badly. This one lands in `<link href>` on a served page, where
 * a bad value is a NETWORK REQUEST — the failure mode is a trust surface fetching
 * bytes this repo does not commit, which would end the offline-verifiable-provenance
 * claim regardless of what the sheet contained.
 *
 * So the rule is allow-list, not deny-list: a same-origin ABSOLUTE path, one leading
 * slash, no scheme, no `//` authority, no `\` (which some parsers fold to `/`), no
 * backtracking, no query or fragment. `//evil.example/x.css` is the case a naive
 * "starts with /" check waves through, and it is a protocol-relative absolute URL.
 *
 * A rejected href falls back to the shipped default and is RECORDED in `rejectedSlots`,
 * which the lock fails on — so the served page keeps its own stylesheet rather than
 * losing its styling, and the bad document cannot be quiet about it.
 */
function usableStylesheetHref(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\/[A-Za-z0-9._~\-/]*$/.test(value) &&
    !value.startsWith("//") &&
    !value.includes("..") &&
    value.endsWith(".css")
  )
}

/**
 * Merge one configured record over a total default, per key.
 *
 * Only keys the default already declares are considered, so configuration cannot coin
 * a state or an authority token — it selects among what code implements (ADR 0058 §3).
 * Unusable values are skipped, which is why the result stays total.
 */
function mergeSlots<K extends string>(
  defaults: Record<K, string>,
  configured: Readonly<Record<string, unknown>> | undefined,
  keys: readonly K[],
  slotPath: (key: K) => string,
  overridden: string[],
): Record<K, string> {
  if (configured === undefined) return defaults
  const out = { ...defaults }
  for (const key of keys) {
    const value = configured[key]
    if (value === undefined) continue
    if (!usableCopy(value)) continue
    out[key] = value
    overridden.push(slotPath(key))
  }
  return out
}

/**
 * Resolve a presentation document into total copy slices.
 *
 * `doc` is `null`/`undefined` when there is no content plane, and may be an arbitrary
 * parsed JSON value otherwise — this function assumes nothing about its shape and
 * narrows every access. Same input ⇒ deep-equal output; no I/O.
 *
 * The identity that keeps ADR 0058 §4 honest: resolving the document that supplies
 * exactly the shipped defaults is deep-equal to `DEFAULT_PRESENTATION` in every copy
 * slot, so committing the catalog cannot move a served byte. That is asserted as a
 * test, not assumed here.
 */
export function resolvePresentation(doc: unknown): ResolvedPresentation {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return DEFAULT_PRESENTATION
  const d = doc as Partial<PresentationContentV1> & Record<string, unknown>

  const overridden: string[] = []

  // L1 — decisionCopy.states[STATE].primaryAction. The state key set is the shipped
  // `PRESENTATION_STATES`; a key outside it is ignored here and rejected by the schema.
  const states = (d.decisionCopy as { states?: Record<string, unknown> } | undefined)?.states
  const ctaConfigured: Record<string, unknown> = {}
  if (states !== null && typeof states === "object" && states !== undefined) {
    for (const state of PRESENTATION_STATES) {
      const entry = (states as Record<string, unknown>)[state]
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue
      const action = (entry as Record<string, unknown>).primaryAction
      if (action !== undefined) ctaConfigured[state] = action
    }
  }
  const primaryCta = mergeSlots(
    PRIMARY_CTA,
    Object.keys(ctaConfigured).length > 0 ? ctaConfigured : undefined,
    PRESENTATION_STATES as readonly Installability[],
    (state) => `decisionCopy.states.${state}.primaryAction`,
    overridden,
  )

  // L2 — authorityCopy.{observedPhrases,absencePhrases}, keyed by shipped authority.
  const authorityCopy = d.authorityCopy as
    | { observedPhrases?: Record<string, unknown>; absencePhrases?: Record<string, unknown> }
    | undefined
  const observed = mergeSlots(
    OBSERVED_CONSEQUENCE,
    objectOrUndefined(authorityCopy?.observedPhrases),
    ADOPTION_AUTHORITIES as readonly AdoptionAuthority[],
    (a) => `authorityCopy.observedPhrases.${a}`,
    overridden,
  )
  const absence = mergeSlots(
    ABSENCE_CONSEQUENCE,
    objectOrUndefined(authorityCopy?.absencePhrases),
    ADOPTION_AUTHORITIES as readonly AdoptionAuthority[],
    (a) => `authorityCopy.absencePhrases.${a}`,
    overridden,
  )

  // L1 — the renderer's fixed section titles, wired slots only.
  const configuredTitles = objectOrUndefined(d.sectionTitles as Record<string, unknown> | undefined)
  const sectionTitles = mergeSlots(
    SECTION_TITLES,
    configuredTitles,
    WIRED_SECTION_TITLES,
    (k) => `sectionTitles.${k}`,
    overridden,
  )

  // A configured slot that no renderer reads would be a config edit with no effect —
  // the exact drift a lock file exists to catch, so it is MEASURED and reported.
  //
  // Computed as "configured but NOT WIRED" rather than "in the deferral list", changed in
  // PR P-4b. The old form enumerated UNWIRED_SECTION_TITLES, which became empty when this
  // batch wired `boundary` — leaving the mechanism live but with nothing to match, so it
  // would have reported nothing forever. This form derives the answer from the wired set,
  // so it keeps working with an empty deferral list AND catches a case the old one missed
  // entirely: a MISSPELLED key (`provenence`) is not a declared deferral, so it was
  // silently dropped by the per-key merge and reported by nothing.
  const unwiredSlots =
    configuredTitles === undefined
      ? []
      : Object.keys(configuredTitles)
          .filter((k) => !(WIRED_SECTION_TITLES as readonly string[]).includes(k))
          .sort()
          .map((k) => `sectionTitles.${k}`)

  // L1 — the LAYOUT MANIFEST (PR P-3). Three separate decisions, deliberately not
  // collapsed into one "is this layout ok" branch, because they fail for different
  // reasons and a reviewer needs to know which:
  //
  //   • groupOrder is checked for STRUCTURAL SUPPORT, not just permutation-ness. An
  //     unsupported order falls back to the shipped section sequence and is RECORDED as
  //     rejected — never emitted as an approximation, because a half-honoured layout is
  //     worse than the shipped one: it looks intentional.
  //   • each cap is clamped into [min, shipped]. Clamping rather than rejecting is right
  //     here because the failure is bounded and monotone in the safe direction — a cap
  //     can only ever hide facts, never manufacture them — but an OUT-OF-RANGE cap is
  //     still recorded, so "I asked for 5 and got 3" is visible rather than silent.
  //   • absent layout ⇒ the shipped default, contributing no overrides.
  const rejected: string[] = []
  const layoutRaw = objectOrUndefined(d.layout as Record<string, unknown> | undefined)
  // PRESENT-BUT-MALFORMED is not the same as ABSENT, and collapsing them would defeat the
  // point of `rejectedSlots`: `layout: "left-to-right"` would fall back to the shipped page
  // in silence, so a committed document that describes nothing servable would read as a
  // document that asked for nothing. Absent stays silent (that is the shipped default, not
  // a fallback); a non-object is recorded.
  if (d.layout !== undefined && layoutRaw === undefined) {
    rejected.push("layout: not an object")
  }
  let layout: ResolvedLayout = DEFAULT_LAYOUT
  if (layoutRaw !== undefined) {
    let sectionOrder: readonly AboveFoldSectionId[] = ABOVE_FOLD_SECTION_IDS
    const order = layoutRaw.groupOrder
    if (order !== undefined) {
      if (!Array.isArray(order)) {
        rejected.push("layout.groupOrder: not an array")
      } else {
        const support = checkLayoutSupport(order)
        if (support.supported && support.sectionOrder !== null) {
          sectionOrder = support.sectionOrder
          // Only a REORDERING is an override; restating the shipped order is not an edit.
          if (sectionOrder.join(",") !== ABOVE_FOLD_SECTION_IDS.join(",")) {
            overridden.push("layout.groupOrder")
          }
        } else {
          rejected.push(`layout.groupOrder: ${support.reason ?? "unsupported"}`)
        }
      }
    }
    const facts = capOrReject(
      layoutRaw.maxAuthorityFacts,
      SHIPPED_LAYOUT_CAPS.maxAuthorityFacts,
      1,
      "layout.maxAuthorityFacts",
      overridden,
      rejected,
    )
    const links = capOrReject(
      layoutRaw.maxSecondaryLinks,
      SHIPPED_LAYOUT_CAPS.maxSecondaryLinks,
      0,
      "layout.maxSecondaryLinks",
      overridden,
      rejected,
    )
    layout = { sectionOrder, maxAuthorityFacts: facts, maxSecondaryLinks: links }
  }

  // L0 — the TOKEN block (PR P-4b). Two slots, resolved by different predicates
  // because they carry different risk: `tokensVersion` is a label that reaches no
  // page, while `stylesheetHref` reaches a served attribute and can cause a fetch.
  //
  // Present-but-malformed is recorded, absent is silent — the same asymmetry the
  // layout block uses above, and for the same reason: a committed `tokens: 3` that
  // fell back in silence would read as a document that asked for nothing.
  const tokensRaw = objectOrUndefined(d.tokens as Record<string, unknown> | undefined)
  if (d.tokens !== undefined && tokensRaw === undefined) {
    rejected.push("tokens: not an object")
  }
  let tokens: ResolvedTokens = DEFAULT_TOKENS
  if (tokensRaw !== undefined) {
    let tokensVersion = DEFAULT_TOKENS.tokensVersion
    if (tokensRaw.tokensVersion !== undefined) {
      if (usableCopy(tokensRaw.tokensVersion)) {
        tokensVersion = tokensRaw.tokensVersion
        if (tokensVersion !== DEFAULT_TOKENS.tokensVersion) overridden.push("tokens.tokensVersion")
      } else {
        rejected.push("tokens.tokensVersion: not a usable string")
      }
    }
    let stylesheetHref = DEFAULT_TOKENS.stylesheetHref
    if (tokensRaw.stylesheetHref !== undefined) {
      if (usableStylesheetHref(tokensRaw.stylesheetHref)) {
        stylesheetHref = tokensRaw.stylesheetHref
        if (stylesheetHref !== DEFAULT_TOKENS.stylesheetHref) overridden.push("tokens.stylesheetHref")
      } else {
        // No echo of the offending value: it is attacker-influenced text bound for a
        // CI log and a committed artifact, and the slot name is what a reviewer needs.
        rejected.push("tokens.stylesheetHref: not a rooted same-origin .css path")
      }
    }
    tokens = { tokensVersion, stylesheetHref }
  }

  return {
    primaryCta,
    authority: { observed, absence },
    sectionTitles,
    layout,
    tokens,
    overriddenSlots: overridden.sort(),
    unwiredSlots,
    rejectedSlots: rejected.sort(),
  }
}

/**
 * Clamp one configured cap, recording whether it was an honoured narrowing or an
 * out-of-range value that got clamped. Restating the shipped value is neither.
 */
function capOrReject(
  raw: unknown,
  shipped: number,
  min: number,
  slot: string,
  overridden: string[],
  rejected: string[],
): number {
  if (raw === undefined) return shipped
  const clamped = clampCap(raw, shipped, min)
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    rejected.push(`${slot}: not an integer`)
    return clamped
  }
  if (raw > shipped || raw < min) {
    rejected.push(`${slot}: ${raw} out of range [${min}, ${shipped}] — clamped to ${clamped}`)
    return clamped
  }
  if (clamped !== shipped) overridden.push(slot)
  return clamped
}

/** Narrow to a plain object, or undefined — arrays and null are not copy records. */
function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
