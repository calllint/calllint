/**
 * resolveIdentity — conclude an identity across source records, and REFUSE to merge when
 * two records claim one (§8.1, §7.1, ADR 0061). Written by R-3.
 *
 * PURE. No clock, no filesystem, no database, no network — the same observer/evaluator
 * split `detectSourceChange` uses. That is not tidiness: it is what lets the conflict path be
 * graded on constructed input, which is the only way to cover the classes the live cohort does
 * not currently exhibit.
 *
 * THE "UNREACHABLE ON REAL DATA" CLAIM THAT WAS HERE IS NOW FALSE, and is inverted rather than
 * deleted because the correction is the useful part. It read: "the conflict path is UNREACHABLE
 * on real data (measured over the committed corpus: raw name 19 distinct / 0 collisions · slug
 * 19 / 0 · repositoryUrl 10 / 0 · package identifier 2 / 0 · publisher head 17 / 1
 * apparent-but-not-a-conflict)". Every one of those numbers is still correct AND the conclusion
 * drawn from them no longer holds: they measure the 19 COMMITTED SNAPSHOT ENTRIES, while this
 * function is now handed the source's full live cohort — 19_739 `active` + `isLatest` names,
 * measured 2026-08-04 by a walk that ran to `reason=exhausted`. At that fan-out slug collisions
 * are MEASURED, not hypothetical: at least two case-fold pairs
 * (`io.github.LocalSynapse/{LocalSynapse-mcp,localsynapse-mcp}` and
 * `io.github.Zuga-luga/{Zugabot,zugabot}`), a FLOOR rather than a count because the probe that
 * found them stopped at its own 500-page ceiling having seen 14_454 of the 19_739.
 *
 * So class 2 now fires in production, and the fail-closed path is live rather than defensive.
 * That is what forced migration 002: this function correctly emits BOTH contesting subjects, and
 * storage could not hold two rows carrying one slug. Reaching a guard for the first time is the
 * moment to check the whole path it feeds, not just the guard — the corpus measurement above
 * made the path look untested when it was merely unexercised.
 *
 * THE GROUPING KEY IS EXACT `canonicalName`. Nothing else. Three heuristics that look
 * reasonable are each falsified by the corpus, and each is wrong in the direction that
 * attaches one product's evidence to another product's page:
 *
 *   - `canonicalSlug` — lossy by construction: it folds case and maps the reverse-DNS `/`
 *     boundary onto a literal `-`, so `a.b/c` and `a.b-c` (and `A.B/C`) land on one slug.
 *     Grouping on it MERGES distinct products.
 *
 *     MEASURED CORRECTION. The plan, and this docblock before it was checked, gave the
 *     colliding pair as `a.b/c` / `a-b-c`. That pair does NOT collide: `.` is inside the
 *     preserved class `[^a-z0-9._-]`, so only `/` is rewritten — `a.b/c` → `a.b-c` while
 *     `a-b-c` → `a-b-c`. The claim is corrected rather than dropped because the CONCLUSION it
 *     was offered for is right and load-bearing (the slug is lossy, so it cannot be a key);
 *     only the witness was wrong, and a wrong witness is what makes a true rule untestable.
 *   - `repositoryUrl` — 9 of 19 committed entries have `null`. `null === null` in a JS Map,
 *     so a group-by fuses 9 unrelated products into one subject. The worst case in the batch.
 *   - publisher (reverse-DNS head) or remote host — `ai.agenticshelf/{graffeo,mcp,puroair}`
 *     is a coffee roaster, an e-commerce catalog and an air-purifier brand sharing one
 *     hosting platform. `publisher-divergence` means ONE IDENTITY CLAIMED BY DIFFERENT
 *     PUBLISHERS, never one publisher with many products.
 *
 * All three are recorded as `identityBasis` EVIDENCE. Recording evidence and keying on it
 * are different acts, and the difference is the whole design.
 *
 * FAIL CLOSED MEANS LESS DATA, NEVER A WINNER. Resolution runs over the WHOLE cohort before
 * anything is written, so a collision is known before either participant would be inserted.
 * On conflict: emit one `identity_conflicts` row naming every participant, mark each subject
 * `CONFLICT`, and emit ZERO `artifact_versions` rows for it. The four tables carry no
 * FOREIGN KEY declarations, so nothing in SQLite would stop a conflicted subject's artifact
 * rows from landing — that invariant has to hold HERE or it does not hold at all.
 */
