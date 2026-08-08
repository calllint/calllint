import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs"
import { dirname, join } from "node:path"
import { pruneOldBlobs, pruneStaleStaging } from "../src/casRetention.js"
import { casBlobPath, casBlobsRoot, casStagingPath, casWorkRoot } from "@calllint/adoption-index"

/**
 * The blobs are placed through `casBlobPath` on purpose, not through a hand-joined path. The sweep
 * has to walk the real two-character fan-out (`cas/blobs/<hex[0:2]>/<hex>`); a test that laid its
 * blobs out flat would pass against a sweep that never descends and therefore inspects nothing on
 * a real store.
 */
describe("casRetention", () => {
  const ROOT = join(process.cwd(), ".var", "test-cas-retention")

  /** A digest whose hex fans out to `ab/`, `cd/`, … — one per distinct first byte. */
  const digest = (firstByte: string, fill: string) => `sha256:${firstByte}${fill.repeat(62)}`

  const putBlob = (d: string, ageDays: number, now: Date): string => {
    const path = casBlobPath(ROOT, d)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, d)
    const t = new Date(now.getTime() - ageDays * 86400 * 1000)
    utimesSync(path, t, t)
    return path
  }

  beforeEach(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(casBlobsRoot(ROOT), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
  })

  it("deletes blobs older than retention and keeps the rest", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    const old = putBlob(digest("ab", "1"), 100, now)
    const recent = putBlob(digest("cd", "2"), 30, now)

    const result = pruneOldBlobs({ root: ROOT, retentionDays: 90, now: now.toISOString() })

    expect(result).toEqual({ inspected: 2, deleted: 1, failed: 0 })
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
  })

  it("keeps every blob when none has reached the cutoff", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    const kept = [
      putBlob(digest("ab", "1"), 30, now),
      putBlob(digest("cd", "2"), 60, now),
      putBlob(digest("ef", "3"), 89, now),
    ]

    const result = pruneOldBlobs({ root: ROOT, retentionDays: 90, now: now.toISOString() })

    expect(result).toEqual({ inspected: 3, deleted: 0, failed: 0 })
    expect(kept.filter((p) => !existsSync(p))).toEqual([])
  })

  it("deletes every blob when all are past the cutoff", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    const gone = [putBlob(digest("ab", "1"), 120, now), putBlob(digest("cd", "2"), 91, now)]

    const result = pruneOldBlobs({ root: ROOT, retentionDays: 90, now: now.toISOString() })

    expect(result).toEqual({ inspected: 2, deleted: 2, failed: 0 })
    expect(gone.filter(existsSync)).toEqual([])
  })

  it("reports zero on an empty blob tree instead of throwing", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    const result = pruneOldBlobs({ root: ROOT, retentionDays: 90, now: now.toISOString() })
    expect(result).toEqual({ inspected: 0, deleted: 0, failed: 0 })
  })

  it("honours a retention window shorter than the default", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    const old = putBlob(digest("ab", "1"), 50, now)
    const recent = putBlob(digest("cd", "2"), 20, now)

    const result = pruneOldBlobs({ root: ROOT, retentionDays: 30, now: now.toISOString() })

    expect(result).toEqual({ inspected: 2, deleted: 1, failed: 0 })
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
  })

  it("descends the fan-out: blobs sharing a directory are both swept", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    // Same first byte → same fan-out directory, different blobs.
    const a = putBlob(`sha256:ab${"1".repeat(62)}`, 100, now)
    const b = putBlob(`sha256:ab${"2".repeat(62)}`, 100, now)
    expect(dirname(a)).toBe(dirname(b))

    const result = pruneOldBlobs({ root: ROOT, retentionDays: 90, now: now.toISOString() })

    expect(result).toEqual({ inspected: 2, deleted: 2, failed: 0 })
  })

  it("a flat blob directly under cas/blobs is not counted (the layout has one owner)", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    // What a sweep written against the WRONG layout would have found. `casBlobPath` never
    // produces this shape, so seeing it counted would mean the sweep invented its own layout.
    const stray = join(casBlobsRoot(ROOT), `${"e".repeat(64)}`)
    writeFileSync(stray, "stray")
    const t = new Date(now.getTime() - 200 * 86400 * 1000)
    utimesSync(stray, t, t)

    const result = pruneOldBlobs({ root: ROOT, retentionDays: 90, now: now.toISOString() })

    expect(result).toEqual({ inspected: 0, deleted: 0, failed: 0 })
    expect(existsSync(stray)).toBe(true)
  })

  it("throws when the blob tree is absent, rather than reporting a clean zero", () => {
    // An absent tree is not an empty tree: reporting {0,0,0} would let a misconfigured root read
    // as "nothing to prune" forever (the absence-makes-a-gate-skip-itself shape).
    rmSync(casBlobsRoot(ROOT), { recursive: true, force: true })
    expect(() =>
      pruneOldBlobs({ root: ROOT, retentionDays: 90, now: "2026-08-04T10:00:00Z" }),
    ).toThrow()
  })

  it("the blob sweep never touches work/ — the two surfaces are separate sweeps", () => {
    // The negative control for collapsing §8.6 into §8.4. If someone widened `pruneOldBlobs` to
    // walk the whole CAS instead of `cas/blobs`, this ancient `.part` would be swept by the wrong
    // sweep on the wrong (days-long) window, and `pruneStaleStaging`'s hours window would become
    // dead code that still reported zeroes.
    const now = new Date("2026-08-04T10:00:00Z")
    const staging = casStagingPath(ROOT, `sha256:${"7".repeat(64)}`)
    mkdirSync(dirname(staging), { recursive: true })
    writeFileSync(staging, "orphan")
    const t = new Date(now.getTime() - 400 * 86400 * 1000)
    utimesSync(staging, t, t)

    const result = pruneOldBlobs({ root: ROOT, retentionDays: 90, now: now.toISOString() })

    expect(result).toEqual({ inspected: 0, deleted: 0, failed: 0 })
    expect(existsSync(staging)).toBe(true)
  })
})

