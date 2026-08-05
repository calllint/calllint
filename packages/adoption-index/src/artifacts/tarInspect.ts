/**
 * tarInspect — read-only static inspection of a gzipped tar, in memory, with hard caps.
 *
 * "Static" is the whole point: this module enumerates and hashes what an archive CONTAINS and
 * never materializes it. Nothing is written to any filesystem location — `cas/expanded/` stays
 * empty until the evidence batch needs it — and nothing in the archive is executed, which is
 * ADR 0061 §2's line. The enforcement of that line is dependency absence, so this is a hand
 * written header parser over `node:zlib`: adding `tar` or `pacote` would put an extraction
 * engine (symlink following, mode bits, `preinstall` awareness) one import away from a batch
 * that must never extract anything.
 *
 * It is a parser, so it is written to be hostile-input-safe by construction: every read is
 * bounds-checked against the buffer, every cap is checked BEFORE the allocation it bounds, and
 * every failure is a returned refusal rather than a throw. A tarball is attacker-controlled
 * bytes from a public registry; a parser that throws on malformed input would turn a hostile
 * publish into a crashed ingestion run.
 */
import { gunzipSync } from "node:zlib"
import { sha256Bytes } from "@calllint/fingerprint"

/** One 512-byte tar block. */
const BLOCK = 512

export interface TarInspectCaps {
  /** Hard ceiling on decompressed bytes. Bounds the zip-bomb ratio, checked by zlib itself. */
  maxUncompressedBytes: number
  /** Hard ceiling on entry count. */
  maxEntries: number
  /** Hard ceiling on any single entry's declared size. */
  maxEntryBytes: number
}

/**
 * Defaults sized for npm tarballs, not for arbitrary archives.
 *
 * The largest artifact in the corpus is a few hundred KB, so 64 MiB / 4096 entries is roughly
 * two orders of magnitude of headroom while still refusing anything pathological. They are
 * parameters rather than constants because control #24 removes the byte cap and must observe an
 * oversized fixture flip from `REJECTED` to `FETCHED` — a hardcoded limit would make that
 * control unwritable without editing this module's logic.
 */
export const DEFAULT_TAR_CAPS: TarInspectCaps = Object.freeze({
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
  maxEntryBytes: 32 * 1024 * 1024,
})

export interface TarEntry {
  /** Full path as recorded, `/`-separated, after any GNU/PAX long-name override. */
  path: string
  /** Declared size in bytes. For directories, 0. */
  size: number
  kind: "file" | "directory" | "other"
  /** `sha256:<hex>` of the entry's own bytes. Files only; null for directories and metadata. */
  digest: string | null
}

/**
 * Why an archive was refused.
 *
 * Every one of these is a REFUSAL of bytes we already hold, which upstream maps to `REJECTED`
 * (and never to `UNAVAILABLE`, which means we could not obtain bytes at all). The distinction
 * matters because `REJECTED` is terminal for that (artifact, claim) pair.
 */
export type TarRefusal =
  | "NOT_GZIP"
  | "UNCOMPRESSED_TOO_LARGE"
  | "NOT_TAR"
  | "TRUNCATED"
  | "PATH_ESCAPE"
  | "TOO_MANY_ENTRIES"
  | "ENTRY_TOO_LARGE"

export type TarInspection =
  | { readonly ok: true; readonly entries: TarEntry[]; readonly uncompressedBytes: number }
  | { readonly ok: false; readonly refusal: TarRefusal; readonly detail: string }

/**
 * Called for each accepted FILE entry, with the bytes this inspection already holds.
 *
 * R-5 needs the TEXT of a handful of allowlisted documents, and this enumeration is the one place
 * in the repo that has already decompressed, bounds-checked and path-normalized them. The
 * alternative — a second tar reader over the same bytes — would be a second parser to keep in
 * agreement about PAX headers, path escapes and octal fields, which is exactly the "two competing
 * implementations" shape the contract forbids.
 *
 * A CALLBACK rather than `entries[].content`, because the memory profile is the reason this hook
 * exists at all: returning every entry's bytes would hold a whole 64 MiB archive resident on every
 * R-4 call, while a visitor lets the caller keep only what it asked for (R-5 keeps at most four
 * surfaces, each capped). `data` is a `subarray` VIEW into the decompressed buffer and is valid
 * only during the call — a visitor that keeps it must copy, and `documentSurfaces.ts` does.
 *
 * Omitted by every existing caller, so R-4's behaviour is unchanged byte-for-byte.
 */
