import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs"
import { dirname, join } from "node:path"
import { pruneOldBlobs } from "../src/casRetention.js"
import { casBlobPath, casBlobsRoot } from "@calllint/adoption-index"

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
})
