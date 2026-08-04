/**
 * THE ADR 0061 §2 NO-EXECUTION INVARIANT — the compiler cannot execute its subjects, measured
 * over the package's MODULES and its DEPENDENCY SET rather than over its control flow.
 *
 * §2 enumerates seven forbidden operations (runs npm lifecycle scripts, runs setup.py / build
 * backends, starts a container, loads a native library, starts an MCP server, connects to a remote
 * MCP server, tests target credentials) and then makes a choice about how to keep them out:
 *
 *   > "A no-execution surface is easier to keep than a no-execution policy. The compiler package
 *   > must not depend on a package manager, a container runtime, or a child-process helper. If
 *   > executing a subject requires adding a dependency, the violation shows up in a lockfile diff
 *   > rather than in a control-flow review."
 *
 * That is a testable claim and NOTHING TESTED IT. Measured at `811edc6`: grep for `child_process`,
 * `spawn`, and `execSync` under `packages/adoption-index/` is clean — so the property holds today
 * and there was no gate keeping it that way. §2's own stated enforcement mechanism was, until this
 * file, unenforced. A pin no gate reads is itself unguarded.
 *
 * WHY A DIRECTORY WALK AND NOT AN IMPORT-GRAPH WALK. This is the deliberate difference from
 * `adoption-index-unreachable.invariants.test.ts`, which walks the graph from the two published
 * bundle entry points and is CORRECT to do so — the question there is what ships. The question
 * here is the opposite one, and a graph walk answers it wrongly:
 *
 *   - The risk is a module that spawns a process, and a module NOT YET imported from `index.ts`
 *     is exactly the shape a violation arrives in — added in one PR, wired in the next. A graph
 *     walk from `index.ts` cannot see it, and would report the package clean on the PR where the
 *     dangerous code landed.
 *   - It was measured at R-3 that the graph walker starts from the two PUBLISHED bundle entries,
 *     so importing the store into a bake-time module left it 11/11 green. Bake-time modules are
 *     off that graph by construction. Every module in this package is on this one.
 *
 * So: every `.ts` file under `packages/adoption-index/src/`, no exceptions and no allowlist.
 *
 * THE COMMENT PROBLEM, and why the specifier extractor is reused rather than a grep. This package
 * documents its own boundary in prose, so its comments legitimately contain the words `spawn` and
 * `child_process` (`resolveArtifacts.ts` says "never spawns a process"). A grep for the forbidden
 * names would fire on the docblock that PROMISES not to do it — a gate that fails on being
 * described is a gate that gets deleted. And the inverse is worse: relaxing the grep to skip
 * comment lines would skip a real `import` inside a `/* ... *\/` block that a later edit uncomments.
 * So this extracts SPECIFIERS with the same regex the sibling suite uses, and asserts over the
 * resulting set. A specifier is a structural fact; a word in a sentence is not.
 *
 * Two false positives that regex produces on THIS package, both confirmed to be prose, are the
 * reason the extractor is applied to specifier POSITIONS only and the assertion is a set
 * comparison rather than a substring search: `tarInspect.ts:83` writes `from "this archive is
 * broken"` and `:221` writes `from "512 arbitrary bytes"` inside comments. Both are inert here —
 * they are not module names and the allowed-set assertion names them as such rather than silently
 * tolerating anything unrecognized.
 *
 * VACUITY IS THE PRIMARY RISK, and it is guarded three ways rather than assumed (control #31):
 *
 *   1. A COUNT floor. The walk must find at least 20 modules. A walker pointed at the wrong
 *      directory, or one whose extension filter stopped matching, returns zero and satisfies
 *      "no module imports child_process" perfectly.
 *   2. A WITNESS that the extractor works on this package — it must find the specifiers that are
 *      genuinely there (`better-sqlite3`, `@calllint/fingerprint`, `node:zlib`, `node:crypto`).
 *      An extractor returning nothing would also report no forbidden specifier.
 *   3. A POSITIVE CONTROL over a SYNTHETIC module written to a temp dir, containing a real
 *      `import { execSync } from "node:child_process"`. The detector must FIRE on it. No mutation
 *      of a shipped file, so the control runs on every CI run rather than being a manual step.
 *
 * Control #29 (add `node:child_process` to a new module in the package) and #31 (point the gate at
 * a module-free directory) are the manual mutations this file is the measurement for.
 *
 * It lives in `tests/invariants/` for the reason its sibling does: `pnpm test` is inside the
 * 19-link `ci:local` chain while `pack:smoke`/`pack:smoke:mcp` are NOT (the #240 green-local,
 * red-remote trap). It reads files and imports no bundler, so it needs no build step.
 */
