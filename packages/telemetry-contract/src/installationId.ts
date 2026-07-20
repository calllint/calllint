/**
 * anonymousInstallationId contract (new11 §3.5, ADR 0049 §2.6).
 *
 * Rules the id MUST satisfy: locally generated, NO hardware fingerprint (it must
 * NOT reuse @calllint/fingerprint capability ids), resettable, non-cross-product,
 * documented (docs/privacy/telemetry.md). This module is a PURE contract: it does
 * not read hardware, the clock, or fs. Generation takes an injected random UUID
 * so callers stay testable and no ambient entropy is smuggled in.
 */

/** Opaque, versioned prefix so a reset/rotation is visibly a fresh id. */
export const INSTALLATION_ID_PREFIX = "cli-anon-"

/**
 * Build an installation id from an externally-supplied random UUID (e.g.
 * crypto.randomUUID at the call site). The generator MUST be random per install
 * and MUST NOT be derived from any hardware/capability identifier.
 */
export function makeInstallationId(randomUuid: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(randomUuid)) {
    throw new Error("telemetry: installation id requires a random UUID v4 string")
  }
  return `${INSTALLATION_ID_PREFIX}${randomUuid.toLowerCase()}`
}

/** True for a well-formed, contract-shaped installation id. */
export function isValidInstallationId(id: string): boolean {
  return /^cli-anon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
}

/**
 * Guard against accidentally seeding the id from a hardware/capability id.
 * @calllint/fingerprint capability ids are hex digests without our prefix; a
 * value that lacks the prefix is rejected as a possible fingerprint reuse.
 */
export function assertNotFingerprint(id: string): void {
  if (!id.startsWith(INSTALLATION_ID_PREFIX)) {
    throw new Error(
      "telemetry: installation id must be a locally-generated anon id, not a fingerprint/capability id",
    )
  }
}
