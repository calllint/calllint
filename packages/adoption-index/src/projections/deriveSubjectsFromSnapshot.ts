/**
 * `deriveSubjectsFromSnapshot` — rebuild the identity plane from a COMMITTED registry snapshot,
 * purely, with no database and no network.
 *
 * WHY THIS EXISTS AT ALL, since the store already holds these rows and re-deriving them looks
 * like duplication. The committed `adoption-index.json` is the output of a pure function over a
 * committed input, so its gate must RE-DERIVE and compare bytes — the same thing
 * `committed-tree.test.ts` does for the 119 served files. A gate that only validated the
 * document's schema would pass a hand-edited `identityDigest` silently, which is the shape
 * [[negative-control-validity-checklist]] calls a no-op assertion (control #117). And it cannot
 * re-derive from the store: `.var/calllint-adoption-index/` is gitignored and never cached, so in
 * the ordinary vitest suite — three OSes, cold checkout — there is no database to read.
 *
 * WHAT MAKES THE OUTPUT TRUSTWORTHY rather than a second, drifting definition of identity: every
 * step below is an already-shipped exported function, and the last two are the SAME two the store's
 * own writer uses. `persistIdentity` writes `canonical_slug` as `subjectSlugRow(s)` and
 * `identity_digest` as `subjectIdentityDigest(s)`; this module calls those, so a derived row is
 * shape-identical to a persisted one by construction, not by a comment. The one thing it cannot
 * reproduce is `firstSeenAt` history — a row seen in an earlier run keeps its original stamp in the
 * store, while a derivation sees only the current snapshot. That is why `lastSeenAt` is the field
 * the projection carries and `firstSeenAt` is not (`adoptionIndexProjection.ts`).
 *
 * THE REVERSE MAPPING IS THE UNAVOIDABLE PART. `resolveIdentity` consumes `SourceRecordV1`, which
 * `toSourceRecord` builds from the registry's RAW wire shape; the committed snapshot is the
 * PROJECTED shape (`snapshotProjection.ts`'s `ProjectedEntry`), one lossy step downstream. So a
 * derivation has to map projected → raw before it can go raw → record → subject. This mapping
 * previously existed only inside `refresh-artifacts-e2e.test.ts` (`corpusPayload()`); a gate that
 * needs it cannot import a test, and two copies of a lossy inverse is how the gate and the
 * pipeline silently disagree. It lives here now, once.
 *
 * WHAT THE INVERSE DOES NOT RECOVER, stated rather than hidden, because a silent lossy inverse is
 * worse than a documented one:
 *   - `transport` on a package. `ProjectedPackage` carries it, and `normalizePackages` reads it
 *     from the raw shape, so it round-trips — but only because it is emitted below. Omitting it
 *     would change `payloadDigest` and nothing would notice.
 *   - `updatedAt` on `_meta`. The projection drops it, so the derived record's `lifecycle` has
 *     `publishedAt` only. This does not reach identity (`resolveIdentity` reads `claimedIdentity`),
 *     which is why it is acceptable here and would not be in a mirror rebuild.
 *   - `isLatest`. Not in the projection either, and it MUST be forced true: the snapshot is already
 *     the filtered live cohort (`isLiveCohort` selected it), so a derivation that left the flag
 *     absent would re-filter an already-filtered set and produce fewer subjects than the pipeline.
 *
 * IDENTITY ONLY. Nothing here compiles a record, reads a policy, or forms a verdict — the same
 * boundary `adoptionIndexProjection.ts` states for its own output (ADR 0061 §4).
 */
import { OFFICIAL_REGISTRY_SOURCE_ID, toSourceRecord } from "../sources/officialRegistry.js"
import { resolveIdentity } from "../identity/resolveIdentity.js"
import { subjectIdentityDigest, subjectSlugRow, type StoredSubject } from "../storage/store.js"
import type { SourceRecordV1 } from "../domain/sourceRecord.js"
import type { ProjectedEntry } from "./snapshotProjection.js"

