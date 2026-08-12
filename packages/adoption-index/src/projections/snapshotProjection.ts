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
    description: record.untrustedPublisherContent?.description ?? "",
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
 * Apply the cap as a reserved-first selection. The shipped edge's `selectCohortEntries`,
 * clause for clause: sorted output, `min(length, max)` as an absolute ceiling, every reserved
 * name present in the input present in the output whenever `max >= 1`, and — when the cap does
 * not bind — the bare sort this replaced.
 *
 * The early exit is why today's committed snapshot cannot move: 19 records against a cap of
 * 100 returns before the partition is reached.
 */
export function selectCohortEntries<T extends { readonly name: string }>(entries: readonly T[], max: number): T[] {
  const byName = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (byName.length <= max) return byName
  const isReserved = (e: T): boolean => RESERVED_COHORT_NAMES.includes(e.name)
  const reserved = byName.filter(isReserved).slice(0, max)
  // Clamped for the same reason as the shipped edge, which carries the measurement: the clamp is
  // reachable ONLY for a negative `max` — `reserved` is already sliced to `max`, so the budget
  // cannot go negative for any `max >= 0`. Unclamped, `slice(0, -1)` means "all but the last", so a
  // negative ceiling admits MORE the more negative it gets.
  const rest = byName.filter((e) => !isReserved(e)).slice(0, Math.max(0, max - reserved.length))
  return [...reserved, ...rest].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function projectSnapshot(opts: ProjectSnapshotOptions): ProjectedSnapshot {
  // The shipped comparator lives inside `selectCohortEntries`, character for character.
  // `localeCompare` would order differently under some locales and make the bytes
  // environment-dependent.
  const entries = selectCohortEntries(opts.records.filter(isLiveCohort).map(toEntry), opts.maxEntries)

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