import { hashJson } from "@calllint/fingerprint"
import type { SourceRecordV1, SourcePackageRef } from "../domain/sourceRecord.js"
import {
  ARTIFACT_VERSION_SCHEMA,
  CANONICAL_SUBJECT_SCHEMA,
  IDENTITY_CONFLICT_SCHEMA,
  assertConflictParticipants,
  type ArtifactVersionV1,
  type CanonicalSubjectV1,
  type ConflictType,
  type IdentityBasis,
  type IdentityConflictV1,
  type SubjectAliasV1,
} from "../domain/subject.js"

/**
 * The slug namespace, duplicated from `trust-index/src/snapshot.ts`'s `REGISTRY_NAMESPACE`
 * rather than imported.
 *
 * Importing it would create an edge from the compiler into the SERVING plane's package,
 * which is exactly the edge the import-boundary gate exists to forbid — and this package's
 * only dependencies are `@calllint/fingerprint` and the native driver. `snapshotProjection`
 * makes the same trade for the same reason and states the same remedy: the equivalence is
 * asserted by a TEST that compares this function against the shipped `registryCanonicalName`
 * over identical input, which catches behavioural drift and not merely structural drift.
 */
export const REGISTRY_SLUG_NAMESPACE = "mcp-registry"

/**
 * `registryCanonicalName`'s transform, character for character.
 *
 * LOSSY ON PURPOSE, AND NEVER A KEY. It lowercases and maps every run of `[^a-z0-9._-]` to a
 * single `-`. Note what that does and does not flatten: `.` and `_` are INSIDE the preserved
 * class and survive, so the lossiness comes from case folding and from the reverse-DNS `/`
 * boundary becoming indistinguishable from a literal `-`. Measured collision buckets:
 * `{a.b/c, a.b-c, A.B/C}` and `{x/y, x-y}`. This is the human-facing label; `canonicalName`
 * is the identity.
 */
export function canonicalSlug(entryName: string): string {
  const slug = entryName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
  return `${REGISTRY_SLUG_NAMESPACE}/${slug}`
}

/**
 * The identity a record CLAIMS, as a single string. Falls back to the source's native id
 * when the source declared no canonical name — matching `snapshotProjection`'s `toEntry`,
 * so the identity layer and the served projection agree on what a nameless record is called.
 */
export function claimedName(record: SourceRecordV1): string {
  return record.claimedIdentity.canonicalName ?? record.source.sourceRecordId
}

/** `hashJson` over the identity key, following `sourceRecordRowId`: derived, never random. */
export function subjectId(sourceId: string, canonicalName: string): string {
  return hashJson({ sourceId, canonicalName })
}

export function artifactVersionId(
  subject: string,
  packageType: string,
  packageIdentifier: string,
  version: string | null,
): string {
  return hashJson({ subjectId: subject, packageType, packageIdentifier, version })
}

/**
 * Ids are sorted before hashing so the id does not depend on the order the collision was
 * discovered in. Two runs that met the same participants in a different order must produce
 * the same conflict row, or replay would accumulate duplicates.
 */
export function conflictId(
  subjectKey: string,
  conflictType: ConflictType,
  sourceRecordIds: readonly string[],
): string {
  return hashJson({ subjectKey, conflictType, sourceRecordIds: [...sourceRecordIds].sort() })
}

/**
 * Which OBSERVATION a conflict participant is — the mirror row, not the subject.
 *
 * `hashJson` over `(sourceId, nativeId, payloadDigest)`, which is `sourceRecordRowId`'s key
 * exactly. Duplicated rather than imported for the same reason `canonicalSlug` is: importing
 * it would pull `storage/store.ts` — and with it `node:fs` — into a function whose whole value
 * is that it touches nothing ambient, inverting the layer direction on top of that. And as
 * with the slug, what makes the duplication safe is a TEST asserting the two agree over
 * identical input, so behavioural drift is caught rather than assumed away.
 *
 * WHY THE DIGEST HAS TO BE IN HERE. For the official registry `sourceRecordId` IS the server
 * name, so every record claiming one name shares one native id; keying participants on the
 * native id alone collapsed a genuine two-record collision to a single participant and made
 * the fail-closed path throw. The digest is what distinguishes the two observations.
 */
export function participantId(record: SourceRecordV1): string {
  return hashJson({
    sourceId: record.source.sourceId,
    sourceNativeId: record.source.sourceRecordId,
    payloadDigest: record.source.payloadDigest,
  })
}

