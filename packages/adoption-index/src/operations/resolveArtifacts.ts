/**
 * resolveArtifacts — Phase A (metadata) + Phase B (bytes) over every artifact that has work.
 *
 * WHY TWO PHASES AND NOT ONE. A metadata read and a blob download are different risk classes with
 * different failure modes, and they produce two different facts: "the registry claims sha512-…"
 * and "we hold bytes that hash to it". Collapsing them would make those one indistinguishable
 * field, which is exactly the Observed-vs-Inferred line Product Principle 8 requires be kept.
 * Phase A can succeed while Phase B fails, and the recorded status says which.
 *
 * WHY ONE TRANSACTION PER ARTIFACT. This is a network loop, and `store.transaction()` issues raw
 * `BEGIN`/`COMMIT` with no nesting. Holding one transaction across the loop would mean a single
 * slow or failing artifact rolls back the outcomes already established for the others, and would
 * hold a write lock open across every socket timeout in the run. So each artifact is resolved
 * outside any transaction and persisted in its own.
 *
 * WHAT IT NEVER DOES. It never executes the subject, never spawns a process, never runs an
 * install script, never writes outside the index root, and never stores unverified bytes. The
 * first four are enforced by the INV-04 gate over this package's modules and dependency set; the
 * last by `cas.verifyAndStore` hashing before it writes.
 */
import type { ArtifactStatus } from "../domain/subject.js"
import { ARTIFACT_RESOLUTION_INPUT_STATUSES } from "../domain/artifactTransitions.js"
import { parseIntegrityClaim } from "../artifacts/integrityClaim.js"
import { inspectTarball, DEFAULT_TAR_CAPS, type TarInspectCaps } from "../artifacts/tarInspect.js"
import { verifyAndStore } from "../artifacts/cas.js"
import { downloadArtifact } from "../artifacts/npmArtifactAdapter.js"
import type { ArtifactAdapterRegistry, ArtifactFetchContext } from "../artifacts/artifactAdapter.js"
import type { AdoptionIndexStore, StoredArtifactVersion } from "../storage/store.js"

/** Why one artifact was not resolved. Every value maps to exactly one status. */
export type ArtifactResolutionOutcome =
  /** Bytes obtained, digest agrees with the registry's claim, blob stored. */
  | "FETCHED"
  /** No adapter for this package type: NOT tried, so the status does not move. */
  | "NO_ADAPTER"
  /** Tried and could not obtain usable bytes or metadata. */
  | "UNAVAILABLE"
  /** Bytes obtained and REFUSED. Terminal for this (artifact, claim) pair. */
  | "REJECTED"

export interface ArtifactResolutionRecord {
  artifactVersionId: string
  packageType: string
  packageIdentifier: string
  outcome: ArtifactResolutionOutcome
  /** The status actually written (equal to the prior status when `NO_ADAPTER`). */
  status: ArtifactStatus
  /** A coded reason — the adapter failure, the tar refusal, or the mismatch. Null on success. */
  reason: string | null
  /** `sha256:<hex>` of the stored blob, on `FETCHED` only. */
  immutableDigest: string | null
  /** Entry count from the static inspection, on `FETCHED` only. Nothing was extracted. */
  entryCount: number | null
  /** True when the blob was already in the CAS, so no bytes were written. */
  deduplicated: boolean
}

export interface ArtifactResolutionSummary {
  /** Artifacts considered — those in `RESOLVED` or `UNAVAILABLE`. */
  considered: number
  fetched: number
  unavailable: number
  rejected: number
  /** Counted separately from `unavailable`: not tried is not the same as tried and failed. */
  skippedNoAdapter: number
  /** Artifacts already `FETCHED` whose bytes were re-verified from cache without a refetch. */
  cached: number
  /** Every artifact's record, in `artifact_version_id` order. */
  records: ArtifactResolutionRecord[]
}

export interface ResolveArtifactsInput {
  store: AdoptionIndexStore
  adapters: ArtifactAdapterRegistry
  /** Injected fetch. There is no ambient network access in this package. */
  fetchImpl: typeof fetch
  /** One clock read, captured at the edge and shared by every artifact in the run (INV-R6). */
  now: string
  /** Per-request timeout, ms. */
  requestTimeoutMs?: number
  /** Hard ceiling on a downloaded artifact's compressed size. */
  maxArtifactBytes?: number
  /** Hard ceiling on artifacts resolved per run (ADR 0038 §6: start small, fail safe). */
  maxArtifacts?: number
  /** Static-inspection caps. */
  tarCaps?: TarInspectCaps
}