/**
 * The staging-orphan sweep (ADR 0061 §8.6).
 *
 * Files are placed through `casStagingPath` for the same reason the blob tests use `casBlobPath`:
 * INV-R7 gives the layout one owner, and a test that hand-joined `work/<hex>.part` would keep
 * passing after the real writer moved. The traversal here is FLAT where the blob tree fans out, so
 * a shared helper would hide precisely the difference that matters.
 */
describe("casRetention — pruneStaleStaging", () => {
  const ROOT = join(process.cwd(), ".var", "test-cas-staging")

  const putPart = (hex: string, ageHours: number, now: Date): string => {
    const path = casStagingPath(ROOT, `sha256:${hex}`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, hex)
    const t = new Date(now.getTime() - ageHours * 3600 * 1000)
    utimesSync(path, t, t)
    return path
  }

  beforeEach(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(casWorkRoot(ROOT), { recursive: true })
  })

  afterEach(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
  })

  it("deletes orphans past the window and keeps a run that may still be in flight", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    const orphan = putPart("1".repeat(64), 72, now)
    const inFlight = putPart("2".repeat(64), 1, now)

    const result = pruneStaleStaging({ root: ROOT, orphanHours: 48, now: now.toISOString() })

    expect(result).toEqual({ inspected: 2, deleted: 1, failed: 0, skipped: 0 })
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(inFlight)).toBe(true)
  })

  it("keeps a file written just before the cutoff — 48h is two full ingest cycles", () => {
    // The window exists to be certain a live run is never touched. A `.part` 47h old is older than
    // any real write (which lives for milliseconds), but the sweep still declines: the guarantee is
    // the window, not a guess about how long a write takes.
    const now = new Date("2026-08-04T10:00:00Z")
    const kept = putPart("3".repeat(64), 47, now)

    const result = pruneStaleStaging({ root: ROOT, orphanHours: 48, now: now.toISOString() })

    expect(result).toEqual({ inspected: 1, deleted: 0, failed: 0, skipped: 0 })
    expect(existsSync(kept)).toBe(true)
  })

  it("counts a non-.part entry as skipped and leaves it alone", () => {
    // `work/` is the staging directory today, but a future writer putting something durable there
    // must not be swept by a sweep written before it existed. `skipped` is how that shows up in the
    // log instead of being silently ignored.
    const now = new Date("2026-08-04T10:00:00Z")
    const durable = join(casWorkRoot(ROOT), "lease.json")
    writeFileSync(durable, "{}")
    const ancient = new Date(now.getTime() - 500 * 3600 * 1000)
    utimesSync(durable, ancient, ancient)
    const orphan = putPart("4".repeat(64), 100, now)

    const result = pruneStaleStaging({ root: ROOT, orphanHours: 48, now: now.toISOString() })

    expect(result).toEqual({ inspected: 1, deleted: 1, failed: 0, skipped: 1 })
    expect(existsSync(durable)).toBe(true)
    expect(existsSync(orphan)).toBe(false)
  })

  it("counts a directory named *.part as skipped rather than trying to unlink it", () => {
    const now = new Date("2026-08-04T10:00:00Z")
    mkdirSync(join(casWorkRoot(ROOT), `${"5".repeat(64)}.part`), { recursive: true })

    const result = pruneStaleStaging({ root: ROOT, orphanHours: 48, now: now.toISOString() })

    expect(result).toEqual({ inspected: 0, deleted: 0, failed: 0, skipped: 1 })
  })

  it("reports zero on an empty staging tree instead of throwing", () => {
    const result = pruneStaleStaging({
      root: ROOT,
      orphanHours: 48,
      now: "2026-08-04T10:00:00Z",
    })
    expect(result).toEqual({ inspected: 0, deleted: 0, failed: 0, skipped: 0 })
  })

  it("throws when work/ is absent, rather than reporting a clean zero", () => {
    // Control #125. Step 1 of the worker creates every index directory unconditionally
    // (`refreshSnapshot.ts:278`), so an absent `work/` means the root is wrong — and a mis-rooted
    // sweep that logged `inspected 0` every night is the §8.5 decoy-root failure this must not
    // reproduce. Same rule `pruneOldBlobs` follows for `cas/blobs`.
    rmSync(casWorkRoot(ROOT), { recursive: true, force: true })
    expect(() =>
      pruneStaleStaging({ root: ROOT, orphanHours: 48, now: "2026-08-04T10:00:00Z" }),
    ).toThrow()
  })

  it("the sweep does not descend: a nested .part is never reached", () => {
    // The asymmetry with `cas/blobs` made executable. `casStagingPath` is flat, so anything nested
    // was not put there by this store, and a sweep that recursed would be walking a layout that
    // has no writer.
    const now = new Date("2026-08-04T10:00:00Z")
    const nestedDir = join(casWorkRoot(ROOT), "ab")
    mkdirSync(nestedDir, { recursive: true })
    const nested = join(nestedDir, `${"6".repeat(64)}.part`)
    writeFileSync(nested, "nested")
    const t = new Date(now.getTime() - 500 * 3600 * 1000)
    utimesSync(nested, t, t)

    const result = pruneStaleStaging({ root: ROOT, orphanHours: 48, now: now.toISOString() })

    expect(result).toEqual({ inspected: 0, deleted: 0, failed: 0, skipped: 1 })
    expect(existsSync(nested)).toBe(true)
  })

  it("a longer window spares an orphan a shorter one would take", () => {
    // Non-vacuity for `orphanHours`: the same fixture must flip on the window alone, or the
    // parameter could be ignored and every assertion above would still pass.
    const now = new Date("2026-08-04T10:00:00Z")
    const at72h = () => putPart("8".repeat(64), 72, now)

    const path = at72h()
    expect(
      pruneStaleStaging({ root: ROOT, orphanHours: 48, now: now.toISOString() }),
    ).toEqual({ inspected: 1, deleted: 1, failed: 0, skipped: 0 })
    expect(existsSync(path)).toBe(false)

    at72h()
    expect(
      pruneStaleStaging({ root: ROOT, orphanHours: 96, now: now.toISOString() }),
    ).toEqual({ inspected: 1, deleted: 0, failed: 0, skipped: 0 })
  })
})
