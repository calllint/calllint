/**
 * An operator step that a script PRINTS must be the one that actually runs.
 *
 * WHY THIS FILE EXISTS. `verify-mcp-tag-protection.mjs --explain` printed a `gh api` command
 * described in the closure report as the exact operator step for creating the `mcp-v*` tag
 * ruleset. It was not runnable. Creating the ruleset for real produced two DIFFERENT 422s
 * against that printed form, and each rules out a repair of the other:
 *
 *   -f 'bypass_actors[][actor_id]=5'  → "5" is not of type "integer"
 *        `-f` stringifies every value; `actor_id` is an integer field.
 *   -F 'bypass_actors[][actor_id]=5'  → Missing required parameter "exclude"
 *        `-F` fixes typing, but NEITHER flag can express an empty array: the `[]` spelling
 *        sends `[""]` and omitting the key sends nothing, while the endpoint requires it.
 *
 * So the defect was not a typo — no flag-only spelling of that body exists. `new18.md` §45
 * says "do not fabricate success. Record exact operator step"; a command that 422s twice is
 * not an exact one, and nothing in the suite noticed, because the printed text was never
 * compared against anything.
 *
 * WHAT IS ASSERTED, AND WHY IT IS THE PROPERTY AND NOT THE WORDING. The `--explain` body is
 * read from the checked-in JSON at run time, so the guard holds the thing that can actually
 * drift: that the printed body is byte-identical to the file an operator is told to POST,
 * and that the file is a body the API would accept in shape. A test asserting the presence
 * of the string "--input" would pass on a command that still could not run.
 *
 * THE FAIL PATH IS THE ONLY PATH THAT PRINTS THIS. `--explain` output is emitted on FAIL,
 * so pointing the script at the real repo (where the ruleset now EXISTS) exercises none of
 * it and would leave this guard vacuously green. Every case below therefore runs against a
 * repo with no matching ruleset, and the premise block asserts that the run really did take
 * the FAIL branch — the substitution that made nine earlier audits vacuous (ADR 0084).
 *
 * NO NETWORK. `CALLLINT_REPO` is pointed at a name that cannot resolve, so `gh` fails and
 * the script exits 1 through its fails-closed path having printed nothing; that is useless
 * for reading `--explain`. Instead a stub `gh` earlier on PATH returns `[]` for the ruleset
 * list, which is the "no ruleset" shape — the FAIL branch, reached deterministically and
 * offline. If `gh` is absent from the machine entirely these tests still work, because the
 * stub IS the `gh` they call.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, chmodSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, "..", "..")
const SCRIPT = resolve(ROOT, "scripts", "verify-mcp-tag-protection.mjs")
const BODY_PATH = "artifacts/authority-distribution-closure/mcp-tag-ruleset.json"

/** A `gh` that answers the ruleset list with `[]` — the shape that drives the FAIL branch. */
let stubDir: string

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), "gh-stub-"))
  // The script shells out as `gh api <path>`. Any ruleset query returns an empty list.
  const sh = `#!/bin/sh\necho '[]'\n`
  writeFileSync(join(stubDir, "gh"), sh)
  chmodSync(join(stubDir, "gh"), 0o755)
  // Windows resolves `gh` via PATHEXT; a .cmd shim covers the non-sh spawn path.
  writeFileSync(join(stubDir, "gh.cmd"), "@echo [] \r\n")
})

afterAll(() => rmSync(stubDir, { recursive: true, force: true }))

