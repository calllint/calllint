/**
 * Ed25519 signature types and interfaces
 * @packageDocumentation
 */

/**
 * Ed25519 keypair for signing receipts
 */
export interface Ed25519Keypair {
  /** 32-byte private key (ed25519 seed) */
  privateKey: Uint8Array
  /** 32-byte public key */
  publicKey: Uint8Array
  /** Key identifier (e.g., "calllint-prod-2026-h2") */
  keyId: string
}

/**
 * Signature metadata attached to a signed receipt
 */
export interface SignatureMetadata {
  /** Signature algorithm (always "ed25519" in v1.0) */
  algorithm: 'ed25519'
  /** Key identifier for public key lookup */
  key_id: string
  /** Base64url-encoded signature (64 bytes, no padding = 86 chars) */
  value: string
  /** ISO-8601 UTC timestamp when signature was created */
  signed_at: string
  /** Optional URL to fetch public key JSON */
  public_key_url?: string
}

/**
 * Public key entry in .well-known/receipt-keys.json
 */
export interface PublicKeyEntry {
  key_id: string
  algorithm: 'ed25519'
  /** Base64url-encoded public key (32 bytes, no padding = 43 chars) */
  public_key: string
  valid_from: string
  valid_until: string | null
  status: 'active' | 'rotated' | 'revoked'
}

/**
 * Public key registry format
 */
export interface PublicKeyRegistry {
  keys: PublicKeyEntry[]
}

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean
  key_id?: string
  error?: string
}
