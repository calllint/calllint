import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

/**
 * `trust-ingest.yml` lets a BOT edit a gate: the ADR 0083 ratchet floor in scripts/gate-s0.ts.
 * The step that bounds it — "Assert the ingest touched no source but the ratchet floor" — had
 * NO reader in CI. Its only proof was /d/tmp/scope.sh, run once, in scratch.
 *
 * So this file extracts that step's script and RUNS it against throwaway git repos. It matters
 * that the cases run in all three index states: the first version of the guard used
 * `git diff --name-only`, which compares the working tree to the INDEX and therefore cannot
 * see a `git add`ed file at all — while peter-evans/create-pull-request commits staged,
 * unstaged and untracked alike. A guard watching a smaller set than the one that ships.
 */

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..")
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "trust-ingest.yml")
const STEP_NAME = "Assert the ingest touched no source but the ratchet floor"

/** The named step's `run:` body, dedented. Anchored on the step NAME, not on `set -uo`. */
function extractScopeGuard(): string {
  const yaml = readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n")
  const at = yaml.indexOf(`- name: ${STEP_NAME}`)
  if (at < 0) {
    throw new Error(
      `the step "${STEP_NAME}" is gone from trust-ingest.yml. It is the only thing stopping ` +
        `the ingest bot from editing gate logic or lowering the ratchet floor — if it was ` +
        `renamed, update STEP_NAME; do not delete this file.`,
    )
  }
  const runAt = yaml.indexOf("run: |", at)
  const lines = yaml.slice(yaml.indexOf("\n", runAt) + 1).split("\n")
  const body: string[] = []
  for (const line of lines) {
    // The body is indented deeper than the `run:` key; the first shallower non-blank line ends it.
    if (line.trim() !== "" && !line.startsWith("          ")) break
    body.push(line.replace(/^ {10}/, ""))
  }
  const script = body.join("\n").trimEnd()
  if (!script.includes("S0_REGRESSION_FLOOR")) {
    throw new Error("extracted the step but it no longer mentions the floor — re-anchor.")
  }
  return script
}

const GUARD = extractScopeGuard()
const tmpRoot = mkdtempSync(join(tmpdir(), "calllint-scope-"))
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }))

interface Run {
  /** exit status: 0 iff the guard stayed silent, 1 iff it red */
  exit: number
  /** combined stdout+stderr */
  out: string
}

function runGuard(title: string, setup: (dir: string) => void): Run {
  const dir = mkdtempSync(join(tmpRoot, title.replace(/\W/g, "_") + "-"))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
  mkdirSync(join(dir, "scripts"), { recursive: true })
  writeFileSync(join(dir, "scripts", "gate-s0.ts"), "const S0_REGRESSION_FLOOR = 100")
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir })

  setup(dir)

  let out = ""
  let exit = 0
  try {
    out = execFileSync("bash", ["-c", GUARD], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    exit = err.status ?? 1
    out = (err.stdout ?? "") + (err.stderr ?? "")
  }
  return { exit, out }
}

const setFloor = (dir: string, n: number) =>
  writeFileSync(join(dir, "scripts", "gate-s0.ts"), `const S0_REGRESSION_FLOOR = ${n}`)
const stage = (dir: string) => execFileSync("git", ["add", "-A"], { cwd: dir })

/** Each index state the PR action will commit from. The guard must see all three. */
const INDEX_STATES: Array<[string, (d: string) => void]> = [
  ["unstaged", () => {}],
  ["staged", stage],
]

describe("trust-ingest scope guard — the bot may write ONE line of ONE file", () => {
  it("a clean tree passes and says the ratchet held", () => {
    const r = runGuard("clean", () => {})
    expect(r.exit).toBe(0)
    expect(r.out).toMatch(/gate-s0\.ts untouched/)
  })

  describe.each(INDEX_STATES)("with the change %s", (_state, apply) => {
    it("a RISING floor is the one permitted edit", () => {
      const r = runGuard("rising", (d) => {
        setFloor(d, 150)
        apply(d)
      })
      expect(r.exit, "the ingest's whole job is to raise this number").toBe(0)
      expect(r.out).toMatch(/ratchet floor 100 -> 150 \(rising\)/)
    })

    it("a LOWERED floor reds — a ratchet may only advance", () => {
      const r = runGuard("lowered", (d) => {
        setFloor(d, 50)
        apply(d)
      })
      expect(r.exit, "this is the direction the gate itself cannot see (ADR 0091 D4)").toBe(1)
      expect(r.out).toMatch(/did not RISE \(100 -> 50\)/)
    })

    it("an UNCHANGED floor reds — it did not advance", () => {
      const r = runGuard("equal", (d) => {
        writeFileSync(join(d, "scripts", "gate-s0.ts"), "const S0_REGRESSION_FLOOR = 100\n")
        apply(d)
      })
      expect(r.exit).toBe(1)
    })

    it("editing gate LOGIC alongside the floor reds — a bot may not touch the rest", () => {
      const r = runGuard("logic", (d) => {
        writeFileSync(
          join(d, "scripts", "gate-s0.ts"),
          "const S0_REGRESSION_FLOOR = 150\nif (false) process.exit(0)",
        )
        apply(d)
      })
      expect(r.exit).toBe(1)
      expect(r.out).toMatch(/OUTSIDE the ratchet floor declaration/)
    })

    it("a stray source file reds even with a legitimate floor rise", () => {
      const r = runGuard("stray", (d) => {
        setFloor(d, 150)
        writeFileSync(join(d, "scripts", "sneaky.ts"), "// rode along")
        apply(d)
      })
      expect(r.exit, "THIS is the case `git diff --name-only` could not see when staged").toBe(1)
      expect(r.out).toMatch(/sneaky\.ts/)
    })
  })

  it("an UNTRACKED stray file reds too — create-pull-request commits those as well", () => {
    const r = runGuard("untracked", (d) => {
      setFloor(d, 150)
      writeFileSync(join(d, "scripts", "sneaky.ts"), "// never added")
    })
    expect(r.exit).toBe(1)
    expect(r.out).toMatch(/sneaky\.ts/)
  })

  it("the guard is not vacuous: it really reads git, not a constant", () => {
    // If the guard ignored the repo it would give the same verdict for opposite inputs.
    const rise = runGuard("v-rise", (d) => setFloor(d, 150))
    const drop = runGuard("v-drop", (d) => setFloor(d, 50))
    expect(rise.exit, "opposite inputs must not produce the same verdict").not.toBe(drop.exit)
  })
})