import { describe, it, expect } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PKG_DIR = join(repoRoot, "packages", "adoption-index")
const SRC_DIR = join(PKG_DIR, "src")

/** Normalize to repo-relative POSIX, so assertions read the same on win32 and CI. */
function rel(abs: string): string {
  return abs.slice(repoRoot.length + 1).split("\\").join("/")
}

/**
 * Every `.ts` module under a directory, recursively.
 *
 * `.d.ts` files are INCLUDED deliberately. `storage/better-sqlite3.d.ts` is a hand-authored
 * ambient declaration, and a declaration file can name any module it likes — an ambient
 * `declare module "child_process"` would be a real widening of what this package can reach while
 * being invisible to a filter that skipped declarations as "not code".
 */
function modulesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...modulesUnder(abs))
    else if (entry.name.endsWith(".ts")) out.push(abs)
  }
  return out.sort()
}

/** The sibling suite's extractor, byte-for-byte: static imports, re-exports, dynamic, and require. */
const SPECIFIER_RE = /(?:^|[^\w$])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|[^\w$])import\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[^\w$])require\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[^\w$])import\s*["']([^"']+)["']/g

function specifiersOf(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(SPECIFIER_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4]
    if (spec) out.push(spec)
  }
  return out
}

/**
 * Every specifier in the package, with the file that names it.
 *
 * A map rather than a set, because a failure message that names the file is the difference between
 * a gate someone fixes and a gate someone deletes.
 */
function specifierMap(dir: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const abs of modulesUnder(dir)) {
    for (const spec of specifiersOf(readFileSync(abs, "utf8"))) {
      const files = out.get(spec) ?? []
      files.push(rel(abs))
      out.set(spec, files)
    }
  }
  return out
}

const MODULES = modulesUnder(SRC_DIR)
const SPECIFIERS = specifierMap(SRC_DIR)

/**
 * Specifiers that would give this package an execution capability, mapped to the §2 line each
 * would violate. A PATTERN list rather than an exact list, because the point is to catch the
 * dependency an author reaches for, and `execa`, `cross-spawn`, and `node:child_process` are three
 * spellings of one capability.
 *
 * `node:vm` and `node:worker_threads` are here although §2 does not name them: both execute code
 * in-process, so "no child process" without them would be a boundary an author could step over
 * while technically complying. `node:module` catches a `createRequire` route to `require`ing a
 * downloaded artifact, which §2's "never `require`d" forbids explicitly.
 */
const FORBIDDEN: readonly { pattern: RegExp; capability: string }[] = Object.freeze([
  { pattern: /^node:child_process$|^child_process$/, capability: "spawns a process" },
  { pattern: /^execa$|^cross-spawn$|^spawn-sync$|^shelljs$|^zx$/, capability: "spawns a process (helper)" },
  { pattern: /^node:vm$|^vm2$|^isolated-vm$/, capability: "evaluates code in-process" },
  { pattern: /^node:worker_threads$/, capability: "runs code on a worker thread" },
  { pattern: /^node:module$/, capability: "createRequire — a route to require()ing an artifact" },
  { pattern: /^pacote$|^npm-registry-fetch$|^libnpmexec$|^npm$|^pnpm$|^yarn$/, capability: "is a package manager" },
  { pattern: /^dockerode$|^node-docker-api$/, capability: "starts a container" },
  { pattern: /^tar$|^tar-stream$|^tar-fs$|^decompress$|^extract-zip$/, capability: "unpacks an archive to disk" },
  { pattern: /^@modelcontextprotocol\/sdk/, capability: "starts or connects to an MCP server" },
  { pattern: /^node:repl$|^node:inspector$/, capability: "evaluates code interactively" },
])

/** The §2 verdict on one specifier: the capability it grants, or null. */
function forbiddenCapability(spec: string): string | null {
  for (const f of FORBIDDEN) if (f.pattern.test(spec)) return f.capability
  return null
}

