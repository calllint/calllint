/**
 * ADR 0003 — the §18 gate's additive-TARGET_KINDS exemption must stay narrow.
 *
 * The §18 gate (`scripts/verify-security-semantic-diff.mjs`) forbids any change under six
 * verdict-deciding packages, one of which is `packages/types`. That package holds BOTH the
 * verdict schema (`Verdict`, `RiskClass`, `PolicyAction`, `Finding`) and `TARGET_KINDS`, the
 * list of config file formats discovery can parse. Adding a harness with a new file format
 * touches the second and not the first, so the gate reported a violation on a change its own
 * rationale says it must permit ("allowed to change how CallLint is FOUND ... not what
 * CallLint DECIDES").
 *
 * ADR 0003 therefore narrows the gate to permit ADDITIVE TARGET_KINDS changes. That is a hole
 * in a security gate, and this file is what keeps the hole the size the ADR describes.
 *
 * The three ways this exemption could go wrong, one test each:
 *
 *   1. It widens to the whole package — a `Verdict` edit rides through on the exemption.
 *   2. It stops being additive-only — a REMOVED kind (a narrowed union, i.e. a breaking
 *      schema change) is waved through as if it were an addition.
 *   3. It grants itself on an unreadable subject — the parse fails and the code treats
 *      "could not tell" as "nothing changed". This one already happened once: a `]` inside
 *      the comment `// Codex (TOML [mcp_servers.*])` truncated a regex parse to 8 of 10
 *      kinds. Fail-closed held, so the bug surfaced as a plausible red rather than a false
 *      green — which is the right failure, and an invisible one.
 */
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const GATE_SRC = "scripts/verify-security-semantic-diff.mjs"
const TYPES_SRC = "packages/types/src/report.ts"

const gate = readFileSync(path.join(ROOT, GATE_SRC), "utf8")
const types = readFileSync(path.join(ROOT, TYPES_SRC), "utf8")

/**
 * Build a throwaway git repo containing only the gate and a `packages/types/src/report.ts`,
 * commit `baseTypes` as the base, apply `headTypes`, commit, then run the real gate across the
 * range. Returns its stdout+stderr and exit code.
 *
 * WHY A REAL REPO AND A REAL SUBPROCESS. The gate's subject IS a git range, so a unit test that
 * called an extracted helper would be testing a copy of the logic with the git half stubbed out
 * — and the git half is where this gate has already broken once (a CI clone has no local `main`).
 * Driving the committed script over synthetic history exercises the parse, the additive check,
 * the range resolution and the exit code together.
 */
