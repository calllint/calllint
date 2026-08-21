/**
 * Hashing + retention tests (new18 §20, §21).
 *
 * The load-bearing property for hashing is that it is KEYED: the same ID under
 * two different secrets must not collide, or a leaked table would be reversible
 * by anyone who can enumerate UUIDs.
 */
import { describe, expect, it } from "vitest"
import { hashInstallationId } from "../src/hash.js"
import {
  BATCH_ID_RETENTION_DAYS,
  INSTALLATION_HASH_RETENTION_DAYS,
  cutoffDay,
} from "../src/retention.js"

const ID = "cli-anon-12345678-1234-1234-1234-123456789abc"

describe("hashInstallationId", () => {
  it("is deterministic for the same ID and secret", async () => {
    const a = await hashInstallationId(ID, "secret-one")
    const b = await hashInstallationId(ID, "secret-one")
    expect(a).toBe(b)
  })

  it("returns a 64-character lowercase hex digest", async () => {
    expect(await hashInstallationId(ID, "secret-one")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("produces different digests under different secrets", async () => {
    // This is what makes the stored hash non-reversible without the key.
    const a = await hashInstallationId(ID, "secret-one")
    const b = await hashInstallationId(ID, "secret-two")
    expect(a).not.toBe(b)
  })

  it("produces different digests for different IDs under one secret", async () => {
    const a = await hashInstallationId(ID, "secret-one")
    const b = await hashInstallationId("cli-anon-87654321-4321-4321-4321-cba987654321", "secret-one")
    expect(a).not.toBe(b)
  })

  it("never contains the raw ID", async () => {
    const digest = await hashInstallationId(ID, "secret-one")
    expect(digest).not.toContain("cli-anon")
    expect(digest).not.toContain("12345678")
  })

  it("refuses to hash without a secret rather than silently downgrading", async () => {
    // A fallback to an unkeyed digest would store reversible hashes while
    // everything still appeared to work.
    await expect(hashInstallationId(ID, "")).rejects.toThrow(/USAGE_HASH_KEY/)
  })

  it("stays correct across alternating secrets (cache must key on the secret)", async () => {
    const one = await hashInstallationId(ID, "secret-one")
    const two = await hashInstallationId(ID, "secret-two")
    expect(await hashInstallationId(ID, "secret-one")).toBe(one)
    expect(await hashInstallationId(ID, "secret-two")).toBe(two)
  })
})

describe("retention windows", () => {
  it("uses 90 days for installation hashes and 30 for batch IDs", () => {
    expect(INSTALLATION_HASH_RETENTION_DAYS).toBe(90)
    expect(BATCH_ID_RETENTION_DAYS).toBe(30)
  })

  it("computes the cutoff day in UTC", () => {
    const now = new Date("2026-08-20T12:00:00Z")
    expect(cutoffDay(now, 30)).toBe("2026-07-21")
    expect(cutoffDay(now, 90)).toBe("2026-05-22")
  })

  it("crosses a year boundary correctly", () => {
    expect(cutoffDay(new Date("2026-01-15T00:00:00Z"), 30)).toBe("2025-12-16")
  })

  it("is unaffected by the time of day", () => {
    expect(cutoffDay(new Date("2026-08-20T23:59:59Z"), 30)).toBe(
      cutoffDay(new Date("2026-08-20T00:00:01Z"), 30),
    )
  })
})
