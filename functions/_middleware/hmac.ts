/**
 * HMAC utilities for server-side installation ID hashing.
 * Privacy guarantee: raw installation IDs are NEVER persisted.
 */

/**
 * Hash an installation ID using HMAC-SHA256.
 * @param installationId - The raw installation ID from the client
 * @param secret - Server-side secret key (USAGE_HASH_KEY env var)
 * @returns Hex-encoded HMAC digest
 */
export async function hashInstallationId(
  installationId: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(installationId)

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )

  const signature = await crypto.subtle.sign("HMAC", key, messageData)
  const hashArray = Array.from(new Uint8Array(signature))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("")

  return hashHex
}

/**
 * Validate that an installation ID is well-formed.
 * Does NOT validate authenticity (HMAC does that).
 */
export function isValidInstallationIdFormat(id: string): boolean {
  // Matches the telemetry-contract format: cli-anon-{uuid}
  return /^cli-anon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
}
