/**
 * Installation ID hashing (new18 §20).
 *
 * HMAC-SHA-256 over the raw `cli-anon-<uuid>` using `USAGE_HASH_KEY`, which is a
 * Worker secret and is never committed, never logged, and never rendered into
 * the report. The keyed construction is what matters: a bare SHA-256 of a UUID
 * would be trivially reversible by anyone who can enumerate UUIDs against a
 * leaked table, whereas without the key an HMAC digest is not.
 *
 * The raw ID is discarded by the caller immediately after hashing.
 */

const encoder = new TextEncoder()

/** Cache the imported CryptoKey — importKey per event is pure overhead. */
let cachedKeyMaterial: string | null = null
let cachedKey: CryptoKey | null = null

async function hmacKey(hashKey: string): Promise<CryptoKey> {
  if (cachedKey && cachedKeyMaterial === hashKey) return cachedKey
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(hashKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  cachedKeyMaterial = hashKey
  cachedKey = key
  return key
}

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("")

/**
 * Hash one installation ID. Throws if the secret is missing rather than falling
 * back to an unkeyed digest — a silent downgrade would store reversible hashes
 * while everything still looked like it worked.
 */
export async function hashInstallationId(rawId: string, hashKey: string): Promise<string> {
  if (!hashKey) {
    throw new Error("usage-worker: USAGE_HASH_KEY is not configured — refusing to hash")
  }
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(hashKey), encoder.encode(rawId))
  return toHex(signature)
}
