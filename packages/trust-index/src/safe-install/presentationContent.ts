// ---------------------------------------------------------------------------
// Workstream P Batch 1 — Structured Content Schema (new15 §6.2 PR P-1; §11
// contentSchema.ts/validatePresentation.ts; ADR 0058 §1/§2/§3).
//
// PURE + deterministic: no filesystem, no clock, no RNG, no LLM, no ambient
// state. ADR 0058 §2 is the reason — presentation configuration is READ at the
// emit edge and PASSED INWARD as an argument, so nothing under packages/*/src/**
// may import from apps/web/content/**. A config plane that is imported can be
// reached from anywhere; a config plane that is a parameter can only be reached
// by whoever was handed it. That includes the forbidden-phrase set: this module
// takes it as a parameter rather than reading project-facts.json, so there is
// exactly one such list in the repo and this file cannot fork it.
//
// What this module is FOR: PR P-2 lifts hardcoded Safe-install copy into
// apps/web/content/**. The lift is only safe if the document it lifts into
// cannot express an L3 (behavioral) value. This module is that boundary,
// enforced three ways, deliberately overlapping:
//
//   1. SHAPE — the JSON Schema is closed (`additionalProperties: false`) at every
//      level, so an unknown key is a validation error rather than ignored data.
//   2. VOCABULARY — RESERVED_KEYS rejects L3 property names at ANY depth. Shape
//      alone stops bad DOCUMENTS; this also stops a future PR that widens the
//      SCHEMA to admit one, because the reserved list is checked independently of
//      the schema and a companion test walks the schema file itself.
//   3. VALUE — closedness says nothing about what a permitted string may SAY. A
//      REVIEW headline reading "No blockers observed" satisfies every structural
//      rule and is exactly the drift ADR 0058 exists to prevent. So value rules
//      forbid cross-state label/CTA impersonation, denial vocabulary on absence
//      wording, and the shipped forbidden-phrase set.
//
// Layer 3 is the one a reviewer would most likely forget to ask for, and the one
// that matters most: levels 1 and 2 keep configuration from changing the page's
// STRUCTURE, while level 3 keeps it from changing the page's MEANING.
// ---------------------------------------------------------------------------

/** Wire identity (ADR 0043/0055 §5). The tag, not the filename, is the contract. */
export const PRESENTATION_CONTENT_VERSION = "calllint.presentation-content.v1" as const

/**
 * The permitted shape of `configVersion` (PR P-7) — copied verbatim from the
 * shipped `tokensVersion` pattern, and for the same reason: a machine token, so
 * "deliberately not prose".
 *
 * Prose is detectable by whitespace (see `proseLeaves`), and every mechanism that
 * governs copy — the `proseLeaves` gate, `check:public-copy`'s prose surface — keys
 * on that. A version that could hold a sentence would be a copy slot wearing an
 * identity key's name, and could be rendered onto a page. This pattern admits no
 * whitespace at all, so it cannot become one.
 */
export const CONFIG_VERSION_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

/** ADR 0058 §1 configuration levels, by measured digest reachability. */
export type PresentationLevel = "L0" | "L1" | "L2"

/**
 * Which level owns each top-level section, and therefore which review a change to
 * it requires: L2 needs security-owner review, L1 public-copy review, L0 neither.
 * Every section is L0/L1/L2 by construction — an L3 section cannot exist here,
 * because an L3 value is one that reaches `contractDigest` and no value in this
 * document does (proven by the P-1 digest gate, not asserted).
 */
export const LEVEL_BY_SECTION = Object.freeze({
  decisionCopy: "L1",
  authorityCopy: "L2",
  sectionTitles: "L1",
  guardConversion: "L1",
  agentRelayCopy: "L1",
  layout: "L1",
  tokens: "L0",
  overrides: "L1",
} as const satisfies Record<string, PresentationLevel>)

export type PresentationSection = keyof typeof LEVEL_BY_SECTION

// Rules 3e/3g (PR P-3) read the structural model: which orderings the renderer can
// actually emit, and the shipped caps configuration may only narrow.
import {
  DISPLAY_GROUPS,
  SHIPPED_LAYOUT_CAPS,
  checkLayoutSupport,
  type DisplayGroup,
} from "./layoutStructure.js"

