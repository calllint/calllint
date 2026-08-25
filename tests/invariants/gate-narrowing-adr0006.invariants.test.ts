/**
 * ADR 0006 — the §18 gate's two new exemptions must stay the size the ADR describes.
 *
 * ADR 0003 opened the first hole in this gate (additive `TARGET_KINDS`). ADR 0006 opens two
 * more, so this file exists for the same reason `target-kinds-exemption.invariants.test.ts`
 * does: an exemption in a security gate is only as narrow as the tests that pin it.
 *
 *   Narrowing 1 — test files. Measured, not assumed: no product file in this repo imports
 *   from a test directory, so a test cannot reach the shipped product. Before this, the gate
 *   reddened on merely ADDING a test to a verdict package — it penalised the act that
 *   strengthens it.
 *
 *   Narrowing 2 — append-only vocabulary in a named file. An appended, unreferenced block is
 *   inert: to move a verdict something must CALL it, and any caller either edits an existing
 *   line in the same file (breaking the byte-prefix check) or lands as a separate file in the
 *   diff (which the gate still catches).
 *
 * The ways these could go wrong, one test each:
 *
 *   1. "test" matches as a SUBSTRING, so a product file named `src/testUtils.ts` slips out.
 *   2. The append-only check degrades to "additive diff", so a mid-file edit rides through.
 *   3. The whitelist widens to a package, so any file gets the append-only pass.
 *   4. It grants itself on an unreadable subject — a file absent at base is read as "fine".
 */
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const GATE_SRC = "scripts/verify-security-semantic-diff.mjs"
const AUTHORITY_SRC = "packages/types/src/authority.ts"

const gate = readFileSync(path.join(ROOT, GATE_SRC), "utf8")

/** A file tree keyed by repo-relative path. */
type Tree = Record<string, string>

/**
 * Commit `base`, apply `head`, run the REAL committed gate across the range.
 *
 * WHY A REAL REPO AND A REAL SUBPROCESS, not an extracted helper: the gate's subject IS a git
 * range, and the git half is where this gate has already broken once (a CI clone has no local
 * `main`). Driving the committed script over synthetic history exercises the path matching, the
 * blob reads, the prefix check and the exit code together. Same rationale as ADR 0003's test.
 *
 * A key deleted from `head` is removed from the tree; a key added is created.
 */
