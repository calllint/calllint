import { describe, it, expect } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import {
  resolveRetentionDays,
  resolveStagingOrphanHours,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_STAGING_ORPHAN_HOURS,
} from "../src/casRetention.js"
import { casBlobPath, casStagingPath } from "@calllint/adoption-index"

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

describe("resolveStagingOrphanHours", () => {
  it("defaults to the declared window when unset or blank", () => {
    expect(DEFAULT_STAGING_ORPHAN_HOURS).toBe(48) // ADR 0061 §8.6 — two full ingest cycles
    for (const env of [{}, { CAS_STAGING_ORPHAN_HOURS: "" }, { CAS_STAGING_ORPHAN_HOURS: "  " }]) {
      expect(resolveStagingOrphanHours(env)).toBe(DEFAULT_STAGING_ORPHAN_HOURS)
    }
  })

  it("is a window in HOURS, not a reuse of the blob window in days", () => {
    // The two windows are independent numbers with independent units. Collapsing them would leave
    // every orphan on disk for three months, which is the growth §8.6 exists to stop — so the fact
    // that they are NOT the same value is itself the claim.
    expect(DEFAULT_STAGING_ORPHAN_HOURS).not.toBe(DEFAULT_RETENTION_DAYS)
  })

  it("accepts a positive integer, trimmed", () => {
    expect(resolveStagingOrphanHours({ CAS_STAGING_ORPHAN_HOURS: "6" })).toBe(6)
    expect(resolveStagingOrphanHours({ CAS_STAGING_ORPHAN_HOURS: " 168 " })).toBe(168)
    expect(resolveStagingOrphanHours({ CAS_STAGING_ORPHAN_HOURS: "1" })).toBe(1)
  })

  it("refuses zero — control #124: a 0h window deletes the write in progress right now", () => {
    // Sharper than the blob case. `casStagingPath` is where bytes are streaming at this instant, so
    // a window that coerced to 0 would unlink a file the current run is mid-write on.
    expect(() => resolveStagingOrphanHours({ CAS_STAGING_ORPHAN_HOURS: "0" })).toThrow(
      /greater than zero/,
    )
  })

  it("refuses a non-integer instead of coercing it", () => {
    for (const raw of ["47.5", "48h", "-1", "2e3", "fortyeight", "NaN", "0x30"]) {
      expect(() => resolveStagingOrphanHours({ CAS_STAGING_ORPHAN_HOURS: raw })).toThrow(
        /positive integer/,
      )
    }
  })

  it("reads its own variable, not the blob window's", () => {
    // Non-vacuity: if the parser read `CAS_RETENTION_DAYS` by copy-paste, every assertion above
    // would still pass, because they only ever set one variable at a time.
    expect(resolveStagingOrphanHours({ CAS_RETENTION_DAYS: "7" })).toBe(
      DEFAULT_STAGING_ORPHAN_HOURS,
    )
    expect(resolveRetentionDays({ CAS_STAGING_ORPHAN_HOURS: "7" })).toBe(DEFAULT_RETENTION_DAYS)
  })
})

describe("pruneCas — the invoked-as-script guard", () => {
  it("importing the bin sweeps nothing on EITHER surface, with both in reach", async () => {
    // The guard's whole purpose, MEASURED rather than restated. `main()` deletes files under
    // `.var/`, so an unguarded module body would sweep whatever `ADOPTION_INDEX_CWD` points at the
    // moment anything imported this file — and a suite that only asserted on a pure parser could
    // not tell the difference. Vitest's entry point is not `pruneCas.ts`, so the guard must hold.
    //
    // BOTH sweeps are staged, because §8.6 gave `main()` a second thing it can delete. A fixture
    // carrying only a blob would keep passing if the guard broke *after* the staging sweep was
    // added — the blob assertion would fail, but nothing would name `work/` as also exposed.
    const cwd = mkdtempSync(join(tmpdir(), "prune-cas-guard-"))
    const root = join(cwd, ".var", "calllint-adoption-index")
    const ancient = new Date("2000-01-01T00:00:00Z")

    const blob = casBlobPath(root, `sha256:${"a".repeat(64)}`)
    mkdirSync(dirname(blob), { recursive: true })
    writeFileSync(blob, "ancient")
    utimesSync(blob, ancient, ancient)

    const staging = casStagingPath(root, `sha256:${"b".repeat(64)}`)
    mkdirSync(dirname(staging), { recursive: true })
    writeFileSync(staging, "ancient orphan")
    utimesSync(staging, ancient, ancient)

    const previous = process.env.ADOPTION_INDEX_CWD
    process.env.ADOPTION_INDEX_CWD = cwd
    try {
      await import("../src/pruneCas.js")
      // Named individually rather than through `.every()`: a collapsed assertion would print
      // "expected false to be true" and leave which surface leaked unstated.
      expect(existsSync(blob)).toBe(true)
      expect(existsSync(staging)).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.ADOPTION_INDEX_CWD
      else process.env.ADOPTION_INDEX_CWD = previous
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
