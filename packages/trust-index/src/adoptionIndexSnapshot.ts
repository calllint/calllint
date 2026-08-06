/**
 * calllint.adoption-index.v1 — the committed IDENTITY projection of the canonical adoption graph
 * (ADR 0061 §7.1). The producer (`projectAdoptionIndex.ts`) is the ONLY thing that opens the
 * compiler's database; it freezes the projected entries here. The bake then reads this file PURELY,
 * so `(committed projection) → (baked bytes)` stays a pure function and the reproducibility diff gate
 * (ADR 0046 §4) is unaffected.
 *
 * WHY THE BAKE MAY NOT READ THE DATABASE INSTEAD, since that is the shorter path and the wrong one.
 * ADR 0061 §5: "nothing served ever queries the compiler … A request for a Trust page must never
 * cause a database read." And measured rather than assumed: `committed-tree.test.ts` re-bakes the
 * whole tree inside the ORDINARY vitest suite on three OSes, where `.var/calllint-adoption-index/`
 * is empty. A bake that opened the store would go red in CI on every leg.
 *
 * IDENTITY ONLY — NEVER A VERDICT. This document carries addressing and provenance, because ADR 0061
 * §4 says the Canonical Adoption Graph "resolves *which subject this is*. It has no opinion about
 * whether that subject is safe", and `computeVerdict` "is the only verdict engine". `parseAdoptionIndex`
 * therefore REFUSES a document carrying a decision field, rather than ignoring it: a projection that
 * grew a verdict would be a second verdict authority, and this reader is where it would enter the
 * serving plane. The refusal is the enforcement point, not the comment above it.
 *
 * ~~Every entry names the compiled `adoption_records` row it came from.~~ INVERTED at R-8, before this
 * file was ever committed, and kept because the wrong reading is what the batch was named after. A
 * CANONICAL SUBJECT is the unit; a COMPILED RECORD is optional enrichment. Nothing in any package's
 * `src/` compiles a record yet (`refreshFromMirror` persists identity only), so requiring
 * `adoptionRecordDigest` here would have made this reader throw on every document the producer can
 * honestly emit today — a reader that only accepts a file no writer can write. The record triple is
 * validated ALL-OR-NOTHING instead, so the absence stays honest and a half-populated entry still
 * fails loudly.
 *
 * THE SHAPE IS DUPLICATED, NOT IMPORTED, mirroring `snapshotProjection.ts`'s choice on the other side.
 * The producing type lives in `@calllint/adoption-index`; importing it here would be harmless in the
 * dependency direction (this package already depends on that one) but would make the SERVED contract
 * follow a store refactor silently. Equivalence is proved behaviourally instead: a test projects a
 * document with the committed producer and drives it through this reader.
 */

/** One entry: addressing + provenance for a single canonical subject. */
export interface AdoptionIndexEntry {
  subjectId: string
  /** The authoritative reverse-DNS registry name, e.g. `ac.inference.sh/mcp`. */
  canonicalName: string
  /**
   * The addressable slug, e.g. `mcp-registry/ac.inference.sh-mcp`. THE JOIN KEY — see `adoptionMap`.
   */
  canonicalSlug: string
  identityStatus: string
  identityDigest: string
  /** The subject row's `lastSeenAt`. Provenance for the identity, not a freshness claim. */
  lastSeenAt: string
  /**
   * Present exactly when a record has been compiled for this subject — absent on every entry today.
   *
   * Absent, never null and never `""`: a placeholder would let a consumer join on a value that names
   * nothing, and `parseAdoptionIndex` rejects an empty string here for that reason.
   */
  adoptionRecordDigest?: string
  /** The record's lifecycle conclusion. Present exactly when `adoptionRecordDigest` is. */
  lifecycleStatus?: string
  /** The record row's `updatedAt`. Named apart from `lastSeenAt` so the two provenances cannot merge. */
  recordUpdatedAt?: string
}

/** The committed adoption-index document. */
export interface AdoptionIndexSnapshot {
  schema: "calllint.adoption-index.v1"
  /** ISO-8601 UTC captured when the projection ran; pinned for a reproducible re-bake. */
  projectedAt: string
  count: number
  /** Entries, sorted by canonical name for byte-stability. */
  entries: AdoptionIndexEntry[]
}

/**
 * The identity fields every entry must carry. `adoptionRecordDigest` is deliberately NOT here — see
 * the docblock's inversion; it is validated by `RECORD_FIELDS` only when present.
 */
const REQUIRED_ENTRY_FIELDS = [
  "subjectId",
  "canonicalName",
  "canonicalSlug",
  "identityStatus",
  "identityDigest",
  "lastSeenAt",
] as const

