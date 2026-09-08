/**
 * snapshotProjection — project the committed `calllint.trust-snapshot.v0` FROM the mirror.
 *
 * This is the piece that protects a green gate from a batch that only meant to add a
 * store. The committed snapshot feeds the bake, and the bake feeds a reproducibility gate
 * that byte-compares committed served bytes against a fresh render. So the rule is
 * absolute: **unchanged upstream ⇒ byte-identical snapshot.**
 *
 * Meeting it requires reproducing `fetchRegistrySnapshot`'s three steps EXACTLY, in order:
 *
 *   1. keep only `status === "active"` AND `isLatest === true`
 *   2. sort by `name`, ascending, with the same comparator
 *   3. cap at `maxEntries` via `selectCohortEntries` — reserved names first, then the
 *      alphabetical remainder, re-sorted so the output stays in name order
 *
 * Step 3 caps AFTER step 2, so the retained entries are the alphabetically first ones — NOT
 * the most recent. That is a surprising property and it is load-bearing: a projection that
 * "improved" it by taking the newest N would change which entries exist, which changes every
 * page the bake emits. The mirror may hold thousands of records; this projection still emits
 * the same cohort for the same upstream.
 *
 * The one exception is ADR 0075's `RESERVED_COHORT_NAMES`, and it exists because the plain
 * alphabetical cap evicted the one subject this project claims about itself: it is the only
 * `io.*` name upstream, so it sorted last and the cap reached it FIRST. A reserved name takes
 * a slot rather than an extra one, so the cap remains an absolute ceiling.
 *
 * The shape is deliberately duplicated from `trust-index/src/snapshot.ts` rather than
 * imported, because importing it would create an edge from this package into the serving
 * plane's package — and the import-boundary gate exists to keep the compiler off that
 * plane. The equivalence is asserted by a test that compares this projection against the
 * shipped `fetchRegistrySnapshot` output over identical input, which is a stronger
 * guarantee than a shared type: it catches BEHAVIOURAL drift, not just structural drift.
 */
import type { SourceRecordV1 } from "../domain/sourceRecord.js"

/**
 * An email-like token in upstream free text. Byte-identical to `fetchRegistry.ts:231`,
 * `claim.ts:79` and `check-public-copy.mjs:439`. FOUR copies of one regex is deliberate, for
 * the reason the third copy already records: each is a defense at a different plane, and a
 * shared import would let one edit silently retire all of them. This file's header states the
 * same rule for the cohort constants — this package has zero imports of the serving plane's
 * package, and the import-boundary gate keeps it that way.
 */
const EMAIL_LIKE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

/**
 * Strip email-like tokens from upstream free text.
 *
 * WHY THIS EXISTS HERE AND NOT ONLY IN `fetchRegistry.ts` (2026-09-08). ADR 0096 added
 * `redactPii` to `toSnapshotEntry` on 2026-09-01 and recorded the consequence as *"No
 * email-like token can reach a served page through an upstream description."* That sentence
 * was false the day it was written, for a reason ADR 0096 itself names two paragraphs earlier:
 * it was placed on `fetchRegistrySnapshot`, and **production has no callers of that function**.
 * `refreshSnapshot.ts:717` writes `mirrored.snapshotText`, which comes through
 * `refreshFromMirror` → this projection. The redaction was mounted on the retired path.
 *
 * The evidence is the pipeline itself: the scheduled `trust-ingest` runs of 2026-08-31 and
 * 2026-09-07 both failed at `check:public-copy` on `"hi@byteray.ai"` reaching
 * `install/mcp-registry/ai.byteray-byteray-mcp/`, with `redactPii` present in the tree at the
 * failing commit. A guard on a dead path cannot refuse anything.
 *
 * Identical text and marker to the boundary copy, because `snapshot-projection.test.ts` requires
 * the two implementations to emit the same bytes for the same upstream — so a redaction on one
 * side only is now a byte divergence, which is the property that makes this pair self-checking.
 */
function redactPii(text: string): string {
  return text.replace(EMAIL_LIKE, "[contact redacted]")
}

export interface ProjectedPackage {
  registryType: string
  identifier: string
  version: string | null
  transport: string | null
}

export interface ProjectedRemote {
  type: string
  url: string
}

export interface ProjectedEntry {
  name: string
  description: string
  version: string | null
  repositoryUrl: string | null
  packages: ProjectedPackage[]
  remotes: ProjectedRemote[]
  status: string | null
  publishedAt: string | null
}

export interface ProjectedSnapshot {
  schema: "calllint.trust-snapshot.v0"
  source: "official-mcp-registry"
  endpoint: string
  fetchedAt: string
  count: number
  entries: ProjectedEntry[]
}

/**
 * The live cohort filter. `isLatest !== true` is rejected rather than `=== false`, so a
 * record whose source omitted the flag is excluded rather than admitted by default —
 * absence of evidence is not evidence of currency.
 */
export function isLiveCohort(record: SourceRecordV1): boolean {
  return record.lifecycle.status === "active" && record.lifecycle.isLatest === true
}

