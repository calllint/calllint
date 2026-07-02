/**
 * Base64url encoding/decoding utilities (RFC 4648 §5, no padding)
 * @packageDocumentation
 */

/**
 * Encode bytes to base64url string (no padding)
 */
export function base64urlEncode(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Decode base64url string to bytes
 */
export function base64urlDecode(str: string): Uint8Array {
  // Add padding if needed
  const padded = str + '==='.slice((str.length + 3) % 4)
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  return new Uint8Array(Buffer.from(base64, 'base64'))
}
