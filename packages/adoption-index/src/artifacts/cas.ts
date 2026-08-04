/**
 * cas — the content-addressed blob store. Verify FIRST, then write.
 *
 * The ordering is the design. Bytes are hashed and compared against the registry's claim before
 * any filesystem call happens, so a blob that fails verification is never written at all. That is
 * strictly stronger than write-then-delete: there is no window in which unverified bytes exist
 * under the index root, so a crash mid-run cannot leave them behind, and no cleanup path has to
 * be trusted. Control #26 inverts the order and observes the CAS holding unverified bytes.
 *
 * Writes go to `work/<digest>.part` and are then renamed into `cas/blobs/<hex[0:2]>/<hex>`.
 * `rename` within one filesystem is atomic, so a reader never observes a partial blob. Both paths
 * come from `storage/paths.ts` — this module joins none of its own (INV-R7).
 */
import { mkdirSync, renameSync, statSync, writeFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { casBlobPath, casStagingPath, isInsideRoot } from "../storage/paths.js"
import { verifyBytesAgainstClaim, type IntegrityClaim, type IntegrityVerification } from "./integrityClaim.js"

export interface CasWriteRefused {
  readonly ok: false
  /** `DIGEST_MISMATCH` is a refusal of bytes; `OUTSIDE_ROOT` is a bug caught before writing. */
  readonly reason: "DIGEST_MISMATCH" | "OUTSIDE_ROOT"
  readonly detail: string
  /** Present on mismatch: what we measured versus what was claimed. */
  readonly verification?: IntegrityVerification
}

export interface CasWriteAccepted {
  readonly ok: true
  /** `sha256:<hex>` — this is also the `cache_key`. */
  readonly digest: string
  /** Absolute path of the blob under `cas/blobs/`. */
  readonly path: string
  /** True when the blob was already present, so nothing was written. */
  readonly deduplicated: boolean
  readonly verification: IntegrityVerification
}

export type CasWriteResult = CasWriteAccepted | CasWriteRefused

/**
 * Verify `bytes` against `claim` and, only on agreement, store them.
 *
 * Synchronous by deliberate choice. The one place concurrency would help is overlapping the
 * write with the next download, and the store's transactions are synchronous anyway
 * (`better-sqlite3` has no async API), so an async writer here would buy nothing while adding an
 * interleaving in which two artifacts' writes and commits could reorder.
 */
export function verifyAndStore(root: string, bytes: Uint8Array, claim: IntegrityClaim): CasWriteResult {
  const verification = verifyBytesAgainstClaim(bytes, claim)
  if (!verification.verified) {
    return {
      ok: false,
      reason: "DIGEST_MISMATCH",
      detail: `claimed ${claim.algorithm}:${claim.expectedHex}, measured ${claim.algorithm}:${verification.observedHex}`,
      verification,
    }
  }

  const digest = verification.immutableDigest
  const target = casBlobPath(root, digest)
  const staging = casStagingPath(root, digest)

  // Belt-and-braces on INV-R7. `casBlobPath` already validates the digest into a fixed shape, so
  // this cannot fire today; it is here because it is the assertion control #30 measures, and
  // because the cost of one `resolve` comparison is nothing against a silent write outside root.
  if (!isInsideRoot(root, target) || !isInsideRoot(root, staging)) {
    return { ok: false, reason: "OUTSIDE_ROOT", detail: target }
  }

  if (existsAsFile(target)) {
    return { ok: true, digest, path: target, deduplicated: true, verification }
  }

  mkdirSync(dirname(target), { recursive: true })
  mkdirSync(dirname(staging), { recursive: true })
  writeFileSync(staging, bytes)
  try {
    renameSync(staging, target)
  } catch (err) {
    // On Windows, `rename` onto an existing file fails rather than replacing it. A concurrent
    // writer of the SAME digest is by definition writing the same bytes, so that is success, not
    // a conflict — but the staging file must not be left behind either way.
    if (existsAsFile(target)) {
      rmSync(staging, { force: true })
      return { ok: true, digest, path: target, deduplicated: true, verification }
    }
    rmSync(staging, { force: true })
    throw err
  }

  return { ok: true, digest, path: target, deduplicated: false, verification }
}

/** True when `path` exists and is a regular file. */
export function existsAsFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
