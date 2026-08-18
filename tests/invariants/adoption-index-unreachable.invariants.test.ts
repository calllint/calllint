/**
 * THE ADR 0061 BOUNDARY INVARIANT — `@calllint/adoption-index` is structurally unreachable
 * from every published bundle, measured over the MODULE GRAPH rather than over a manifest.
 *
 * WHY THE MANIFEST IS THE WRONG THING TO MEASURE. The obvious check — "no publishable
 * package declares adoption-index" — passes today and would keep passing after a real leak:
 *
 *   - Both bundles are built with an unqualified `bundle: true` and NO `external` list
 *     (`apps/cli/build.mjs`, `packages/calllint-mcp/build.mjs`), so esbuild INLINES every
 *     reachable module. Runtime `dependencies` stay `{}` whatever the graph contains.
 *   - `calllint-mcp` names `@calllint/trust-index` in devDependencies, and trust-index is
 *     precisely the package that legitimately imports the store (`refreshSnapshot.ts`).
 *     So the declared graph does not separate them at all.
 *
 * The two shipped smoke gates are blind to this for the same reason: `package-smoke.mjs:121`
 * and `mcp-pack-smoke.mjs:67` assert runtime deps are EMPTY, and `:137`/`:80` assert no
 * unresolved `@calllint/*` specifier survives. A bundled-in store satisfies all four — it is
 * inlined, so it leaves no dependency and no unresolved import. It would ship silently, and
 * the first symptom would be `better-sqlite3` failing to load on a user's machine, because a
 * `.node` binary cannot be bundled at all.
 *
 * So this walks the graph the BUNDLER walks, from the same two entry points, and asserts what
 * actually matters: no module under `packages/adoption-index/` is reachable, and no specifier
 * names the native driver.
 *
 * VACUITY IS THE REAL RISK HERE, and it is guarded twice rather than assumed. A resolver that
 * silently failed on `@calllint/trust-index/matchLexical` would report zero adoption-index
 * modules for the wrong reason, and the test would go green by resolving nothing:
 *
 *   1. A WITNESS that subpath resolution works — `calllint-mcp` must reach EXACTLY the two
 *      trust-index subpath modules it imports (`./matchLexical`, `./agentRelay`). Those are
 *      `exports`-map subpaths, the hardest case the resolver has, and they are the same two
 *      esbuild's own metafile reports.
 *   2. A POSITIVE CONTROL that the detector fires — the same walker, from a real shipped file
 *      that legitimately imports the store (`refreshSnapshot.ts`), must REACH adoption-index.
 *      No synthetic fixture: if this direction ever returns empty, the detector is broken and
 *      the unreachability assertions above mean nothing.
 *
 * Ground truth this was validated against, from esbuild's own `metafile.inputs` at authoring:
 *   calllint      → 243 modules, 0 trust-index, 0 adoption-index, 0 native
 *   calllint-mcp  → 190 modules, 2 trust-index, 0 adoption-index, 0 native
 *
 * It lives in `tests/invariants/` (not in a package, and not in `scripts/`) because it spans
 * apps/cli + calllint-mcp + trust-index + adoption-index, and because `pnpm test` is in the
 * 19-link `ci:local` chain while `pack:smoke`/`pack:smoke:mcp` are NOT — the #240 trap shape,
 * where a gate that only runs in the 3-OS matrix cannot be reproduced locally. It resolves
 * from source and imports no bundler, so it needs no build step and no devDependency (esbuild
 * is not resolvable from a root-level test; measured, not assumed).
 */
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Normalize to repo-relative POSIX, so assertions read the same on win32 and CI. */
function rel(abs: string): string {
  return abs.slice(repoRoot.length + 1).split("\\").join("/")
}

type PkgManifest = { name?: string; main?: string; exports?: unknown; private?: boolean }

/** Every workspace package, by name → { dir, manifest }. Read once, from disk. */
function workspacePackages(): Map<string, { dir: string; manifest: PkgManifest }> {
  const out = new Map<string, { dir: string; manifest: PkgManifest }>()
  for (const root of ["packages", "apps"]) {
    const rootDir = join(repoRoot, root)
    if (!existsSync(rootDir)) continue
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestPath = join(rootDir, entry.name, "package.json")
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PkgManifest
      if (manifest.name) out.set(manifest.name, { dir: join(rootDir, entry.name), manifest })
    }
  }
  return out
}

const PKGS = workspacePackages()

