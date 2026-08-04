/**
 * refreshFromMirror — the operation that turns the committed snapshot into a PROJECTION.
 *
 * Before this batch, `refreshSnapshot.ts` did one GET and serialized the result. The
 * snapshot was therefore the ONLY record of what upstream held, and everything the
 * emitter dropped at ingestion — deprecated servers, superseded versions, anything past
 * the cap — was unrecoverable. R-1 inverts that: the FULL cursor-paginated source is
 * mirrored into `source_records` first, and the snapshot is projected from the mirror.
 *
 * The byte-identity requirement is what shapes this file. The committed snapshot feeds a
 * reproducibility gate that byte-compares committed served bytes against a fresh render,
 * so an unchanged upstream must produce an unchanged snapshot — not an equivalent one.
 * `packages/adoption-index/test/snapshot-projection.test.ts` measures that against the
 * shipped emitter's own output over one shared raw body, which is why this function does
 * not re-implement any of the filter, the sort, or the cap: it calls `projectSnapshot`.
 *
 * TWO CAPS, DELIBERATELY DISTINCT. They count different populations and conflating them
 * is the defect this file is arranged to prevent:
 *
 *   - the MIRROR cap (`maxEntries` on `SourceSyncContext`) is a runaway guard, applied in
 *     ARRIVAL order and BEFORE the lifecycle filter. It bounds the read.
 *   - the SNAPSHOT cap (`maxEntries` on `projectSnapshot`) is the served-cohort size,
 *     applied AFTER filtering to live records and sorting by name. It bounds the artifact.
 *
 * The snapshot cap cannot be honoured from a truncated read: to know which N live entries
 * are alphabetically first you need the complete live set, and a prefix of arrival order is
 * not that. So `assertMirrorComplete` refuses to project from a capped read, and the mirror
 * cap defaults well above the snapshot cap rather than equal to it. Setting them equal
 * would look correct and would be wrong precisely when the source grows.
 */
import { hashJson } from "@calllint/fingerprint"
import { AdoptionIndexStore, type PersistIdentityResult } from "../storage/store.js"
import { resolveIdentity } from "../identity/resolveIdentity.js"
import type { SourceAdapter, SourceSyncContext } from "../sources/sourceAdapter.js"
import { OFFICIAL_REGISTRY_SOURCE_ID } from "../sources/officialRegistry.js"
import { assertMirrorComplete, syncSource, type SyncSourceResult } from "./syncSource.js"
import { projectSnapshot, serializeSnapshot, type ProjectedSnapshot } from "../projections/snapshotProjection.js"
import { detectSourceChange, type SourceChangeVerdict } from "./detectSourceChange.js"

/**
 * How many raw records one mirror run reads, when the caller names no cap.
 *
 * Chosen as a multiple of the snapshot cap, not equal to it, for a measured reason: the
 * mirror keeps the non-live records the snapshot drops, so it must read strictly more than
 * the snapshot emits to fill it. The committed snapshot holds 19 of a 25 cap today, so this
 * ceiling is not close to binding; when it does bind, `assertMirrorComplete` says so
 * instead of quietly shipping a short snapshot.
 */
export const DEFAULT_MIRROR_MAX_ENTRIES = 1000

export interface RefreshFromMirrorOptions {
  store: AdoptionIndexStore
  adapter: SourceAdapter
  /** Injected fetch. There is no ambient network access in this package. */
  fetchImpl: typeof fetch
  /**
   * The one clock read of the run, captured by the caller at the edge and passed inward
   * (§9.5, INV-R6). It becomes both the records' `retrievedAt` and the snapshot's
   * `fetchedAt`, so a run's mirror and its projection agree on when they happened.
   */
  now: string
  /** The endpoint recorded in the snapshot verbatim (never derived from the adapter). */
  endpoint: string
  /** Served-cohort size. The emitter's cap, applied after filter + sort. */
  snapshotMaxEntries: number
  /** Raw-read ceiling. Defaults to `DEFAULT_MIRROR_MAX_ENTRIES`. */
  mirrorMaxEntries?: number
  /** `full` ignores the watermark; `incremental` resumes from it. */
  mode?: "full" | "incremental"
  /** Page-count ceiling, forwarded to the adapter. */
  maxPages?: number
}

