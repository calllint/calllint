/**
 * new20 §E2 — `--config <path>` is a real flag, not published copy.
 *
 * THE DEFECT THIS PINS. `calllint scan --config <path>` was advertised on eight published
 * surfaces (the SSOT's opencode record, the generated harness pages, llms.txt, llms-full.txt,
 * agent-instructions.md and the hand-maintained pages) and printed by `calllint inventory`
 * for months. No command read it. `parseArgs` consumes `--k v` as a flag/value pair whenever
 * the next token is not another flag, so the path landed in `flags.config` and never became a
 * positional. Measured 2026-08-23, both outcomes were wrong and the dangerous one was silent:
 *
 *   no default config present → exit 2, "No config given and none found". Confusing, since
 *                               the user plainly did give one, but VISIBLE.
 *   a default config present  → discovery ran and scanned `.cursor/mcp.json` instead, exit 0
 *                               with a verdict. The user asked about the file they named and
 *                               got an answer about a different one, silently.
 *
 * The second case is why a wording fix was not enough: a verdict that describes a file nobody
 * named is "evidence must belong to the thing it claims" — CallLint's founding rule — broken
 * by CallLint. It is also invisible to every flag-existence gate, because `--auto` and
 * discovery are real and do run; they just answer about the wrong file and exit 0.
 *
 * WHY THE DECOY IS THE LOAD-BEARING PART OF EVERY CASE BELOW. A test that only asserted
 * `--config named.json` exits 0 would have PASSED against the broken build: discovery would
 * have found the decoy and exited 0 too. So each fixture writes a `.cursor/mcp.json`
 * containing a differently-named server, and asserts on WHICH server came back. Without the
 * decoy this file would be a vacuous pass — the dominant fault class in this repo.
 *
 * HD-06 in `check-harness-distribution.mjs` is the other half of this: it asserts every flag
 * advertised in the SSOT is read somewhere under `apps/cli/src`. It is a source scan, so it
 * proves the flag is READ; this file proves reading it produces the right report. Neither
 * subsumes the other — a flag could be read into a variable nothing uses, which HD-06 cannot
 * see and case 2 below would catch.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseArgs } from "../src/args.js"
import { TARGET_FLAG, TARGET_LOOKALIKE_FLAGS, resolveConfigInput, isInputError } from "../src/commands/resolveInput.js"

/** The file the user names. Its server name is what a correct report must contain. */
const NAMED = JSON.stringify({
  mcpServers: { "named-target-server": { command: "npx", args: ["-y", "demo-mcp@1.2.3"] } },
})

/**
 * The decoy at a default-discovery location. If a case below comes back with THIS server, the
 * CLI answered about a file the user never named — the exact silent failure being pinned.
 */
const DECOY = JSON.stringify({
  mcpServers: { "decoy-default-server": { command: "npx", args: ["-y", "other-mcp@9.9.9"] } },
})

let cwd: string
const noStdin = () => {
  throw new Error("readStdin must not be called when a target was named")
}

/**
 * Name a fixture file by absolute path.
 *
 * `resolveConfigInput` resolves a NAMED target against `process.cwd()` — `deps.cwd` is consumed
 * only by `findDefaultConfig`, i.e. only by discovery. In the shipped CLI the two are the same
 * value, so relative paths behave as users expect; in this file they are not, so a relative
 * `named.json` would be looked up under the repo root and report "File not found". Measured
 * 2026-08-23: that asymmetry failed the four cases below before this helper existed. Discovery
 * cases stay relative-free and go through `deps.cwd`, which is why the premise test needs no
 * helper.
 */
const at = (rel: string) => path.join(cwd, rel)

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "calllint-target-flag-"))
  writeFileSync(path.join(cwd, "named.json"), NAMED)
  mkdirSync(path.join(cwd, ".cursor"), { recursive: true })
  writeFileSync(path.join(cwd, ".cursor", "mcp.json"), DECOY)
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

/** Resolve exactly as the commands do: parse a real argv, then run the shared resolver. */
const resolve = (argv: string[]) =>
  resolveConfigInput(parseArgs(["scan", ...argv]), { cwd, readStdin: noStdin })

describe("the fixture's own premise (asserted before anything is concluded from it)", () => {
  it("has a decoy at a discovery path that resolves when no target is named", () => {
    // Without this, every case below could pass by there being no decoy to mistake.
    const r = resolve([])
    expect(isInputError(r)).toBe(false)
    if (isInputError(r)) return
    expect(r.text, "discovery did not reach the decoy — the controls below prove nothing").toContain(
      "decoy-default-server",
    )
  })
})