/** The five shipped human/route states (mirrors `Installability`). */
export const PRESENTATION_STATES = [
  "PREPARE_AVAILABLE",
  "REVIEW_REQUIRED",
  "BLOCKED",
  "LOCAL_PREFLIGHT_REQUIRED",
  "UNSUPPORTED",
] as const

/**
 * The six shipped above-the-fold display groups (new14 §7).
 *
 * RE-EXPORTED, not defined here (PR P-3). The group vocabulary and the renderer's
 * section structure are one fact — which groups exist is inseparable from which
 * sections carry them — so `layoutStructure.ts` owns both and this module re-exports
 * the vocabulary. That keeps a single definition (no drift, no reconciling test) and
 * keeps the dependency acyclic: the validator reads the structural model, never the
 * reverse. Every existing import of `DISPLAY_GROUPS` from this module keeps working.
 */
export { DISPLAY_GROUPS, type DisplayGroup }

/**
 * L3 property names that may never appear in a presentation document at any
 * depth — the behavioral-semantics vocabulary ADR 0058 §6 keeps in code
 * permanently. This is checked independently of the JSON Schema on purpose: the
 * schema stops documents, this stops the schema from being widened to admit one.
 */
export const RESERVED_KEYS: readonly string[] = [
  // verdict + reason vocabulary (INV-P4)
  "verdict",
  "verdicts",
  "verdictLabel",
  "publicLabel",
  "reasonCode",
  "reasonCodes",
  "evidenceLevel",
  // route + action (ADR 0058 §6)
  "installability",
  "nextAction",
  "recommendedNextAction",
  "kind",
  "tool",
  // AgentProtocolPolicy (new15 §20.1)
  "goal",
  "steps",
  "mustAskBefore",
  "mustStopWhen",
  "prohibitedShortcuts",
  "agentGuidance",
  // binding digests — presentation may never restate a binding value
  "artifactDigest",
  "contractDigest",
  "evidenceDigest",
  "decisionDigest",
  "semanticContractDigest",
  "expectedContractDigest",
  // decision-adjacent structures
  "authorityDelta",
  "publicObservation",
  "observed",
  "completeness",
  "usedForSafetyDecision",
]

/**
 * Denial vocabulary forbidden in ABSENCE wording (ADR 0058 §3; new14 §4.1). "Not
 * observed" is an observation about evidence; "denied"/"impossible" is a claim
 * about the world that CallLint never makes and cannot support.
 */
export const FORBIDDEN_ABSENCE_TERMS: readonly string[] = [
  "denied",
  "impossible",
  "cannot",
  "can not",
  "never",
  "prevented",
  "blocked from",
  "guaranteed",
]

// --- document types ---------------------------------------------------------

export interface StateCopy {
  readonly headline?: string
  readonly primaryAction?: string
  readonly supportingText?: string
  readonly secondaryLinkLabel?: string
}

export interface PresentationContentV1 {
  readonly schema: typeof PRESENTATION_CONTENT_VERSION
  readonly locale: string
  /**
   * Which revision of this catalog is deployed (§14 可回滚性, "每个 presentation
   * config 有版本"; PR P-7). An IDENTITY key like `schema` and `locale` — validated
   * and digested, never resolved — NOT a levelled section:
   *
   *   • `sectionsAtLevel` walks only `LEVEL_BY_SECTION`, so a levelled version would
   *     drag `l0`/`l1`/`l2` on every catalog revision and destroy the point of having
   *     per-level digests at all.
   *   • `presentationDigest` covers the whole canonical document, so an identity key
   *     DOES move it — which is exactly right: the version and the document it names
   *     must never disagree, and a moved aggregate digest is how a disagreement shows.
   *
   * OPTIONAL, three ways load-bearing: the empty document's digest stays what P-1
   * pinned (so rollback keeps a real predecessor rather than a branch), every
   * pre-P-7 committed revision stays a valid document instead of becoming
   * retroactively malformed, and a catalog that omits it still resolves — so this
   * field can never become a deployment blocker.
   */
  readonly configVersion?: string
  readonly decisionCopy?: { readonly states?: Readonly<Partial<Record<(typeof PRESENTATION_STATES)[number], StateCopy>>> }
  readonly authorityCopy?: {
    readonly observedPhrases?: Readonly<Record<string, string>>
    readonly absencePhrases?: Readonly<Record<string, string>>
  }
  readonly sectionTitles?: Readonly<Record<string, string>>
  readonly guardConversion?: Readonly<Record<string, string>>
  readonly agentRelayCopy?: Readonly<Record<string, string>>
  readonly layout?: {
    readonly groupOrder: readonly DisplayGroup[]
    readonly maxAuthorityFacts?: number
    readonly maxSecondaryLinks?: number
  }
  readonly tokens?: { readonly tokensVersion: string; readonly stylesheetHref?: string }
  readonly overrides?: { readonly resources: Readonly<Record<string, Readonly<Record<string, string>>>> }
}

