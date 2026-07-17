/**
 * I2c-1 acceptance tests — the pure maintainer-claim core (ADR 0047 §4, ADR 0048 §3).
 *
 * The load-bearing properties: verification FAILS CLOSED (absent / revoked / ambiguous
 * ⇒ no publisher), the store parser rejects a malformed store and any email-like owner
 * (PII guard), and the resolved flag carries only the public handle + digests + time
 * (never a safety claim). No I/O, no clock, no network — this is the offline half.
 */
import { describe, it, expect } from "vitest"
import {
  parseClaimStore,
  verifiedPublisherFor,
  EMPTY_CLAIM_STORE,
  type ClaimRecord,
  type ClaimStore,
} from "../src/index.js"

const DIGEST = "sha256:aaaa" as const
const SCOPE = "sha256:bbbb" as const

const record = (over: Partial<ClaimRecord> = {}): ClaimRecord => ({
  schema: "calllint.claim.v0",
  canonicalName: "calllint-fixtures/safe-time",
  owner: "octo-org",
  installationId: 42,
  artifactDigest: DIGEST,
  scopeDigest: SCOPE,
  verifiedAt: "2026-07-17T00:00:00.000Z",
  status: "active",
  ...over,
})

const store = (records: ClaimRecord[]): ClaimStore => ({
  schema: "calllint.claim-store.v0",
  records,
})

describe("verifiedPublisherFor — fails closed (ADR 0047 §4)", () => {
  it("returns the sole active record's publisher (positive)", () => {
    const vp = verifiedPublisherFor(store([record()]), "calllint-fixtures/safe-time")
    expect(vp).toEqual({
      owner: "octo-org",
      verifiedAt: "2026-07-17T00:00:00.000Z",
      observedArtifactDigest: DIGEST,
    })
  })

  it("returns undefined for an empty store (unclaimed — the committed default)", () => {
    expect(verifiedPublisherFor(EMPTY_CLAIM_STORE, "calllint-fixtures/safe-time")).toBeUndefined()
  })

  it("returns undefined when the only record is revoked (negative)", () => {
    const vp = verifiedPublisherFor(store([record({ status: "revoked" })]), "calllint-fixtures/safe-time")
    expect(vp).toBeUndefined()
  })

  it("returns undefined for a different namespace (no cross-claim leak)", () => {
    expect(verifiedPublisherFor(store([record()]), "calllint-fixtures/other")).toBeUndefined()
  })

  it("returns undefined when >1 active records claim the same namespace (ambiguous, never guess)", () => {
    const s = store([record({ owner: "a" }), record({ owner: "b" })])
    expect(verifiedPublisherFor(s, "calllint-fixtures/safe-time")).toBeUndefined()
  })

  it("counts only active records: one active + one revoked resolves to the active one", () => {
    const s = store([record({ owner: "keep" }), record({ owner: "gone", status: "revoked" })])
    expect(verifiedPublisherFor(s, "calllint-fixtures/safe-time")?.owner).toBe("keep")
  })
})

describe("parseClaimStore", () => {
  it("accepts an empty store (the normal pre-claim state)", () => {
    const s = parseClaimStore(JSON.stringify(EMPTY_CLAIM_STORE))
    expect(s.records).toHaveLength(0)
  })

  it("throws on a wrong schema or non-array records", () => {
    expect(() => parseClaimStore(JSON.stringify({ schema: "nope", records: [] }))).toThrow(/schema/)
    expect(() => parseClaimStore(JSON.stringify({ schema: "calllint.claim-store.v0", records: {} }))).toThrow(/array/)
  })

  it("rejects a record with an empty or missing owner", () => {
    expect(() => parseClaimStore(JSON.stringify(store([record({ owner: "" })])))).toThrow(/owner/)
  })

  it("rejects an email-like owner (PII guard mirrors check-public-copy #17)", () => {
    expect(() => parseClaimStore(JSON.stringify(store([record({ owner: "me@example.com" })])))).toThrow(/PII/)
  })
})
