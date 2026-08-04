import { createHash } from "node:crypto"

/** sha256 of a string, prefixed for clarity in reports. */
export function sha256(input: string): string {
  return "sha256:" + createHash("sha256").update(input, "utf8").digest("hex")
}

/**
 * sha256 of raw BYTES, in the same `"sha256:<hex>"` shape as `sha256`.
 *
 * A separate function rather than a widened parameter on `sha256`, because the two differ in
 * exactly the place that matters: `sha256` passes `"utf8"` to `update`, which is correct for
 * text and silently wrong for binary — feeding it a latin1-decoded tarball re-encodes every
 * byte above 0x7f as two, and the digest no longer describes the bytes on the wire. There was
 * no byte-level digest in this repo before R-4, so an artifact verifier had nothing correct to
 * call.
 *
 * It lives here because §10 says hashing is one package, and it is purely additive: no existing
 * call site changes, so no committed digest can move. The two agree on their overlap —
 * `sha256Bytes(Buffer.from(s, "utf8")) === sha256(s)` — which is the property the test asserts,
 * and which is what makes this an extension of the same convention rather than a second one.
 */
export function sha256Bytes(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex")
}

/**
 * Stable JSON stringify: object keys sorted recursively so equal objects always
 * hash identically regardless of key order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** Hash any JSON value via stable stringify. */
export function hashJson(value: unknown): string {
  return sha256(stableStringify(value))
}