/**
 * The `_meta` key the official registry stamps its lifecycle under.
 *
 * Duplicated from `officialRegistry.ts` rather than exported from it, because that constant is
 * module-private there and widening a module's surface to serve a derivation would invert the
 * dependency. Pinned by a test that reads a real record's lifecycle back out, so a drift between
 * the two spellings fails rather than silently yielding `status: null` on every entry.
 */
export const OFFICIAL_META_KEY = "io.modelcontextprotocol.registry/official"

/**
 * One projected entry → the registry's raw wire item.
 *
 * Fields are OMITTED when empty rather than emitted as `null`/`[]`, mirroring what the live
 * endpoint sends: `payloadDigest` is `hashJson(item)`, so an added `"remotes": []` would change
 * the digest of every record and make a derived `sourceRecordId` set that is right while every
 * digest is wrong. The digest does not reach identity, but it does reach `source_records`, and a
 * derivation that is subtly wrong in a place nothing checks is the one worth being exact about.
 */
function toRawItem(entry: ProjectedEntry): Record<string, unknown> {
  const server: Record<string, unknown> = { name: entry.name }
  if (entry.description.length > 0) server.description = entry.description
  if (entry.version != null) server.version = entry.version
  if (entry.repositoryUrl != null) server.repository = { url: entry.repositoryUrl, source: "github" }
  if (entry.packages.length > 0) {
    server.packages = entry.packages.map((p) => ({
      registryType: p.registryType,
      identifier: p.identifier,
      ...(p.version == null ? {} : { version: p.version }),
      ...(p.transport == null ? {} : { transport: p.transport }),
    }))
  }
  if (entry.remotes.length > 0) {
    server.remotes = entry.remotes.map((r) => ({ type: r.type, url: r.url }))
  }
  return {
    server,
    _meta: {
      [OFFICIAL_META_KEY]: {
        status: entry.status,
        // FORCED, not copied: the snapshot is the already-filtered live cohort. See the docblock.
        isLatest: true,
        ...(entry.publishedAt == null ? {} : { publishedAt: entry.publishedAt }),
      },
    },
  }
}

/** Projected entries → source records, in snapshot order. Exported for the round-trip test. */
export function deriveSourceRecords(
  entries: readonly ProjectedEntry[],
  retrievedAt: string,
): SourceRecordV1[] {
  const out: SourceRecordV1[] = []
  for (const entry of entries) {
    // `null` only when the raw item has no usable name, which `toRawItem` cannot produce from a
    // parsed snapshot — kept as a filter rather than a throw because the signature is nullable and
    // a derivation that silently indexed past a null would be worse than one that skips it.
    const record = toSourceRecord(toRawItem(entry), retrievedAt)
    if (record !== null) out.push(record)
  }
  return out
}

/**
 * A committed snapshot's entries → the `canonical_subjects` rows they imply. Pure.
 *
 * `observedAt` fills BOTH `firstSeenAt` and `lastSeenAt`, because a single snapshot carries no
 * history — see the docblock. Callers that need the store's real `firstSeenAt` must read the store;
 * this function is for the gate, which compares only what the projection carries.
 *
 * A `CONFLICT` subject comes back with `canonicalSlug: null`, exactly as the store would hold it,
 * so the projection's one skip rule behaves identically on derived and stored rows.
 */
export function deriveSubjectsFromSnapshot(opts: {
  entries: readonly ProjectedEntry[]
  observedAt: string
  /** Defaults to the official registry — the only source with a committed snapshot today. */
  sourceId?: string
}): StoredSubject[] {
  const records = deriveSourceRecords(opts.entries, opts.observedAt)
  const resolved = resolveIdentity({
    records,
    sourceId: opts.sourceId ?? OFFICIAL_REGISTRY_SOURCE_ID,
    observedAt: opts.observedAt,
  })
  return resolved.subjects.map((s) => ({
    subjectId: s.subjectId,
    canonicalName: s.canonicalName,
    // The store's own two functions, so a derived row and a persisted row agree by construction.
    canonicalSlug: subjectSlugRow(s),
    displayName: s.displayName,
    identityStatus: s.identityStatus,
    identityDigest: subjectIdentityDigest(s),
    firstSeenAt: s.firstSeenAt,
    lastSeenAt: s.lastSeenAt,
  }))
}