/** 30s per request, 32 MiB per artifact, 64 artifacts per run — sized in the plan's terms. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
export const DEFAULT_MAX_ARTIFACTS = 64

export async function resolveArtifacts(input: ResolveArtifactsInput): Promise<ArtifactResolutionSummary> {
  const ctx: ArtifactFetchContext = {
    fetchImpl: input.fetchImpl,
    now: input.now,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxArtifactBytes: input.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
  }
  const tarCaps = input.tarCaps ?? DEFAULT_TAR_CAPS
  const maxArtifacts = input.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS

  const all = input.store.listArtifactVersions()
  const pending = all.filter((a) => ARTIFACT_RESOLUTION_INPUT_STATUSES.includes(a.artifactStatus))
  // `listArtifactVersions` is already ordered by `artifact_version_id`, so the cap takes a
  // deterministic prefix rather than whichever rows the driver happened to return first.
  const considered = pending.slice(0, maxArtifacts)

  const summary: ArtifactResolutionSummary = {
    considered: considered.length,
    fetched: 0,
    unavailable: 0,
    rejected: 0,
    skippedNoAdapter: 0,
    cached: 0,
    records: [],
  }

  for (const artifact of considered) {
    // A THROWN failure is caught here, per artifact, and not only the failures an adapter returns.
    // Without this the one-transaction-per-artifact design is defeated from outside: a single
    // adapter that throws — a hostile one, a buggy one, or a `fetch` implementation that rejects in
    // a way the adapter did not anticipate — propagates out of the loop and the cohort loses every
    // outcome it had not yet reached, which is the exact failure the per-artifact transaction
    // exists to prevent. `artifact-store.test.ts`'s "a throwing artifact does not roll back its
    // neighbours" is the measurement; it failed against the first version of this file.
    const record = await resolveOne(artifact, input, ctx, tarCaps).catch((err: unknown) =>
      // UNAVAILABLE, not REJECTED: the adapter was CALLED, so this is tried-and-failed, and no
      // bytes were ever in hand to refuse. Same reason a 404 is `UNAVAILABLE`.
      persist(input, artifact, {
        artifactVersionId: artifact.artifactVersionId,
        packageType: artifact.packageType,
        packageIdentifier: artifact.packageIdentifier,
        immutableDigest: null,
        entryCount: null,
        deduplicated: false,
        outcome: "UNAVAILABLE",
        status: "UNAVAILABLE",
        reason: `ADAPTER_THREW: ${errorMessage(err)}`,
      }),
    )
    summary.records.push(record)

    switch (record.outcome) {
      case "FETCHED":
        summary.fetched += 1
        if (record.deduplicated) summary.cached += 1
        break
      case "UNAVAILABLE":
        summary.unavailable += 1
        break
      case "REJECTED":
        summary.rejected += 1
        break
      case "NO_ADAPTER":
        summary.skippedNoAdapter += 1
        break
    }
  }

  return summary
}

async function resolveOne(
  artifact: StoredArtifactVersion,
  input: ResolveArtifactsInput,
  ctx: ArtifactFetchContext,
  tarCaps: TarInspectCaps,
): Promise<ArtifactResolutionRecord> {
  const base = {
    artifactVersionId: artifact.artifactVersionId,
    packageType: artifact.packageType,
    packageIdentifier: artifact.packageIdentifier,
    immutableDigest: null,
    entryCount: null,
    deduplicated: false,
  }

  const adapter = input.adapters.get(artifact.packageType)
  if (adapter === undefined) {
    // NOT TRIED. The status does not move and nothing is written — `UNAVAILABLE` here would
    // claim "tried and failed" about a type this build has no adapter for, which is the honest
    // handling of pypi/oci/nuget/mcpb that R-3 graded `RESOLVED`.
    return {
      ...base,
      outcome: "NO_ADAPTER",
      status: artifact.artifactStatus,
      reason: `NO_ADAPTER:${artifact.packageType}`,
    }
  }

  // ── Phase A: metadata ───────────────────────────────────────────────────────────────────
  const metadata = await adapter.resolveMetadata(artifact, ctx)
  if (!metadata.ok) {
    return persist(input, artifact, {
      ...base,
      outcome: "UNAVAILABLE",
      status: "UNAVAILABLE",
      reason: `${metadata.failure}: ${metadata.detail}`,
    })
  }

  const claimText = metadata.metadata.integrity
  if (claimText === undefined) {
    // The adapter is expected to have already returned ARTIFACT_DIGEST_UNAVAILABLE; this is the
    // belt-and-braces branch for an adapter that does not. Without a claim there is nothing to
    // verify against, and R-4 stores only verified bytes.
    return persist(input, artifact, {
      ...base,
      outcome: "UNAVAILABLE",
      status: "UNAVAILABLE",
      reason: "ARTIFACT_DIGEST_UNAVAILABLE: registry stated no integrity",
    })
  }

  const claim = parseIntegrityClaim(claimText)
  if (!claim.ok) {
    // A broken or unsupported claim leaves the bytes unverifiable, which is `UNAVAILABLE` — not
    // `REJECTED`, because refusing requires having refused actual bytes.
    return persist(input, artifact, {
      ...base,
      outcome: "UNAVAILABLE",
      status: "UNAVAILABLE",
      reason: `INTEGRITY_CLAIM_${claim.reason}`,
      registryIntegrity: claimText,
    })
  }

  // ── Phase B: bytes ──────────────────────────────────────────────────────────────────────
  const download = await downloadArtifact(metadata.metadata.tarballUrl, ctx)
  if (!download.ok) {
    // `ARTIFACT_TOO_LARGE` lands here rather than in `REJECTED`: the cap means we stopped
    // reading, so we never held the artifact to refuse it.
    return persist(input, artifact, {
      ...base,
      outcome: "UNAVAILABLE",
      status: "UNAVAILABLE",
      reason: `${download.failure}: ${download.detail}`,
      registryIntegrity: claim.claim.raw,
    })
  }

  // Static inspection BEFORE the CAS write, so bytes that are not a well-formed archive — or that
  // carry an escaping path — are refused rather than stored. Nothing is extracted or executed.
  const inspection = inspectTarball(download.bytes, tarCaps)
  if (!inspection.ok) {
    return persist(input, artifact, {
      ...base,
      outcome: "REJECTED",
      status: "REJECTED",
      reason: `${inspection.refusal}: ${inspection.detail}`,
      registryIntegrity: claim.claim.raw,
    })
  }

  const stored = verifyAndStore(input.store.paths.root, download.bytes, claim.claim)
  if (!stored.ok) {
    return persist(input, artifact, {
      ...base,
      outcome: "REJECTED",
      status: "REJECTED",
      reason: `${stored.reason}: ${stored.detail}`,
      registryIntegrity: claim.claim.raw,
    })
  }

  return persist(input, artifact, {
    ...base,
    outcome: "FETCHED",
    status: "FETCHED",
    reason: null,
    immutableDigest: stored.digest,
    entryCount: inspection.entries.length,
    deduplicated: stored.deduplicated,
    registryIntegrity: claim.claim.raw,
  })
}

/**
 * Persist one outcome in its own transaction and return the record.
 *
 * `registryIntegrity` is recorded on every branch that got as far as reading a claim — including
 * the failing ones — because the claim is an OBSERVATION about the registry and is worth having
 * even when the bytes did not arrive. `lastVerifiedAt` is set only on `FETCHED`: a failed attempt
 * must not refresh a freshness column, or a run of 404s would report stale bytes as fresh.
 */
