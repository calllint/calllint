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

import { DEFAULT_GUARD_OFFER_COPY, type GuardOfferCopy } from "@calllint/core"
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
import {
  LEVEL_BY_SECTION,
  PRESENTATION_STATES,
  type PresentationContentV1,
  type PresentationSection,
} from "./presentationContent.js"
import { DEFAULT_TOKENS, type ResolvedTokens } from "./tokenPlane.js"
import {
  AGENT_RELAY_SLOTS,
  DEFAULT_AGENT_RELAY_COPY,
  WIRED_AGENT_RELAY,
  type AgentRelayCopy,
} from "./agentRelay.js"
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
export { DEFAULT_AGENT_RELAY_COPY, type AgentRelayCopy }

/**
 * The `sectionTitles` slots the RENDERER actually consumes today — all ten of them.
 *
 * Complete since PR P-4b wired `boundary`, the one slot P-2 deferred because its emitted
 * form was folded across three source lines. This array is now the section's full wired
 * set, and it is the reason a MISSPELLED key is catchable: `unwiredSlots` is derived by
 * subtracting this list from what a document configured, so `provenence` is reported
 * rather than silently dropped by the per-key merge.
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

/**
 * The three guard slots configuration may reach. `declineLabel` is absent ON PURPOSE —
 * see `CODE_OWNED_SLOTS.guardConversion` for the measured reason.
 */
const WIRED_GUARD_SLOTS: readonly (keyof GuardOfferCopy)[] = [
  "offerHeadline",
  "offerBody",
  "acceptLabel",
]

/** Every guard slot the schema declares, in schema order — the classification domain. */
const GUARD_SLOTS: readonly string[] = ["offerHeadline", "offerBody", "declineLabel", "acceptLabel"]

/**
 * The per-resource override slots with a consumer. Three more are code-owned.
 *
 * Typed against `ResolvedResourceOverride` — the RESOLVED shape — not against the wider
 * `ResourceOverride` the schema declares. That is what makes the wired set and the resolved
 * record the same domain by construction: adding a name here without adding the field to
 * `ResolvedResourceOverride` is a typecheck error, so the resolver cannot honour a field it
 * has nowhere to put.
 */
const WIRED_OVERRIDE_SLOTS: readonly (keyof ResolvedResourceOverride)[] = ["displayName", "reason"]

/** Every override slot the schema's `resourceOverride` declares. */
const OVERRIDE_SLOTS: readonly string[] = [
  "displayName",
  "scopeAlias",
  "originalSetupUrl",
  "expiresAt",
  "reason",
]

/**
 * ENCODE a canonical slug into an `overrides.resources` KEY.
 *
 * The schema's `propertyNames.pattern` is `^[a-z0-9][a-z0-9._-]*$`, which admits no `/`.
 * Every one of the 19 committed canonical slugs contains a `/` (`io.github.owner/name`),
 * so **0 of 19** can be written literally. Measured, not assumed.
 *
 * THE TRAP THIS FUNCTION EXISTS TO CLOSE. The LEAF segment of a slug
 * (`ac.inference.sh-mcp`) *does* match the pattern, so the obvious attempt — key by the
 * part after the slash — validates cleanly and then silently addresses the wrong thing, or
 * collides across two publishers with the same package name. The shipped fixture's
 * slash-free `io.github.example-mcp` is why nobody hit this.
 *
 * So the key space is reached by ENCODING rather than by widening the schema:
 * `/` → `__`, which is measured legal (19/19 encoded keys match the pattern), injective
 * (19 unique), and unambiguous (`__` occurs in 0 real slugs, so decoding is exact).
 *
 * The pattern defect itself is RECORDED in the plane audit and left for an ADR to fix —
 * changing a schema file is not licensed in this batch. A round-trip test over all 19
 * committed slugs is what keeps this honest; a containment check would not catch the leaf.
 */
export function overrideKey(canonicalSlug: string): string {
  return canonicalSlug.replaceAll("/", "__")
}