describe("the gate measures a real package (vacuity guards — control #31)", () => {
  it("finds the package's modules — a count floor, not an existence check", () => {
    // 23 `.ts` files at authoring. The floor is 20 rather than 23 so a legitimate refactor that
    // merges two modules does not fail the gate, and low enough to be a real traversal: a walker
    // pointed at the wrong directory returns 0 and would satisfy every assertion below.
    expect(existsSync(SRC_DIR), `${rel(SRC_DIR)} must exist`).toBe(true)
    expect(MODULES.length).toBeGreaterThan(20)
    // And it must have descended: a walker that only read the top level would miss `artifacts/`,
    // which is where every byte-handling module in this package lives.
    const dirs = new Set(MODULES.map((m) => rel(m).split("/").slice(3, 4)[0]))
    expect([...dirs].sort()).toContain("artifacts")
  })

  it("WITNESS: the extractor finds the specifiers that ARE there", () => {
    // An extractor returning nothing satisfies "no forbidden specifier" perfectly. These four are
    // the package's real external surface, and one of them (`better-sqlite3`) is a native binding
    // — the closest thing to an execution capability this package legitimately holds.
    for (const spec of ["better-sqlite3", "@calllint/fingerprint", "node:zlib", "node:crypto"]) {
      expect(SPECIFIERS.has(spec), `expected the extractor to find "${spec}"`).toBe(true)
    }
    // And it read more than one file.
    expect(new Set([...SPECIFIERS.values()].flat()).size).toBeGreaterThan(10)
  })

  it("POSITIVE CONTROL: the detector FIRES on a module that imports node:child_process", () => {
    // A synthetic module in a temp directory, so the control runs on every CI run instead of being
    // a manual mutation of a shipped file. This is control #29's shape, automated.
    const dir = mkdtempSync(join(tmpdir(), "calllint-inv04-control-"))
    try {
      mkdirSync(join(dir, "nested"), { recursive: true })
      writeFileSync(
        join(dir, "nested", "violator.ts"),
        'import { execSync } from "node:child_process"\nexport const run = () => execSync("echo hi")\n',
        "utf8",
      )
      const found = specifierMap(dir)
      const offenders = [...found.keys()].filter((s) => forbiddenCapability(s) !== null)
      expect(offenders, "the detector must fire on a real child_process import").toEqual(["node:child_process"])
      expect(modulesUnder(dir)).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("POSITIVE CONTROL: a module-free directory produces ZERO modules, which the count floor rejects", () => {
    // Control #31 stated as an assertion. The gate's protection against vacuity is the count floor
    // in the first test, and this proves the floor is the thing doing the work: pointed at an empty
    // directory the walk returns nothing, so a version of this suite WITHOUT the floor would report
    // a clean package for a directory that has no code in it at all.
    const dir = mkdtempSync(join(tmpdir(), "calllint-inv04-empty-"))
    try {
      mkdirSync(join(dir, "sub", "deeper"), { recursive: true })
      writeFileSync(join(dir, "README.md"), 'import { execSync } from "node:child_process"\n', "utf8")
      expect(modulesUnder(dir)).toEqual([])
      expect(specifierMap(dir).size).toBe(0)
      // The floor is what converts "found nothing" into a failure.
      expect(modulesUnder(dir).length).not.toBeGreaterThan(20)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("the FORBIDDEN table itself is non-empty and every pattern is anchored", () => {
    // A table that silently emptied — or one whose patterns lost their anchors and stopped
    // matching — is the third way this gate could pass while measuring nothing.
    expect(FORBIDDEN.length).toBeGreaterThanOrEqual(10)
    for (const f of FORBIDDEN) {
      expect(f.pattern.source.startsWith("^"), `${f.pattern} must be anchored`).toBe(true)
      expect(f.capability.length).toBeGreaterThan(0)
    }
  })
})

describe("ADR 0061 §2 — no module in the compiler can execute anything (INV-04)", () => {
  it("names ZERO forbidden specifier, across every module in the package", () => {
    const offenders: string[] = []
    for (const [spec, files] of SPECIFIERS) {
      const capability = forbiddenCapability(spec)
      if (capability !== null) offenders.push(`"${spec}" (${capability}) in ${files.join(", ")}`)
    }
    expect(offenders, `ADR 0061 §2 forbids these:\n  ${offenders.join("\n  ")}`).toEqual([])
  })

  it("the package's ENTIRE external specifier set is exactly the six known entries", () => {
    // The stronger assertion, and the one that catches a capability the FORBIDDEN table did not
    // anticipate. A pattern list can only refuse what someone thought of; an exact SET refuses
    // everything nobody vouched for, so a novel `import "some-exec-helper"` fails here even though
    // no pattern names it. This is the assertion that makes §2's "shows up in a lockfile diff"
    // true of the SOURCE as well as the manifest.
    //
    // The two prose strings are the extractor's known false positives, both inside comments in
    // `tarInspect.ts` ("...from \"this archive is broken\"" and "...from \"512 arbitrary bytes\"").
    // They are named rather than filtered out: a filter would be a hole, while naming them means
    // rewording a comment fails this test and someone re-confirms the list on purpose.
    const external = [...SPECIFIERS.keys()].filter((s) => !s.startsWith(".")).sort()
    expect(external).toEqual([
      "512 arbitrary bytes",
      "@calllint/fingerprint",
      "better-sqlite3",
      "node:crypto",
      "node:fs",
      "node:path",
      "node:zlib",
      "this archive is broken",
    ])
  })

  it("every relative specifier resolves to a file that exists", () => {
    // Not a §2 assertion, but the thing that keeps the set assertion above honest: an unresolvable
    // relative import means the extractor is reading something other than the real graph, and a
    // typo'd path would otherwise sit green until a build.
    const missing: string[] = []
    for (const abs of MODULES) {
      for (const spec of specifiersOf(readFileSync(abs, "utf8"))) {
        if (!spec.startsWith(".")) continue
        const base = resolve(dirname(abs), spec).replace(/\.js$/, "")
        if (!existsSync(base + ".ts") && !existsSync(join(base, "index.ts")) && !existsSync(base)) {
          missing.push(`${rel(abs)} → ${spec}`)
        }
      }
    }
    expect(missing, `unresolvable relative imports:\n  ${missing.join("\n  ")}`).toEqual([])
  })
})

describe("ADR 0061 §2 — the dependency SET is the enforcement mechanism", () => {
  const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    scripts?: Record<string, string>
    private?: boolean
  }

  it("dependencies are EXACTLY the two entries, at exactly these versions", () => {
    // §2: "If executing a subject requires adding a dependency, the violation shows up in a
    // lockfile diff rather than in a control-flow review." That is only true if something reads
    // the set. This is that something.
    //
    // The version is pinned by VALUE for `better-sqlite3` because it is not a normal pin: Node-20
    // prebuilds were dropped at 12.10.0, so a range that resolved to 12.10+ would compile from
    // source on all three CI legs. `12.9.0` exactly, no caret.
    expect(manifest.dependencies).toEqual({
      "@calllint/fingerprint": "workspace:*",
      "better-sqlite3": "12.9.0",
    })
  })

  it("declares no dev, optional, or peer dependency at all", () => {
    // Three fields that would each let a capability in through a door the `dependencies`
    // assertion does not watch. `optionalDependencies` is the quietest of the three: a missing
    // optional install does not fail, so a container runtime added there would be absent in CI
    // and present on a developer's machine.
    expect(manifest.devDependencies).toBeUndefined()
    expect(manifest.optionalDependencies).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
  })

  it("declares no lifecycle script — the package cannot run anything at install time", () => {
    // A `postinstall` in THIS package would execute on every `pnpm install` in the repo, which is
    // an execution surface that no module-level assertion above would see.
    const scripts = manifest.scripts ?? {}
    for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"]) {
      expect(scripts[hook], `${hook} must not be declared`).toBeUndefined()
    }
  })

  it("the lockfile's importer entry matches the manifest — no phantom resolution", () => {
    // The manifest states intent; the lockfile states what `pnpm install` will actually place in
    // `node_modules`. Asserting only the manifest would miss a lockfile that resolved a
    // transitive execution helper into this importer's own dependency block.
    const lock = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8")
    const start = lock.indexOf("\n  packages/adoption-index:\n")
    expect(start, "the lockfile must carry an importer entry for this package").toBeGreaterThan(-1)
    // The importer's own block runs to the next top-level `  <path>:` key at the same indent.
    const rest = lock.slice(start + 1)
    const nextKey = rest.slice(1).search(/\n {2}\S/)
    const block = nextKey === -1 ? rest : rest.slice(0, nextKey + 1)
    expect(block).toContain("better-sqlite3")
    expect(block).toContain("specifier: 12.9.0")
    expect(block).toContain("link:../fingerprint")
    for (const f of FORBIDDEN) {
      const named = block.split("\n").filter((line) => f.pattern.test(line.trim().replace(/:.*$/, "")))
      expect(named, `lockfile importer must not name ${f.pattern}`).toEqual([])
    }
  })

  it("is private — an unpublishable package cannot become someone's transitive dependency", () => {
    // Restated here rather than left to the sibling suite, because §2's boundary and §1's
    // publishability are two claims that happen to share one field, and a change to it should
    // fail both gates rather than silently satisfy the one that no longer applies.
    expect(manifest.private).toBe(true)
  })
})
