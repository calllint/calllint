/**
 * evidenceDigest — the primary key of `evidence_records`, and the reason R-5 is idempotent.
 *
 * `evidence_digest` is a PRIMARY KEY, so what goes into it decides whether a second run of the
 * same batch inserts a duplicate or hits the key and stops. It is therefore a function of the
 * INPUTS ALONE:
 *
 *   - `artifactDigest`     which verified bytes were read
 *   - `policyDigest`       under which policy the observation was graded
 *   - `engineVersion`      which detector set produced the findings
 *   - `observationDigest`  what was observed in those bytes
 *
 * DELIBERATELY ABSENT: `created_at`, `last_verified_at`, and every other wall clock. This is the
 * same discipline that makes R-4 name a CAS blob after its own digest — a name that is a function
 * of the content, so writing it twice is a no-op rather than a second row. Control #55 puts
 * `created_at` back and observes the second run inserting a duplicate.
 *
 * `policyDigest` is IN, and its absence is control #56. Without it a policy change would leave
 * every existing row's key unmoved, so a re-run would hit the primary key and silently reuse
 * evidence graded under the OLD policy — the stale-verdict failure, arriving as a cache hit.
 *
 * The four inputs are named fields rather than a concatenated string because `hashJson` sorts keys
 * (`stableStringify`), so the digest cannot change under field reordering, and a future fifth input
 * is additive rather than a positional break.
 */
import { hashJson } from "@calllint/fingerprint"
import type { TarEntry } from "../artifacts/tarInspect.js"

/** The four inputs `evidence_digest` is derived from. */
export interface EvidenceDigestInput {
  /** `sha256:<hex>` of the verified blob these observations came from. */
  artifactDigest: string
  /** `hashJson(policy)` — which policy graded the findings. */
  policyDigest: string
  /** The engine version whose detectors produced them. */
  engineVersion: string
  /** `observationDigest(entries)` — what was in the bytes. */
  observationDigest: string
}

/**
 * Digest of the tarball inventory.
 *
 * SORTED by path before hashing. `inspectTarball` yields entries in archive order, which is the
 * publisher's choice and not ours: two tarballs holding identical files in a different order are
 * the same observation, and a digest that disagreed would split one observation into two rows.
 *
 * Each entry contributes its path, size, kind and per-file digest — the whole `TarEntry`, so a file
 * whose CONTENT changed while its path and size did not still moves the digest. Dropping `digest`
 * here would make a same-shape, different-bytes archive indistinguishable.
 */
export function observationDigest(entries: readonly TarEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return hashJson(
    sorted.map((e) => ({ path: e.path, size: e.size, kind: e.kind, digest: e.digest })),
  )
}

/** `sha256:<hex>` over the four inputs, and nothing else. */
export function evidenceDigest(input: EvidenceDigestInput): string {
  return hashJson({
    artifactDigest: input.artifactDigest,
    policyDigest: input.policyDigest,
    engineVersion: input.engineVersion,
    observationDigest: input.observationDigest,
  })
}
