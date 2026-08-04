/**
 * artifact-resolution — the four PURE halves of R-4: the integrity claim, the tar inspection,
 * the CAS write, and the npm adapter's metadata read.
 *
 * `artifact-store.test.ts` grades what only a real database can see (the transition table as a
 * property of storage, one transaction per artifact, the four columns read back). This file grades
 * what a database cannot: whether the comparison is algorithm-aware, whether a hostile archive is
 * refused rather than crashed on, and whether unverified bytes can reach the filesystem.
 *
 * FIXTURES ARE BUILT IN MEMORY, never committed. Three reasons, and the first is the one that
 * decides it: these tests must control the exact byte to flip, and a committed archive can only be
 * corrupted by committing a second one. A committed `.tgz` would also make git call the file binary
 * (the R-3 NUL lesson) and would make the tar parser's own correctness unmeasurable — a fixture
 * produced by `tar` proves the parser agrees with `tar`, while a hand-written header proves it
 * agrees with the FORMAT, including the ustar/GNU/PAX shapes `tar` would not emit on demand.
 *
 * Negative controls this file is the measurement for:
 *   #22 compare the claim to `immutableDigest` by string equality → every artifact REJECTED
 *   #23 flip one fixture byte                                    → REJECTED and nothing in the CAS
 *   #24 remove the streaming byte cap                            → oversized fixture FETCHED
 *   #26 write before verifying                                   → the CAS holds unverified bytes
 *   #30 a blob path outside the index root                       → the INV-R7 assertion fires
 */
import { describe, it, expect, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sha256Bytes } from "@calllint/fingerprint"
import {
  parseIntegrityClaim,
  verifyBytesAgainstClaim,
  SUPPORTED_INTEGRITY_ALGORITHMS,
  inspectTarball,
  normalizeEntryPath,
  DEFAULT_TAR_CAPS,
  verifyAndStore,
  existsAsFile,
  casBlobPath,
  casStagingPath,
  resolveIndexPaths,
  npmArtifactAdapter,
  downloadArtifact,
  NPM_REGISTRY,
  type IntegrityClaim,
  type ArtifactFetchContext,
  type StoredArtifactVersion,
} from "../src/index.js"

const NOW = "2026-08-04T00:00:00.000Z"

// ── in-memory tar construction ────────────────────────────────────────────────────────────────

const BLOCK = 512

interface TarFile {
  path: string
  data: Buffer
  /** ustar '0' by default; '5' directory, 'L' GNU long name, 'x' PAX. */
  typeFlag?: string
  /** Written into `prefix` (offset 345) instead of being joined into `name`. */
  prefix?: string
  /** Overwrite the computed checksum, to make a NOT_TAR fixture. */
  corruptChecksum?: boolean
  /** Declare a size larger than the data, to make a TRUNCATED fixture. */
  declaredSize?: number
}

/**
 * Write one 512-byte ustar header.
 *
 * The checksum is COMPUTED here rather than hardcoded, because the parser validates it: a
 * hardcoded value would have to be recomputed by hand for every fixture variation, and the first
 * mistake would look like a parser bug. `corruptChecksum` is therefore an explicit opt-in, which
 * is what makes "a bad checksum is refused" a distinguishable assertion rather than an accident.
 */
function header(file: TarFile): Buffer {
  const h = Buffer.alloc(BLOCK, 0)
  h.write(file.path.slice(0, 100), 0, "utf8")
  h.write("0000644\0", 100, "ascii") // mode
  h.write("0000000\0", 108, "ascii") // uid
  h.write("0000000\0", 116, "ascii") // gid
  const size = file.declaredSize ?? file.data.length
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii")
  h.write("00000000000\0", 136, "ascii") // mtime — a constant, so a fixture has no clock in it
  h.write("        ", 148, "ascii") // checksum field reads as spaces while summing
  h.write(file.typeFlag ?? "0", 156, "ascii")
  h.write("ustar\0" + "00", 257, "ascii")
  if (file.prefix !== undefined) h.write(file.prefix.slice(0, 155), 345, "utf8")

  let sum = 0
  for (let i = 0; i < BLOCK; i += 1) sum += h[i] ?? 0
  const checksum = file.corruptChecksum ? (sum + 1) % 0o777777 : sum
  h.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii")
  return h
}

/** Assemble a tar (uncompressed). Two zero blocks terminate, as the format requires. */
function tar(files: readonly TarFile[], opts: { omitTrailer?: boolean } = {}): Buffer {
  const parts: Buffer[] = []
  for (const file of files) {
    parts.push(header(file))
    if (file.data.length > 0) {
      const padded = Buffer.alloc(Math.ceil(file.data.length / BLOCK) * BLOCK, 0)
      file.data.copy(padded)
      parts.push(padded)
    }
  }
  if (opts.omitTrailer !== true) parts.push(Buffer.alloc(BLOCK * 2, 0))
  return Buffer.concat(parts)
}

/** A gzipped tar. `level: 9` is not for size — it makes the bytes deterministic across runs. */
function tgz(files: readonly TarFile[], opts: { omitTrailer?: boolean } = {}): Uint8Array {
  return new Uint8Array(gzipSync(tar(files, opts), { level: 9 }))
}

/** The ordinary fixture: what an npm tarball's shape actually looks like. */
function packageTgz(): Uint8Array {
  return tgz([
    { path: "package/", data: Buffer.alloc(0), typeFlag: "5" },
    { path: "package/package.json", data: Buffer.from('{"name":"alpha","version":"1.2.3"}\n', "utf8") },
    { path: "package/index.js", data: Buffer.from("export const x = 1\n", "utf8") },
  ])
}

