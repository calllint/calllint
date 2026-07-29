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
//   3. NARROW WHAT TRAVELS INWARD. The resolver returns three small slices, and each
//      consumer is handed only its own. `selectDecisionAuthorities` receives authority
//      wording and cannot see CTAs; the renderer receives titles and cannot see either.
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
  "provenance",
  "publisherBlock",
]

/** Copy slots declared by the schema but not yet consumed by a renderer (P-3/P-4b). */
export const UNWIRED_SECTION_TITLES: readonly string[] = ["boundary"]

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
  /** Which slots came from configuration, in stable order. A measurement, for the lock. */
  readonly overriddenSlots: readonly string[]
  /** Configured slots that no renderer consumes yet. Non-empty ⇒ the lock gate fails. */
  readonly unwiredSlots: readonly string[]
}

/** The shipped defaults, resolved from no document at all. */
export const DEFAULT_PRESENTATION: ResolvedPresentation = Object.freeze({
  primaryCta: PRIMARY_CTA,
  authority: DEFAULT_AUTHORITY_COPY,
  sectionTitles: SECTION_TITLES,
  overriddenSlots: Object.freeze([]),
  unwiredSlots: Object.freeze([]),
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
  const unwiredSlots =
    configuredTitles === undefined
      ? []
      : UNWIRED_SECTION_TITLES.filter((k) => configuredTitles[k] !== undefined).map(
          (k) => `sectionTitles.${k}`,
        )

  return {
    primaryCta,
    authority: { observed, absence },
    sectionTitles,
    overriddenSlots: overridden.sort(),
    unwiredSlots,
  }
}

/** Narrow to a plain object, or undefined — arrays and null are not copy records. */
function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
