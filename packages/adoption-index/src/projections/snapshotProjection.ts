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
 *   3. `.slice(0, maxEntries)`
 *
 * Step 3 caps AFTER step 2, so the retained 25 are the 25 alphabetically first — NOT the
 * 25 most recent. That is a surprising property and it is load-bearing: a projection that
 * "improved" it by taking the newest 25 would change which entries exist, which changes
 * every page the bake emits. The mirror may hold thousands of records; this projection
 * still emits the same 25 for the same upstream.
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

export function projectSnapshot(opts: ProjectSnapshotOptions): ProjectedSnapshot {
  const entries = opts.records
    .filter(isLiveCohort)
    .map(toEntry)
    // The shipped comparator, character for character. `localeCompare` would order
    // differently under some locales and make the bytes environment-dependent.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, opts.maxEntries)

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