export type TarEntryVisitor = (entry: TarEntry, data: Uint8Array) => void

/**
 * Decompress and enumerate. Never throws, never writes, never executes.
 */
export function inspectTarball(
  gzipped: Uint8Array,
  caps: TarInspectCaps = DEFAULT_TAR_CAPS,
  visit?: TarEntryVisitor,
): TarInspection {
  // Gzip magic, checked before handing bytes to zlib so "this isn't an archive" is distinguishable
  // from "this archive is broken". A registry serving an HTML error page with a 200 lands here.
  if (gzipped.length < 2 || gzipped[0] !== 0x1f || gzipped[1] !== 0x8b) {
    return { ok: false, refusal: "NOT_GZIP", detail: "missing gzip magic 1f 8b" }
  }

  let tar: Buffer
  try {
    // `maxOutputLength` makes the cap zlib's own concern, so an expansion bomb is refused DURING
    // inflation rather than after a multi-GB allocation has already succeeded.
    tar = gunzipSync(gzipped, { maxOutputLength: caps.maxUncompressedBytes })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // zlib reports the cap breach as a buffer-size error; anything else is genuine corruption.
    if (/maxOutputLength|Buffer|memory/i.test(message)) {
      return { ok: false, refusal: "UNCOMPRESSED_TOO_LARGE", detail: `exceeds ${caps.maxUncompressedBytes} bytes` }
    }
    return { ok: false, refusal: "NOT_GZIP", detail: message }
  }

  const entries: TarEntry[] = []
  let offset = 0
  /** Pending GNU long name ('L') or PAX `path=` override, consumed by the next real header. */
  let pendingLongName: string | null = null

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (isZeroBlock(header)) break // end-of-archive marker (one is enough to stop reading)
    offset += BLOCK

    if (!hasValidChecksum(header)) {
      return { ok: false, refusal: "NOT_TAR", detail: `bad header checksum at offset ${offset - BLOCK}` }
    }

    const size = parseOctal(header, 124, 12)
    if (size === null) return { ok: false, refusal: "NOT_TAR", detail: "unparseable size field" }
    if (size > caps.maxEntryBytes) {
      return { ok: false, refusal: "ENTRY_TOO_LARGE", detail: `entry declares ${size} bytes` }
    }

    // Bounds-check BEFORE slicing: a header may declare more data than the buffer holds.
    if (offset + size > tar.length) {
      return { ok: false, refusal: "TRUNCATED", detail: `entry data runs past end of archive` }
    }
    const data = tar.subarray(offset, offset + size)
    offset += padTo512(size)

    const typeFlag = String.fromCharCode(header[156] ?? 0)

    // GNU long name: this block's DATA is the next entry's path.
    if (typeFlag === "L") {
      pendingLongName = trimNul(data.toString("utf8"))
      continue
    }
    // PAX extended header: a keyword-length record set; only `path` affects enumeration.
    if (typeFlag === "x" || typeFlag === "X") {
      pendingLongName = paxPath(data.toString("utf8")) ?? pendingLongName
      continue
    }
    // GNU long link name and PAX global headers carry nothing this inspection reports on.
    if (typeFlag === "K" || typeFlag === "g") continue

    const rawPath = pendingLongName ?? joinPrefixedName(header)
    pendingLongName = null
    if (rawPath.length === 0) continue

    const normalized = normalizeEntryPath(rawPath)
    if (normalized === null) {
      // Refused, not sanitized. A path that escapes is a statement about the publisher's intent,
      // and silently rewriting it would discard exactly the signal a later batch wants to see.
      return { ok: false, refusal: "PATH_ESCAPE", detail: rawPath }
    }

    if (entries.length >= caps.maxEntries) {
      return { ok: false, refusal: "TOO_MANY_ENTRIES", detail: `more than ${caps.maxEntries} entries` }
    }

    const kind = entryKind(typeFlag, normalized)
    const entry: TarEntry = {
      path: normalized,
      size,
      kind,
      digest: kind === "file" ? sha256Bytes(data) : null,
    }
    entries.push(entry)
    // AFTER the entry is accepted, so a visitor can never observe bytes from an entry this
    // inspection went on to refuse. Files only: a directory header's `data` is empty, and handing
    // a visitor an empty buffer for one would invite it to treat a directory as an empty document.
    if (visit !== undefined && kind === "file") visit(entry, data)
  }

  return { ok: true, entries, uncompressedBytes: tar.length }
}