function toEntry(record: SourceRecordV1): ProjectedEntry {
  const id = record.claimedIdentity
  return {
    name: id.canonicalName ?? record.source.sourceRecordId,
    // The shipped snapshot stores "" for a missing description, not null. Matching that
    // is not cosmetic: `null` and `""` serialize differently, and the bytes are compared.
    // Redacted here rather than at the store, so the mirror keeps the upstream bytes it was
    // given (the payload digest is computed over the raw item) while nothing PII-bearing
    // leaves the projection. Redacted, not dropped — ADR 0096's reasoning is unchanged.
    description: redactPii(record.untrustedPublisherContent?.description ?? ""),
    version: id.version ?? null,
    repositoryUrl: id.repositoryUrl ?? null,
    packages: id.packages.map((p) => ({
      registryType: p.registryType,
      identifier: p.identifier,
      version: p.version,
      transport: p.transport,
    })),
    remotes: id.remotes.map((r) => ({ type: r.type, url: r.url })),
    // The shipped emitter writes the literal "active" here, having already filtered to
    // active-only. Deriving it from the record would be equivalent today and would
    // diverge the moment the filter changed; pin the literal the emitter pins.
    status: "active",
    publishedAt: record.lifecycle.publishedAt ?? null,
  }
}

export interface ProjectSnapshotOptions {
  /** Mirror rows for this source, any order. */
  records: readonly SourceRecordV1[]
  /** Carried verbatim into the document, as the shipped emitter does. */
  endpoint: string
  /** The retained `fetchedAt`; injected, never a clock read (§9.5, INV-R6). */
  fetchedAt: string
  /** The ADR 0038 §6 cap. Same default as the shipped edge. */
  maxEntries: number
  /** Previously published registry names (Cumulative Coverage Amendment v1, §G2) */
  retainedNames?: readonly string[]
}

/**
 * Names the cohort slice must never evict, in the REGISTRY'S OWN KEY SPACE (reverse-DNS,
 * with the `/`). ADR 0075.
 *
 * Duplicated VERBATIM from `trust-index/src/fetchRegistry.ts`, which carries the full
 * rationale. The two must hold the same members: a name reserved on one side only would make
 * the two implementations disagree exactly when the cap binds, and `snapshot-projection.test.ts`
 * asserts they agree byte-for-byte. Duplication over import for the reason stated in this
 * file's header — this package has zero imports of the serving plane's package, and the
 * import-boundary gate keeps it that way.
 *
 * Keyed on the registry name, never the slug: `registryCanonicalName` maps `/` → `-`, so
 * `io.github.calllint-calllint` collides onto the claimed subject's slug AND sorts before it
 * (`-` is 45, `/` is 47). Exact equality over the original name is the only unimpersonable
 * form. Measured, not supposed.
 */
export const RESERVED_COHORT_NAMES: readonly string[] = ["io.github.calllint/calllint"]

/**
 * Apply the cap as a retained+reserved-first selection (Cumulative Coverage Amendment v1, §D).
 *
 * Previously published names (retainedNames) are sticky: they survive even when new entries
 * sort before them alphabetically. Reserved names (RESERVED_COHORT_NAMES) remain protected.
 * Remaining slots are filled deterministically from alphabetically-first candidates.
 *
 * Duplicated VERBATIM from `trust-index/src/fetchRegistry.ts` (Amendment §G2), which carries
 * the full contract. The two must behave identically: a name retained on one side only would
 * make the implementations disagree exactly when the cap binds, and `snapshot-projection.test.ts`
 * asserts they agree byte-for-byte.
 */
export function selectCohortEntries<T extends { readonly name: string }>(
  entries: readonly T[],
  max: number,
  retainedNames?: readonly string[],
): T[] {
  const byName = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (byName.length <= max) return byName

  // A negative cap emits nothing (Amendment §D preserves this invariant from prior logic)
  if (max < 0) return []

  const retained = retainedNames ?? []
  const isRetained = (e: T): boolean => retained.includes(e.name)
  const isReserved = (e: T): boolean => RESERVED_COHORT_NAMES.includes(e.name)

  // Step 2-3 (Amendment §D): partition into retained, reserved (minus already-retained), and candidates
  const retainedPresent = byName.filter(isRetained)
  const reservedPresent = byName.filter((e) => isReserved(e) && !isRetained(e)).slice(0, max)

  // Step 4-5 (Amendment §D): fail closed if retained+reserved exceeds cap
  if (retainedPresent.length + reservedPresent.length > max) {
    throw new Error(
      `Cumulative coverage conflict: ${retainedPresent.length} retained + ${reservedPresent.length} reserved > ${max} cap`,
    )
  }

  // Step 6 (Amendment §D): fill remaining slots from alphabetically-first candidates
  const candidates = byName.filter((e) => !isRetained(e) && !isReserved(e))
  const remaining = max - retainedPresent.length - reservedPresent.length
  const selected = candidates.slice(0, Math.max(0, remaining))

  // Step 7 (Amendment §D): final sort by name
  return [...retainedPresent, ...reservedPresent, ...selected].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
}

export function projectSnapshot(opts: ProjectSnapshotOptions): ProjectedSnapshot {
  // The shipped comparator lives inside `selectCohortEntries`, character for character.
  // `localeCompare` would order differently under some locales and make the bytes
  // environment-dependent.
  const entries = selectCohortEntries(
    opts.records.filter(isLiveCohort).map(toEntry),
    opts.maxEntries,
    opts.retainedNames,
  )

  return {
    schema: "calllint.trust-snapshot.v0",
    source: "official-mcp-registry",
    endpoint: opts.endpoint,
    fetchedAt: opts.fetchedAt,
    count: entries.length,
    entries,
  }
}

/**
 * Serialize exactly as `refreshSnapshot.ts` commits it: 2-space indent, trailing newline.
 * A projection that produced the right object and the wrong bytes would still move the
 * committed file, so the serializer is part of the contract, not a caller's choice.
 */
export function serializeSnapshot(snapshot: ProjectedSnapshot): string {
  return JSON.stringify(snapshot, null, 2) + "\n"
}
