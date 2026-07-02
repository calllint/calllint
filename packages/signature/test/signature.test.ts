import { describe, test, expect } from 'vitest'
import { generateKeypair, signReceipt, verifyReceipt, exportKeypair, importKeypair } from '../src/ed25519.js'
import { base64urlEncode, base64urlDecode } from '../src/base64url.js'

describe('@calllint/signature', () => {
  describe('base64url encoding', () => {
    test('encodes and decodes round-trip', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 254, 253])
      const encoded = base64urlEncode(original)
      const decoded = base64urlDecode(encoded)

      expect(decoded).toEqual(original)
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(encoded).not.toContain('=')
    })

    test('produces 86 chars for 64-byte signature', () => {
      const signature = new Uint8Array(64).fill(0)
      const encoded = base64urlEncode(signature)
      expect(encoded.length).toBe(86) // 64 bytes * 4/3, no padding
    })

    test('produces 43 chars for 32-byte public key', () => {
      const publicKey = new Uint8Array(32).fill(0)
      const encoded = base64urlEncode(publicKey)
      expect(encoded.length).toBe(43) // 32 bytes * 4/3, no padding
    })
  })

  describe('keypair generation', () => {
    test('generates valid keypair', async () => {
      const keypair = await generateKeypair('calllint-test-2026-h2')

      expect(keypair.keyId).toBe('calllint-test-2026-h2')
      expect(keypair.privateKey).toHaveLength(32)
      expect(keypair.publicKey).toHaveLength(32)
    })

    test('generates different keypairs each time', async () => {
      const kp1 = await generateKeypair('test-1')
      const kp2 = await generateKeypair('test-2')

      expect(kp1.privateKey).not.toEqual(kp2.privateKey)
      expect(kp1.publicKey).not.toEqual(kp2.publicKey)
    })
  })

  describe('keypair export/import', () => {
    test('exports and imports round-trip', async () => {
      const original = await generateKeypair('calllint-dev-2026-h2')
      const exported = exportKeypair(original)
      const imported = importKeypair(exported)

      expect(imported.keyId).toBe(original.keyId)
      expect(imported.privateKey).toEqual(original.privateKey)
      expect(imported.publicKey).toEqual(original.publicKey)
    })

    test('exported format matches schema', async () => {
      const keypair = await generateKeypair('calllint-prod-2026-h2')
      const exported = exportKeypair(keypair)

      expect(exported).toHaveProperty('key_id', 'calllint-prod-2026-h2')
      expect(exported).toHaveProperty('algorithm', 'ed25519')
      expect(exported).toHaveProperty('private_key')
      expect(exported).toHaveProperty('public_key')

      // Check base64url format (no padding)
      expect(typeof exported.private_key).toBe('string')
      expect(typeof exported.public_key).toBe('string')
      expect((exported.private_key as string)).not.toContain('=')
      expect((exported.public_key as string)).not.toContain('=')
    })
  })

  describe('receipt signing and verification', () => {
    test('sign and verify round-trip', async () => {
      const keypair = await generateKeypair('calllint-test-2026-h2')
      const unsignedReceipt = {
        schema_version: 'calllint.receipt.v0',
        receipt_id: 'clrec_test123',
        verdict: 'SAFE',
        hashes: {
          input_hash: 'sha256:abc123',
          policy_hash: 'sha256:def456',
          report_hash: 'sha256:ghi789',
          ruleset_hash: 'sha256:jkl012',
        },
      }

      const signature = await signReceipt(unsignedReceipt, keypair)
      const signedReceipt = { ...unsignedReceipt, signature }

      const result = await verifyReceipt(signedReceipt, keypair.publicKey)

      expect(result.valid).toBe(true)
      expect(result.key_id).toBe('calllint-test-2026-h2')
      expect(result.error).toBeUndefined()
    })

    test('signature matches expected format', async () => {
      const keypair = await generateKeypair('calllint-prod-2026-h2')
      const unsignedReceipt = { test: 'data' }

      const signature = await signReceipt(unsignedReceipt, keypair)

      expect(signature.algorithm).toBe('ed25519')
      expect(signature.key_id).toBe('calllint-prod-2026-h2')
      expect(signature.value).toMatch(/^[A-Za-z0-9_-]{86}$/) // 64 bytes base64url
      expect(signature.signed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    test('detects tampered receipt', async () => {
      const keypair = await generateKeypair('calllint-test-2026-h2')
      const unsignedReceipt = { verdict: 'SAFE', data: 'original' }

      const signature = await signReceipt(unsignedReceipt, keypair)
      const signedReceipt = { ...unsignedReceipt, signature }

      // Tamper with the receipt
      const tamperedReceipt = { ...signedReceipt, verdict: 'BLOCK' }

      const result = await verifyReceipt(tamperedReceipt, keypair.publicKey)

      expect(result.valid).toBe(false)
    })

    test('detects tampered signature value', async () => {
      const keypair = await generateKeypair('calllint-test-2026-h2')
      const unsignedReceipt = { verdict: 'SAFE' }

      const signature = await signReceipt(unsignedReceipt, keypair)
      const signedReceipt = { ...unsignedReceipt, signature }

      // Tamper with the signature: flip the first char to a DIFFERENT base64url
      // char so the mutation is always real (a random 'X'-first signature would
      // otherwise make replace(/^./, 'X') a no-op and flake the assertion).
      const first = signature.value[0]
      const flipped = first === 'A' ? 'B' : 'A'
      const tamperedReceipt = {
        ...signedReceipt,
        signature: {
          ...signature,
          value: flipped + signature.value.slice(1),
        },
      }

      const result = await verifyReceipt(tamperedReceipt, keypair.publicKey)

      expect(result.valid).toBe(false)
    })

    test('rejects wrong public key', async () => {
      const keypair1 = await generateKeypair('key-1')
      const keypair2 = await generateKeypair('key-2')
      const unsignedReceipt = { data: 'test' }

      const signature = await signReceipt(unsignedReceipt, keypair1)
      const signedReceipt = { ...unsignedReceipt, signature }

      const result = await verifyReceipt(signedReceipt, keypair2.publicKey)

      expect(result.valid).toBe(false)
    })

    test('rejects receipt without signature field', async () => {
      const unsignedReceipt = { verdict: 'SAFE' }

      const result = await verifyReceipt(unsignedReceipt, new Uint8Array(32))

      expect(result.valid).toBe(false)
      expect(result.error).toContain('No signature field')
    })

    test('accepts public key as base64url string', async () => {
      const keypair = await generateKeypair('calllint-test-2026-h2')
      const unsignedReceipt = { data: 'test' }

      const signature = await signReceipt(unsignedReceipt, keypair)
      const signedReceipt = { ...unsignedReceipt, signature }

      const publicKeyBase64url = base64urlEncode(keypair.publicKey)
      const result = await verifyReceipt(signedReceipt, publicKeyBase64url)

      expect(result.valid).toBe(true)
    })

    test('deterministic signatures for same input', async () => {
      // ed25519 is deterministic - same input + key → same signature
      const privateKey = new Uint8Array(32).fill(1) // fixed private key
      const publicKey = new Uint8Array(32).fill(2) // (not a real keypair, but sufficient for test)
      const keypair = { privateKey, publicKey, keyId: 'test' }

      const receipt = { data: 'fixed' }

      const sig1 = await signReceipt(receipt, keypair)
      const sig2 = await signReceipt(receipt, keypair)

      // Signature value should be identical (signed_at will differ)
      expect(sig1.value).toBe(sig2.value)
    })
  })

  describe('edge cases', () => {
    test('handles empty receipt object', async () => {
      const keypair = await generateKeypair('test')
      const emptyReceipt = {}

      const signature = await signReceipt(emptyReceipt, keypair)
      const signedReceipt = { signature }

      const result = await verifyReceipt(signedReceipt, keypair.publicKey)

      expect(result.valid).toBe(true)
    })

    test('handles large receipt object', async () => {
      const keypair = await generateKeypair('test')
      const largeReceipt = {
        findings: Array.from({ length: 100 }, (_, i) => ({
          rule_id: `rule-${i}`,
          severity: 'high',
          evidence: 'x'.repeat(200),
        })),
      }

      const signature = await signReceipt(largeReceipt, keypair)
      const signedReceipt = { ...largeReceipt, signature }

      const result = await verifyReceipt(signedReceipt, keypair.publicKey)

      expect(result.valid).toBe(true)
    })

    test('rejects invalid public key length', async () => {
      const keypair = await generateKeypair('test')
      const receipt = { data: 'test' }
      const signature = await signReceipt(receipt, keypair)
      const signedReceipt = { ...receipt, signature }

      const invalidPublicKey = new Uint8Array(16) // wrong length

      const result = await verifyReceipt(signedReceipt, invalidPublicKey)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid public key length')
    })
  })
})