/**
 * The record triple, checked as a UNIT.
 *
 * All three or none: an entry carrying `lifecycleStatus` without `adoptionRecordDigest` claims a
 * conclusion it cannot name the source of, which is the shape a hand-edit or a half-finished
 * producer change would leave behind. The producer emits them with a single spread for the same
 * reason; this is the consuming-side restatement, because a guard only on the producer is bypassed
 * by editing the committed file (control #117).
 */
const RECORD_FIELDS = ["adoptionRecordDigest", "lifecycleStatus", "recordUpdatedAt"] as const

/**
 * Field names a served identity projection must never carry — the same enumeration the producer
 * freezes as `FORBIDDEN_PROJECTION_FIELDS`, restated on the CONSUMING side because a guard only on
 * the producer is bypassed by a hand-edited file, and a hand-edited file is exactly what control #117
 * simulates.
 */
const FORBIDDEN_ENTRY_FIELDS = [
  "decision",
  "verdict",
  "decisionDigest",
  "policyDigest",
  "evidence",
  "evidenceDigest",
  "findingCount",
  "recordJson",
  "record_json",
] as const

/**
 * Parse + validate a committed adoption index. Pure. Throws — never returns null — on a wrong schema,
 * a non-array `entries`, an entry missing a required identity field, an entry carrying part of the
 * record triple, or any entry carrying a decision field. A corrupt projection must fail the bake
 * LOUDLY rather than let it serve stale or verdict-bearing identity (control #113).
 */
export function parseAdoptionIndex(text: string): AdoptionIndexSnapshot {
  const doc = JSON.parse(text) as Partial<AdoptionIndexSnapshot>
  if (doc.schema !== "calllint.adoption-index.v1") {
    throw new Error(`adoption-index: unexpected schema ${JSON.stringify(doc.schema)}`)
  }
  if (typeof doc.projectedAt !== "string" || doc.projectedAt.length === 0) {
    throw new Error("adoption-index: projectedAt must be a non-empty string")
  }
  if (!Array.isArray(doc.entries)) {
    throw new Error("adoption-index: entries must be an array")
  }
  for (const e of doc.entries) {
    for (const field of REQUIRED_ENTRY_FIELDS) {
      if (typeof e?.[field] !== "string" || e[field].length === 0) {
        throw new Error(
          `adoption-index: each entry needs a non-empty ${field}; got ${JSON.stringify(e?.[field])}`,
        )
      }
    }

    // `in`, not a truthiness test: present-and-empty must reach the per-field check below and be
    // rejected there by name, rather than being silently read as absent.
    const present = RECORD_FIELDS.filter((field) => field in (e as object))
    if (present.length !== 0 && present.length !== RECORD_FIELDS.length) {
      throw new Error(
        `adoption-index: ${e.canonicalSlug} carries ${present.join(", ")} but not the whole record triple (${RECORD_FIELDS.join(", ")}) — a lifecycle conclusion must name the record it came from`,
      )
    }
    for (const field of present) {
      const value = e[field]
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(
          `adoption-index: ${e.canonicalSlug} has a ${field} of ${JSON.stringify(value)} — a subject with no compiled record must OMIT the field, never carry a placeholder`,
        )
      }
    }

    for (const forbidden of FORBIDDEN_ENTRY_FIELDS) {
      if (forbidden in (e as object)) {
        throw new Error(
          `adoption-index: refused field "${forbidden}" on ${e.canonicalSlug} — the adoption graph has no opinion about safety (ADR 0061 §4); a verdict comes from computeVerdict every time`,
        )
      }
    }
  }
  return doc as AdoptionIndexSnapshot
}

/**
 * Build the lookup the bake joins on, keyed by `canonicalSlug`.
 *
 * THE KEY IS THE SLUG, AND THAT WAS A MEASURED CORRECTION. The plan said join on `canonicalName`,
 * which reads naturally because `IndexEntry.canonicalName` and `AdoptionIndexEntry.canonicalName` are
 * spelled the same — but they hold different strings. `index.json`'s `canonicalName` holds the
 * ADDRESS (`registryCanonicalName` produces `mcp-registry/ac.inference.sh-mcp`), while the store's
 * `canonical_name` holds the raw registry name (`ac.inference.sh/mcp`). Probed over the two committed
 * files: raw name matched 0/19, slug matched 19/19.
 *
 * The fixtures cohort cannot join and must not: `index.json` carries 39 entries, of which 20 are
 * `calllint-fixtures/*` — local golden fixtures that were never registry subjects and have no
 * canonical record. Their absence from this map is what makes the wiring's positive and negative case
 * both live inside one committed file.
 */
export function adoptionMap(snap: AdoptionIndexSnapshot | null): Map<string, AdoptionIndexEntry> {
  const map = new Map<string, AdoptionIndexEntry>()
  if (!snap) return map
  for (const e of snap.entries) map.set(e.canonicalSlug, e)
  return map
}
