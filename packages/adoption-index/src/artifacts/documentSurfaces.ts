/**
 * documentSurfaces — select the allowlisted document surfaces out of a verified tarball.
 *
 * This is the SECOND caller of an existing pure seam, not a new analysis. `analyzeDocumentSurfaces`
 * (`packages/static-analyzer/src/documentSurface.ts:27`) takes `readonly DocumentSurface[]` and its
 * docblock already states the contract this file satisfies: "The core never reads files — the CLI
 * reads the allowlisted surfaces (bounded, offline) and hands their text here, keeping this
 * analysis pure and deterministic." R-5 substitutes "reads from a verified CAS blob" for "reads
 * from disk" and changes nothing else: same detectors, same `promptScan.js` scanners, same finding
 * ids.
 *
 * WHY NOT SYNTHESIZE A CONFIG AND CALL `scanServer`. `scanServer` consumes a
 * `NormalizedMcpServer` — a CONFIGURATION — and R-5 holds BYTES. Of `RuntimeBinding`'s eleven
 * fields, exactly one (`packageName`) is answerable from a tarball; the other ten describe how some
 * host was configured to launch the server, which is not in the archive. Fabricating them would
 * feed an INFERENCE to a function and then record its output as an OBSERVATION — the
 * Observed/Inferred fusion principle 8 and ADR 0061 both forbid. So R-5 stops at the seam that is
 * genuinely byte-shaped and records what it actually saw.
 *
 * THE ALLOWLIST IS THE CLI'S, deliberately restated rather than imported: `apps/cli/src/commands/
 * surfaces.ts` is an application entry point that a private library must not depend on (and its
 * `readDocumentSurfaces` reads the filesystem, which is the one capability this path must not
 * have). What IS shared is the thing that would matter if it drifted — the cap and the kinds come
 * from the same `@calllint/types` vocabulary, and `SURFACE_SIZE_CAP`'s value is asserted equal to
 * the CLI's by test, so a change on either side is a failure rather than a silent divergence.
 */
import type { DocumentSurface, DocumentSurfaceKind } from "@calllint/types"
import { DEFAULT_TAR_CAPS, inspectTarball, type TarEntry, type TarInspectCaps, type TarInspection } from "./tarInspect.js"

/**
 * Max bytes decoded per surface. Equal to the CLI's `SURFACE_SIZE_CAP` (ADR 0015), asserted by
 * test rather than imported — see the module docblock.
 */
export const SURFACE_SIZE_CAP = 256 * 1024

/**
 * The fixed, named allowlist. No globbing, no recursion, no nested directories: a `README.md` at
 * the archive root is a surface, a `docs/vendor/README.md` is not. Matching by exact basename after
 * one optional leading directory is what npm's own layout requires — every entry in an npm tarball
 * is under `package/` — and admitting deeper paths would let a publisher place a payload where a
 * human reader would never look for it while still having it scanned as if it were the front page.
 */
const SURFACE_FILES: readonly { readonly file: string; readonly kind: DocumentSurfaceKind }[] = Object.freeze([
  { file: "README.md", kind: "readme" },
  { file: "SKILL.md", kind: "skill" },
  { file: "AGENTS.md", kind: "agents" },
])

/** Result of walking one archive for its document surfaces. */
export interface SurfaceExtraction {
  /** The inspection itself — refusals propagate verbatim, so a bad archive stays one outcome. */
  readonly inspection: TarInspection
  /** Allowlisted surfaces found, ordered by the allowlist then `package.json`. Empty is normal. */
  readonly surfaces: readonly DocumentSurface[]
}

/**
 * Strip one leading directory segment, which is how npm packs (`package/README.md`).
 *
 * Returns null when the path has no directory at all AND is not a bare surface name, or when it
 * nests deeper than one level. Exactly one level is stripped, never more: `package/a/README.md`
 * yields `a/README.md`, which matches no allowlist entry and is therefore ignored.
 */
function surfaceRelativePath(entryPath: string): string | null {
  const slash = entryPath.indexOf("/")
  if (slash === -1) return entryPath
  const rest = entryPath.slice(slash + 1)
  return rest.length === 0 ? null : rest
}

/** Decode as UTF-8, capped. `truncated` reports whether anything was cut. */
function decodeCapped(bytes: Uint8Array): { text: string; truncated: boolean } {
  const truncated = bytes.length > SURFACE_SIZE_CAP
  const slice = truncated ? bytes.subarray(0, SURFACE_SIZE_CAP) : bytes
  // A copy, not the view: `data` handed to a `TarEntryVisitor` is a subarray of the decompressed
  // buffer and is only valid during the call (see `TarEntryVisitor`'s docblock).
  return { text: Buffer.from(slice).toString("utf8"), truncated }
}

/**
 * Inspect `gzipped` once, collecting both the full entry inventory and the allowlisted surfaces.
 *
 * ONE pass, because the inventory is what `observationDigest` covers and the surfaces are what the
 * detectors read — deriving them from two separate decompressions would allow the digest to
 * describe bytes the findings did not come from.
 */
export function extractDocumentSurfaces(
  gzipped: Uint8Array,
  caps: TarInspectCaps = DEFAULT_TAR_CAPS,
): SurfaceExtraction {
  const found = new Map<string, DocumentSurface>()
  // A Map rather than a `let … | null`, for the same reason `found` is one: a variable assigned only
  // inside the visitor stays narrowed to its initializer at every use after the call, because
  // TypeScript does not reset narrowing for assignments it cannot prove ran. `Map.get` returns
  // `T | undefined` unconditionally, so the "was a manifest seen" question is answered by the data
  // structure instead of by a cast that would also silence a real mistake.
  const manifest = new Map<string, { text: string; truncated: boolean }>()

  const inspection = inspectTarball(gzipped, caps, (entry: TarEntry, data: Uint8Array) => {
    const rel = surfaceRelativePath(entry.path)
    if (rel === null) return

    for (const { file, kind } of SURFACE_FILES) {
      // Case-sensitive: `readme.md` is not `README.md`. The CLI matches by exact name too, and a
      // case-insensitive match here would make the two paths disagree about the same archive.
      if (rel === file && !found.has(file)) {
        const got = decodeCapped(data)
        found.set(file, { path: file, kind, text: got.text, truncated: got.truncated })
        return
      }
    }
    if (rel === "package.json" && !manifest.has(rel)) manifest.set(rel, decodeCapped(data))
  })

  // A refused archive contributes NO surfaces, even ones read before the refusal. `inspectTarball`
  // refuses an archive as a whole — a path escape or an oversized entry is a statement about the
  // publisher — and scanning the readable prefix of a refused archive would report findings from
  // bytes the pipeline declined to accept.
  if (!inspection.ok) return { inspection, surfaces: [] }

  const surfaces: DocumentSurface[] = []
  for (const { file } of SURFACE_FILES) {
    const got = found.get(file)
    if (got) surfaces.push(got)
  }
  const packageJson = manifest.get("package.json")
  if (packageJson !== undefined) {
    const description = parseDescription(packageJson.text)
    if (description !== null) {
      surfaces.push({
        path: "package.json",
        kind: "package-description",
        text: description,
        truncated: packageJson.truncated,
      })
    }
  }

  return { inspection, surfaces }
}

/** The `description` string of a package manifest, or null. Parsed as JSON, never executed. */
function parseDescription(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const description = (parsed as Record<string, unknown>).description
    return typeof description === "string" ? description : null
  } catch {
    // A malformed manifest is not a surface error, matching the CLI's behaviour.
    return null
  }
}