export interface RefreshFromMirrorResult {
  sync: SyncSourceResult
  snapshot: ProjectedSnapshot
  /** Exactly the bytes to commit: `JSON.stringify(snapshot, null, 2) + "\n"`. */
  snapshotText: string
  /** Rows in the mirror for this source, history included. */
  mirroredRecords: number
  /** Distinct subjects after collapsing history — the population the projection reads. */
  currentSubjects: number
  /**
   * Whether this run changed anything the served tree is a function of, and which §16.2
   * tier the change reaches (R-2). The caller decides what to rebuild; this operation only
   * measures and persists the key.
   */
  change: SourceChangeVerdict
  /**
   * `hashJson` over the projected cohort's ENTRIES — the value persisted to
   * `source_checkpoints.snapshot_digest` and compared on the next run.
   */
  snapshotDigest: string
  /**
   * What identity resolution CONCLUDED this run, and what reached the store (R-3).
   *
   * `conflicts > 0` is not a warning: each conflict is a refusal to merge, its subjects are
   * `CONFLICT` (terminal), and none of them contributed an artifact row. So `subjects` and
   * `artifacts` do not track each other when a collision occurs — by design.
   */
  identity: {
    subjects: number
    conflicts: number
    artifacts: number
    aliases: number
    /** Row counts as written, from the store's own report rather than from the resolver's. */
    persisted: PersistIdentityResult
  }
}

/**
 * The change key: a digest of the projected cohort's ENTRIES.
 *
 * Deliberately not the snapshot envelope. `ProjectedSnapshot` carries `fetchedAt`, which is
 * the run's one clock read, so digesting the envelope would move the key on every run and the
 * detector would never skip. `count` is derived from `entries` and `endpoint`/`schema`/`source`
 * are constants of the projection, so `entries` alone is both necessary and sufficient.
 *
 * `hashJson` sorts object keys recursively, so the digest is stable against key-order drift in
 * the payloads the mirror stores.
 */
export function cohortDigest(snapshot: ProjectedSnapshot): string {
  return hashJson(snapshot.entries)
}

/**
 * Mirror the source, then project the snapshot from the mirror.
 *
 * The order is not a preference. §9.4 forbids advancing a checkpoint before the records are
 * durably committed, and `syncSource` already commits both in one transaction; projecting
 * afterwards means the snapshot can only ever describe records that are actually stored. A
 * projection taken from the in-flight stream would be able to disagree with the mirror it
 * claims to project.
 *
 * The read is `listLatestSourceRecordPayloads`, NOT `listSourceRecordPayloads`. The mirror
 * keeps every observation of a subject on purpose, so the plain read returns the same
 * server once per historical payload and the projection would emit it that many times.
 *
 * R-2 adds the change detection, and the ORDER of its three reads is what makes it sound:
 *
 *   1. the PRIOR cohort digest, read BEFORE the sync. Comparing against durable state is the
 *      whole point — a digest compared against something this run computed detects nothing.
 *   2. the mirror's current subjects, also read BEFORE the sync. After `syncSource` persists,
 *      this run's own records are current, so the set difference that finds a withdrawal is
 *      unmeasurable: everything observed is present by construction.
 *   3. the NEXT cohort digest, after projecting.
 */
