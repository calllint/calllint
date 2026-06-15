import { createHash } from "node:crypto"

/** sha256 of a string, prefixed for clarity in reports. */
export function sha256(input: string): string {
  return "sha256:" + createHash("sha256").update(input, "utf8").digest("hex")
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