/** Decode an `overrides.resources` key back to its canonical slug. Exact inverse. */
export function decodeOverrideKey(key: string): string {
  return key.replaceAll("__", "/")
}

/** The permitted per-resource override fields (ADR 0058 §3), all optional. */
export interface ResourceOverride {
  readonly displayName?: string
  readonly scopeAlias?: string
  readonly originalSetupUrl?: string
  readonly expiresAt?: string
  readonly reason?: string
}

/**
 * The resolved override slice: encoded key → the wired fields that survived resolution.
 *
 * Keyed by the ENCODED form, because that is what a document writes and what a lock
 * artifact must echo back for a reviewer to find. Consumers that hold a canonical slug
 * call `overrideKey` on it — one direction, one place.
 */
export interface ResolvedOverrides {
  readonly resources: Readonly<Record<string, ResolvedResourceOverride>>
}

/** One resource's honoured overrides. Absent field ⇒ the shipped derived value stands. */
export interface ResolvedResourceOverride {
  /** Replaces the projection's derived identity line — applied DOWNSTREAM of the seal. */
  readonly displayName?: string
  /** Why this override exists. Reaches the lock artifact; reaches no served byte. */
  readonly reason?: string
}

// --- the classification tables (PR P-5) -------------------------------------
//
// Two tables partition every configurable slot in the document. Together they are what
// makes `unwiredSlots` TOTAL — before P-5 the mechanism covered `sectionTitles` alone, so
// `guardConversion`, `agentRelayCopy` and `overrides` could be configured, validate clean,
// move `presentationDigest`, and reach nothing, tripping no gate. That is ADR 0058 §3's
// named drift ("a key that validates and then does nothing") and it was live in three
// places.
//
// Both tables are `satisfies Record<PresentationSection, …>`, so adding a 9th section to
// `LEVEL_BY_SECTION` without classifying its slots is a TYPECHECK error — the failure
// arrives before any gate runs. That is the P-4b `mutateSectionTitles` precedent (a 3-key
// literal became a compile error when a 4th key landed) applied to the resolver, and it is
// the difference between "declared with its reason" as a mechanism and as a claim.

/**
 * Slots with a REAL consumer, per section. `unwiredSlots` is derived by subtracting these
 * from what a document actually configured.
 *
 * Derived from the WIRED set, never from a deferral list. P-4b learned this the hard way:
 * `UNWIRED_SECTION_TITLES` went empty when `boundary` was wired, which left the mechanism
 * running with nothing to match — it would have reported nothing forever. Subtraction from
 * "what is wired" keeps working at an empty deferral list AND catches a case enumeration
 * never could: a misspelled key belongs to no declared bucket.
 *
 * Entries reuse the constants that already exist rather than restating them, so a slot
 * cannot be wired in one place and forgotten in the other.
 */
export const WIRED_SLOTS = {
  decisionCopy: PRESENTATION_STATES.map((s) => `states.${s}.primaryAction`),
  authorityCopy: [
    ...ADOPTION_AUTHORITIES.map((a) => `observedPhrases.${a}`),
    ...ADOPTION_AUTHORITIES.map((a) => `absencePhrases.${a}`),
  ],
  sectionTitles: WIRED_SECTION_TITLES,
  guardConversion: WIRED_GUARD_SLOTS,
  agentRelayCopy: WIRED_AGENT_RELAY,
  layout: ["groupOrder", "maxAuthorityFacts", "maxSecondaryLinks"],
  tokens: ["tokensVersion", "stylesheetHref"],
  // Override slots are PER-RESOURCE, so they are written in the wildcard form and matched
  // through `wildcardOf` — the resource key is caller data, so it cannot be enumerated the
  // way `decisionCopy`'s states are.
  //
  // That difference is load-bearing rather than stylistic. `decisionCopy` lists its states
  // CONCRETELY, so `states.NOT_A_STATE.primaryAction` matches no entry and gets reported;
  // if it were wildcarded, an invented state key would be silently accepted. Wildcards are
  // used only where the variable segment genuinely cannot be known.
  overrides: ["resources", ...WIRED_OVERRIDE_SLOTS.map((f) => `resources.*.${f}`)],
} as const satisfies Record<PresentationSection, readonly string[]>