function runGateOverRange(base: Tree, head: Tree): { out: string; exit: number } {
  const tmp = mkdtempSync(path.join(tmpdir(), "adr6-"))
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

  const write = (tree: Tree) => {
    for (const [rel, content] of Object.entries(tree)) {
      const abs = path.join(tmp, rel)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
  }

  try {
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@t.t")
    git("config", "user.name", "t")

    // The gate under test, byte-identical to the committed one.
    mkdirSync(path.join(tmp, "scripts"), { recursive: true })
    cpSync(path.join(ROOT, GATE_SRC), path.join(tmp, GATE_SRC))

    write(base)
    git("add", "-A")
    git("commit", "-qm", "base")

    // Remove files present at base but absent at head, then write head.
    for (const rel of Object.keys(base)) {
      if (!(rel in head)) rmSync(path.join(tmp, rel), { force: true })
    }
    write(head)
    git("add", "-A")
    git("commit", "-qm", "head")

    const baseRef = git("rev-parse", "HEAD~1").trim()
    try {
      const out = execFileSync("node", [path.join(tmp, GATE_SRC), "--base", baseRef], {
        cwd: tmp,
        encoding: "utf8",
      })
      return { out, exit: 0 }
    } catch (error: any) {
      return { out: `${error.stdout ?? ""}${error.stderr ?? ""}`, exit: error.status ?? 1 }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** A minimal authority.ts standing in for the real one: some content the append must not touch. */
const AUTHORITY_BASE = [
  'export const AUTHORITY_SCHEMA_VERSION = "calllint.authority.v0" as const',
  "",
  "export interface AuthorityCapability {",
  "  readonly id: string",
  "}",
  "",
].join("\n")

/** The appended vocabulary block — new top-level exports, nothing above them touched. */
const APPENDED_VOCAB = [
  'export const AUTHORITY_LAYERS = ["identity", "entrypoint", "execution", "tool", "effect"] as const',
  "export type AuthorityLayer = (typeof AUTHORITY_LAYERS)[number]",
  "",
].join("\n")

describe("ADR 0006 — the gate's two new exemptions stay narrow", () => {
  /* ── The exemptions exist, are named, and are scoped ──────────────────────────────── */

  it("the gate names ADR 0006 and whitelists exactly one file for append-only", () => {
    expect(gate).toContain("ADR 0006")
    // The whitelist is a single file, not a package. If a second entry appears it must come
    // with its own ADR reasoning, and this red is the prompt to write it.
    const decl = gate.match(/const APPEND_ONLY_VOCAB_FILES = \[([^\]]*)\]/)
    expect(decl).not.toBeNull()
    const entries = [...(decl?.[1] ?? "").matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2])
    expect(entries).toEqual([AUTHORITY_SRC])
  })

  it("the test-path pattern is anchored to a path SEGMENT, not a substring", () => {
    // The widening failure for narrowing 1: `/test/` as a substring would exempt a product
    // file named `src/testUtils.ts`. Assert the shipped regex against both forms directly.
    const src = gate.match(/const TEST_PATH_SEGMENT = (\/.*\/)\n/)
    expect(src).not.toBeNull()
    // eslint-disable-next-line no-eval -- reading the gate's own literal, not external input
    const pattern: RegExp = eval(src?.[1] ?? "/$^/")

    expect(pattern.test("packages/types/test/authority-layers.test.ts")).toBe(true)
    expect(pattern.test("packages/core/tests/x.test.ts")).toBe(true)
    expect(pattern.test("packages/discovery/src/__tests__/y.test.ts")).toBe(true)
    // Must NOT match: product files that merely contain the letters "test".
    expect(pattern.test("packages/types/src/testUtils.ts")).toBe(false)
    expect(pattern.test("packages/policy/src/latest.ts")).toBe(false)
    expect(pattern.test("packages/core/src/contest.ts")).toBe(false)
  })

  it("the five other verdict packages are still guarded", () => {
    for (const pkg of ["risk-engine", "static-analyzer", "policy", "fingerprint", "core"]) {
      expect(gate).toContain(`packages/${pkg}`)
    }
  })

  /* ── The measurement the test-file exemption rests on, re-run against the real tree ── */

  it("no product file imports from a test directory — narrowing 1's premise", () => {
    // This is ADR 0006's load-bearing measurement. If a product file ever imports a test
    // helper, a test file CAN reach the shipped product and narrowing 1 is unsound.
    let hits = ""
    try {
      hits = execFileSync(
        "git",
        [
          "grep",
          "-nE",
          "from ['\"][^'\"]*(test|__tests__)",
          "--",
          "packages/*/src/**/*.ts",
          "apps/*/src/**/*.ts",
          ":(exclude)*/__tests__/*",
          ":(exclude)*.test.ts",
          ":(exclude)*.spec.ts",
        ],
        { cwd: ROOT, encoding: "utf8" }
      )
    } catch {
      hits = "" // git grep exits 1 on no matches, which is the passing case
    }
    expect(hits.trim()).toBe("")
  })
})

describe("ADR 0006 narrowing 1 — test files", () => {
  it("PC-A: ADDING a test file to a verdict package goes green", () => {
    const base: Tree = { [AUTHORITY_SRC]: AUTHORITY_BASE }
    const head: Tree = {
      ...base,
      "packages/types/test/authority-layers.test.ts": 'import { it } from "vitest"\nit("x", () => {})\n',
    }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).toContain("[ADR 0006]")
    expect(out).toContain("test file, not reachable from src")
    expect(out).toContain("SECURITY_SEMANTICS = UNCHANGED")
    expect(exit).toBe(0)
  })

  it("PC-B: CHANGING an existing test in a verdict package goes green", () => {
    const testFile = "packages/core/test/extract-fingerprint.test.ts"
    const base: Tree = { [testFile]: 'import { it } from "vitest"\nit("a", () => {})\n' }
    const head: Tree = { [testFile]: 'import { it } from "vitest"\nit("a", () => {})\nit("b", () => {})\n' }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).toContain("[ADR 0006]")
    expect(exit).toBe(0)
  })

  it("NC-A: a PRODUCT file whose name contains 'test' still reds", () => {
    // The substring-vs-segment failure, driven end-to-end rather than against the regex alone.
    const util = "packages/types/src/testUtils.ts"
    const base: Tree = { [util]: "export const helper = 1\n" }
    const head: Tree = { [util]: "export const helper = 2\n" }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).toContain("SECURITY_SEMANTICS = CHANGED")
    expect(out).toContain(util)
    expect(exit).not.toBe(0)
  })

  it("NC-B: a src file under a verdict package still reds when a test lands beside it", () => {
    // The exemption must be per-FILE, not "this commit touched a test, so let it all through".
    const base: Tree = { [AUTHORITY_SRC]: AUTHORITY_BASE }
    const head: Tree = {
      [AUTHORITY_SRC]: AUTHORITY_BASE.replace('"calllint.authority.v0"', '"calllint.authority.v1"'),
      "packages/types/test/new.test.ts": 'import { it } from "vitest"\nit("x", () => {})\n',
    }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).toContain("SECURITY_SEMANTICS = CHANGED")
    expect(out).toContain(AUTHORITY_SRC)
    expect(exit).not.toBe(0)
  })
})

