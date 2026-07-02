import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// Guard: the CLI's dispatch table (run.ts) and its user-facing help (help.ts)
// must describe the SAME set of commands. R3–R6 shipped commands
// (receipt/action/inbox + receipt sign/keygen) that reached run.ts but not
// help.ts for four release cycles before an audit caught it. This binds the two
// so a new command that skips the help text — or help text naming a command
// that no longer dispatches — fails CI. See memory: docs-bind-to-release.

const here = dirname(fileURLToPath(import.meta.url))
const cliSrc = join(here, "..", "src")

const runSrc = readFileSync(join(cliSrc, "run.ts"), "utf8")
const helpSrc = readFileSync(join(cliSrc, "commands", "help.ts"), "utf8")

/** Commands run.ts dispatches: every `case "<cmd>":` in the switch. */
function runCommands(): Set<string> {
  const cmds = new Set<string>()
  for (const m of runSrc.matchAll(/case\s+"([a-z][a-z-]*)":/g)) cmds.add(m[1])
  // `help` is handled by an early return before the switch, not a case.
  cmds.add("help")
  return cmds
}

/** Commands named in the help COMMANDS block (top-level, first token per line). */
function helpCommands(): Set<string> {
  const start = helpSrc.indexOf("COMMANDS")
  const end = helpSrc.indexOf("CHECK OPTIONS")
  expect(start, "help.ts must have a COMMANDS block").toBeGreaterThan(-1)
  expect(end, "help.ts must have OPTIONS after COMMANDS").toBeGreaterThan(start)
  const block = helpSrc.slice(start, end)
  const cmds = new Set<string>()
  for (const line of block.split("\n")) {
    // Lines look like `  scan [target]  ...` or `  receipt verify <f>  ...`.
    // Take the first lowercase token as the top-level command. Skip headings
    // ("COMMANDS", "Advanced:") and blank lines.
    const m = line.match(/^\s{2,}([a-z][a-z-]*)\b/)
    if (m) cmds.add(m[1])
  }
  return cmds
}

describe("CLI help ↔ dispatch parity", () => {
  const dispatched = runCommands()
  const helped = helpCommands()

  it("every dispatched command appears in help COMMANDS", () => {
    const missingFromHelp = [...dispatched].filter((c) => !helped.has(c)).sort()
    expect(missingFromHelp, `commands dispatched by run.ts but absent from help.ts: ${missingFromHelp.join(", ")}`).toEqual([])
  })

  it("every help COMMANDS entry is actually dispatched", () => {
    const missingFromRun = [...helped].filter((c) => !dispatched.has(c)).sort()
    expect(missingFromRun, `commands named in help.ts but not dispatched by run.ts: ${missingFromRun.join(", ")}`).toEqual([])
  })
})
