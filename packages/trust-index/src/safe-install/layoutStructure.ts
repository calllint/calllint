// ---------------------------------------------------------------------------
// Workstream P Batch 3 — the LAYOUT STRUCTURE model (new15 §6.2 PR P-3; ADR 0058 §3).
//
// PURE + deterministic. No I/O, no clock, no config reading (ADR 0058 §2 — this is
// consumed as a parameter, like every other presentation slice).
//
// WHY THIS FILE EXISTS. ADR 0058 §3 permits configuration to "select among orderings
// the code already implements and validates" and forbids it from "reorder[ing] into an
// arrangement the renderer does not structurally support". Honouring that sentence
// requires knowing which arrangements the renderer supports — and the served bytes say
// that is NOT "any permutation of the six groups":
//
//   apps/web/public/install/**/index.html emits FIVE above-the-fold <section>s carrying
//   the SIX display groups, because `disposition` and `primary_action` are FUSED inside
//   one `install-disposition` section (headline paragraph, then CTA paragraph). Two more
//   sections (`install-publisher`, `install-provenance`) sit below the fold and carry no
//   display group at all.
//
// So of the 720 permutations of six groups, the renderer can emit exactly 120: those in
// which `disposition` is immediately followed by `primary_action`. A resolver that
// accepted all 720 would let a document claim an ordering the renderer silently ignores
// — a config key that validates and then does nothing, which is the precise drift the
// presentation lock exists to catch.
//
// The predicate below is DERIVED from the section model rather than hand-listed, so it
// tracks the renderer instead of describing it once. If PR P-4b ever splits the fused
// section, `ABOVE_FOLD_SECTIONS` changes and the supported set widens automatically;
// the paired test asserts the model against the real emitted markup either way.
// ---------------------------------------------------------------------------

/**
 * The six shipped above-the-fold display groups — the VOCABULARY (a set), in new14 §7's
 * documentation numbering.
 *
 * ⚠️ This array's ORDER is NOT an emittable layout. §7 numbers the primary action fifth
 * ("5 one primary action", after the authority facts), but the served markup emits the CTA
 * THIRD, fused into `install-disposition`. So `checkLayoutSupport([...DISPLAY_GROUPS])`
 * is `false` with reason `fused-run-split`, and a fixture that spreads this array as a
 * `groupOrder` is asserting an arrangement the renderer has never produced. Use
 * `DEFAULT_GROUP_ORDER` below for the emitted order; use this only where a SET is meant
 * (the schema enum, membership checks, the missing-group diff). The paired test pins both
 * facts, so the discrepancy cannot be rediscovered by a failing build a third time.
 *
 * Defined HERE rather than in `presentationContent.ts` (which re-exports it, so every
 * existing import site is unchanged) because the group vocabulary and the section
 * structure below are the same fact: a group exists precisely because some section
 * emits it. Splitting them across two modules would need a reconciling test; keeping
 * them together makes the structural predicate derivable and the imports acyclic.
 */
export const DISPLAY_GROUPS = [
  "identity",
  "disposition",
  "consequence",
  "authority_facts",
  "primary_action",
  "secondary_links",
] as const

export type DisplayGroup = (typeof DISPLAY_GROUPS)[number]

/** The above-the-fold section ids the renderer emits, in shipped order. */
export const ABOVE_FOLD_SECTION_IDS = [
  "install-identity",
  "install-disposition",
  "install-consequence",
  "install-authority",
  "install-secondary",
] as const

export type AboveFoldSectionId = (typeof ABOVE_FOLD_SECTION_IDS)[number]

/**
 * Which display groups each emitted section carries, in the order they appear INSIDE
 * that section. This is the ground truth the structural predicate is derived from.
 *
 * `install-disposition` carries two groups because the shipped markup puts the verdict
 * headline and the primary CTA in one section — that is a fact about the bytes, not a
 * modelling choice, and pretending otherwise is what would make the manifest dishonest.
 */
export const SECTION_GROUPS: Readonly<Record<AboveFoldSectionId, readonly DisplayGroup[]>> =
  Object.freeze({
    "install-identity": Object.freeze(["identity"] as const),
    "install-disposition": Object.freeze(["disposition", "primary_action"] as const),
    "install-consequence": Object.freeze(["consequence"] as const),
    "install-authority": Object.freeze(["authority_facts"] as const),
    "install-secondary": Object.freeze(["secondary_links"] as const),
  })

/**
 * The shipped default order: every section's groups, sections in emitted order. THIS is
 * the group sequence the renderer actually produces — it differs from `DISPLAY_GROUPS`
 * (see the warning there), and it is derived from the section model rather than restated.
 */
export const DEFAULT_GROUP_ORDER: readonly DisplayGroup[] = Object.freeze(
  ABOVE_FOLD_SECTION_IDS.flatMap((id) => [...SECTION_GROUPS[id]]),
)

/**
 * Groups that must stay adjacent, in this exact relative order, because one emitted
 * section carries them all. Derived — never hand-maintained.
 */
export const FUSED_GROUP_RUNS: readonly (readonly DisplayGroup[])[] = Object.freeze(
  ABOVE_FOLD_SECTION_IDS.map((id) => SECTION_GROUPS[id]).filter((gs) => gs.length > 1),
)