/**
 * Resolve an `exports` map entry for one subpath, honouring the two shapes this repo uses:
 * a bare string (`"./src/index.ts"`) and a conditions object (`{types, default}`).
 */
function fromExports(exportsField: unknown, subpath: string): string | null {
  if (exportsField == null || typeof exportsField !== "object") {
    return subpath === "." && typeof exportsField === "string" ? exportsField : null
  }
  const target = (exportsField as Record<string, unknown>)[subpath]
  if (typeof target === "string") return target
  if (target != null && typeof target === "object") {
    const conds = target as Record<string, unknown>
    for (const key of ["import", "default", "require"]) {
      if (typeof conds[key] === "string") return conds[key] as string
    }
  }
  return null
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const

/** Attach an extension / index file to an extensionless or `.js`-specified path. */
function resolveFile(candidate: string): string | null {
  if (existsSync(candidate) && !candidate.endsWith("/")) {
    // A directory can exist at a bare path; only accept an actual file.
    try {
      if (readdirSync(dirname(candidate)).length >= 0 && !isDirectory(candidate)) return candidate
    } catch {
      /* fall through to the extension probes */
    }
  }
  // TS source for a `.js` specifier (NodeNext style, which this repo writes throughout).
  const swapped = candidate.replace(/\.(js|mjs|cjs)$/, "")
  for (const base of [candidate, swapped]) {
    for (const ext of EXTENSIONS) {
      const withExt = base + ext
      if (existsSync(withExt) && !isDirectory(withExt)) return withExt
    }
    for (const ext of EXTENSIONS) {
      const asIndex = join(base, "index" + ext)
      if (existsSync(asIndex) && !isDirectory(asIndex)) return asIndex
    }
  }
  return null
}

function isDirectory(p: string): boolean {
  try {
    readdirSync(p)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve one module specifier from one importer. Returns an absolute file path for anything
 * inside the workspace, `null` for an external package (node_modules / node: builtin) — the
 * walk deliberately stops at the workspace edge, because the boundary under test is about
 * OUR packages, and `better-sqlite3` is asserted by SPECIFIER rather than by traversal (its
 * `.node` binary has no module graph to follow).
 */
function resolveSpecifier(spec: string, importer: string): string | null {
  if (spec.startsWith(".")) return resolveFile(resolve(dirname(importer), spec))
  const scoped = spec.startsWith("@")
  const parts = spec.split("/")
  const pkgName = scoped ? parts.slice(0, 2).join("/") : parts[0]
  const found = PKGS.get(pkgName!)
  if (!found) return null // external: not part of this boundary
  const subpath = "." + spec.slice(pkgName!.length)
  const target = fromExports(found.manifest.exports, subpath) ?? (subpath === "." ? found.manifest.main : null)
  if (!target) return null
  return resolveFile(resolve(found.dir, target))
}

const SPECIFIER_RE = /(?:^|[^\w$])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|[^\w$])import\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[^\w$])require\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[^\w$])import\s*["']([^"']+)["']/g

/** Every module specifier in one file, static and dynamic alike. */
function specifiersOf(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(SPECIFIER_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4]
    if (spec) out.push(spec)
  }
  return out
}

type Graph = { modules: Set<string>; specifiers: Set<string> }

/** Walk the transitive workspace module graph from one entry file. */
function walkGraph(entryAbs: string): Graph {
  const modules = new Set<string>()
  const specifiers = new Set<string>()
  const queue = [entryAbs]
  while (queue.length > 0) {
    const current = queue.pop()!
    const key = rel(current)
    if (modules.has(key)) continue
    modules.add(key)
    const src = readFileSync(current, "utf8")
    for (const spec of specifiersOf(src)) {
      specifiers.add(spec)
      const next = resolveSpecifier(spec, current)
      if (next) queue.push(next)
    }
  }
  return { modules, specifiers }
}

/** The two bundle entry points, from the two `build.mjs` files. */
const BUNDLES = [
  { name: "calllint", entry: "apps/cli/src/index.ts" },
  { name: "calllint-mcp", entry: "packages/calllint-mcp/src/index.ts" },
] as const

const graphs = new Map<string, Graph>(
  BUNDLES.map((b) => [b.name, walkGraph(resolve(repoRoot, b.entry))] as const),
)