function persist(
  input: ResolveArtifactsInput,
  artifact: StoredArtifactVersion,
  record: Omit<ArtifactResolutionRecord, "status"> & {
    status: ArtifactStatus
    registryIntegrity?: string
  },
): ArtifactResolutionRecord {
  const fetched = record.status === "FETCHED"
  input.store.transaction((tx) => {
    tx.updateArtifactResolution({
      artifactVersionId: artifact.artifactVersionId,
      artifactStatus: record.status,
      immutableDigest: record.immutableDigest,
      registryIntegrity: record.registryIntegrity ?? artifact.registryIntegrity,
      cacheKey: fetched ? record.immutableDigest : null,
      lastVerifiedAt: fetched ? input.now : null,
    })
  })

  return {
    artifactVersionId: record.artifactVersionId,
    packageType: record.packageType,
    packageIdentifier: record.packageIdentifier,
    outcome: record.outcome,
    status: record.status,
    reason: record.reason,
    immutableDigest: record.immutableDigest,
    entryCount: record.entryCount,
    deduplicated: record.deduplicated,
  }
}

/**
 * A thrown value's message, for the `reason` column.
 *
 * `catch` binds `unknown`, and a thrown non-`Error` is not hypothetical here: a rejected `fetch` in
 * some runtimes rejects with a `DOMException`, and a badly-written adapter can `throw "boom"`.
 * `String(err)` on those yields something legible rather than `[object Object]`.
 */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** One line for a run log. Kept here so the bin does not re-derive the phrasing. */
export function describeArtifactResolution(s: ArtifactResolutionSummary): string {
  return (
    `artifacts: ${s.considered} considered, ${s.fetched} fetched` +
    (s.cached > 0 ? ` (${s.cached} already in CAS)` : "") +
    `, ${s.unavailable} unavailable, ${s.rejected} rejected, ${s.skippedNoAdapter} skipped (no adapter)`
  )
}
