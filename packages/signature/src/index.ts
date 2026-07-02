/**
 * @calllint/signature - Ed25519 signature generation and verification for CallLint receipts
 * @packageDocumentation
 */

export { generateKeypair, signReceipt, verifyReceipt, exportKeypair, importKeypair } from './ed25519.js'
export { base64urlEncode, base64urlDecode } from './base64url.js'
export type {
  Ed25519Keypair,
  SignatureMetadata,
  PublicKeyEntry,
  PublicKeyRegistry,
  VerificationResult,
} from './types.js'
