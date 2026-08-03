/**
 * paths — the ONE place that decides where the adoption index persists.
 *
 * INV-R7: the compiler's entire persistence lives under `.var/calllint-adoption-index/`
 * and it writes NOTHING outside that root. The Trust Gateway remains the only writer of
 * host configuration; this store writes no host config at all.
 *
 * That invariant is only credible if a single function owns the layout, so every path
 * below is derived from `root` and `resolveIndexRoot` is the only entry point. A module
 * that joined its own path would put a write outside the audited set, and the negative
 * control for INV-R7 (control #12) would have nothing to measure.
 *
 * The directory shape is §11.1, verbatim.
 */
import { resolve } from "node:path"

/** The persistence root, relative to a repo/service working directory (INV-R7). */
export const INDEX_ROOT_DIRNAME = ".var/calllint-adoption-index"

/** The subdirectories §11.1 declares. Created eagerly so no writer has to mkdir -p. */
export const INDEX_SUBDIRS = [
  "db",
  "cas/blobs",
  "cas/expanded",
  "cas/manifests",
  "work",
  "dead-letter",
  "reports",
  "locks",
] as const

export interface IndexPaths {
  /** Absolute path of `.var/calllint-adoption-index`. */
  root: string
  /** Absolute path of the SQLite database file (§11.1 `db/adoption-index.sqlite`). */
  db: string
  /** Absolute paths of every declared subdirectory, in declaration order. */
  dirs: string[]
}

/**
 * Resolve the index layout beneath `cwd`.
 *
 * `cwd` is a parameter rather than a `process.cwd()` read so that a test can point the
 * store at a temp directory without setting a global, and so that the systemd unit in
 * R-9 can point it at a service data dir. Defaulting it here would make the temp-dir
 * test depend on process state, which is the kind of ambient coupling that makes a
 * "writes nothing outside root" assertion untestable.
 */
export function resolveIndexPaths(cwd: string): IndexPaths {
  const root = resolve(cwd, INDEX_ROOT_DIRNAME)
  return {
    root,
    db: resolve(root, "db", "adoption-index.sqlite"),
    dirs: INDEX_SUBDIRS.map((d) => resolve(root, d)),
  }
}

/**
 * True when `candidate` is inside `root`. Used by the INV-R7 assertion, and written
 * with `resolve` on both sides so a `..` segment cannot smuggle a path past a plain
 * `startsWith` on unnormalized text.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const r = resolve(root)
  const c = resolve(candidate)
  if (c === r) return true
  // Compare on a separator boundary: `/a/bc` must not count as inside `/a/b`.
  return c.startsWith(r.endsWith("\\") || r.endsWith("/") ? r : r + pathSep(r))
}

function pathSep(sample: string): string {
  return sample.includes("\\") ? "\\" : "/"
}
