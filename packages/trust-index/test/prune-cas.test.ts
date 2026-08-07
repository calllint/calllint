import { describe, it, expect } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { resolveRetentionDays, DEFAULT_RETENTION_DAYS } from "../src/casRetention.js"
import { casBlobPath } from "@calllint/adoption-index"

describe("resolveRetentionDays", () => {
  it("defaults to the declared window when unset or blank", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90) // ADR 0061 §8.4 — the number itself is the claim
    for (const env of [{}, { CAS_RETENTION_DAYS: "" }, { CAS_RETENTION_DAYS: "   " }]) {
      expect(resolveRetentionDays(env)).toBe(DEFAULT_RETENTION_DAYS)
    }
  })

  it("accepts a positive integer, trimmed", () => {
    expect(resolveRetentionDays({ CAS_RETENTION_DAYS: "30" })).toBe(30)
    expect(resolveRetentionDays({ CAS_RETENTION_DAYS: " 180 " })).toBe(180)
    expect(resolveRetentionDays({ CAS_RETENTION_DAYS: "1" })).toBe(1)
  })

  it("refuses zero — a 0-day window would delete the run's own fresh blobs", () => {
    expect(() => resolveRetentionDays({ CAS_RETENTION_DAYS: "0" })).toThrow(/greater than zero/)
  })

  it("refuses a non-integer instead of coercing it", () => {
    // `parseInt` would read each of these as a number and silently prune on the wrong window:
    // "45.9" → 45, "30d" → 30, "-1" → -1 (a NEGATIVE window deletes everything).
    for (const raw of ["45.9", "30d", "-1", "1e3", "ninety", "NaN", "0x10"]) {
      expect(() => resolveRetentionDays({ CAS_RETENTION_DAYS: raw })).toThrow(/positive integer/)
    }
  })
})

describe("pruneCas — the invoked-as-script guard", () => {
  it("importing the bin sweeps nothing, even with an ancient blob in reach", async () => {
    // The guard's whole purpose, MEASURED rather than restated. `main()` deletes files under
    // `.var/`, so an unguarded module body would sweep whatever `ADOPTION_INDEX_CWD` points at the
    // moment anything imported this file — and a suite that only asserted on a pure parser could
    // not tell the difference. Vitest's entry point is not `pruneCas.ts`, so the guard must hold.
    const cwd = mkdtempSync(join(tmpdir(), "prune-cas-guard-"))
    const blob = casBlobPath(join(cwd, ".var", "calllint-adoption-index"), `sha256:${"a".repeat(64)}`)
    mkdirSync(dirname(blob), { recursive: true })
    writeFileSync(blob, "ancient")
    const ancient = new Date("2000-01-01T00:00:00Z")
    utimesSync(blob, ancient, ancient)

    const previous = process.env.ADOPTION_INDEX_CWD
    process.env.ADOPTION_INDEX_CWD = cwd
    try {
      await import("../src/pruneCas.js")
      expect(existsSync(blob)).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.ADOPTION_INDEX_CWD
      else process.env.ADOPTION_INDEX_CWD = previous
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
