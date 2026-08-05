/**
 * casRead — read a blob back out of the CAS, and RE-MEASURE it.
 *
 * R-5 is the CAS's first reader. `cas.ts` writes verify-then-store and exports no read path at
 * all, so "trust the path or re-hash the bytes" is not an existing behaviour being changed here —
 * it is a behaviour being established, and this file establishes the stricter one.
 *
 * WHY RE-HASH WHAT WAS ALREADY VERIFIED ON THE WAY IN. A blob's filename is a CLAIM about its
 * content, and R-4's own rule is that a claim and a measurement are two different things — the
 * reason `registry_integrity` and `immutable_digest` are kept as two columns that are never
 * compared for equality. The write-side verification proves what was true when the blob was
 * written; it says nothing about the bytes on disk now. `.var/` is a plain gitignored directory:
 * an operator can edit a file under it, a truncated write can survive a full disk, a restored
 * backup can put yesterday's bytes under today's name. Trusting the name would make every one of
 * those compile silently into evidence, under a digest asserting the content was verified.
 *
 * Control #60 renames a blob onto another digest's path and observes the refusal. Without the
 * re-hash that control passes while the store records evidence attributed to bytes it never saw.
 *
 * Never throws on bad content — a refusal is data, in the same shape `cas.ts` uses, so one bad
 * blob is a per-artifact outcome rather than an exception that ends the batch.
 */
import { readFileSync } from "node:fs"
import { sha256Bytes } from "@calllint/fingerprint"
import { casBlobPath, isInsideRoot } from "../storage/paths.js"
import { existsAsFile } from "./cas.js"

export interface CasReadAccepted {
  readonly ok: true
  /** The bytes, re-measured and in agreement with `digest`. */
  readonly bytes: Uint8Array
  /** `sha256:<hex>` — the MEASURED digest, which equals the requested one. */
  readonly digest: string
}

export interface CasReadRefused {
  readonly ok: false
  /**
   * `MISSING` — no blob at that path (a cold checkout, or a pruned cache).
   * `DIGEST_MISMATCH` — bytes are present but are not the bytes the name claims.
   * `OUTSIDE_ROOT` — a bug caught before reading, mirroring `cas.ts`'s write-side check.
   * `UNREADABLE` — present but the read itself failed (permissions, I/O).
   */
  readonly reason: "MISSING" | "DIGEST_MISMATCH" | "OUTSIDE_ROOT" | "UNREADABLE"
  readonly detail: string
}

export type CasReadResult = CasReadAccepted | CasReadRefused

/**
 * Read the blob named by `digest`, re-hash it, and return it only on agreement.
 *
 * Synchronous, matching `verifyAndStore` — the store's transactions are synchronous
 * (`better-sqlite3` has no async API), so an async reader would buy nothing and add an
 * interleaving between a read and the transaction that records what it found.
 */
export function readVerifiedBlob(root: string, digest: string): CasReadResult {
  let target: string
  try {
    target = casBlobPath(root, digest)
  } catch (err) {
    // `casBlobPath` throws on a malformed digest. Here that is INPUT — the digest comes out of a
    // database column, not from a `sha256Bytes` call one line up — so it is refused as data rather
    // than allowed to end the batch.
    return { ok: false, reason: "OUTSIDE_ROOT", detail: err instanceof Error ? err.message : String(err) }
  }

  // Belt-and-braces on INV-R7, same as the write side: `casBlobPath` already validated the digest
  // into a fixed shape, so this cannot fire today.
  if (!isInsideRoot(root, target)) {
    return { ok: false, reason: "OUTSIDE_ROOT", detail: target }
  }

  if (!existsAsFile(target)) {
    return { ok: false, reason: "MISSING", detail: target }
  }

  let bytes: Uint8Array
  try {
    bytes = readFileSync(target)
  } catch (err) {
    return { ok: false, reason: "UNREADABLE", detail: err instanceof Error ? err.message : String(err) }
  }

  const measured = sha256Bytes(bytes)
  if (measured !== digest) {
    return {
      ok: false,
      reason: "DIGEST_MISMATCH",
      detail: `blob at ${target} measured ${measured}, name claims ${digest}`,
    }
  }

  return { ok: true, bytes, digest: measured }
}