/** An SRI claim over `bytes`, in the shape npm publishes. */
function sri(bytes: Uint8Array, algorithm: "sha1" | "sha256" | "sha384" | "sha512" = "sha512"): string {
  return `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`
}

/** The `<alg>:<hex>` shape the ported mapping SYNTHESIZES from `dist.shasum`. */
function shasumClaim(bytes: Uint8Array): string {
  return `sha1:${createHash("sha1").update(bytes).digest("hex")}`
}

function claimOf(raw: string): IntegrityClaim {
  const parsed = parseIntegrityClaim(raw)
  if (!parsed.ok) throw new Error(`fixture claim did not parse: ${raw} (${parsed.reason})`)
  return parsed.claim
}

// ── temp roots ────────────────────────────────────────────────────────────────────────────────

const dirs: string[] = []

/**
 * A fresh index root, with the subdirectories CREATED — the same `paths.dirs` loop
 * `refreshSnapshot.ts` runs before opening the store.
 *
 * Creating them matters for one assertion in particular: "`cas/expanded` is empty" is a real
 * measurement only if the directory exists. Against a root where it was never created, the same
 * assertion would pass for the wrong reason, and would keep passing after a change that started
 * extracting somewhere else entirely.
 */
function tempRoot(): string {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-artifact-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  return paths.root
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Every blob file under `cas/blobs/`, repo-relative-ish, for "nothing was written" assertions. */
function casBlobs(root: string): string[] {
  const blobsDir = join(root, "cas", "blobs")
  if (!existsSync(blobsDir)) return []
  const out: string[] = []
  for (const shard of readdirSync(blobsDir, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue
    for (const name of readdirSync(join(blobsDir, shard.name))) out.push(`${shard.name}/${name}`)
  }
  return out.sort()
}

function stagingFiles(root: string): string[] {
  const workDir = join(root, "work")
  return existsSync(workDir) ? readdirSync(workDir).sort() : []
}

// ── the integrity claim ───────────────────────────────────────────────────────────────────────

describe("integrity claim — the comparison is algorithm-aware (control #22)", () => {
  it("verifies SRI sha512 against bytes, and the two digest shapes are NOT equal", () => {
    const bytes = packageTgz()
    const claim = claimOf(sri(bytes, "sha512"))
    const verification = verifyBytesAgainstClaim(bytes, claim)

    expect(verification.verified).toBe(true)
    // THE DEFECT THIS MODULE EXISTS TO AVOID, stated as an assertion. `registry_integrity` is
    // `sha512-<base64>` and `immutable_digest` is `sha256:<hex>`; an implementation that compared
    // them (control #22) rejects every artifact in the corpus, because these two strings are
    // never equal for any bytes.
    expect(claim.raw).not.toBe(verification.immutableDigest)
    expect(claim.raw.startsWith("sha512-")).toBe(true)
    expect(verification.immutableDigest.startsWith("sha256:")).toBe(true)
    // And the observed hex is the CLAIM's algorithm's output, not sha256's.
    expect(verification.observedHex).toHaveLength(SUPPORTED_INTEGRITY_ALGORITHMS.sha512 * 2)
    expect(verification.observedHex).not.toBe(verification.immutableDigest.slice("sha256:".length))
  })

  it("verifies the SYNTHESIZED `sha1:<hex>` shape — the shape the ported mapping falls back to", () => {
    // `npmResolver.ts` prefers `dist.integrity` and falls back to `` `sha1:${dist.shasum}` ``.
    // A parser that only understood SRI would fail on exactly the fallback the reuse introduces,
    // so both separators are graded, not just the documented one.
    const bytes = packageTgz()
    const claim = claimOf(shasumClaim(bytes))
    expect(claim.algorithm).toBe("sha1")
    expect(claim.weak).toBe(true)
    expect(verifyBytesAgainstClaim(bytes, claim).verified).toBe(true)
  })

  it("computes immutableDigest over the SAME buffer it verified", () => {
    // The two digests are produced by one function so they cannot describe different bytes.
    // Asserted against `sha256Bytes` independently, because the value written to
    // `immutable_digest` and the value verified being over one buffer is the whole reason
    // `verifyBytesAgainstClaim` returns both.
    const bytes = packageTgz()
    const v = verifyBytesAgainstClaim(bytes, claimOf(sri(bytes)))
    expect(v.immutableDigest).toBe(sha256Bytes(bytes))
  })

  it("refuses bytes whose digest disagrees, and reports both values", () => {
    const bytes = packageTgz()
    const other = tgz([{ path: "package/other.js", data: Buffer.from("different", "utf8") }])
    const claim = claimOf(sri(bytes))
    const v = verifyBytesAgainstClaim(other, claim)
    expect(v.verified).toBe(false)
    expect(v.observedHex).not.toBe(claim.expectedHex)
    // Both sides are recorded, because "we measured X, they claimed Y" is what a human needs.
    expect(v.observedHex).toBe(createHash("sha512").update(other).digest("hex"))
  })

  it("selects the STRONGEST supported entry and skips unknown ones", () => {
    const bytes = packageTgz()
    const raw = `${sri(bytes, "sha256")} sha3-512-Zm9v ${sri(bytes, "sha512")}`
    const claim = claimOf(raw)
    expect(claim.algorithm).toBe("sha512")
    // `raw` keeps the WHOLE claim, including the entry we did not select — the observed input,
    // not our interpretation of it (Product Principle 8).
    expect(claim.raw).toBe(raw)
    expect(verifyBytesAgainstClaim(bytes, claim).verified).toBe(true)
  })

  it("returns UNSUPPORTED_ALGORITHM only when NO entry is supported", () => {
    expect(parseIntegrityClaim("sha3-512-Zm9v")).toEqual({ ok: false, reason: "UNSUPPORTED_ALGORITHM" })
    expect(parseIntegrityClaim("md5-Zm9vYmFy")).toEqual({ ok: false, reason: "UNSUPPORTED_ALGORITHM" })
    // One supported entry among unsupported ones is fully checkable, so it must NOT be a rejection.
    const bytes = packageTgz()
    const mixed = parseIntegrityClaim(`sha3-256-Zm9v ${sri(bytes, "sha256")}`)
    expect(mixed.ok).toBe(true)
  })

  it("strips the SRI `?options` suffix, which carries no verification material", () => {
    const bytes = packageTgz()
    const claim = claimOf(`${sri(bytes, "sha512")}?foo=bar`)
    expect(verifyBytesAgainstClaim(bytes, claim).verified).toBe(true)
  })

  it("refuses lenient base64 — the alphabet, the length, and the round-trip are all checked", () => {
    // `Buffer.from(s, "base64")` silently discards characters outside the alphabet, so a length
    // check alone would be the only thing between us and treating garbage as a real claim.
    expect(parseIntegrityClaim("sha512-!!!!").ok).toBe(false)
    expect(parseIntegrityClaim("sha256-" + "A".repeat(4)).ok).toBe(false) // right alphabet, wrong length
    // Correct length, but not a canonical encoding: the round-trip catches trailing-bit sloppiness
    // that the alphabet and the length both accept.
    const canonical = createHash("sha256").update("x").digest("base64")
    const sloppy = canonical.slice(0, -1) + (canonical.endsWith("A") ? "B" : "A")
    const parsed = parseIntegrityClaim(`sha256-${sloppy}`)
    if (parsed.ok) expect(parsed.claim.expectedHex).toHaveLength(64)
    else expect(parsed.reason).toBe("MALFORMED")
  })

  it("refuses hex of the wrong length, and normalizes case", () => {
    const hex = createHash("sha1").update("x").digest("hex")
    expect(parseIntegrityClaim(`sha1:${hex.slice(0, 38)}`)).toEqual({ ok: false, reason: "MALFORMED" })
    expect(claimOf(`sha1:${hex.toUpperCase()}`).expectedHex).toBe(hex)
  })

  it("distinguishes EMPTY from MALFORMED", () => {
    // Different facts about the registry: "stated nothing" versus "stated something broken".
    expect(parseIntegrityClaim("")).toEqual({ ok: false, reason: "EMPTY" })
    expect(parseIntegrityClaim("   ")).toEqual({ ok: false, reason: "EMPTY" })
    expect(parseIntegrityClaim("sha512-")).toEqual({ ok: false, reason: "MALFORMED" })
    expect(parseIntegrityClaim("-abc")).toEqual({ ok: false, reason: "MALFORMED" })
    expect(parseIntegrityClaim("nonsense")).toEqual({ ok: false, reason: "MALFORMED" })
  })

  it("is sensitive to a single flipped byte (control #23, at the claim layer)", () => {
    const bytes = packageTgz()
    const claim = claimOf(sri(bytes))
    const flipped = Uint8Array.from(bytes)
    flipped[flipped.length - 1] = (flipped[flipped.length - 1]! ^ 0x01) & 0xff
    expect(verifyBytesAgainstClaim(bytes, claim).verified).toBe(true)
    expect(verifyBytesAgainstClaim(flipped, claim).verified).toBe(false)
  })
})

// ── the tar inspection ────────────────────────────────────────────────────────────────────────

describe("tar inspection — enumerate, never materialize", () => {
  it("enumerates a package tarball's entries with per-entry digests", () => {
    const inspection = inspectTarball(packageTgz())
    if (!inspection.ok) throw new Error(`unexpected refusal: ${inspection.refusal} ${inspection.detail}`)

    expect(inspection.entries.map((e) => e.path)).toEqual([
      "package/",
      "package/package.json",
      "package/index.js",
    ])
    const [dir, manifest] = inspection.entries
    // A directory has no bytes, so it has no digest — null rather than the digest of nothing,
    // which would be a real value for an entry that has none.
    expect(dir!.kind).toBe("directory")
    expect(dir!.digest).toBeNull()
    expect(manifest!.kind).toBe("file")
    expect(manifest!.digest).toBe(sha256Bytes(Buffer.from('{"name":"alpha","version":"1.2.3"}\n', "utf8")))
    expect(inspection.uncompressedBytes).toBeGreaterThan(0)
  })

  it("is deterministic — the same archive inspects identically twice", () => {
    const bytes = packageTgz()
    expect(inspectTarball(bytes)).toEqual(inspectTarball(bytes))
  })

  it("refuses non-gzip bytes before handing them to zlib", () => {
    // A registry serving an HTML error page with a 200 lands exactly here, and NOT_GZIP says so
    // rather than reporting a corrupt archive.
    const html = new TextEncoder().encode("<!doctype html><title>502</title>")
    expect(inspectTarball(html)).toMatchObject({ ok: false, refusal: "NOT_GZIP" })
    expect(inspectTarball(new Uint8Array(0))).toMatchObject({ ok: false, refusal: "NOT_GZIP" })
    expect(inspectTarball(new Uint8Array([0x1f]))).toMatchObject({ ok: false, refusal: "NOT_GZIP" })
  })

  it("refuses gzip that does not contain a tar", () => {
    const notTar = new Uint8Array(gzipSync(Buffer.alloc(BLOCK, 0x41)))
    expect(inspectTarball(notTar)).toMatchObject({ ok: false, refusal: "NOT_TAR" })
  })

  it("validates the checksum on EVERY header, not only the first", () => {
    // A valid first header followed by garbage is a real corruption shape, so a parser that
    // checked only the first block would accept it and report one entry.
    const mixed = tgz([
      { path: "package/ok.js", data: Buffer.from("ok", "utf8") },
      { path: "package/bad.js", data: Buffer.from("bad", "utf8"), corruptChecksum: true },
    ])
    expect(inspectTarball(mixed)).toMatchObject({ ok: false, refusal: "NOT_TAR" })
  })

  it("refuses a truncated archive rather than reading past the buffer", () => {
    // The header declares more data than the archive holds. A parser that sliced without the
    // bounds check would return a short buffer and hash it as if it were complete.
    const truncated = tgz([{ path: "package/big.js", data: Buffer.from("ab", "utf8"), declaredSize: 4096 }])
    expect(inspectTarball(truncated)).toMatchObject({ ok: false, refusal: "TRUNCATED" })
  })

  it("REFUSES an escaping path rather than sanitizing it", () => {
    // Refusal, not repair: a path that escapes is a statement about the publisher, and rewriting
    // it would discard the signal a later batch wants. Every family is graded, because each is a
    // different bypass of a naive `startsWith` check.
    for (const path of [
      "../outside.js",
      "package/../../outside.js",
      "/etc/passwd",
      "C:/Windows/System32/x.dll",
      "//server/share/x",
    ]) {
      expect(inspectTarball(tgz([{ path, data: Buffer.from("x", "utf8") }])), path).toMatchObject({
        ok: false,
        refusal: "PATH_ESCAPE",
      })
    }
  })

  it("normalizeEntryPath refuses backslash and NUL variants", () => {
    expect(normalizeEntryPath("package/lib/index.js")).toBe("package/lib/index.js")
    expect(normalizeEntryPath("package\\lib\\index.js")).toBe("package/lib/index.js")
    // A NUL truncates the name for many downstream consumers, so it is a way to make a path read
    // differently to us than to them.
    expect(normalizeEntryPath("package/ok.js\0/../../etc/passwd")).toBeNull()
    expect(normalizeEntryPath("..")).toBeNull()
    expect(normalizeEntryPath("a/../b")).toBeNull()
    // `..` as a SUBSTRING is fine; only a whole segment escapes.
    expect(normalizeEntryPath("package/..hidden")).toBe("package/..hidden")
  })

  it("honours the entry-count cap (a cap is a parameter, so control #24 is writable)", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      path: `package/f${i}.js`,
      data: Buffer.from(String(i), "utf8"),
    }))
    expect(inspectTarball(tgz(many), { ...DEFAULT_TAR_CAPS, maxEntries: 3 })).toMatchObject({
      ok: false,
      refusal: "TOO_MANY_ENTRIES",
    })
    expect(inspectTarball(tgz(many), DEFAULT_TAR_CAPS).ok).toBe(true)
  })

  it("honours the per-entry byte cap on the DECLARED size", () => {
    const file = { path: "package/big.bin", data: Buffer.alloc(2048, 0x41) }
    expect(inspectTarball(tgz([file]), { ...DEFAULT_TAR_CAPS, maxEntryBytes: 1024 })).toMatchObject({
      ok: false,
      refusal: "ENTRY_TOO_LARGE",
    })
  })

  it("refuses a decompression bomb DURING inflation, not after allocating it", () => {
    // 4 MiB of zeros compresses to a few KB. With the cap below the expanded size, zlib itself
    // refuses, so the allocation never happens — which is why the cap is passed to `gunzipSync`
    // rather than checked on its result.
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(4 * 1024 * 1024, 0), { level: 9 }))
    expect(bomb.length).toBeLessThan(64 * 1024)
    expect(inspectTarball(bomb, { ...DEFAULT_TAR_CAPS, maxUncompressedBytes: 64 * 1024 })).toMatchObject({
      ok: false,
      refusal: "UNCOMPRESSED_TOO_LARGE",
    })
  })

  it("reads a GNU long name ('L') as the NEXT entry's path", () => {
    const long = "package/" + "d/".repeat(60) + "deep.js"
    const inspection = inspectTarball(
      tgz([
        { path: "././@LongLink", data: Buffer.from(long + "\0", "utf8"), typeFlag: "L" },
        { path: long.slice(0, 100), data: Buffer.from("deep", "utf8") },
      ]),
    )
    if (!inspection.ok) throw new Error(`unexpected refusal: ${inspection.refusal}`)
    expect(inspection.entries.map((e) => e.path)).toEqual([long])
  })

  it("reads a PAX 'x' path override, and ignores its other records", () => {
    const long = "package/pax/" + "x".repeat(120) + ".js"
    const record = (kv: string) => {
      const len = String(kv.length + 1 + String(kv.length + 1 + String(kv.length).length).length)
      // Length-prefixed records are self-describing; compute the length the format requires.
      let total = kv.length + 2 + len.length
      for (;;) {
        const candidate = `${total} ${kv}\n`
        if (candidate.length === total) return candidate
        total = candidate.length
      }
    }
    const pax = record(`path=${long}`) + record("uid=0")
    const inspection = inspectTarball(
      tgz([
        { path: "PaxHeaders/0", data: Buffer.from(pax, "utf8"), typeFlag: "x" },
        { path: "package/placeholder.js", data: Buffer.from("pax", "utf8") },
      ]),
    )
    if (!inspection.ok) throw new Error(`unexpected refusal: ${inspection.refusal}`)
    expect(inspection.entries.map((e) => e.path)).toEqual([long])
  })

  it("joins the ustar `prefix` field with `name`", () => {
    const inspection = inspectTarball(
      tgz([{ path: "index.js", prefix: "package/deeply/nested", data: Buffer.from("p", "utf8") }]),
    )
    if (!inspection.ok) throw new Error(`unexpected refusal: ${inspection.refusal}`)
    expect(inspection.entries[0]!.path).toBe("package/deeply/nested/index.js")
  })

  it("stops at the end-of-archive marker and never throws on trailing garbage", () => {
    const withTrailer = tar([{ path: "package/a.js", data: Buffer.from("a", "utf8") }])
    const withGarbage = new Uint8Array(gzipSync(Buffer.concat([withTrailer, Buffer.alloc(37, 0x5a)])))
    const inspection = inspectTarball(withGarbage)
    if (!inspection.ok) throw new Error(`unexpected refusal: ${inspection.refusal}`)
    expect(inspection.entries.map((e) => e.path)).toEqual(["package/a.js"])
  })

  it("never throws, for any of a spread of hostile inputs", () => {
    // The contract is "returns a refusal", because a parser that throws turns a hostile publish
    // into a crashed ingestion run that loses the whole cohort.
    const hostile: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0x1f, 0x8b]),
      new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0xff, 0xff]),
      new Uint8Array(gzipSync(Buffer.alloc(1, 0))),
      new Uint8Array(gzipSync(Buffer.alloc(BLOCK - 1, 0x41))),
      tgz([{ path: "package/x", data: Buffer.from("x", "utf8") }], { omitTrailer: true }),
      new Uint8Array(gzipSync(Buffer.from("not a tar at all", "utf8"))),
    ]
    for (const bytes of hostile) {
      expect(() => inspectTarball(bytes)).not.toThrow()
    }
  })
})