/**
 * The canonical EMPTY document: schema-valid, supplies no copy, and therefore
 * resolves to the shipped code defaults for every slot.
 *
 * This is what makes the greenfield state expressible rather than special-cased.
 * At P-1 there is no apps/web/content/** at all, so "no content plane" has to
 * have an honest digest — the digest of this document — instead of a null the
 * lock file would have to explain. Presentation fails open to code defaults; it
 * never fails to a blank page.
 */
export const EMPTY_PRESENTATION_CONTENT: PresentationContentV1 = Object.freeze({
  schema: PRESENTATION_CONTENT_VERSION,
  locale: "en-US",
})

// --- validation -------------------------------------------------------------

/** One validation failure. `path` is a JSON pointer-ish path for a reviewable message. */
export interface PresentationContentError {
  readonly path: string
  readonly rule:
    | "schema-tag"
    | "locale"
    | "config-version"
    | "unknown-section"
    | "reserved-key"
    | "unknown-key"
    | "empty-value"
    | "layout-groups"
    | "layout-unsupported"
    | "layout-cap"
    | "label-impersonation"
    | "cta-impersonation"
    | "absence-vocabulary"
    | "absence-asserts-capability"
    | "forbidden-phrase"
  readonly message: string
}

/**
 * The shipped code defaults a document is checked AGAINST for impersonation. The
 * caller passes the REAL constants (`VERDICT_PUBLIC_LABEL`, `PRIMARY_CTA`) rather
 * than this module copying them, for the same reason the presentation audit reads
 * the real constants: a copy would drift from the shipped bytes it claims to
 * govern, and then the rule would be checking nothing.
 */
export interface PresentationValidationContext {
  /** verdict → shipped public label. Used to detect cross-verdict impersonation. */
  readonly verdictLabels: Readonly<Record<string, string>>
  /** installability → shipped default CTA. Used to detect cross-state CTA impersonation. */
  readonly stateCtas: Readonly<Record<string, string>>
  /** Forbidden overclaim phrases, passed in from project-facts.json at the I/O edge. */
  readonly forbiddenPhrases: readonly string[]
  /**
   * authority → shipped OBSERVED phrase (PR P-3, Rule 3f). Optional so every pre-P-3
   * caller keeps compiling and every existing rule behaves identically; supplied, it
   * lets the validator catch an absence slot that reproduces the observed assertion for
   * the same authority. Passed in as the real constant for the same reason as the two
   * maps above: a local copy would drift from the bytes it governs.
   */
  readonly observedPhrases?: Readonly<Record<string, string>>
}

/** The verdict whose shipped label maps 1:1 onto each installability state. */
const STATE_VERDICT: Readonly<Record<string, string>> = Object.freeze({
  PREPARE_AVAILABLE: "SAFE",
  REVIEW_REQUIRED: "REVIEW",
  BLOCKED: "BLOCK",
  LOCAL_PREFLIGHT_REQUIRED: "UNKNOWN",
  // UNSUPPORTED has no verdict of its own — it is a host-support fact, not a
  // disposition — so any verdict label in its headline is an impersonation.
})

/** Case/whitespace-insensitive comparison, so impersonation cannot hide in casing. */
function sameCopy(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Walk every string leaf, reporting its path — the basis of the depth-independent rules. */
function walkLeaves(value: unknown, path: string, visit: (path: string, leaf: string) => void): void {
  if (typeof value === "string") {
    visit(path, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkLeaves(v, `${path}[${i}]`, visit))
    return
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      walkLeaves((value as Record<string, unknown>)[key], `${path}/${key}`, visit)
    }
  }
}