/**
 * Slots that are CODE-OWNED BY DESIGN, each with the measured reason it cannot be wired.
 *
 * The reason is the point. A slot in this table is not "not done yet" — it is a slot that
 * *should not* be configurable, and a document that configures one gets a lock failure
 * naming why rather than a generic "unwired" with an empty list interpolated into it.
 *
 * Five distinct reasons cover every slot here, and each is a measurement:
 *   • L3 REACHABILITY — the value reaches `contractDigest`, so configuring it would move a
 *     sealed artifact (ADR 0058 §1).
 *   • NO SHIPPED COUNTERPART — the renderer emits nothing for it, so wiring it would ADD
 *     served bytes, which needs an ADR 0058 §4 license this batch does not have.
 *   • A SECURITY FLOOR COMPARES IT AS A LITERAL — configuration would be able to fail, or
 *     to weaken, its own gate.
 *   • NO CONSUMER EXISTS — repo-wide search finds no reader, so wiring it anywhere would be
 *     dishonest rather than useful.
 *   • CLOCK-DEPENDENT — honouring it needs a clock the reproducibility-gated bake cannot
 *     have without two bakes of one commit disagreeing.
 */
export const CODE_OWNED_SLOTS = {
  decisionCopy: {
    "states.*.headline":
      "L3: the state headline reaches contractDigest, so configuring it would move a sealed artifact",
    "states.*.supportingText":
      "no shipped counterpart: the renderer emits no supporting line, so wiring it would ADD served bytes (needs an ADR 0058 §4 license)",
    "states.*.secondaryLinkLabel":
      "no shipped counterpart: the renderer emits no secondary link, so wiring it would ADD served bytes (needs an ADR 0058 §4 license)",
  },
  authorityCopy: {},
  sectionTitles: {},
  guardConversion: {
    declineLabel:
      "security floor compares it as a literal: Gate 2.4-F asserts declineOption === 'Not now' and that '[Not now]' is rendered, and ContinuousProtectionOffer types the field as that literal — configuration reaching it could fail, or weaken, INV-2.4-07's own floor",
  },
  // Empty as of P-6: the five decision-relay slots gained a real consumer
  // (`composeRelayNotes` → the MCP prepare result's `notes[]`), so every slot moved into
  // `WIRED_AGENT_RELAY`. The compiler forces both edits to happen together — a slot left
  // here while also wired appears in both tables, which the totality test fails by name.
  agentRelayCopy: {},
  layout: {},
  tokens: {},
  overrides: {
    "resources.*.scopeAlias": "no consumer exists: repo-wide search finds no reader",
    "resources.*.originalSetupUrl": "no consumer exists: repo-wide search finds no reader",
    "resources.*.expiresAt":
      "clock-dependent: resolvePresentation is pure by contract and the install tree is reproducibility-gated, so honouring an expiry would make two bakes of one commit disagree",
  },
} as const satisfies Record<PresentationSection, Readonly<Record<string, string>>>

/**
 * Look up why a slot is code-owned, tolerating the per-key wildcard forms above.
 *
 * `decisionCopy` and `overrides` are keyed per-state and per-resource, so their table
 * entries are written with a `*` where the variable segment goes. Reporting has the
 * concrete path in hand (`states.BLOCKED.headline`), so it is normalized here rather than
 * enumerating every state × slot pair in the table — the pairs are mechanical, the reasons
 * are not.
 */
export function codeOwnedReason(
  section: PresentationSection,
  slotPath: string,
  wildcardPath?: string,
): string | undefined {
  const table: Readonly<Record<string, string>> = CODE_OWNED_SLOTS[section]
  return table[slotPath] ?? table[wildcardPath ?? wildcardOf(slotPath)]
}