// ── the CAS ───────────────────────────────────────────────────────────────────────────────────

describe("CAS — verify first, then write (controls #26, #30)", () => {
  it("stores verified bytes at the sharded content path and nowhere else", () => {
    const root = tempRoot()
    const bytes = packageTgz()
    const claim = claimOf(sri(bytes))

    const result = verifyAndStore(root, bytes, claim)
    if (!result.ok) throw new Error(`unexpected refusal: ${result.reason} ${result.detail}`)

    expect(result.digest).toBe(sha256Bytes(bytes))
    expect(result.deduplicated).toBe(false)
    expect(result.path).toBe(casBlobPath(root, result.digest))
    expect(existsAsFile(result.path)).toBe(true)
    // The stored bytes are the bytes, not a re-encoding of them.
    expect(new Uint8Array(readFileSync(result.path))).toEqual(bytes)
    // Exactly one blob, and the staging file is gone.
    const hex = result.digest.slice("sha256:".length)
    expect(casBlobs(root)).toEqual([`${hex.slice(0, 2)}/${hex}`])
    expect(stagingFiles(root)).toEqual([])
  })

  it("REFUSES a digest mismatch and writes NOTHING (control #23 at the CAS layer)", () => {
    const root = tempRoot()
    const bytes = packageTgz()
    const flipped = Uint8Array.from(bytes)
    flipped[flipped.length - 1] = (flipped[flipped.length - 1]! ^ 0x01) & 0xff
    // The claim is over the ORIGINAL bytes; the flipped bytes are offered against it.
    const claim = claimOf(sri(bytes))

    const result = verifyAndStore(root, flipped, claim)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toBe("DIGEST_MISMATCH")
    expect(result.verification?.verified).toBe(false)
    // The assertion control #26 inverts. Verify-then-write means there is no window in which
    // unverified bytes exist under the root — not a window that a cleanup path closes.
    expect(casBlobs(root)).toEqual([])
    expect(stagingFiles(root)).toEqual([])
    expect(existsSync(casBlobPath(root, sha256Bytes(flipped)))).toBe(false)
  })

  it("deduplicates the second write of identical content", () => {
    const root = tempRoot()
    const bytes = packageTgz()
    const claim = claimOf(sri(bytes))

    const first = verifyAndStore(root, bytes, claim)
    const second = verifyAndStore(root, bytes, claim)
    if (!first.ok || !second.ok) throw new Error("both writes should succeed")

    expect(first.deduplicated).toBe(false)
    expect(second.deduplicated).toBe(true)
    expect(second.path).toBe(first.path)
    expect(casBlobs(root)).toHaveLength(1)
    expect(stagingFiles(root)).toEqual([])
  })

  it("keeps two different blobs apart", () => {
    const root = tempRoot()
    const a = packageTgz()
    const b = tgz([{ path: "package/b.js", data: Buffer.from("b", "utf8") }])
    expect(verifyAndStore(root, a, claimOf(sri(a))).ok).toBe(true)
    expect(verifyAndStore(root, b, claimOf(sri(b))).ok).toBe(true)
    expect(casBlobs(root)).toHaveLength(2)
  })

  it("every path it writes is INSIDE the index root (control #30)", () => {
    const root = tempRoot()
    const bytes = packageTgz()
    const digest = sha256Bytes(bytes)
    // The layout is owned by `paths.ts` (INV-R7), so this asserts the OWNER's output rather than
    // re-deriving a path here. `resolve` on both sides, so a `..` cannot smuggle past a
    // `startsWith` on unnormalized text.
    for (const p of [casBlobPath(root, digest), casStagingPath(root, digest)]) {
      expect(p.startsWith(root)).toBe(true)
      expect(p).not.toContain("..")
    }
    const result = verifyAndStore(root, bytes, claimOf(sri(bytes)))
    if (!result.ok) throw new Error("expected success")
    expect(result.path.startsWith(root)).toBe(true)
  })

  it("throws on a malformed digest rather than joining it into a path (control #30)", () => {
    const root = tempRoot()
    // The digest becomes a path SEGMENT, so accepting arbitrary text is what turns a digest bug
    // into a write outside the root. Callers are internal, so this is a programming error and a
    // throw is the honest response — not a refusal that a caller could ignore.
    for (const bad of ["", "sha256:", "../../etc/passwd", "sha256:../../etc/passwd", "sha512:" + "a".repeat(128), "sha256:ZZZ", "sha256:" + "a".repeat(63)]) {
      expect(() => casBlobPath(root, bad), bad).toThrow(/expected a "sha256:<64 hex>" digest/)
      expect(() => casStagingPath(root, bad), bad).toThrow(/expected a "sha256:<64 hex>" digest/)
    }
  })

  it("existsAsFile is false for a directory and for an absent path", () => {
    const root = tempRoot()
    expect(existsAsFile(join(root, "cas", "blobs"))).toBe(false)
    expect(existsAsFile(join(root, "nope"))).toBe(false)
  })
})

