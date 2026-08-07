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
import type { ArtifactResolutionSummary } from "./resolveArtifacts.js"
import type { EvidenceCompilationSummary } from "./compileEvidence.js"
import { planWithdrawal } from "./planWithdrawal.js"
import { applyWithdrawal, type ApplyWithdrawalResult } from "./applyWithdrawal.js"

/**
 * How many raw records one mirror run reads, when the caller names no cap.
 *
 * Still a multiple of the snapshot cap, not equal to it, for the original measured reason: the
 * mirror keeps the non-live records the snapshot drops, so it must read strictly more than the
 * snapshot emits to fill it.
 *
 * RAISED 1000 → 40_000 → 100_000, and BOTH earlier numbers were wrong for the same reason, so
 * the reason is recorded rather than just the number. 1000 reasoned from the SNAPSHOT's 19-of-25
 * occupancy — a property of the projection, while this bounds the RAW read. 40_000 reasoned from
 * "the source holds well over 21_000", which was a probe stopped at its own 210-page ceiling; a
 * later probe capped at 500 pages reported "50_000+" the same way. Only a walk that terminated
 * with `reason=exhausted` measured the source: `pages=653 total=65235 elapsed=7090s`
 * (2026-08-04). At 40_000 the fail-closed guard would still have fired on every scheduled run —
 * the fix I first shipped for this defect did not clear it.
 *
 * 100_000 is `DEFAULT_MAX_PAGES` x `PAGE_SIZE`, and the two ceilings are deliberately EQUAL so
 * that neither is dead code: a record cap below pages x page-size can never let the page ceiling
 * fire, and above it can never fire itself. Equal, whichever exit reports first is the one that
 * actually bound, and the operator's remedy names the knob that will change the outcome.
 *
 * Why not more headroom: `DEFAULT_MAX_PAGES` argues the upper bound in wall-clock — a ceiling
 * the job cannot reach before its timeout is not the limit that binds, and a timeout truncates
 * SILENTLY, bypassing this guard entirely. That argument caps this number too, since the two
 * move together.
 */