/** Walk every object KEY, reporting its path — used for the reserved-key rule. */
function walkKeys(value: unknown, path: string, visit: (path: string, key: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkKeys(v, `${path}[${i}]`, visit))
    return
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      visit(`${path}/${key}`, key)
      walkKeys((value as Record<string, unknown>)[key], `${path}/${key}`, visit)
    }
  }
}

/**
 * Validate a presentation-content document. PURE: returns errors, throws nothing,
 * reads nothing.
 *
 * This is the VALUE + VOCABULARY layer. It is deliberately NOT a JSON Schema
 * re-implementation — `schemas/calllint.presentation-content.v1.schema.json`
 * carries shape (closedness, enums, bounds) and is validated with Ajv in the test
 * suite. What a schema fundamentally cannot express is the rule that matters most:
 * a permitted string in a permitted slot may still SAY something that reassigns
 * meaning. `{"REVIEW_REQUIRED":{"headline":"No blockers observed"}}` is
 * schema-perfect and is precisely the drift ADR 0058 exists to stop.
 *
 * Errors are returned in a stable order (document order, then rule) so the same
 * document always produces byte-identical output for the lock artifact.
 */
export function validatePresentationContent(
  doc: unknown,
  ctx: PresentationValidationContext,
): readonly PresentationContentError[] {
  const errors: PresentationContentError[] = []
  const add = (path: string, rule: PresentationContentError["rule"], message: string): void => {
    errors.push({ path, rule, message })
  }

  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return [{ path: "", rule: "schema-tag", message: "document must be a JSON object" }]
  }
  const d = doc as Record<string, unknown>

  if (d.schema !== PRESENTATION_CONTENT_VERSION) {
    add("/schema", "schema-tag", `schema must be "${PRESENTATION_CONTENT_VERSION}"`)
  }
  if (typeof d.locale !== "string" || !/^[a-z]{2}(-[A-Z]{2})?$/.test(d.locale)) {
    add("/locale", "locale", "locale must be a BCP-47 tag such as en-US")
  }
  // PR P-7 — the version is OPTIONAL (an absent key is the pre-P-7 state and every
  // committed revision of the catalog), but a PRESENT one must be a machine token.
  // A blank value reports `config-version` rather than `empty-value`: the two rules
  // would both be true, and the specific one names the actual obligation.
  if (d.configVersion !== undefined) {
    if (typeof d.configVersion !== "string" || !CONFIG_VERSION_PATTERN.test(d.configVersion)) {
      add(
        "/configVersion",
        "config-version",
        `configVersion must be a machine token matching ${CONFIG_VERSION_PATTERN.source} — deliberately not prose, so it can never be rendered as copy`,
      )
    }
  }

  // Unknown top-level sections. The schema rejects these too; doing it here as
  // well means the validator is usable standalone (the lock script runs it before
  // any Ajv instance exists) and cannot silently diverge from LEVEL_BY_SECTION.
  // `schema`/`locale`/`configVersion` are the three IDENTITY keys: they carry no
  // level by construction, which is why they are named here rather than living in
  // LEVEL_BY_SECTION.
  const known = new Set<string>([...Object.keys(LEVEL_BY_SECTION), "schema", "locale", "configVersion"])
  for (const key of Object.keys(d)) {
    if (!known.has(key)) add(`/${key}`, "unknown-section", `unknown top-level section "${key}"`)
  }

  // Rule 2 — reserved L3 keys at ANY depth.
  walkKeys(d, "", (path, key) => {
    if (RESERVED_KEYS.includes(key)) {
      add(path, "reserved-key", `"${key}" is L3 behavioral semantics and is owned by code (ADR 0058 §6)`)
    }
  })

  // Empty strings: a blank slot would silently erase a shipped default, which is a
  // deletion disguised as a config edit.
  walkLeaves(d, "", (path, leaf) => {
    if (
      path !== "/schema" &&
      path !== "/locale" &&
      path !== "/configVersion" &&
      leaf.trim() === ""
    ) {
      add(path, "empty-value", "value is empty — omit the key to keep the shipped default")
    }
  })

  // Rule 3a — the layout manifest must be a PERMUTATION of the six shipped groups.
  const layout = d.layout
  if (layout !== null && typeof layout === "object" && !Array.isArray(layout)) {
    const before3a = errors.length
    const order = (layout as Record<string, unknown>).groupOrder
    if (!Array.isArray(order)) {
      add("/layout/groupOrder", "layout-groups", "groupOrder is required and must be an array")
    } else {
      const seen = new Set<unknown>()
      for (const [i, g] of order.entries()) {
        if (typeof g !== "string" || !(DISPLAY_GROUPS as readonly string[]).includes(g)) {
          add(`/layout/groupOrder[${i}]`, "layout-groups", `"${String(g)}" is not a shipped display group`)
        } else if (seen.has(g)) {
          add(`/layout/groupOrder[${i}]`, "layout-groups", `duplicate group "${g}"`)
        }
        seen.add(g)
      }
      const missing = DISPLAY_GROUPS.filter((g) => !seen.has(g))
      if (missing.length > 0) {
        add(
          "/layout/groupOrder",
          "layout-groups",
          `missing shipped group(s): ${missing.join(", ")} — config may reorder, never delete (ADR 0058 §3)`,
        )
      }

      // Rule 3g (PR P-3) — STRUCTURAL SUPPORT. A permutation of the right six groups
      // can still be one the renderer cannot emit: `disposition` and `primary_action`
      // are carried by a single <section>, so an order that splits them describes a
      // page that does not exist. Rejecting it here is what keeps the manifest from
      // becoming a key that validates and then does nothing — the exact drift ADR 0058
      // §3 forbids. Checked only once the permutation rules above are satisfied, so a
      // malformed order reports its real cause instead of two overlapping ones.
      if (errors.length === before3a) {
        const support = checkLayoutSupport(order)
        if (!support.supported && support.message !== null) {
          add("/layout/groupOrder", "layout-unsupported", support.message)
        }
      }
    }

    // Rule 3e (PR P-3) — CAP BOUNDS. The JSON Schema bounds these, but the schema is
    // not the only door: the lock script validates standalone before any Ajv instance
    // exists, and a schema can be widened in a PR that never touches this file. The
    // caps are evidence-adjacent — the ≤3 authority selection is derived from evidence
    // and sealed into `authorityDelta` — so configuration must be provably unable to
    // raise them. It may show fewer facts; it may never manufacture a slot.
    const caps = [
      ["maxAuthorityFacts", SHIPPED_LAYOUT_CAPS.maxAuthorityFacts, 1],
      ["maxSecondaryLinks", SHIPPED_LAYOUT_CAPS.maxSecondaryLinks, 0],
    ] as const
    for (const [key, shipped, min] of caps) {
      const raw = (layout as Record<string, unknown>)[key]
      if (raw === undefined) continue
      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        add(`/layout/${key}`, "layout-cap", `${key} must be an integer`)
      } else if (raw > shipped) {
        add(
          `/layout/${key}`,
          "layout-cap",
          `${key} is ${raw}, above the shipped cap of ${shipped} — configuration may show fewer, never more (ADR 0058 §3)`,
        )
      } else if (raw < min) {
        add(`/layout/${key}`, "layout-cap", `${key} is ${raw}, below the minimum of ${min}`)
      }
    }
  }

  // Rule 3b — cross-state impersonation. Config may reword a state; it may never
  // make one disposition read as another. Checked against the SHIPPED constants
  // the caller passes in, so the rule tracks the real bytes.
  const states = (d.decisionCopy as { states?: Record<string, unknown> } | undefined)?.states
  if (states !== null && typeof states === "object" && states !== undefined) {
    for (const [state, raw] of Object.entries(states)) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue
      const copy = raw as Record<string, unknown>
      const ownVerdict = STATE_VERDICT[state]
      if (typeof copy.headline === "string") {
        for (const [verdict, label] of Object.entries(ctx.verdictLabels)) {
          if (verdict !== ownVerdict && sameCopy(copy.headline, label)) {
            add(
              `/decisionCopy/states/${state}/headline`,
              "label-impersonation",
              `headline reproduces the shipped ${verdict} label "${label}" on a ${state} page (INV-P4)`,
            )
          }
        }
      }
      if (typeof copy.primaryAction === "string") {
        for (const [other, cta] of Object.entries(ctx.stateCtas)) {
          if (other !== state && sameCopy(copy.primaryAction, cta)) {
            add(
              `/decisionCopy/states/${state}/primaryAction`,
              "cta-impersonation",
              `primaryAction reproduces the shipped ${other} CTA "${cta}" on a ${state} page`,
            )
          }
        }
      }
    }
  }

  // Rule 3c — absence wording stays an observation (ADR 0058 §3; new14 §4.1).
  const absence = (d.authorityCopy as { absencePhrases?: Record<string, unknown> } | undefined)?.absencePhrases
  if (absence !== null && typeof absence === "object" && absence !== undefined) {
    for (const [authority, text] of Object.entries(absence)) {
      if (typeof text !== "string") continue
      const lower = text.toLowerCase()
      for (const term of FORBIDDEN_ABSENCE_TERMS) {
        if (lower.includes(term)) {
          add(
            `/authorityCopy/absencePhrases/${authority}`,
            "absence-vocabulary",
            `absence wording uses "${term}" — "not observed" is an observation about evidence, never a claim that the capability is ${term} (ADR 0058 §3)`,
          )
        }
      }
    }
  }

  // Rule 3f (PR P-3) — ABSENCE COPY MAY NOT ASSERT THE CAPABILITY. Rule 3c stops the
  // over-strong direction ("denied", "impossible"); this stops the inverted one, which
  // is strictly worse and which no shipped gate caught before P-3:
  //
  //   absencePhrases.shell_execution: "Can run shell commands with access to paths."
  //
  // That is schema-valid, contains no denial term, carries no forbidden overclaim, and
  // renders on a page where the evidence showed the capability was NOT observed. It is a
  // false statement about the artifact, produced entirely from configuration — exactly
  // the class INV-P4 exists to prevent. The rule is deliberately narrow and mechanical:
  // an absence phrase must not open with the shipped OBSERVED assertion voice, and it
  // must not reproduce the shipped observed phrase for its own authority.
  const absenceAssert = (d.authorityCopy as { absencePhrases?: Record<string, unknown> } | undefined)?.absencePhrases
  if (absenceAssert !== null && typeof absenceAssert === "object" && absenceAssert !== undefined) {
    for (const [authority, text] of Object.entries(absenceAssert)) {
      if (typeof text !== "string") continue
      const trimmed = text.trim()
      // The shipped observed voice is an unqualified capability assertion: "Can …",
      // "Requires …", "Runs …", "Connects …", "Requests …". An absence sentence that
      // opens this way claims the capability on a page asserting it was not observed.
      if (/^(can|could|will|does|requires?|runs?|connects?|requests?|sends?|initiates?)\b/i.test(trimmed)) {
        add(
          `/authorityCopy/absencePhrases/${authority}`,
          "absence-asserts-capability",
          `absence wording opens with the OBSERVED assertion voice ("${trimmed.split(/\s+/)[0]}") — this slot renders when evidence did NOT observe ${authority}, so it must describe the observation, not assert the capability (INV-P4)`,
        )
      }
      const shipped = ctx.observedPhrases?.[authority]
      if (typeof shipped === "string" && sameCopy(trimmed, shipped)) {
        add(
          `/authorityCopy/absencePhrases/${authority}`,
          "absence-asserts-capability",
          `absence wording reproduces the shipped OBSERVED phrase for ${authority} ("${shipped}") — the two slots make opposite claims and may never carry the same sentence`,
        )
      }
    }
  }

  // Rule 3d — the shipped forbidden-phrase set, applied to configuration exactly
  // as `check:public-copy` applies it to emitted bytes (INV-P4). Enforced from
  // P-1 so it is already true the moment PR P-2 creates the first content file.
  walkLeaves(d, "", (path, leaf) => {
    const lower = leaf.toLowerCase()
    for (const phrase of ctx.forbiddenPhrases) {
      if (lower.includes(phrase.toLowerCase())) {
        add(path, "forbidden-phrase", `contains forbidden overclaim "${phrase}"`)
      }
    }
  })

  return errors
}

/** True when the document is valid under every rule. */
export function isValidPresentationContent(
  doc: unknown,
  ctx: PresentationValidationContext,
): boolean {
  return validatePresentationContent(doc, ctx).length === 0
}