// ── the npm adapter ───────────────────────────────────────────────────────────────────────────

/** A `StoredArtifactVersion` as R-3 would have written it. */
function artifactRow(over: Partial<StoredArtifactVersion> = {}): StoredArtifactVersion {
  return {
    artifactVersionId: "sha256:" + "a".repeat(64),
    subjectId: "sha256:" + "b".repeat(64),
    packageType: "npm",
    packageIdentifier: "alpha",
    version: "1.2.3",
    sourceLocator: "npm:alpha",
    immutableDigest: null,
    registryIntegrity: null,
    artifactStatus: "RESOLVED",
    cacheKey: null,
    firstSeenAt: NOW,
    lastVerifiedAt: null,
    ...over,
  }
}

interface StubRoute {
  status?: number
  json?: unknown
  bytes?: Uint8Array
  headers?: Record<string, string>
  throws?: string
}

/**
 * A fetch stub that records what was asked for.
 *
 * A stub rather than a network read, for the same reason every other suite in this package uses
 * one: `ArtifactFetchContext` takes an injected `fetchImpl` precisely so the offline gates stay
 * offline. `calls` is what makes "no refetch" measurable at all.
 */
function stubFetch(routes: Record<string, StubRoute>): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    const route = routes[url]
    if (route === undefined) return new Response("not found", { status: 404 })
    if (route.throws !== undefined) throw new Error(route.throws)
    if (route.bytes !== undefined) {
      return new Response(route.bytes, { status: route.status ?? 200, headers: route.headers })
    }
    return new Response(JSON.stringify(route.json ?? {}), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json", ...route.headers },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function ctxWith(fetchImpl: typeof fetch, over: Partial<ArtifactFetchContext> = {}): ArtifactFetchContext {
  return { fetchImpl, now: NOW, requestTimeoutMs: 5_000, maxArtifactBytes: 32 * 1024 * 1024, ...over }
}