/**
 * Normalize one concrete slot path to its wildcard form: `states.BLOCKED.headline` →
 * `states.*.headline`. Returns the path unchanged when it has no third segment.
 *
 * DERIVATION IS THE FALLBACK, NOT THE CONTRACT. It assumes the variable segment contains no
 * dot, which holds for `decisionCopy`'s state keys and fails for `overrides`' encoded slugs —
 * `resources.io.github.calllint__calllint.displayName` would wildcard `io`, i.e. address a
 * slot nobody wrote. So `collectUnwired`, which knows the variable segment because it is
 * iterating over it, passes `wildcardPath` explicitly and never relies on this. It stays for
 * the two-level call sites (tests, and a reviewer asking "why is this slot code-owned?")
 * where the derivation is exact.
 */
function wildcardOf(slotPath: string): string {
  const parts = slotPath.split(".")
  if (parts.length < 3) return slotPath
  return [parts[0], "*", ...parts.slice(2)].join(".")
}

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
  /**
   * L1 — the Guard offer's three configurable strings (PR P-5). Handed to
   * `continuousProtectionOffer({ copy })` at the bake/gate edge; reaches a TERMINAL, never
   * a served page, which is why lifting it is structurally zero-served-byte.
   */
  readonly guardConversion: GuardOfferCopy
  /**
   * L1 — relay wording an agent echoes (PR P-5; all six slots wired at P-6). The five
   * decision-relay slots compose into the MCP prepare result's `notes[]` through
   * `composeRelayNotes`, each sentence gated on the contract field it relays.
   * ADR 0058 §6: relay copy may never add or remove a protocol trigger.
   */
  readonly agentRelay: AgentRelayCopy
  /**
   * L1 — per-resource overrides, keyed by `overrideKey(canonicalSlug)` (PR P-5). Applied
   * strictly DOWNSTREAM of the seal, so an override can change what a page reads and can
   * never change what a contract digest covers.
   */
  readonly overrides: ResolvedOverrides
  /** Which slots came from configuration, in stable order. A measurement, for the lock. */
  readonly overriddenSlots: readonly string[]
  /**
   * Configured slots that reach nothing, each with the reason. Non-empty ⇒ the lock fails.
   *
   * TOTAL over all eight sections since PR P-5. Two causes land here and the message
   * distinguishes them: a slot in `CODE_OWNED_SLOTS` reports its measured reason, and a
   * slot in neither table (a misspelling, or a section key the schema admits but no
   * resolver reads) reports that it matches no known slot.
   */
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
  // Imported from `@calllint/core`, not restated. ONE default source survives, so
  // "the catalog restates the shipped defaults" is checkable against the render's own
  // constants rather than against a second copy that merely happens to agree.
  guardConversion: DEFAULT_GUARD_OFFER_COPY,
  agentRelay: DEFAULT_AGENT_RELAY_COPY,
  overrides: Object.freeze({ resources: Object.freeze({}) }),
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
 * Record every configured key in one section that reaches nothing, with its reason.
 *
 * Called once per section, which is what makes `unwiredSlots` total. Two outcomes, and the
 * message distinguishes them because a reviewer needs different actions:
 *   • the slot is in `CODE_OWNED_SLOTS` ⇒ report its measured reason. This is a document
 *     asking for something that should not be configurable — the fix is to remove the key.
 *   • the slot is in neither table ⇒ report that it matches no known slot. This is a
 *     misspelling, and the fix is to correct it.
 *
 * BOTH path forms are consulted, because the two tables are deliberately written in different
 * forms and each choice is load-bearing:
 *   • `WIRED_SLOTS.decisionCopy` lists states CONCRETELY (`states.BLOCKED.primaryAction`), so
 *     an INVENTED state key matches nothing and gets reported. Wildcarding it would silently
 *     accept `states.NOT_A_STATE.primaryAction`.
 *   • `WIRED_SLOTS.overrides` must be wildcarded (`resources.*.displayName`), because the
 *     resource key is caller data and cannot be enumerated.
 * Consulting both forms is what lets each section use the stricter convention available to it
 * without a per-section branch here.
 *
 * `prefix.concrete` is what the message shows — a reviewer needs the real key to find it in
 * the document — and `prefix.wildcard` is supplied by the caller rather than derived, because
 * an encoded slug contains dots and derivation would wildcard the wrong segment.
 */