/** Run `--explain` against the stub. Exit 1 is EXPECTED: it is the branch that explains. */
function explainOutput(): string {
  try {
    execFileSync(process.execPath, [SCRIPT, "--explain"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` },
      stdio: ["pipe", "pipe", "pipe"],
    })
    return ""
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    expect(e.status, "the no-ruleset case must exit 1; a 0 here means the FAIL branch was not taken").toBe(1)
    return `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
}

describe("the premise: the FAIL branch really ran, so there is something to check", () => {
  it("reaches the explain branch rather than passing or dying early", () => {
    const out = explainOutput()
    expect(out, "no output captured — the script did not reach its explain block").not.toBe("")
    expect(out).toContain("FAIL: no active tag ruleset restricts creation")
    expect(out).toContain("Equivalent API call")
  })

  it("the checked-in body the explain text points at exists and is valid JSON", () => {
    const raw = readFileSync(resolve(ROOT, BODY_PATH), "utf8")
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})

describe("the printed operator step is the runnable one", () => {
  it("uses --input, never the -f/-F flag forms that were measured failing with 422", () => {
    const out = explainOutput()
    expect(out).toMatch(/gh api --method POST repos\/[^/]+\/[^/]+\/rulesets --input/)
    // The exact spellings that produced the two 422s must not come back.
    expect(out, "-f stringifies actor_id and the API rejects it as not-an-integer").not.toContain(
      "-f 'bypass_actors[][actor_id]",
    )
    expect(out, "-F fixes typing but cannot send exclude: []").not.toContain("-F 'bypass_actors[][actor_id]")
    expect(out, "this spelling sends [\"\"] , not an empty array").not.toContain(
      "conditions[ref_name][exclude][]=",
    )
  })

  it("prints the checked-in body VERBATIM, so the two cannot drift apart", () => {
    const out = explainOutput()
    const onDisk = JSON.parse(readFileSync(resolve(ROOT, BODY_PATH), "utf8"))
    // The script pretty-prints what it read. Every line of that must appear in the output:
    // this is what makes editing the JSON file update the printed step automatically.
    for (const line of JSON.stringify(onDisk, null, 2).split("\n")) {
      expect(out, `explain output is missing this line of ${BODY_PATH}: ${line}`).toContain(line)
    }
    expect(out, "the operator is also told the file path, for the no-heredoc route").toContain(BODY_PATH)
  })

  it("the heredoc it prints is closeable — an indented terminator would never close", () => {
    const out = explainOutput()
    const lines = out.split(/\r?\n/)
    const start = lines.findIndex((l) => l.includes("--input - <<'JSON'"))
    expect(start, "no heredoc found in the explain output").toBeGreaterThanOrEqual(0)
    const term = lines.findIndex((l, i) => i > start && l.trimEnd() === "JSON")
    expect(term, "the heredoc has no unindented JSON terminator, so it would hang the shell").toBeGreaterThan(
      start,
    )
    expect(lines[term], "a terminator with leading whitespace does not close a <<'X' heredoc").toBe("JSON")
  })
})

describe("the body is one the rulesets API can accept in shape", () => {
  // Shape only: these are the three fields whose spelling produced the measured 422s. This
  // asserts the CONTENT of the body, independent of how the script prints it.
  const body = () => JSON.parse(readFileSync(resolve(ROOT, BODY_PATH), "utf8"))

  it("actor_id is a real integer, not a string", () => {
    const actors = body().bypass_actors as Array<{ actor_id: unknown }>
    expect(actors.length).toBeGreaterThan(0)
    for (const a of actors) expect(typeof a.actor_id, "a string here is the first 422").toBe("number")
  })

  it("conditions.ref_name.exclude is present and an EMPTY array, not [\"\"]", () => {
    const ref = body().conditions?.ref_name
    expect(Array.isArray(ref?.exclude), "a missing exclude is the second 422").toBe(true)
    expect(ref.exclude, 'the flag form sends [""], which is not the same thing').toEqual([])
  })

  it("it targets tags and restricts creation — otherwise it would not close AC-32's half", () => {
    const b = body()
    expect(b.target).toBe("tag")
    expect(b.enforcement, "evaluate/disabled report without blocking").toBe("active")
    expect(b.conditions.ref_name.include).toContain("refs/tags/mcp-v*")
    expect((b.rules as Array<{ type: string }>).map((r) => r.type)).toContain("creation")
  })
})
