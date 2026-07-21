/**
 * Install-command single-source invariants (new11 §1.1 / A5).
 *
 * `project-facts.json.install` is the ONE authoritative home for CallLint's own
 * install/invocation commands. These assertions lock its shape so the block cannot
 * silently rot: every command is a non-empty `npx …` string, `scan` stays the
 * canonical form of the legacy `defaultInstallCommand`, and no two keys advertise
 * the same binary with different flags (which would reintroduce the drift this block
 * exists to kill). The presence-in-served-copy half is enforced by check:public-copy.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const facts = JSON.parse(fs.readFileSync(path.join(repoRoot, "project-facts.json"), "utf8"))

describe("project-facts install block — single source (§1.1)", () => {
  it("exists with a description and at least the four core commands", () => {
    expect(facts.install).toBeTruthy()
    expect(typeof facts.install.description).toBe("string")
    for (const key of ["scan", "scanCi", "mcpServer", "integrate"]) {
      expect(typeof facts.install[key]).toBe("string")
      expect(facts.install[key].length).toBeGreaterThan(0)
    }
  })

  it("every command (except description) is an npx invocation", () => {
    for (const [key, val] of Object.entries(facts.install)) {
      if (key === "description") continue
      expect(val, `install.${key}`).toMatch(/^npx /)
    }
  })

  it("install.scan is the canonical form of defaultInstallCommand", () => {
    expect(facts.install.scan).toBe(facts.defaultInstallCommand)
  })

  it("every command is distinct (no redundant duplicate entries)", () => {
    // Each key names a different invocation; two keys holding the byte-identical
    // command would be dead weight and a drift hazard (edit one, forget the other).
    const cmds = Object.entries(facts.install)
      .filter(([k]) => k !== "description")
      .map(([, v]) => String(v))
    expect(new Set(cmds).size, `duplicate commands: ${cmds.join(" | ")}`).toBe(cmds.length)
  })
})