describe("the walker measures a real graph (vacuity guards)", () => {
  it("both bundle entry points exist and resolve a substantial graph", () => {
    // A walker that resolved nothing would satisfy every unreachability assertion below.
    // esbuild's metafile reported 243 / 190 inputs at authoring; this counts workspace
    // sources only, so it is smaller — but it must be large enough to be a real traversal.
    for (const b of BUNDLES) {
      expect(existsSync(resolve(repoRoot, b.entry)), `${b.entry} must exist`).toBe(true)
      expect(graphs.get(b.name)!.modules.size).toBeGreaterThan(50)
    }
  })

  it("WITNESS: subpath exports resolve — calllint-mcp reaches exactly its 2 trust-index modules", () => {
    // `@calllint/trust-index/matchLexical` and `/agentRelay` are `exports`-map subpaths, the
    // hardest case the resolver handles. If it silently failed on them it would also fail to
    // follow anything behind them, and "adoption-index unreachable" would be vacuously true.
    // These are the same two modules esbuild's own metafile lists for this bundle.
    const ti = [...graphs.get("calllint-mcp")!.modules].filter((m) => m.startsWith("packages/trust-index/")).sort()
    expect(ti).toEqual([
      "packages/trust-index/src/matchLexical.ts",
      "packages/trust-index/src/safe-install/agentRelay.ts",
    ])
  })

  it("POSITIVE CONTROL: the detector fires — refreshSnapshot.ts DOES reach adoption-index", () => {
    // A real shipped file that legitimately imports the store, walked by the same code. If
    // this ever returns empty, the walker is broken and every assertion below is meaningless.
    const g = walkGraph(resolve(repoRoot, "packages/trust-index/src/refreshSnapshot.ts"))
    const reached = [...g.modules].filter((m) => m.startsWith("packages/adoption-index/"))
    expect(reached.length).toBeGreaterThan(0)
    expect(reached).toContain("packages/adoption-index/src/index.ts")
    // And it reaches the driver, the one module that names the native binding.
    expect(g.specifiers).toContain("better-sqlite3")
  })
})

describe("ADR 0061 — the store is unpublishable, and the publishable SET is pinned", () => {
  it("@calllint/adoption-index is private", () => {
    // The first of the two independent mechanisms. Privacy stops PUBLISHING; the graph
    // assertions below stop REACHING. Neither is sufficient alone: a private package is
    // still bundled if imported, and a public one still ships even if nothing imports it.
    expect(PKGS.get("@calllint/adoption-index")?.manifest).toMatchObject({ private: true })
  })

  it("the publishable set is EXACTLY the five known packages", () => {
    // Measured, because nothing else in the repo asserts it. `package-smoke.mjs` and
    // `mcp-pack-smoke.mjs` each validate ONE bundle they are handed by name — neither
    // enumerates the workspace, so a package that silently became publishable is invisible
    // to both. They also run outside `ci:local` (only in the 3-OS matrix), which is the
    // #240 trap: a local run cannot reproduce the failure. This assertion is a SET, not a
    // count, so a swap that keeps the size at five still fails.
    const publishable = [...PKGS.entries()].filter(([, v]) => v.manifest.private !== true).map(([n]) => n).sort()
    expect(publishable).toEqual([
      "@calllint/credits",
      "@calllint/signature",
      "@calllint/telemetry-contract",
      "calllint",
      "calllint-mcp",
    ])
  })
})

describe("ADR 0061 — no published bundle reaches the adoption index", () => {
  for (const b of BUNDLES) {
    it(`${b.name} bundles ZERO adoption-index modules`, () => {
      const reached = [...graphs.get(b.name)!.modules].filter((m) => m.startsWith("packages/adoption-index/"))
      expect(reached, `${b.name} must not bundle the store: ${reached.join(", ")}`).toEqual([])
    })

    it(`${b.name} names no @calllint/adoption-index specifier, anywhere in its graph`, () => {
      const named = [...graphs.get(b.name)!.specifiers].filter((s) => s.includes("adoption-index"))
      expect(named, `${b.name} must not import the store: ${named.join(", ")}`).toEqual([])
    })

    it(`${b.name} names no native SQLite driver — a .node binary cannot be bundled`, () => {
      // Asserted by specifier rather than by traversal: `better-sqlite3` resolves to a
      // prebuilt `.node`, which has no module graph to follow. This is the assertion that
      // would have caught the leak as a build failure instead of as a user's crash.
      const native = [...graphs.get(b.name)!.specifiers].filter((s) => /better-sqlite3|node:sqlite/.test(s))
      expect(native, `${b.name} must not name a SQLite driver: ${native.join(", ")}`).toEqual([])
    })
  }
})