/**
 * A registry package type this batch can resolve OFFLINE. `RESOLVED` means "the registry
 * declared a package we understand", never "we fetched it" — that is `FETCHED`, and it needs
 * R-4's adapter. Anything outside this set is `UNSUPPORTED`, which never upgrades to a
 * verdict of SAFE (INV-R3).
 */
export const RESOLVABLE_PACKAGE_TYPES: readonly string[] = Object.freeze(["npm", "pypi", "oci", "nuget", "mcpb"])

export interface ResolveIdentityOptions {
  /** The current observation of each subject. History would emit a subject twice. */
  records: readonly SourceRecordV1[]
  /** The source these records belong to; part of `subjectId`. */
  sourceId: string
  /** Injected stamp for `firstSeenAt`/`lastSeenAt`/`createdAt` — never a clock (INV-R6). */
  observedAt: string
}

export interface ResolveIdentityResult {
  subjects: CanonicalSubjectV1[]
  aliases: SubjectAliasV1[]
  artifacts: ArtifactVersionV1[]
  conflicts: IdentityConflictV1[]
}

/**
 * `sourceLocator` for an artifact: what the registry said, in a form a human can act on and
 * the engine will NOT follow. Resolving an artifact never executes it, and this string is
 * never rendered as a command.
 */
function sourceLocator(pkg: SourcePackageRef): string {
  return pkg.version == null ? `${pkg.registryType}:${pkg.identifier}` : `${pkg.registryType}:${pkg.identifier}@${pkg.version}`
}

/**
 * Build the identity evidence for one record. Every kind present is recorded — including the
 * two that must never be grouping keys, because a human adjudicating a conflict needs to see
 * the repository and publisher that made it look like one identity.
 */
function basisFor(record: SourceRecordV1): IdentityBasis[] {
  const id = record.claimedIdentity
  const recordId = record.source.sourceRecordId
  const basis: IdentityBasis[] = [
    { kind: "registry-canonical-name", value: claimedName(record), sourceRecordId: recordId },
  ]
  if (id.repositoryUrl != null && id.repositoryUrl.length > 0) {
    basis.push({ kind: "repository-url", value: id.repositoryUrl, sourceRecordId: recordId })
  }
  for (const pkg of id.packages) {
    basis.push({
      kind: "package-identifier",
      value: `${pkg.registryType}:${pkg.identifier}`,
      sourceRecordId: recordId,
    })
  }
  return basis
}

/** Stable, duplicate-free, order-independent — an alias list must not depend on arrival order. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

/**
 * Collapse basis entries that are the SAME EVIDENCE stated twice.
 *
 * MEASURED, and the reason this exists rather than being obvious. `basisFor` emits one
 * `package-identifier` per declared package, but a basis VALUE is `registryType:identifier`
 * with no version in it — so a record declaring `npm:same@1` and `npm:same@2` produced the
 * identical triple twice. `subject_aliases` is where `identityBasis` persists and its
 * PRIMARY KEY is `(alias, subject_id)`, so the second row could never land: the document
 * would carry evidence the store cannot round-trip, and a read-back comparison would fail on
 * a difference that is not a difference.
 *
 * Keyed on the whole triple, so a value supplied by a DIFFERENT record survives as its own
 * entry: `sourceRecordId` is a citation, and dropping one would drop the record it points at.
 *
 * WHAT THAT DOES NOT BUY, corrected here after measuring rather than left as an implication.
 * On the official registry it does not preserve "two observations agreed": `IdentityBasis`
 * cites the NATIVE id, which for this source is the server name, so two observations of one
 * name produce byte-identical triples and collapse. Nothing is lost — the two entries would
 * have been indistinguishable, carrying no information a reader could act on. Where the
 * observations ARE visible is the conflict's `sourceRecordIds`, which are `participantId`s
 * precisely because the native id cannot tell them apart. A multi-source cohort is the case
 * where this key does keep two entries, and it is the case it was written for.
 */