function runGateOverRange(baseTypes: string, headTypes: string): { out: string; exit: number } {
  const tmp = mkdtempSync(path.join(tmpdir(), "adr3-"))
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

  try {
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@t.t")
    git("config", "user.name", "t")

    mkdirSync(path.join(tmp, "packages", "types", "src"), { recursive: true })
    mkdirSync(path.join(tmp, "scripts"), { recursive: true })
    // The gate under test, byte-identical to the committed one.
    cpSync(path.join(ROOT, GATE_SRC), path.join(tmp, GATE_SRC))

    const typesPath = path.join(tmp, TYPES_SRC)
    writeFileSync(typesPath, baseTypes)
    git("add", "-A")
    git("commit", "-qm", "base")

    writeFileSync(typesPath, headTypes)
    git("add", "-A")
    git("commit", "-qm", "head")

    // Range must be base..HEAD. `main` points at HEAD after two commits on main, so measure
    // against the first commit explicitly.
    const base = git("rev-parse", "HEAD~1").trim()
    try {
      const out = execFileSync("node", [path.join(tmp, GATE_SRC), "--base", base], {
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

/** A minimal report.ts carrying just the const the exemption reads. */
function reportWith(kinds: string[], extra = ""): string {
  const body = kinds.map((k) => `  "${k}",`).join("\n")
  return `export const TARGET_KINDS = [\n${body}\n] as const\n\nexport type TargetKind = (typeof TARGET_KINDS)[number]\n${extra}`
}

const BASE_KINDS = ["cursor-mcp-config", "claude-settings", "mcp-servers", "npm", "inline"]

describe("ADR 0003 — additive TARGET_KINDS exemption stays narrow", () => {
  /* ── The exemption exists and is scoped to one file and one const ─────────────────── */

  it("the gate names ADR 0003 and scopes the exemption to report.ts alone", () => {
    expect(gate).toContain("ADR 0003")
    expect(gate).toMatch(/TARGET_KINDS_FILE\s*=\s*['"]packages\/types\/src\/report\.ts['"]/)
    // The other five verdict packages are untouched by the narrowing.
    for (const pkg of ["risk-engine", "static-analyzer", "policy", "fingerprint", "core"]) {
      expect(gate).toContain(`packages/${pkg}`)
    }
  })

  it("TARGET_KINDS still has exactly one consumer, so order-independence holds", () => {
    // The ADR's justification for set semantics. If a second consumer appears — especially one
    // that indexes the array — the exemption's reasoning lapses and this reds.
    expect(types).toContain("export type TargetKind = (typeof TARGET_KINDS)[number]")
    const consumers = execFileSync(
      "git",
      ["grep", "-l", "TARGET_KINDS", "--", "packages/**/*.ts", "apps/**/*.ts"],
      { cwd: ROOT, encoding: "utf8" }
    )
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    expect(consumers).toEqual([TYPES_SRC])
  })

  /* ── Positive control: an addition passes ─────────────────────────────────────────── */

  it("PC: adding a kind mid-array is exempted and the gate goes green", () => {
    const head = [...BASE_KINDS]
    head.splice(2, 0, "codex-mcp") // inserted mid-array, as the real change was
    const { out, exit } = runGateOverRange(reportWith(BASE_KINDS), reportWith(head))
    expect(out).toContain("[ADR 0003]")
    expect(out).toContain("SECURITY_SEMANTICS = UNCHANGED")
    expect(exit).toBe(0)
  })

  it("PC: a comment containing ] does not break the parse", () => {
    // The regression that already bit once: `// Codex (TOML [mcp_servers.*])`.
    const head = reportWith(
      [...BASE_KINDS, "codex-mcp"],
      ""
    ).replace('"codex-mcp",', '"codex-mcp",        // Codex (TOML [mcp_servers.*])')
    const { out, exit } = runGateOverRange(reportWith(BASE_KINDS), head)
    expect(out).toContain("[ADR 0003]")
    expect(exit).toBe(0)
  })

  /* ── Negative controls ───────────────────────────────────────────────────────────── */

  it("NC-A: REMOVING a kind is not exempted — a narrowed union still reds", () => {
    const head = BASE_KINDS.filter((k) => k !== "mcp-servers")
    const { out, exit } = runGateOverRange(reportWith(BASE_KINDS), reportWith(head))
    expect(out).not.toContain("[ADR 0003]")
    expect(out).toContain("SECURITY_SEMANTICS = CHANGED")
    expect(out).toContain(TYPES_SRC)
    expect(exit).not.toBe(0)
  })

  it("NC-B: renaming a kind reds — a rename is a removal plus an addition", () => {
    const head = BASE_KINDS.map((k) => (k === "npm" ? "npm-registry" : k))
    const { out, exit } = runGateOverRange(reportWith(BASE_KINDS), reportWith(head))
    expect(out).not.toContain("[ADR 0003]")
    expect(exit).not.toBe(0)
  })

  it("NC-C: an edit ELSEWHERE in report.ts reds even when TARGET_KINDS is additive", () => {
    // The widening failure: the exemption must cover the const, not the file. A Verdict change
    // riding along with a legitimate kind addition is exactly what must not pass.
    const head = reportWith(
      [...BASE_KINDS, "codex-mcp"],
      '\nexport type Verdict = "SAFE" | "REVIEW" | "BLOCK" | "UNKNOWN" | "PROBABLY_FINE"\n'
    )
    const { out, exit } = runGateOverRange(reportWith(BASE_KINDS), head)
    expect(out).toContain("SECURITY_SEMANTICS = CHANGED")
    expect(exit).not.toBe(0)
  })

  it("NC-D: an unparseable TARGET_KINDS is not exempted — fail closed, not fail quiet", () => {
    // Unbalanced array. The exemption must refuse to grant itself when it cannot read its
    // subject; treating "could not tell" as "nothing changed" is the defect this repo keeps
    // rediscovering.
    const head = 'export const TARGET_KINDS = [\n  "cursor-mcp-config",\n  "codex-mcp",\n as const\n'
    const { out, exit } = runGateOverRange(reportWith(BASE_KINDS), head)
    expect(out).not.toContain("[ADR 0003]")
    expect(exit).not.toBe(0)
  })
})