/** Why a `groupOrder` cannot be emitted. `null` reason ⇒ it can. */
export interface LayoutSupportResult {
  readonly supported: boolean
  /** Machine-stable cause, for a gate message that names the fix. */
  readonly reason:
    | null
    | "not-a-permutation"
    | "fused-run-split"
    | "fused-run-reordered"
  readonly message: string | null
  /** The section sequence this order emits as, when supported. */
  readonly sectionOrder: readonly AboveFoldSectionId[] | null
}

/** Is `order` a permutation of the six shipped groups (no additions, no deletions)? */
function isPermutation(order: readonly unknown[]): boolean {
  if (order.length !== DISPLAY_GROUPS.length) return false
  const seen = new Set<unknown>(order)
  if (seen.size !== order.length) return false
  return DISPLAY_GROUPS.every((g) => seen.has(g))
}

/**
 * Can the renderer emit this group order?
 *
 * Total and pure: any input, including garbage, yields a verdict with a reason. The
 * predicate is structural, so it answers about the RENDERER, not about taste — a
 * rejected order is one the DOM cannot express, not one somebody dislikes.
 */
export function checkLayoutSupport(order: readonly unknown[]): LayoutSupportResult {
  if (!isPermutation(order)) {
    return {
      supported: false,
      reason: "not-a-permutation",
      message: `groupOrder must be a permutation of the six shipped groups (${DISPLAY_GROUPS.join(", ")}) — config may reorder, never add or delete (ADR 0058 §3)`,
      sectionOrder: null,
    }
  }
  const groups = order as readonly DisplayGroup[]
  for (const run of FUSED_GROUP_RUNS) {
    const first = groups.indexOf(run[0] as DisplayGroup)
    // Contiguous, and in the section's own internal order.
    for (let k = 1; k < run.length; k += 1) {
      const at = groups.indexOf(run[k] as DisplayGroup)
      if (at !== first + k) {
        return {
          supported: false,
          reason: at < first ? "fused-run-reordered" : "fused-run-split",
          message:
            `${run.join(" + ")} are emitted by ONE section, so they must stay adjacent in this order; ` +
            `the renderer has no markup that separates them (ADR 0058 §3 — configuration selects among ` +
            `orderings the renderer structurally supports)`,
          sectionOrder: null,
        }
      }
    }
  }
  // Supported ⇒ the section order is read off the run heads, in requested order.
  const sectionOrder: AboveFoldSectionId[] = []
  for (const g of groups) {
    const owner = ABOVE_FOLD_SECTION_IDS.find((id) => SECTION_GROUPS[id][0] === g)
    if (owner !== undefined) sectionOrder.push(owner)
  }
  return { supported: true, reason: null, message: null, sectionOrder }
}

/** Convenience predicate for callers that only need the boolean. */
export function isStructurallySupported(order: readonly unknown[]): boolean {
  return checkLayoutSupport(order).supported
}

/**
 * The section sequence a supported order emits as; the shipped order when unsupported.
 * Fail open per slot (ADR 0058 §5 INV-P3) — a bad manifest renders the shipped page.
 */
export function sectionOrderFor(order: readonly unknown[]): readonly AboveFoldSectionId[] {
  return checkLayoutSupport(order).sectionOrder ?? ABOVE_FOLD_SECTION_IDS
}

/**
 * The shipped render caps. Configuration may only NARROW these: `maxAuthorityFacts`
 * is applied strictly downstream of the seal, so it cannot reach `authorityDelta`
 * (INV-P1), and it can never raise the evidence-derived selection cap (ADR 0059: 5).
 */
export const SHIPPED_LAYOUT_CAPS = Object.freeze({
  maxAuthorityFacts: 5,
  maxSecondaryLinks: 2,
} as const)

/**
 * The resolved LAYOUT slice — a section sequence plus two render caps.
 *
 * Declared in this module, not in `resolvePresentation.ts`, for a structural reason: the
 * resolver imports `SECTION_TITLES` from the renderer, so if the renderer imported this
 * type from the resolver the three modules would form an import cycle. Keeping the layout
 * VOCABULARY in the leaf module that owns the section model leaves the graph acyclic —
 * renderer and resolver both depend on this, and neither on the other's internals.
 *
 * Note what this carries: not the group order the document asked for, but the SECTION
 * sequence the renderer will emit, already checked against what the renderer can express.
 * The renderer therefore has no way to receive an order it cannot emit, which is what
 * makes "configuration selects, never invents" true by construction.
 */
export interface ResolvedLayout {
  /** The above-the-fold sections, in emit order. Always a full, supported sequence. */
  readonly sectionOrder: readonly AboveFoldSectionId[]
  /** Render-time cap on authority facts SHOWN. Never raises the sealed selection cap. */
  readonly maxAuthorityFacts: number
  /** Render-time cap on secondary links shown. */
  readonly maxSecondaryLinks: number
}

/** The shipped default layout: emitted section order, shipped caps. */
export const DEFAULT_LAYOUT: ResolvedLayout = Object.freeze({
  sectionOrder: [...ABOVE_FOLD_SECTION_IDS],
  maxAuthorityFacts: SHIPPED_LAYOUT_CAPS.maxAuthorityFacts,
  maxSecondaryLinks: SHIPPED_LAYOUT_CAPS.maxSecondaryLinks,
})

/** Clamp a configured cap into `[min, shipped]`. Non-integers ⇒ the shipped value. */
export function clampCap(value: unknown, shipped: number, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return shipped
  if (value < min) return min
  if (value > shipped) return shipped
  return value
}