function dedupeBasis(basis: readonly IdentityBasis[]): IdentityBasis[] {
  const seen = new Set<string>()
  const out: IdentityBasis[] = []
  for (const b of basis) {
    // `\u0000` written as an ESCAPE, not as a raw byte. It was a literal NUL here and the file
    // was valid TypeScript that ran green — but `git` classifies a file containing NUL as
    // binary, so `grep` refused to search it and a diff would have shown "Binary files differ".
    // A separator that cannot appear in a kind, a URL, or a registry name is still the right
    // choice; it just has to be spelled.
    const key = `${b.kind}\u0000${b.value}\u0000${b.sourceRecordId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(b)
  }
  return out
}

/**
 * The reverse-DNS head of a registry name — `ai.agenticshelf/mcp` → `ai.agenticshelf`.
 *
 * Computed ONLY to compare publishers WITHIN one claimed identity. It is never a grouping
 * key: the committed corpus has 17 distinct heads over 19 entries, and the single repeat is
 * `ai.agenticshelf/{graffeo,mcp,puroair}` — three unrelated products on one hosting
 * platform. Grouping on it would merge them, which is the defect, not the feature.
 */
export function publisherHead(canonicalName: string): string {
  const slash = canonicalName.indexOf("/")
  return slash === -1 ? canonicalName : canonicalName.slice(0, slash)
}

/**
 * The three DIVERGENCE classes, measured only among records that already claim ONE identity.
 *
 * WHY THEY ARE SCOPED THAT WAY, AND WHY THAT IS A NARROWING. A divergence is two records
 * disagreeing about what one identity IS — different repositories, different packages,
 * different publishers behind the same name. Across DIFFERENT names, the same three signals
 * are not disagreement at all: they are ordinary independence, and treating them as conflict
 * is exactly what controls #2/#3/#4 mutate this code to do (9 `null` repos fusing into one
 * subject; the `agenticshelf` trio merging).
 *
 * The consequence is stated rather than hidden: on the committed corpus every group has
 * exactly one record, so all three classes are structurally unreachable — as is the
 * `canonical-name-collision` that gates them. They are graded on synthetic input (control
 * #21) and nowhere else. A class that only fires alongside another is still worth recording
 * separately, because it names WHY the identity is in conflict, which is the first thing a
 * human adjudicating the row needs.
 */
function divergenceTypes(bucket: readonly SourceRecordV1[]): ConflictType[] {
  if (bucket.length < 2) return []
  const types: ConflictType[] = []

  // `null` repositories are absence of evidence, not agreement and not disagreement — so
  // they are filtered out BEFORE the distinctness count. Counting them would report a
  // divergence between a record that named a repository and one that named none.
  const repos = new Set(
    bucket.map((r) => r.claimedIdentity.repositoryUrl).filter((u): u is string => u != null && u.length > 0),
  )
  if (repos.size > 1) types.push("repository-url-divergence")

  const pkgs = new Set(
    bucket.flatMap((r) => r.claimedIdentity.packages.map((p) => `${p.registryType}:${p.identifier}`)),
  )
  if (pkgs.size > 1) types.push("package-identifier-divergence")

  // ONE IDENTITY CLAIMED BY DIFFERENT PUBLISHERS. The inverse — one publisher, many
  // identities — is normal and must never reach here; it cannot, because `bucket` is a
  // single claimed name by construction.
  const publishers = new Set(bucket.map((r) => publisherHead(claimedName(r))))
  if (publishers.size > 1) types.push("publisher-divergence")

  return types
}

/**
 * Group records by EXACT claimed name. A `Map` preserves insertion order, but every output
 * collection is sorted before it is returned, so the result does not depend on it.
 */
function groupByClaimedName(records: readonly SourceRecordV1[]): Map<string, SourceRecordV1[]> {
  const groups = new Map<string, SourceRecordV1[]>()
  for (const record of records) {
    const key = claimedName(record)
    const bucket = groups.get(key)
    if (bucket === undefined) groups.set(key, [record])
    else bucket.push(record)
  }
  return groups
}

export function resolveIdentity(opts: ResolveIdentityOptions): ResolveIdentityResult {
  const groups = groupByClaimedName(opts.records)

  // Slug collisions are cross-GROUP: two DISTINCT canonical names that flatten to one slug.
  // Computed before any subject is built, because a subject may not be emitted for a name
  // that is about to be found in conflict — pre-persist detection is what makes fail-closed
  // reachable at all.
  const slugOwners = new Map<string, string[]>()
  for (const name of groups.keys()) {
    const slug = canonicalSlug(name)
    const owners = slugOwners.get(slug)
    if (owners === undefined) slugOwners.set(slug, [name])
    else owners.push(name)
  }

  const conflicts: IdentityConflictV1[] = []
  const conflictedNames = new Set<string>()

  // Class 1: two records claim ONE canonical name. The registry cannot tell us which is the
  // product, so neither is elected. Silent election is precisely what R-3 exists to remove.
  for (const [name, bucket] of groups) {
    if (bucket.length < 2) continue

    // The participants are identified by (nativeId, payloadDigest), not by nativeId alone.
    //
    // MEASURED, and this is a correction of the obvious version of this line. For the official
    // registry `sourceRecordId` IS the server name (`officialRegistry.ts` keys on it so a
    // republish is a new observation, not a new subject), so two records claiming one name
    // necessarily share it. De-duplicating on nativeId alone therefore collapsed a real
    // two-record collision to one participant and `assertConflictParticipants` THREW — the
    // fail-closed path crashing instead of recording the refusal it exists to record. The
    // store's UNIQUE key is `(source, nativeId, payloadDigest)`, so two same-named rows with
    // different payloads legitimately coexist in the mirror and this input is reachable.
    //
    // The digest is what distinguishes the observations, so it belongs in the identity of a
    // participant. Two rows with the SAME digest are one observation seen twice and still
    // collapse — which is why the assertion below is kept rather than removed: a bucket of
    // byte-identical duplicates is not a conflict, and it must not be reported as one.
    const ids = sortedUnique(bucket.map((r) => participantId(r)))
    if (ids.length < 2) continue
    assertConflictParticipants(ids, name)
    conflictedNames.add(name)
    // The collision itself, plus each way the records DISAGREE about the identity they
    // share. One row per class: the collision says "these cannot be merged", the
    // divergences say why, and a human adjudicating needs both.
    for (const conflictType of ["canonical-name-collision" as ConflictType, ...divergenceTypes(bucket)]) {
      conflicts.push({
        schema: IDENTITY_CONFLICT_SCHEMA,
        conflictId: conflictId(name, conflictType, ids),
        subjectKey: name,
        conflictType,
        sourceRecordIds: ids,
        status: "OPEN",
        createdAt: opts.observedAt,
        resolvedAt: null,
        resolution: null,
      })
    }
  }

  // Class 2: distinct names, one slug. The slug is the human-facing label, so two products
  // sharing one would be served at one address — the collision has to surface here even
  // though each name resolves cleanly on its own.
  for (const [slug, owners] of slugOwners) {
    if (owners.length < 2) continue
    // Same participant identity as class 1, and for the same reason. Distinct owner names mean
    // distinct native ids here, so this never collapsed the way class 1 did — but a conflict
    // row whose participants were keyed differently from every other conflict row would point
    // at something that is not a mirror row, and the two classes must be adjudicable alike.
    const ids = sortedUnique(owners.flatMap((n) => (groups.get(n) ?? []).map((r) => participantId(r))))
    assertConflictParticipants(ids, slug)
    for (const name of owners) conflictedNames.add(name)
    conflicts.push({
      schema: IDENTITY_CONFLICT_SCHEMA,
      conflictId: conflictId(slug, "slug-collision", ids),
      subjectKey: slug,
      conflictType: "slug-collision",
      sourceRecordIds: ids,
      status: "OPEN",
      createdAt: opts.observedAt,
      resolvedAt: null,
      resolution: null,
    })
  }

  const subjects: CanonicalSubjectV1[] = []
  const aliases: SubjectAliasV1[] = []
  const artifacts: ArtifactVersionV1[] = []

  for (const [name, bucket] of groups) {
    const id = subjectId(opts.sourceId, name)
    // NATIVE ids here, deliberately, where a conflict's participants are `participantId`s.
    // The two answer different questions: a subject records WHICH SOURCES claim it (one server
    // observed twice is still one source, and this list feeds `subjectIdentityDigest`, which
    // must not move when only a payload was refreshed), while a conflict has to name the exact
    // mirror ROWS a human will open to adjudicate it. Using one key for both would either make
    // the digest churn on every republish or make the conflict unadjudicable.
    const recordIds = sortedUnique(bucket.map((r) => r.source.sourceRecordId))
    // De-duplicated because `subject_aliases`' PRIMARY KEY is `(alias, subject_id)` and this
    // list is what lands there — see `dedupeBasis`. One record declaring two versions of one
    // package yields one basis value twice, and the second row could never be stored.
    const basis = dedupeBasis(bucket.flatMap(basisFor))
    const slug = canonicalSlug(name)
    const inConflict = conflictedNames.has(name)

    // A CONFLICT subject is still RECORDED — the row is the evidence a human adjudicates
    // from, and dropping it would turn a refusal into a silent omission. What it must not do
    // is carry artifacts (below) or claim a resolution it does not have.
    subjects.push({
      schema: CANONICAL_SUBJECT_SCHEMA,
      subjectId: id,
      canonicalName: name,
      canonicalSlug: slug,
      // The registry's display name is UNTRUSTED publisher content used as a label only
      // (INV-R8). Falls back to the canonical name, never to an empty string.
      displayName: bucket[0]!.claimedIdentity.displayName ?? name,
      aliases: sortedUnique([slug, ...basis.filter((b) => b.kind !== "registry-canonical-name").map((b) => b.value)]),
      sourceRecordIds: recordIds,
      identityBasis: basis,
      // PROVISIONAL for every non-conflicted subject in this release. §8.1 seeds identity
      // from the Official MCP Registry canonical name alone, and single-source resolution is
      // PROVISIONAL by definition — `RESOLVED` would claim corroboration that does not exist.
      identityStatus: inConflict ? "CONFLICT" : "PROVISIONAL",
      firstSeenAt: opts.observedAt,
      lastSeenAt: opts.observedAt,
    })

    // One row per DISTINCT alias string. `dedupeBasis` folds identical triples; this folds by
    // VALUE alone, which is strictly coarser and is what `(alias, subject_id)` actually keys on.
    // Two entries differing only in `sourceRecordId` are one row, and the first citation wins —
    // the earliest-arriving observation of that value. The two folds are separate because they
    // answer to different constraints: the document keeps every distinct citation, the table
    // keeps one row per alias.
    const emitted = new Set<string>()
    for (const b of basis) {
      if (emitted.has(b.value)) continue
      emitted.add(b.value)
      aliases.push({ alias: b.value, subjectId: id, sourceRecordId: b.sourceRecordId, aliasType: b.kind })
    }
    // The derived slug is an alias no single record supplied, hence a null `sourceRecordId`.
    // Skipped when a record already claimed that exact string, because the row would be the
    // same primary key: a real citation beats a derived one with nothing behind it.
    if (!emitted.has(slug)) {
      aliases.push({ alias: slug, subjectId: id, sourceRecordId: null, aliasType: "registry-canonical-name" })
    }

    // FAIL CLOSED. A conflicted subject yields ZERO artifact rows: an artifact is the unit
    // evidence attaches to, so attaching one to an unresolved identity is how a coffee
    // roaster's evidence would end up on an air purifier's page.
    if (inConflict) continue

    for (const pkg of bucket[0]!.claimedIdentity.packages) {
      artifacts.push({
        schema: ARTIFACT_VERSION_SCHEMA,
        artifactVersionId: artifactVersionId(id, pkg.registryType, pkg.identifier, pkg.version),
        subjectId: id,
        version: pkg.version,
        packageType: pkg.registryType,
        packageIdentifier: pkg.identifier,
        // The registry HOST, which the snapshot does not declare. R-4's adapter resolves it.
        packageRegistry: null,
        sourceLocator: sourceLocator(pkg),
        // REQUIRED and null: the snapshot declares no digest anywhere (2 packages / 18
        // remotes over 19 committed entries, no digest field on either shape). A fabricated
        // digest would be worse than an honest absence, because downstream cannot tell the
        // difference between a verified artifact and an invented one.
        immutableDigest: null,
        // `registryIntegrity` is deliberately ABSENT, not null: the schema types it
        // `{type: "string", minLength: 1}` and does not require it, so `null` would fail
        // validation. R-4 sets it when a registry supplies an integrity claim.
        artifactStatus: RESOLVABLE_PACKAGE_TYPES.includes(pkg.registryType) ? "RESOLVED" : "UNSUPPORTED",
      })
    }
  }

  // Sorted on the way out so two runs over the same records produce identical collections
  // regardless of arrival order — the same reason `sourceRecordRowId` is derived.
  subjects.sort((a, b) => (a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0))
  aliases.sort(
    (a, b) =>
      (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0) ||
      (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0) ||
      (a.aliasType < b.aliasType ? -1 : a.aliasType > b.aliasType ? 1 : 0),
  )
  artifacts.sort((a, b) => (a.artifactVersionId < b.artifactVersionId ? -1 : a.artifactVersionId > b.artifactVersionId ? 1 : 0))
  conflicts.sort((a, b) => (a.conflictId < b.conflictId ? -1 : a.conflictId > b.conflictId ? 1 : 0))

  return { subjects, aliases, artifacts, conflicts }
}