describe("new20 §E2 — --config names the scan target", () => {
  it("--config <path> reads the named file, not the discovery decoy", () => {
    const r = resolve(["--config", at("named.json")])
    expect(isInputError(r), JSON.stringify(r)).toBe(false)
    if (isInputError(r)) return
    expect(r.text).toContain("named-target-server")
    expect(r.text, "scanned the discovery decoy while the user named a file").not.toContain(
      "decoy-default-server",
    )
    expect(r.configPath).toBe(at("named.json"))
  })

  it("--config=<path> resolves identically (parseArgs splits on =)", () => {
    const r = resolve([`--config=${at("named.json")}`])
    expect(isInputError(r)).toBe(false)
    if (isInputError(r)) return
    expect(r.text).toContain("named-target-server")
    expect(r.configPath).toBe(at("named.json"))
  })

  it("agrees with the positional spelling on both text and configPath", () => {
    // The alias claim: same target, same report. `configPath` is what the report prints as the
    // subject of its verdict, so a divergence here is a verdict about an ambiguous subject.
    const viaFlag = resolve(["--config", at("named.json")])
    const viaPositional = resolve([at("named.json")])
    expect(isInputError(viaFlag) || isInputError(viaPositional)).toBe(false)
    if (isInputError(viaFlag) || isInputError(viaPositional)) return
    expect(viaFlag).toEqual(viaPositional)
  })

  it("reports a missing file rather than falling through to discovery", () => {
    // The old failure mode in its most dangerous shape: a typo'd path must NOT quietly become
    // a scan of whatever discovery happens to find.
    const r = resolve(["--config", at("does-not-exist.json")])
    expect(isInputError(r), "a nonexistent --config path fell through to discovery").toBe(true)
    if (!isInputError(r)) return
    expect(r.error).toContain("does-not-exist.json")
    expect(r.exitCode).toBe(2)
  })

  it("rejects --config with no value instead of scanning something else", () => {
    // `--config` as the last token parses to boolean true, which must not read as "no target".
    const r = resolve(["--config"])
    expect(isInputError(r)).toBe(true)
    if (!isInputError(r)) return
    expect(r.error).toContain("needs a path")
    expect(r.exitCode).toBe(2)
  })

  it("lets a positional win when both are given", () => {
    // Documented primary spelling wins. Silently preferring the flag would reintroduce
    // "scanned something other than what you pointed at" in a new place.
    const r = resolve([at("named.json"), "--config", at(".cursor/mcp.json")])
    expect(isInputError(r), JSON.stringify(r)).toBe(false)
    if (isInputError(r)) return
    expect(r.text).toContain("named-target-server")
    expect(r.text).not.toContain("decoy-default-server")
  })
})

describe("the flag is implemented, not merely absent from the refusal list", () => {
  it("config is no longer a refused lookalike", () => {
    // Guards against a regression that re-adds it: the list and the implementation would then
    // disagree, and the refusal branch would shadow a flag the help text documents.
    expect([...TARGET_LOOKALIKE_FLAGS]).not.toContain(TARGET_FLAG)
  })

  it("still refuses the lookalikes CallLint never published", () => {
    // Anti-vacuity: the refusal branch must still exist and still fire. If this cohort were
    // empty, "config was removed from the list" would be an unfalsifiable statement.
    expect(TARGET_LOOKALIKE_FLAGS.length, "no lookalikes left to refuse").toBeGreaterThan(0)
    for (const alias of TARGET_LOOKALIKE_FLAGS) {
      // A REAL path, so the refusal is the reason for the exit — not the file being absent.
      // The refusal branch runs before the existence check, so a bogus path here would let this
      // pass against a build that had dropped the branch entirely.
      const r = resolve([`--${alias}`, at("named.json")])
      expect(isInputError(r), `--${alias} was silently accepted`).toBe(true)
      if (!isInputError(r)) continue
      // The message must name the working spelling, or it teaches nothing.
      expect(r.error).toContain(`calllint scan ${at("named.json")}`)
      expect(r.exitCode).toBe(2)
    }
  })

  it("is documented in help.ts — an implemented flag nobody can find is half-shipped", async () => {
    const { readFileSync } = await import("node:fs")
    // `fileURLToPath`, not `new URL(...).pathname`: on POSIX the pathname IS the path, so the
    // `.slice(1)` this once used to strip Windows' leading `/` from `/d:/...` turned
    // `/home/runner/...` into a RELATIVE `home/runner/...` and the read failed with ENOENT.
    // Green on Windows, red on the other two matrix legs — a platform assumption only a
    // cross-OS run can see.
    const help = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "commands", "help.ts"),
      "utf8",
    )
    expect(help).toContain(`--${TARGET_FLAG} <path>`)
  })
})