function collectUnwired(
  section: PresentationSection,
  configured: Readonly<Record<string, unknown>> | undefined,
  out: string[],
  prefix?: { readonly concrete: string; readonly wildcard: string },
): void {
  if (configured === undefined) return
  const wired: readonly string[] = WIRED_SLOTS[section]
  for (const key of Object.keys(configured).sort()) {
    const concrete = prefix === undefined ? key : `${prefix.concrete}.${key}`
    const wildcard = prefix === undefined ? key : `${prefix.wildcard}.${key}`
    if (wired.includes(concrete) || wired.includes(wildcard)) continue
    const reason = codeOwnedReason(section, concrete, wildcard)
    out.push(
      `${section}.${concrete}: ${reason ?? "matches no known slot — check the spelling against the schema"}`,
    )
  }
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
  // PR P-4b. The old form enumerated UNWIRED_SECTION_TITLES, which became empty when that
  // batch wired `boundary` — leaving the mechanism live but with nothing to match, so it
  // would have reported nothing forever. This form derives the answer from the wired set,
  // so it keeps working with an empty deferral list AND catches a case the old one missed
  // entirely: a MISSPELLED key (`provenence`) is not a declared deferral, so it was
  // silently dropped by the per-key merge and reported by nothing.
  //
  // PR P-5 makes it TOTAL: `unwired` accumulates across every section (see
  // `collectUnwired`, called once per section below), because the P-4b form covered
  // `sectionTitles` alone — so three whole sections could be configured, validate, move
  // the digest, and report nothing.
  const unwired: string[] = []
  collectUnwired("sectionTitles", configuredTitles, unwired)
  // `authorityCopy` is wired as `observedPhrases.<authority>` / `absencePhrases.<authority>`,
  // so each block is collected under its own prefix rather than at the top level.
  // Concrete in both positions: the authority token set is shipped and enumerated, so an
  // invented token must be reported rather than wildcarded into acceptance.
  collectUnwired("authorityCopy", objectOrUndefined(authorityCopy?.observedPhrases), unwired, {
    concrete: "observedPhrases",
    wildcard: "observedPhrases",
  })
  collectUnwired("authorityCopy", objectOrUndefined(authorityCopy?.absencePhrases), unwired, {
    concrete: "absencePhrases",
    wildcard: "absencePhrases",
  })
  // `decisionCopy` is nested per state, so it is collected one level down with the state
  // in the prefix — `states.BLOCKED.headline`, which `codeOwnedReason` wildcards.
  if (states !== null && typeof states === "object" && states !== undefined) {
    for (const state of Object.keys(states as Record<string, unknown>).sort()) {
      collectUnwired(
        "decisionCopy",
        objectOrUndefined((states as Record<string, unknown>)[state]),
        unwired,
        // Concrete AND wildcard: `states.BLOCKED.primaryAction` hits the wired list by its
        // concrete form (so an invented state is caught), while `states.*.headline` hits the
        // code-owned table by its wildcard form (so five states share one reason).
        { concrete: `states.${state}`, wildcard: "states.*" },
      )
    }
  }

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
  collectUnwired("layout", layoutRaw, unwired)
  collectUnwired("tokens", tokensRaw, unwired)

  // L1 — the GUARD CONVERSION block (PR P-5). Three of four slots wired; `declineLabel` is
  // code-owned and reports as such, because a security floor compares it as a literal.
  //
  // Resolved through `mergeSlots` like every other copy slice, so fail-open-per-slot and the
  // `overriddenSlots` convention are INHERITED rather than re-implemented — one behaviour for
  // an unusable configured string across the whole document, not a second convention here.
  const guardRaw = objectOrUndefined(d.guardConversion as Record<string, unknown> | undefined)
  if (d.guardConversion !== undefined && guardRaw === undefined) {
    rejected.push("guardConversion: not an object")
  }
  const guardConversion = mergeSlots(
    DEFAULT_GUARD_OFFER_COPY as Record<keyof GuardOfferCopy, string>,
    guardRaw,
    WIRED_GUARD_SLOTS,
    (k) => `guardConversion.${k}`,
    overridden,
  )
  collectUnwired("guardConversion", guardRaw, unwired)

  // L1 — the AGENT RELAY block (PR P-5; ALL SIX slots wired at P-6). `guardOffer` reaches
  // the MCP guard tool's relay line; the five decision-relay slots reach the MCP prepare
  // result's `notes[]` through `composeRelayNotes`, each gated on the contract field it
  // relays. `CODE_OWNED_SLOTS.agentRelayCopy` is consequently empty.
  const relayRaw = objectOrUndefined(d.agentRelayCopy as Record<string, unknown> | undefined)
  if (d.agentRelayCopy !== undefined && relayRaw === undefined) {
    rejected.push("agentRelayCopy: not an object")
  }
  const agentRelay = mergeSlots(
    DEFAULT_AGENT_RELAY_COPY as Record<keyof AgentRelayCopy, string>,
    relayRaw,
    WIRED_AGENT_RELAY,
    (k) => `agentRelayCopy.${k}`,
    overridden,
  )
  collectUnwired("agentRelayCopy", relayRaw, unwired)

  // L1 — PER-RESOURCE OVERRIDES (PR P-5). Two of five fields wired: `displayName` (reaches
  // the projection's identity line, applied strictly downstream of the seal) and `reason`
  // (reaches the lock artifact — a real emitted artifact whose bytes move when it moves).
  //
  // Keys are the ENCODED slug form (`overrideKey`). No decoding happens here: the resolver
  // does not know the corpus, so it cannot tell a typo'd slug from an unpublished one, and
  // guessing would be worse than passing the key through for the consumer to miss.
  const overridesRaw = objectOrUndefined(d.overrides as Record<string, unknown> | undefined)
  if (d.overrides !== undefined && overridesRaw === undefined) {
    rejected.push("overrides: not an object")
  }
  const resourcesRaw = objectOrUndefined(overridesRaw?.resources)
  if (overridesRaw?.resources !== undefined && resourcesRaw === undefined) {
    rejected.push("overrides.resources: not an object")
  }
  const resolvedResources: Record<string, ResolvedResourceOverride> = {}
  if (resourcesRaw !== undefined) {
    for (const key of Object.keys(resourcesRaw).sort()) {
      const entry = objectOrUndefined(resourcesRaw[key])
      if (entry === undefined) {
        rejected.push(`overrides.resources.${key}: not an object`)
        continue
      }
      const one: { displayName?: string; reason?: string } = {}
      for (const field of WIRED_OVERRIDE_SLOTS) {
        const value = entry[field]
        if (value === undefined) continue
        if (!usableCopy(value)) continue
        one[field] = value
        overridden.push(`overrides.resources.${key}.${field}`)
      }
      // An entry whose every field was unwired or unusable resolves to nothing. Recorded as
      // an empty record rather than dropped, so the lock can show that the key was SEEN —
      // the alternative reads identically to a key that was never written.
      resolvedResources[key] = Object.freeze(one)
      // The wildcard form is passed explicitly, NOT derived: an encoded slug contains dots
      // (`io.github.calllint__calllint`), so splitting the concrete path would wildcard `io`
      // and address a slot nobody wrote.
      collectUnwired("overrides", entry, unwired, {
        concrete: `resources.${key}`,
        wildcard: "resources.*",
      })
    }
  }
  if (overridesRaw !== undefined) {
    // Only top-level `overrides` keys; `resources` is descended into above.
    collectUnwired("overrides", overridesRaw, unwired)
  }

  return {
    primaryCta,
    authority: { observed, absence },
    sectionTitles,
    layout,
    tokens,
    guardConversion,
    agentRelay,
    overrides: { resources: Object.freeze(resolvedResources) },
    overriddenSlots: overridden.sort(),
    unwiredSlots: unwired.sort(),
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
