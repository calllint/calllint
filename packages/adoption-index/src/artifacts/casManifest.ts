/**
 * casManifest — what one run REFERENCED in the blob store, written where a gate can read it.
 *
 * ## Why this file exists
 *
 * `cas/manifests` has been declared in `INDEX_SUBDIRS` since the first commit, and
 * `scripts/gate-s1.ts` has been counting the files in it for as long as that gate has existed.
 * Nothing ever wrote one. So the census printed `cas/manifests=0` on every run, and the gate's
 * `cas-dedup-rate` measure REFUSED with a blocker it named precisely: a dedup rate is
 * `distinct blobs ÷ manifest references`, and with zero manifests there was nothing the blobs
 * were deduplicated *against*. That refusal was correct and it was permanent — the denominator
 * had never been produced by any run, past or future.
 *
 * This is the fourth instance of one fault class in this store (`storage/paths.ts:reportsRoot`
 * names it, `storage/runReport.ts` fixed the third): a reader whose subject does not exist reads
 * a benign value forever and never says so. The pattern of the fix is the same too — the fact was
 * already known at the moment of the write and was persisted nowhere a gate could reach.
 *
 * ## What a REFERENCE is, and why the distinction is the whole design
 *
 * `verifyAndStore` returns `deduplicated: boolean` per call. Summing those booleans into a
 * running total would have closed the measure with one integer and no new directory. That was
 * considered and rejected (ADR 0093 §4): a count answers *how many hits* and cannot answer
 * *against what*. Nine requests for one blob and nine distinct blobs sharing one prior both
 * report "8 deduplicated", and they mean opposite things about the store.
 *
 * So a manifest records WHICH digests a run referenced. The two numbers a rate needs are then
 * both sets, both re-derivable from disk:
 *
 *   references — every (artifact, digest) pair the run resolved. The DENOMINATOR.
 *   distinct   — the digests among them, counted once. The blobs those references resolved to.
 *
 * `references − distinct` is reuse WITHIN the run; `deduplicated` counts the references whose
 * bytes were already on disk when the run reached them, which includes reuse ACROSS runs. Both
 * are recorded, because they answer different questions and a single "dedup rate" that silently
 * meant one of them is how a number starts being read as the other.
 *
 * ## What it is NOT
 *
 * It is not a source of truth about the CAS. `cas/blobs` is; this records what one run asked of
 * it. If a manifest names a digest no blob exists at, the manifest is the bug — and a gate can
 * see that, which it could not before, because both sides are now on disk.
 *
 * It is also not a rate. Every field is a raw count or a list, denominators included, for the
 * reason `runReport.ts` gives at length: the empty-denominator defect this repo keeps finding can
 * only be caught downstream if the counts arrive unaggregated. Here that is not hypothetical —
 * `45 blobs / 0 manifests` rendered as `100%` is the exact defect that kept this measure refused,
 * and it is the harder variant, a non-zero numerator over a zero denominator.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { casManifestPath, isInsideRoot } from "../storage/paths.js"

/**
 * The schema id, versioned so a reader can refuse a shape it does not know.
 *
 * Matched EXACTLY by readers, never prefix-matched — `scripts/gate-s1.ts` enumerates the versions
 * it can read for the reason `runReport.ts:54` records: a prefix match accepts every future
 * version sight unseen, which is the defect an exact check exists to prevent.
 */
export const CAS_MANIFEST_SCHEMA = "calllint.cas-manifest.v1"

/** One reference: an artifact the run resolved, and the blob its bytes landed at. */
export interface CasManifestReference {
  /** The `artifact_versions.artifact_version_id` this reference is for. The join key back to the row. */
  readonly artifactVersionId: string
  /** `sha256:<hex>` of the referenced blob — `verifyAndStore`'s own digest, never recomputed. */
  readonly digest: string
  /**
   * True when the blob was already present, so this reference wrote no bytes.
   *
   * `verifyAndStore`'s value, copied. Note what it is NOT: it is not "another reference in this
   * manifest has the same digest". A first-in-run reference to a blob a PREVIOUS run stored is
   * `true` here and unique in `distinctDigests` — which is why both numbers are recorded.
   */
  readonly deduplicated: boolean
}