export async function refreshFromMirror(opts: RefreshFromMirrorOptions): Promise<RefreshFromMirrorResult> {
  const mirrorMaxEntries = opts.mirrorMaxEntries ?? DEFAULT_MIRROR_MAX_ENTRIES
  const ctx: SourceSyncContext = {
    retrievedAt: opts.now,
    fetchImpl: opts.fetchImpl,
    maxEntries: mirrorMaxEntries,
    ...(opts.maxPages === undefined ? {} : { maxPages: opts.maxPages }),
  }

  // Read #1 and #2, both BEFORE the sync — see the docblock. `priorSnapshotDigest` is `null`
  // on a first run or a store rebuilt from scratch, which the detector reports as its own
  // reason rather than conflating with "changed".
  const priorSnapshotDigest = opts.store.readCheckpoint(opts.adapter.sourceId).snapshotDigest
  const subjectsBefore = new Set(
    opts.store.listLatestSourceRecords(opts.adapter.sourceId).map((r) => r.sourceNativeId),
  )

  const sync = await syncSource({
    store: opts.store,
    adapter: opts.adapter,
    ctx,
    mode: opts.mode ?? "full",
    completedAt: opts.now,
  })

  // Fails CLOSED. A capped read cannot support the snapshot's filter-then-sort-then-slice,
  // and the resulting short snapshot would be undetectable in the artifact.
  assertMirrorComplete(sync, mirrorMaxEntries)

  const records = opts.store.listLatestSourceRecordPayloads(opts.adapter.sourceId)
  const snapshot = projectSnapshot({
    records,
    endpoint: opts.endpoint,
    fetchedAt: opts.now,
    maxEntries: opts.snapshotMaxEntries,
  })

  // A subject the mirror already considered current that this run did NOT observe. The mirror
  // is append-only — there is no DELETE in this package — so its memory of a withdrawn
  // subject outlives the withdrawal, and nothing else in the run can notice the absence.
  // Sorted so the reported set (and any log line built from it) is deterministic.
  const absentFromSource = [...subjectsBefore].filter((id) => !sync.observedNativeIds.has(id)).sort()

  const snapshotDigest = cohortDigest(snapshot)

  // IDENTITY RESOLUTION RUNS HERE — after the projection, and never upstream of it (R-3).
  //
  // WHAT ACTUALLY PROTECTS THE PROJECTION IS DATA FLOW, NOT LINE ORDER. This comment first
  // claimed the ordering was "asserted by a control that moves it". Measured: moving this call
  // above `projectSnapshot` leaves all 44 tests in `refresh-from-mirror` +
  // `snapshot-projection` GREEN. It has to. `resolveIdentity` is pure, `records` is computed
  // before both call sites, and its return value is never read by the projection — so the two
  // statements commute and no byte can move. The control as first written was unfalsifiable,
  // and a green that cannot go red is not evidence (R-2 control #11: a control that passes when
  // it should fail is a finding about the harness).
  //
  // The real invariant, stated so it can be broken: `snapshot` is a function of `records`
  // ALONE. The committed snapshot feeds a reproducibility gate that byte-compares committed
  // served bytes against a fresh render, so anything identity concludes must stay downstream.
  // The falsifiable mutation is therefore a DEPENDENCY, not a reorder — pass any part of
  // `identity` into `projectSnapshot`'s input (filter `records` by resolved subject, say) and
  // the byte comparison fails, because 19 entries no longer project 19. That is the shape
  // `refresh-from-mirror.test.ts` records for control #16.
  //
  // Resolution reads the SAME `records` the projection read — the current observation of each
  // subject, not history — so a subject cannot be concluded from a payload the source has
  // withdrawn.
  const identity = resolveIdentity({ records, sourceId: opts.adapter.sourceId, observedAt: opts.now })

  const change = detectSourceChange({
    priorSnapshotDigest,
    nextSnapshotDigest: snapshotDigest,
    absentFromSource,
    // R-3 flips this grid cell from `null` to a MEASURED boolean. It is true exactly when
    // this run actually resolved an identity layer — which a skipped run did not, and which is
    // why `NO_CHANGE` keeps `null` rather than taking `false`.
    identityResolved: identity.subjects.length > 0,
  })

  // Persist the key AFTER projecting — the digest cannot exist before the cohort does, which
  // is why this is a second checkpoint write rather than a field on `syncSource`'s. It reuses
  // the run's own checkpoint so nothing else on it moves.
  // The checkpoint and the identity layer commit TOGETHER. A run that advanced the digest but
  // failed to persist its subjects would report "no change" on the next run — the digest
  // matches — while the store holds no identity for the cohort that digest describes. One
  // transaction makes that state unreachable rather than merely unlikely.
  const checkpoint = { ...sync.checkpoint, snapshotDigest }
  const persistedIdentity = opts.store.transaction((tx) => {
    tx.advanceCheckpoint(checkpoint)
    return tx.persistIdentity(identity)
  })

  return {
    // `sync.checkpoint` is the value written mid-run, before the digest existed. Returning it
    // verbatim would report a checkpoint that no longer matches the store, so the digest-
    // carrying one replaces it: what the caller sees is what is on disk.
    sync: { ...sync, checkpoint },
    snapshot,
    snapshotText: serializeSnapshot(snapshot),
    mirroredRecords: opts.store.listSourceRecords(opts.adapter.sourceId).length,
    currentSubjects: records.length,
    change,
    snapshotDigest,
    identity: {
      subjects: identity.subjects.length,
      conflicts: identity.conflicts.length,
      artifacts: identity.artifacts.length,
      aliases: identity.aliases.length,
      persisted: persistedIdentity,
    },
  }
}

/** The source id this operation mirrors when the caller names no other. */
export const DEFAULT_SOURCE_ID = OFFICIAL_REGISTRY_SOURCE_ID