export const DEFAULT_MIRROR_MAX_ENTRIES = 100_000

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
  /**
   * Artifact resolution (R-4), as an injected PORT rather than an import.
   *
   * A port for two reasons. First, artifact resolution is a NETWORK loop with a per-artifact time
   * budget, and it must run outside the identity transaction — `store.transaction()` issues raw
   * `BEGIN`/`COMMIT` with no nesting, so a loop inside it would hold a write lock across every
   * socket timeout in the run and roll back the whole cohort on one failure. Second, it keeps the
   * data-flow invariant structurally visible: `snapshot` stays a function of `records` ALONE, so
   * nothing artifact resolution concludes can reach the bytes the reproducibility gate compares.
   *
   * OMITTED ⇒ the run behaves exactly as it did at R-3: `rebuild.artifact` stays `null` and the
   * returned verdict is byte-identical. That is what lets every existing assertion stay green
   * unchanged and confines the new behaviour to callers that opt in.
   */
  artifactPort?: (ctx: { now: string }) => Promise<ArtifactResolutionSummary>
  /**
   * Evidence compilation (R-5), as a second injected PORT — never a widening of the first.
   *
   * A SECOND port rather than an extra field on `artifactPort`'s context, because the two answer
   * different questions about different inputs. R-4 asks what a registry SERVES (a network read,
   * `Inferred` until its bytes are verified); R-5 asks what VERIFIED BYTES CONTAIN (a local read,
   * `Observed`). Fusing them into one capability would make the Observed/Inferred boundary
   * unrepresentable in the type — the same reason `ResolverContext` was not given a blob capability
   * (control #63).
   *
   * `Promise` even though `compileEvidence` is synchronous: the port is the SEAM, and a caller that
   * needs to await something around compilation (a job-state write, in the batch that owns
   * `compiler_runs`) must not force this signature to change. `await` on a non-promise is a no-op.
   *
   * OMITTED ⇒ the run behaves exactly as it did at R-4: `rebuild.evidence` stays `null`, `evidence`
   * is `null`, and the returned verdict is byte-identical. Same asymmetry as `artifactPort`, for the
   * same reason — a run that was never asked to compile evidence has not measured the layer, and
   * `false` would assert it did (control #61).
   */
  evidencePort?: (ctx: { now: string }) => Promise<EvidenceCompilationSummary>
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
  /**
   * What artifact resolution did this run (R-4), or `null` when no port was passed.
   *
   * `null` rather than a zeroed summary: a run that was never asked to resolve artifacts is not
   * the same as a run that resolved none, and a summary of all zeros would read as the latter.
   * The same distinction `rebuild.artifact` keeps.
   */
  artifacts: ArtifactResolutionSummary | null
  /**
   * What evidence compilation did this run (R-5), or `null` when no port was passed.
   *
   * `null` rather than a zeroed summary, for the third time in this result and the same reason each
   * time: a run that was never asked to compile evidence is not a run that compiled none.
   */
  evidence: EvidenceCompilationSummary | null
  /**
   * What the lifecycle axis did this run (R-11) — the APPLICATION of the withdrawal this operation has
   * REPORTED since R-2 without acting on it.
   *
   * NOT nullable, unlike the three summaries above, and the difference is not an inconsistency: those
   * three are optional PORTS, so "never asked" is a state they can be in. Withdrawal has no port — it
   * is pure computation plus a local write over rows this run already committed, so it always runs and
   * an empty result means "nothing to move", which is exactly what the zeroes say.
   */
  lifecycle: ApplyWithdrawalResult & {
    /** Absent native ids no stored subject claimed. Surfaced, never silently dropped. */
    unmatched: readonly string[]
    /** Absent subjects already `TOMBSTONED` — terminal, so deliberately untouched. */
    skippedTerminal: readonly string[]
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

  // THE LIFECYCLE AXIS IS APPLIED HERE (R-11) — after the identity commit, in its own transaction.
  //
  // AFTER, because `planWithdrawal` joins the absent native ids against STORED subjects, and this run's
  // subjects do not exist until the commit above. IN ITS OWN TRANSACTION for the same mechanical reason
  // as `resolveArtifacts`: `store.transaction()` does not nest, and `applyWithdrawal` opens one.
  //
  // Splitting the two commits is safe because the plan is PURE AND IDEMPOTENT. A crash between them
  // leaves the identity committed and the lifecycle unwritten; the next run reads the same mirror,
  // recomputes the same absences, and applies the same plan. Nothing is lost and nothing double-counts,
  // because `setSubjectLifecycle` keeps the FIRST `withdrawn_at` on a replay.
  //
  // THE COHORT IS ALREADY KNOWN COMPLETE at this point — `assertMirrorComplete` failed the run closed
  // above, BEFORE `absentFromSource` was computed. That ordering is what makes automatic application
  // safe: a truncated read cannot reach here and therefore cannot manufacture an absence. The second
  // line of defence is that this path writes `WITHDRAWN` only, never `TOMBSTONED`, so even a defect
  // upstream of it produces a state the next complete run reverses by itself.
  const withdrawalPlan = planWithdrawal({
    subjects: opts.store.listSubjects(),
    absentFromSource,
    observedNativeIds: sync.observedNativeIds,
  })
  const applied = applyWithdrawal({ store: opts.store, plan: withdrawalPlan, observedAt: opts.now })
  const lifecycle = {
    ...applied,
    unmatched: withdrawalPlan.unmatched,
    skippedTerminal: withdrawalPlan.skippedTerminal,
  }

  // ARTIFACT RESOLUTION RUNS HERE (R-4) — after the identity commit, outside any transaction.
  //
  // After, because it resolves the artifact ROWS that commit just wrote: there is nothing to
  // fetch until `persistIdentity` has created them. Outside, because it is a network loop and
  // `store.transaction()` does not nest — `resolveArtifacts` opens one transaction per artifact
  // so a single slow or failing download cannot roll back the cohort.
  const artifactResolved = await opts.artifactPort?.({ now: opts.now })

  // EVIDENCE COMPILATION RUNS HERE (R-5) — after artifact resolution, and the order is a data
  // dependency rather than a preference. R-5 compiles from artifacts in `FETCHED`, and `FETCHED` is
  // exactly what this run's `artifactPort` may just have produced. Running it first would compile
  // evidence for the artifacts a PREVIOUS run fetched and silently skip this run's, so a cold store
  // would need two runs to reach a state one run already justifies.
  //
  // Still outside any transaction, and for a sharper reason than R-4's: `compileEvidence` opens one
  // transaction PER ARTIFACT itself, and `store.transaction()` does not nest. Calling it from inside
  // a transaction would issue a nested `BEGIN`.
  const evidenceCompiled = await opts.evidencePort?.({ now: opts.now })

  // THE VERDICT IS BUILT LAST, and this is the one deliberate reorder in the batch (R-4).
  //
  // Safe because the verdict's inputs are all fixed before the persist: `priorSnapshotDigest` was
  // read before the sync, `nextSnapshotDigest` comes from the projection, `absentFromSource` from
  // `subjectsBefore` + `sync.observedNativeIds`, and the two `*Resolved` booleans from work
  // already done. The persist mutates none of them, which is why the no-port verdict is
  // byte-identical to R-3's — the control that keeps this reorder honest.
  //
  // Building it last is also the more truthful arrangement: the verdict describes what the run
  // DID, and the artifact tier cannot be described before the artifacts are resolved.
  const change = detectSourceChange({
    priorSnapshotDigest,
    nextSnapshotDigest: snapshotDigest,
    absentFromSource,
    // R-3 flips this grid cell from `null` to a MEASURED boolean. It is true exactly when
    // this run actually resolved an identity layer — which a skipped run did not, and which is
    // why `NO_CHANGE` keeps `null` rather than taking `false`.
    identityResolved: identity.subjects.length > 0,
    // R-4 flips the artifact cell the same way, and keeps the same asymmetry: no port ⇒ the key
    // is omitted entirely ⇒ the tier stays `null`. Passing `false` here on a portless run would
    // assert "no artifact rebuild needed" about a layer nothing measured (control #27). With a
    // port, `true` means the run actually resolved an artifact layer — `considered > 0` rather
    // than `fetched > 0`, because a cohort whose every artifact came back UNAVAILABLE was still
    // measured, and its downstream tiers still need rebuilding to reflect that.
    ...(artifactResolved === undefined ? {} : { artifactResolved: artifactResolved.considered > 0 }),
    // R-5 flips the evidence cell, same asymmetry again: no port ⇒ the key is omitted ⇒ the tier
    // stays `null`. `considered > 0` and not `compiled > 0`, for the reason R-4 established one
    // tier up — a cohort whose every blob came back unreadable was still MEASURED, and the
    // downstream tiers still need rebuilding to reflect what it found. Using `compiled` would also
    // make the tier flip to `false` on the second identical run, when the rows are all `UNCHANGED`
    // and idempotence is working correctly.
    ...(evidenceCompiled === undefined ? {} : { evidenceCompiled: evidenceCompiled.considered > 0 }),
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
    // `null` when no port was passed, so "this run resolved no artifacts" and "this run was not
    // asked to" stay distinguishable in the result exactly as they are in the rebuild tier.
    artifacts: artifactResolved ?? null,
    // `null` when no port was passed, so "compiled no evidence" and "was never asked to" stay
    // distinguishable — exactly as `artifacts` does one line up and as `rebuild.evidence` does.
    //
    // The phrasing deliberately keeps no quoted string adjacent to the word f-r-o-m. INV-04's
    // specifier extractor is a regex whose `[^;]*?` crosses newlines, so prose in that shape is
    // read as a module name and lands in the external-specifier set. The gate names its two known
    // prose false positives rather than filtering them, and that is the right default — but a third
    // entry spanning two lines with `//` inside it would make the allowlist stop reading like a
    // list of module names, which is the property that lets a real violation stand out in it.
    // Measured, not theorized: the first draft of THIS comment tripped the trap it describes.
    evidence: evidenceCompiled ?? null,
    lifecycle,
  }
}

/** The source id this operation mirrors when the caller names no other. */
export const DEFAULT_SOURCE_ID = OFFICIAL_REGISTRY_SOURCE_ID