export interface CasManifest {
  readonly schema: typeof CAS_MANIFEST_SCHEMA
  /** The `compiler_runs.run_id` this belongs to — the same id `reports/run-<id>.json` carries. */
  readonly runId: string
  readonly completedAt: string
  /**
   * Every reference, in `artifactVersionId` order.
   *
   * Ordered so two runs over an unchanged store produce byte-identical manifests: an unordered
   * list would make every manifest differ from the last for reasons that are not facts about the
   * store, and a diff nobody can read is a diff nobody checks.
   */
  readonly references: readonly CasManifestReference[]
  /**
   * The counts a rate needs, written out beside the list rather than left to a reader.
   *
   * Derived by `summarizeReferences` from `references` alone, so the two cannot disagree — the
   * same rule `runReport.ts` follows for its six counters. A reader that distrusts them can
   * recount the list; that is the point of shipping both.
   */
  readonly totals: {
    /** `references.length` — the DENOMINATOR of a dedup rate. */
    readonly references: number
    /** Distinct digests among the references. */
    readonly distinctDigests: number
    /** References whose bytes were already on disk when the run reached them. */
    readonly deduplicated: number
  }
}

/**
 * Derive the totals from the references, so nothing hand-counts them.
 *
 * Exported because the gate needs the same derivation to check a manifest's own totals against its
 * own list — a manifest that disagrees with itself is the one thing a reader here must be able to
 * catch, and it cannot if the only implementation lives on the write side.
 */
export function summarizeReferences(references: readonly CasManifestReference[]): CasManifest["totals"] {
  const digests = new Set<string>()
  let deduplicated = 0
  for (const r of references) {
    digests.add(r.digest)
    if (r.deduplicated) deduplicated += 1
  }
  return { references: references.length, distinctDigests: digests.size, deduplicated }
}

/**
 * Build a manifest from the references a run collected.
 *
 * Sorts and derives here rather than trusting a caller to, because the caller is a loop over a
 * network operation and the ordering guarantee above is what makes two identical runs produce
 * identical bytes.
 */
export function buildCasManifest(input: {
  runId: string
  completedAt: string
  references: readonly CasManifestReference[]
}): CasManifest {
  const references = [...input.references].sort((a, b) =>
    a.artifactVersionId < b.artifactVersionId ? -1 : a.artifactVersionId > b.artifactVersionId ? 1 : 0,
  )
  return {
    schema: CAS_MANIFEST_SCHEMA,
    runId: input.runId,
    completedAt: input.completedAt,
    references,
    totals: summarizeReferences(references),
  }
}

/**
 * Write one run's manifest under `<root>/cas/manifests/run-<runId>.json`.
 *
 * Staging + rename, for the same reason `cas.ts` and `runReport.ts` do it: a gate that reads the
 * directory mid-write must never see a half-written JSON file, and must never have to tell a
 * truncated manifest from a real one. `rename` within one filesystem is atomic.
 *
 * Returns the path written, so a caller can log it and a test can assert on it without re-deriving
 * the layout (INV-R7: this module joins none of its own paths).
 */
export function writeCasManifest(root: string, manifest: CasManifest): string {
  const target = casManifestPath(root, manifest.runId)
  const staging = `${target}.part`

  // Belt-and-braces on INV-R7, matching `cas.ts` and `runReport.ts`: `casManifestPath` already
  // validates the run id into a filename-safe shape so this cannot fire today, but a silent write
  // outside the index root is exactly what the invariant exists to prevent, and one `resolve`
  // costs nothing.
  if (!isInsideRoot(root, target) || !isInsideRoot(root, staging)) {
    throw new Error(`writeCasManifest: refusing to write outside the index root: ${target}`)
  }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(staging, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  try {
    renameSync(staging, target)
  } catch (err) {
    rmSync(staging, { force: true })
    throw err
  }
  return target
}
