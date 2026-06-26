import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { DocumentSurface, DocumentSurfaceKind } from "@calllint/types"

/** Max bytes scanned per surface file; larger files are truncated (ADR 0015). */
export const SURFACE_SIZE_CAP = 256 * 1024

/**
 * The fixed, named allowlist of document surfaces. No globbing, no recursion, no
 * symlink following — only these exact files directly under the surface dir.
 */
const SURFACE_FILES: { file: string; kind: DocumentSurfaceKind }[] = [
  { file: "README.md", kind: "readme" },
  { file: "SKILL.md", kind: "skill" },
  { file: "AGENTS.md", kind: "agents" },
]

function readCapped(path: string): { text: string; truncated: boolean } | undefined {
  try {
    const st = statSync(path)
    if (!st.isFile()) return undefined
    const raw = readFileSync(path, "utf8")
    if (raw.length > SURFACE_SIZE_CAP) {
      return { text: raw.slice(0, SURFACE_SIZE_CAP), truncated: true }
    }
    return { text: raw, truncated: false }
  } catch {
    return undefined
  }
}

/**
 * Read the allowlisted document surfaces from `dir`, offline and bounded (ADR
 * 0015). Returns only the files that exist; a missing dir or missing files is not
 * an error (returns fewer/zero surfaces). Reads `package.json` for its
 * `description` string only — never executes it.
 */
export function readDocumentSurfaces(dir: string): DocumentSurface[] {
  const surfaces: DocumentSurface[] = []
  if (!existsSync(dir)) return surfaces

  for (const { file, kind } of SURFACE_FILES) {
    const got = readCapped(join(dir, file))
    if (got) surfaces.push({ path: file, kind, text: got.text, truncated: got.truncated })
  }

  // package.json: scan the `description` field only (parsed as JSON, not executed).
  const pkgPath = join(dir, "package.json")
  const pkgRaw = readCapped(pkgPath)
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw.text) as unknown
      const description =
        pkg && typeof pkg === "object" && !Array.isArray(pkg)
          ? (pkg as Record<string, unknown>).description
          : undefined
      if (typeof description === "string") {
        surfaces.push({
          path: "package.json",
          kind: "package-description",
          text: description,
          truncated: pkgRaw.truncated,
        })
      }
    } catch {
      // A malformed package.json is not a surface error; skip it.
    }
  }

  return surfaces
}
