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
 * The content-addressed path of one verified blob, `cas/blobs/<hex[0:2]>/<hex>`.
 *
 * It lives here, and not in the CAS writer, because INV-R7's credibility rests on a single
 * owner of the layout (see the module docblock) — a writer that joined its own path would put
 * a write outside the audited set. The two-character fan-out keeps any one directory small
 * enough that a listing stays cheap at expansion scale.
 *
 * `digest` must be this repo's `sha256:<hex>` convention. A digest in any other shape is a
 * programming error rather than bad input — the only callers are internal, and the digest they
 * pass is one `sha256Bytes` just produced — so this throws instead of returning a refusal. The
 * hex is validated because it becomes a path segment: accepting arbitrary text here is what
 * turns a digest bug into a write outside the root, which is exactly what control #30 checks.
 */
/**
 * The root of the content-addressed blob tree, `cas/blobs`.
 *
 * It exists for the same reason `casBlobPath` does: INV-R7 gives the layout ONE owner. The
 * retention sweep (`casRetention.ts`) has to enumerate the tree rather than address one blob, and
 * a sweep that joined `"cas", "blobs"` itself would be a second definition of the layout — the
 * exact drift the invariant exists to prevent. Whatever `casBlobPath` writes under, this returns.
 */
export function casBlobsRoot(root: string): string {
  return resolve(root, "cas", "blobs")
}

export function casBlobPath(root: string, digest: string): string {
  const hex = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : ""
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`casBlobPath: expected a "sha256:<64 hex>" digest, received ${JSON.stringify(digest)}`)
  }
  return resolve(root, "cas", "blobs", hex.slice(0, 2), hex)
}

/**
 * The staging path a blob is written to before it is renamed into place.
 *
 * The temp name is the digest itself: deterministic, so no clock and no `Math.random` enter the
 * store, and idempotent, so two concurrent writes of identical content cannot collide on a name
 * while carrying different bytes.
 */
export function casStagingPath(root: string, digest: string): string {
  const hex = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : ""
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`casStagingPath: expected a "sha256:<64 hex>" digest, received ${JSON.stringify(digest)}`)
  }
  return resolve(root, "work", `${hex}.part`)
}

/**
 * The root of the staging tree, `work` — the directory `casStagingPath` writes into.
 *
 * Same argument as `casBlobsRoot`: INV-R7 gives the layout ONE owner, and the ADR 0061 §8.6 orphan
 * sweep has to ENUMERATE this directory rather than address one file in it. A sweep that joined
 * `"work"` itself would be a second definition of the layout, and the first one to drift would do
 * so silently — it would simply sweep a directory nothing writes to and report `inspected 0`
 * forever, which is the failure mode §8.5 already measured for a mis-rooted CAS sweep.
 *
 * Note the asymmetry with `casBlobsRoot`: that tree is a two-character fan-out, this one is flat.
 * Callers must not assume a shared traversal shape.
 */
export function casWorkRoot(root: string): string {
  return resolve(root, "work")
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