function entryKind(typeFlag: string, path: string): TarEntry["kind"] {
  if (typeFlag === "5") return "directory"
  // A trailing slash marks a directory even when the type flag is the legacy '0'.
  if (path.endsWith("/")) return "directory"
  if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "7") return "file"
  return "other"
}

/**
 * Reject any path that could resolve outside its own extraction root.
 *
 * Returns null on refusal rather than a cleaned path. Four families are refused: absolute POSIX
 * paths, Windows drive-absolute and UNC paths, any `..` segment, and NUL-bearing paths (a NUL
 * truncates the name for many downstream consumers, so it is a way to make a path read
 * differently to us than to them).
 */
export function normalizeEntryPath(raw: string): string | null {
  if (raw.includes("\0")) return null
  const unified = raw.replace(/\\/g, "/")
  if (unified.startsWith("/")) return null
  if (/^[A-Za-z]:/.test(unified)) return null
  if (unified.startsWith("//")) return null
  const segments = unified.split("/")
  if (segments.some((s) => s === "..")) return null
  return unified
}

/** ustar splits long names across `prefix` (345) and `name` (0). */
function joinPrefixedName(header: Buffer): string {
  const name = trimNul(header.subarray(0, 100).toString("utf8"))
  const prefix = trimNul(header.subarray(345, 500).toString("utf8"))
  if (prefix.length === 0) return name
  return `${prefix}/${name}`
}

/** PAX records are `"<len> <key>=<value>\n"`, length counting the whole record. */
function paxPath(text: string): string | null {
  for (const line of text.split("\n")) {
    const space = line.indexOf(" ")
    if (space === -1) continue
    const record = line.slice(space + 1)
    const eq = record.indexOf("=")
    if (eq === -1) continue
    if (record.slice(0, eq) === "path") return record.slice(eq + 1)
  }
  return null
}

/**
 * The tar header checksum: the unsigned sum of all 512 bytes with the checksum field itself
 * read as spaces. This is what separates "a tar" from "512 arbitrary bytes", so it is checked
 * on every header rather than only the first — a valid first header followed by garbage is a
 * real corruption shape.
 */
function hasValidChecksum(header: Buffer): boolean {
  const declared = parseOctal(header, 148, 8)
  if (declared === null) return false
  let sum = 0
  for (let i = 0; i < BLOCK; i += 1) {
    sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0)
  }
  return sum === declared
}

/**
 * Parse a tar octal field. Returns null when unparseable, so the caller refuses rather than
 * proceeding on a silent NaN-to-0 coercion.
 */
function parseOctal(header: Buffer, start: number, length: number): number | null {
  const field = header.subarray(start, start + length)
  // GNU base-256 encoding for values too large for octal: high bit of the first byte set.
  if ((field[0] ?? 0) & 0x80) {
    let value = (field[0] ?? 0) & 0x7f
    for (let i = 1; i < field.length; i += 1) value = value * 256 + (field[i] ?? 0)
    return Number.isSafeInteger(value) ? value : null
  }
  const text = trimNul(field.toString("ascii")).trim()
  if (text.length === 0) return 0
  if (!/^[0-7]+$/.test(text)) return null
  const value = Number.parseInt(text, 8)
  return Number.isSafeInteger(value) ? value : null
}

function isZeroBlock(block: Buffer): boolean {
  for (let i = 0; i < block.length; i += 1) if (block[i] !== 0) return false
  return true
}

function trimNul(text: string): string {
  const nul = text.indexOf("\0")
  return nul === -1 ? text : text.slice(0, nul)
}

function padTo512(size: number): number {
  const remainder = size % BLOCK
  return remainder === 0 ? size : size + (BLOCK - remainder)
}