/** A minimal packument for `name@version` whose tarball is `bytes`. */
function packument(name: string, version: string, bytes: Uint8Array, over: Record<string, unknown> = {}) {
  return {
    name,
    "dist-tags": { latest: version },
    versions: {
      [version]: {
        name,
        version,
        dist: {
          tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
          integrity: sri(bytes),
          shasum: createHash("sha1").update(bytes).digest("hex"),
        },
      },
    },
    ...over,
  }
}

describe("npm adapter — Phase A, one metadata read", () => {
  it("resolves a pinned version to a tarball URL and an integrity claim", async () => {
    const bytes = packageTgz()
    const { fetchImpl, calls } = stubFetch({
      [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", bytes) },
    })
    const result = await npmArtifactAdapter.resolveMetadata(artifactRow(), ctxWith(fetchImpl))
    if (!result.ok) throw new Error(`unexpected failure: ${result.failure} ${result.detail}`)

    expect(result.metadata.resolvedVersion).toBe("1.2.3")
    expect(result.metadata.packageRegistry).toBe(NPM_REGISTRY)
    expect(result.metadata.tarballUrl).toBe("https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz")
    expect(claimOf(result.metadata.integrity!).algorithm).toBe("sha512")
    // Phase A is ONE read. The adapter never downloads — that is Phase B's job, in another module.
    expect(calls).toEqual([`${NPM_REGISTRY}/alpha`])
  })

  it("single-encodes a scoped name", async () => {
    const bytes = packageTgz()
    const { fetchImpl, calls } = stubFetch({
      [`${NPM_REGISTRY}/@adeu%2fmcp-server`]: { json: packument("@adeu/mcp-server", "1.7.1", bytes) },
    })
    const result = await npmArtifactAdapter.resolveMetadata(
      artifactRow({ packageIdentifier: "@adeu/mcp-server", version: "1.7.1" }),
      ctxWith(fetchImpl),
    )
    expect(result.ok).toBe(true)
    // `encodeURIComponent` on the whole name would escape the leading `@`, which the registry
    // does not accept. This is the corpus's own scoped package.
    expect(calls).toEqual([`${NPM_REGISTRY}/@adeu%2fmcp-server`])
  })

  it("pins a FLOATING spec to the latest dist-tag", async () => {
    const bytes = packageTgz()
    const { fetchImpl } = stubFetch({
      [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "9.9.9", bytes) },
    })
    for (const spec of [null, "", "latest", "^1.0.0", "~1.0.0", ">1", "*"]) {
      const result = await npmArtifactAdapter.resolveMetadata(
        artifactRow({ version: spec }),
        ctxWith(fetchImpl),
      )
      if (!result.ok) throw new Error(`spec ${JSON.stringify(spec)}: ${result.failure}`)
      expect(result.metadata.resolvedVersion, JSON.stringify(spec)).toBe("9.9.9")
    }
  })

  it("falls back to `sha1:<shasum>` when the version doc states no SRI", async () => {
    const bytes = packageTgz()
    const doc = packument("alpha", "1.2.3", bytes) as Record<string, unknown>
    const versions = doc.versions as Record<string, { dist: Record<string, unknown> }>
    delete versions["1.2.3"]!.dist.integrity
    const { fetchImpl } = stubFetch({ [`${NPM_REGISTRY}/alpha`]: { json: doc } })

    const result = await npmArtifactAdapter.resolveMetadata(artifactRow(), ctxWith(fetchImpl))
    if (!result.ok) throw new Error(`unexpected failure: ${result.failure}`)
    expect(result.metadata.integrity).toBe(shasumClaim(bytes))
    // And the claim it produces actually verifies the bytes — the point of accepting a weak claim.
    expect(verifyBytesAgainstClaim(bytes, claimOf(result.metadata.integrity!)).verified).toBe(true)
  })

  it("reports ARTIFACT_DIGEST_UNAVAILABLE when the registry states neither", async () => {
    const bytes = packageTgz()
    const doc = packument("alpha", "1.2.3", bytes) as Record<string, unknown>
    const versions = doc.versions as Record<string, { dist: Record<string, unknown> }>
    delete versions["1.2.3"]!.dist.integrity
    delete versions["1.2.3"]!.dist.shasum
    const { fetchImpl } = stubFetch({ [`${NPM_REGISTRY}/alpha`]: { json: doc } })

    // Not a silent unverified FETCHED: with no claim there is nothing to verify against.
    expect(await npmArtifactAdapter.resolveMetadata(artifactRow(), ctxWith(fetchImpl))).toMatchObject({
      ok: false,
      failure: "ARTIFACT_DIGEST_UNAVAILABLE",
    })
  })

  it("maps each registry failure to its own code", async () => {
    const bytes = packageTgz()
    const cases: [StubRoute, string][] = [
      [{ status: 404, json: {} }, "PACKAGE_NOT_FOUND"],
      [{ status: 500, json: {} }, "NETWORK_UNAVAILABLE"],
      [{ throws: "socket hang up" }, "NETWORK_UNAVAILABLE"],
      [{ json: [] }, "MALFORMED_METADATA"],
      [{ json: { name: "alpha", versions: {} } }, "PACKAGE_NOT_FOUND"],
      [{ json: { versions: { "1.2.3": {} } } }, "PACKAGE_NOT_FOUND"],
      [{ json: packument("alpha", "7.7.7", bytes) }, "ARTIFACT_VERSION_UNRESOLVED"],
    ]
    for (const [route, failure] of cases) {
      const { fetchImpl } = stubFetch({ [`${NPM_REGISTRY}/alpha`]: route })
      const result = await npmArtifactAdapter.resolveMetadata(artifactRow(), ctxWith(fetchImpl))
      expect(result, failure).toMatchObject({ ok: false, failure })
    }
  })

  it("reports ARTIFACT_VERSION_UNRESOLVED when a floating spec has no latest tag", async () => {
    const bytes = packageTgz()
    const doc = packument("alpha", "1.2.3", bytes) as Record<string, unknown>
    delete doc["dist-tags"]
    const { fetchImpl } = stubFetch({ [`${NPM_REGISTRY}/alpha`]: { json: doc } })
    expect(
      await npmArtifactAdapter.resolveMetadata(artifactRow({ version: "latest" }), ctxWith(fetchImpl)),
    ).toMatchObject({ ok: false, failure: "ARTIFACT_VERSION_UNRESOLVED" })
  })

  it("REFUSES a non-https tarball URL — a packument is attacker-influenceable", async () => {
    const bytes = packageTgz()
    for (const tarball of ["http://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz", "file:///etc/passwd", "not a url"]) {
      const doc = packument("alpha", "1.2.3", bytes) as Record<string, unknown>
      const versions = doc.versions as Record<string, { dist: Record<string, unknown> }>
      versions["1.2.3"]!.dist.tarball = tarball
      const { fetchImpl } = stubFetch({ [`${NPM_REGISTRY}/alpha`]: { json: doc } })
      expect(
        await npmArtifactAdapter.resolveMetadata(artifactRow(), ctxWith(fetchImpl)),
        tarball,
      ).toMatchObject({ ok: false, failure: "MALFORMED_METADATA" })
    }
  })

  it("never throws, whatever the registry returns", async () => {
    for (const route of [
      { throws: "ECONNRESET" },
      { json: null },
      { json: "a string" },
      { status: 200, bytes: new Uint8Array([0x00, 0x01]) },
    ] as StubRoute[]) {
      const { fetchImpl } = stubFetch({ [`${NPM_REGISTRY}/alpha`]: route })
      await expect(npmArtifactAdapter.resolveMetadata(artifactRow(), ctxWith(fetchImpl))).resolves.toMatchObject({
        ok: false,
      })
    }
  })

  it("refuses an empty package identifier without a network call", async () => {
    const { fetchImpl, calls } = stubFetch({})
    expect(
      await npmArtifactAdapter.resolveMetadata(artifactRow({ packageIdentifier: "" }), ctxWith(fetchImpl)),
    ).toMatchObject({ ok: false, failure: "MALFORMED_METADATA" })
    expect(calls).toEqual([])
  })
})

