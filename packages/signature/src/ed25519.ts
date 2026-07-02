/**
 * Ed25519 signature generation and verification
 * @packageDocumentation
 */

import { createHash } from 'node:crypto'
import * as ed25519 from '@noble/ed25519'
import { sha256, stableStringify } from '@calllint/fingerprint'
import { base64urlEncode, base64urlDecode } from './base64url.js'
import type { Ed25519Keypair, SignatureMetadata, VerificationResult } from './types.js'

// ed25519 signing/verification is a pure CPU operation over a fixed 32-byte
// hash — there is no I/O to await. @noble/ed25519 exposes a fully synchronous
// API once a synchronous sha512 is supplied; we back it with Node's crypto.
// Keeping these calls synchronous is deliberate: the CLI command layer is
// synchronous (run() returns a CommandResult), so an async crypto API there
// forced a busy-wait that deadlocked the event loop. See ADR 0032.
ed25519.etc.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
  const hash = createHash('sha512')
  hash.update(ed25519.etc.concatBytes(...messages))
  return new Uint8Array(hash.digest())
}

/**
 * Generate a new ed25519 keypair for testing/development
 *
 * @param keyId - Key identifier (e.g., "calllint-dev-2026-h2")
 * @returns Ed25519 keypair
 */
export function generateKeypair(keyId: string): Ed25519Keypair {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(privateKey)

  return {
    privateKey,
    publicKey,
    keyId,
  }
}

/**
 * Sign a receipt (without signature field)
 *
 * @param unsignedReceipt - Receipt object WITHOUT signature field
 * @param keypair - Ed25519 keypair
 * @returns Signature metadata to attach to receipt
 */
export function signReceipt(
  unsignedReceipt: Record<string, unknown>,
  keypair: Ed25519Keypair
): SignatureMetadata {
  // 1. Canonical JSON serialization (same as receipt hashing in ADR 0028)
  const canonical = stableStringify(unsignedReceipt)

  // 2. Hash the canonical form
  const hash = sha256(canonical) // → "sha256:abc123..."

  // 3. Extract hex digest (strip "sha256:" prefix)
  const hashHex = hash.slice(7) // "sha256:" is 7 chars
  const hashBytes = Buffer.from(hashHex, 'hex') // 32 bytes

  // 4. Sign the hash with ed25519
  const signatureBytes = ed25519.sign(hashBytes, keypair.privateKey)

  // 5. Encode signature as base64url
  const signatureBase64url = base64urlEncode(signatureBytes)

  return {
    algorithm: 'ed25519',
    key_id: keypair.keyId,
    value: signatureBase64url,
    signed_at: new Date().toISOString(),
  }
}

/**
 * Verify a signed receipt
 *
 * @param signedReceipt - Receipt object WITH signature field
 * @param publicKey - Ed25519 public key (32 bytes) or base64url string
 * @returns Verification result
 */
export function verifyReceipt(
  signedReceipt: Record<string, unknown>,
  publicKey: Uint8Array | string
): VerificationResult {
  try {
    // Extract signature metadata
    const sig = signedReceipt.signature as SignatureMetadata | undefined
    if (!sig) {
      return { valid: false, error: 'No signature field in receipt' }
    }

    if (sig.algorithm !== 'ed25519') {
      return { valid: false, error: `Unsupported algorithm: ${sig.algorithm}` }
    }

    // Decode public key if it's a string
    const publicKeyBytes = typeof publicKey === 'string'
      ? base64urlDecode(publicKey)
      : publicKey

    if (publicKeyBytes.length !== 32) {
      return { valid: false, error: 'Invalid public key length (expected 32 bytes)' }
    }

    // Decode signature
    const signatureBytes = base64urlDecode(sig.value)
    if (signatureBytes.length !== 64) {
      return { valid: false, error: 'Invalid signature length (expected 64 bytes)' }
    }

    // Remove signature field to get the unsigned receipt
    const { signature, ...unsignedReceipt } = signedReceipt

    // Recompute hash (same as signing)
    const canonical = stableStringify(unsignedReceipt)
    const hash = sha256(canonical)
    const hashHex = hash.slice(7)
    const hashBytes = Buffer.from(hashHex, 'hex')

    // Verify signature
    const valid = ed25519.verify(signatureBytes, hashBytes, publicKeyBytes)

    return { valid, key_id: sig.key_id }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    }
  }
}

/**
 * Export keypair to JSON format for storage
 *
 * @param keypair - Ed25519 keypair
 * @returns JSON-serializable keypair object
 */
export function exportKeypair(keypair: Ed25519Keypair): Record<string, unknown> {
  return {
    key_id: keypair.keyId,
    algorithm: 'ed25519',
    private_key: base64urlEncode(keypair.privateKey),
    public_key: base64urlEncode(keypair.publicKey),
  }
}

/**
 * Import keypair from JSON format
 *
 * @param json - JSON keypair object (from exportKeypair)
 * @returns Ed25519 keypair
 */
export function importKeypair(json: Record<string, unknown>): Ed25519Keypair {
  if (json.algorithm !== 'ed25519') {
    throw new Error(`Unsupported algorithm: ${json.algorithm}`)
  }

  return {
    keyId: json.key_id as string,
    privateKey: base64urlDecode(json.private_key as string),
    publicKey: base64urlDecode(json.public_key as string),
  }
}