describe("ADR 0006 narrowing 2 — append-only vocabulary", () => {
  it("PC-C: append-only to authority.ts goes green", () => {
    const base: Tree = { [AUTHORITY_SRC]: AUTHORITY_BASE }
    const head: Tree = { [AUTHORITY_SRC]: AUTHORITY_BASE + APPENDED_VOCAB }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).toContain("[ADR 0006]")
    expect(out).toContain("append-only")
    expect(out).toContain("SECURITY_SEMANTICS = UNCHANGED")
    expect(exit).toBe(0)
  })

  it("PC-D: append-only PLUS a test change in the same commit both go green", () => {
    // The actual PR #334 scenario: both exemptions active at once. The combined delta must not
    // interfere with either narrowing.
    const base: Tree = { [AUTHORITY_SRC]: AUTHORITY_BASE }
    const head: Tree = {
      [AUTHORITY_SRC]: AUTHORITY_BASE + APPENDED_VOCAB,
      "packages/types/test/authority-layers.test.ts": 'import { it } from "vitest"\nit("x", () => {})\n',
    }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).toContain("[ADR 0006]") // should appear twice, once per file
    expect(out).toContain("SECURITY_SEMANTICS = UNCHANGED")
    expect(exit).toBe(0)
  })

  it("NC-C: MODIFYING an existing line in authority.ts reds, even if the diff is additive", () => {
    // The boundary: an append to the file's byte stream is NOT an exempt append if it touches
    // an existing line. The simplest breaking edit: change the schema version string.
    const base: Tree = { [AUTHORITY_SRC]: AUTHORITY_BASE }
    const head: Tree = { [AUTHORITY_SRC]: AUTHORITY_BASE.replace('"calllint.authority.v0"', '"calllint.authority.v1"') }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).not.toContain("append-only")
    expect(out).toContain("SECURITY_SEMANTICS = CHANGED")
    expect(out).toContain(AUTHORITY_SRC)
    expect(exit).not.toBe(0)
  })

  it("NC-D: append-only to a NON-WHITELISTED file still reds", () => {
    // The exemption is file-specific, not package-wide. If another vocabulary file appears, it
    // needs its own ADR and a slot in APPEND_ONLY_VOCAB_FILES, not free-ride.
    const other = "packages/policy/src/rules.ts"
    const base: Tree = { [other]: "export const RULES = []\n" }
    const head: Tree = { [other]: "export const RULES = []\nexport const ACTIONS = []\n" }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).not.toContain("append-only")
    expect(out).toContain("SECURITY_SEMANTICS = CHANGED")
    expect(out).toContain(other)
    expect(exit).not.toBe(0)
  })

  it("NC-E: a file absent at base is not exempted — fail closed on unreadable subject", () => {
    // The always-green hole: if reading the base blob fails, treat it as "changed", not "fine".
    const base: Tree = {}
    const head: Tree = { [AUTHORITY_SRC]: AUTHORITY_BASE }
    const { out, exit } = runGateOverRange(base, head)
    expect(out).not.toContain("append-only")
    expect(out).toContain("SECURITY_SEMANTICS = CHANGED")
    expect(exit).not.toBe(0)
  })
})