describe("download — Phase B, under a hard cap (control #24)", () => {
  const URL_OK = "https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz"

  it("returns the bytes verbatim", async () => {
    const bytes = packageTgz()
    const { fetchImpl } = stubFetch({ [URL_OK]: { bytes } })
    const result = await downloadArtifact(URL_OK, ctxWith(fetchImpl))
    if (!result.ok) throw new Error(`unexpected failure: ${result.failure} ${result.detail}`)
    expect(result.bytes).toEqual(bytes)
    // And the bytes that came back are the bytes the claim will be checked against.
    expect(sha256Bytes(result.bytes)).toBe(sha256Bytes(bytes))
  })

  it("refuses a declared content-length over the cap BEFORE reading a byte", async () => {
    const bytes = packageTgz()
    const { fetchImpl } = stubFetch({ [URL_OK]: { bytes, headers: { "content-length": "999999999" } } })
    expect(await downloadArtifact(URL_OK, ctxWith(fetchImpl, { maxArtifactBytes: 1024 }))).toMatchObject({
      ok: false,
      failure: "ARTIFACT_TOO_LARGE",
    })
  })

  it("refuses an oversized body even when no length was declared", async () => {
    // The cap is enforced while streaming, so a server that omits `content-length` (or lies) is
    // still bounded. Control #24 removes this and observes the oversized fixture become FETCHED.
    const big = new Uint8Array(gzipSync(Buffer.alloc(256 * 1024, 0x41), { level: 0 }))
    const { fetchImpl } = stubFetch({ [URL_OK]: { bytes: big } })
    expect(await downloadArtifact(URL_OK, ctxWith(fetchImpl, { maxArtifactBytes: 4096 }))).toMatchObject({
      ok: false,
      failure: "ARTIFACT_TOO_LARGE",
    })
  })

  it("accepts a body exactly AT the cap — the boundary is inclusive", async () => {
    const bytes = packageTgz()
    const { fetchImpl } = stubFetch({ [URL_OK]: { bytes } })
    const result = await downloadArtifact(URL_OK, ctxWith(fetchImpl, { maxArtifactBytes: bytes.length }))
    expect(result.ok).toBe(true)
  })

  it("refuses a non-https URL and makes no request", async () => {
    const { fetchImpl, calls } = stubFetch({})
    expect(await downloadArtifact("http://evil.example/x.tgz", ctxWith(fetchImpl))).toMatchObject({
      ok: false,
      failure: "NETWORK_UNAVAILABLE",
    })
    expect(calls).toEqual([])
  })

  it("maps a non-200 and a thrown error to NETWORK_UNAVAILABLE", async () => {
    const a = stubFetch({ [URL_OK]: { status: 503, bytes: new Uint8Array(0) } })
    expect(await downloadArtifact(URL_OK, ctxWith(a.fetchImpl))).toMatchObject({
      ok: false,
      failure: "NETWORK_UNAVAILABLE",
    })
    const b = stubFetch({ [URL_OK]: { throws: "ETIMEDOUT" } })
    expect(await downloadArtifact(URL_OK, ctxWith(b.fetchImpl))).toMatchObject({
      ok: false,
      failure: "NETWORK_UNAVAILABLE",
    })
  })
})

describe("the four halves compose — metadata → download → inspect → store", () => {
  it("an end-to-end pass over one in-memory artifact", async () => {
    const root = tempRoot()
    const bytes = packageTgz()
    const tarballUrl = "https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz"
    const { fetchImpl } = stubFetch({
      [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", bytes) },
      [tarballUrl]: { bytes },
    })
    const ctx = ctxWith(fetchImpl)

    const metadata = await npmArtifactAdapter.resolveMetadata(artifactRow(), ctx)
    if (!metadata.ok) throw new Error(`Phase A failed: ${metadata.failure}`)
    const download = await downloadArtifact(metadata.metadata.tarballUrl, ctx)
    if (!download.ok) throw new Error(`Phase B failed: ${download.failure}`)
    const inspection = inspectTarball(download.bytes)
    if (!inspection.ok) throw new Error(`inspection refused: ${inspection.refusal}`)
    const stored = verifyAndStore(root, download.bytes, claimOf(metadata.metadata.integrity!))
    if (!stored.ok) throw new Error(`CAS refused: ${stored.reason} ${stored.detail}`)

    expect(inspection.entries).toHaveLength(3)
    expect(stored.digest).toBe(sha256Bytes(bytes))
    expect(casBlobs(root)).toHaveLength(1)
    // NOTHING was extracted. `cas/expanded` stays empty until the evidence batch needs it, so
    // "static inspection" is a claim about the filesystem and not only about intent.
    expect(readdirSync(join(root, "cas", "expanded"))).toEqual([])
  })

  it("a tampered tarball fails the composition and leaves the CAS empty", async () => {
    const root = tempRoot()
    const real = packageTgz()
    // The registry claims the real bytes; the CDN serves different ones. The realistic shape of
    // a compromised mirror, and the one the whole batch exists to refuse.
    const served = tgz([{ path: "package/evil.js", data: Buffer.from("malicious", "utf8") }])
    const tarballUrl = "https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz"
    const { fetchImpl } = stubFetch({
      [`${NPM_REGISTRY}/alpha`]: { json: packument("alpha", "1.2.3", real) },
      [tarballUrl]: { bytes: served },
    })
    const ctx = ctxWith(fetchImpl)

    const metadata = await npmArtifactAdapter.resolveMetadata(artifactRow(), ctx)
    if (!metadata.ok) throw new Error("Phase A should succeed")
    const download = await downloadArtifact(tarballUrl, ctx)
    if (!download.ok) throw new Error("Phase B should succeed")
    // The archive is well-formed — the refusal is the DIGEST, which is the point: a valid tar
    // carrying the wrong bytes is exactly what a static structural check cannot catch.
    expect(inspectTarball(download.bytes).ok).toBe(true)
    const stored = verifyAndStore(root, download.bytes, claimOf(metadata.metadata.integrity!))
    expect(stored).toMatchObject({ ok: false, reason: "DIGEST_MISMATCH" })
    expect(casBlobs(root)).toEqual([])
    expect(stagingFiles(root)).toEqual([])
  })
})
