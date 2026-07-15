import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * B3 — secure-agent-install skill: content + neutrality guardrails.
 *
 * The skill is a distribution artifact (docs + a thin runner), not code with a
 * runtime surface, so this test locks the properties that MUST hold for it to be
 * safe to publish:
 *   - forbidden overclaim / partnership language never appears (ADR 0034 + the
 *     project forbidden-phrase list);
 *   - the skill states it installs nothing and never executes the target;
 *   - the runner shells to `calllint trust prepare` (composes the gateway, no
 *     bespoke scan logic) and does not run an install/enable command itself.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SKILL = join(here, "..", "..", "..", "skills", "secure-agent-install")

/** Read every text file shipped in the skill (recursively). */
function skillFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else out.push({ path: p, text: readFileSync(p, "utf-8") })
    }
  }
  walk(SKILL)
  return out
}

// ADR 0034 forbidden language + the project's overclaim phrases + partnership implications.
const FORBIDDEN = [
  "certified safe",
  "guaranteed safe",
  "guaranteed secure",
  "100% safe",
  "approved by calllint",
  "skillspector-verified",
  "skillspector verified",
  "nvidia approved",
  "nvidia verified",
  "nvidia-verified",
  "in partnership with",
  "official skillspector",
]

describe("secure-agent-install skill", () => {
  const files = skillFiles()

  it("ships the expected files", () => {
    const names = files.map((f) => f.path)
    expect(names.some((n) => n.endsWith("SKILL.md"))).toBe(true)
    expect(names.some((n) => n.endsWith("README.md"))).toBe(true)
    expect(names.some((n) => n.endsWith("runner.sh"))).toBe(true)
    expect(existsSync(join(SKILL, "hosts", "claude-code.md"))).toBe(true)
    expect(existsSync(join(SKILL, "hosts", "cursor.md"))).toBe(true)
    expect(existsSync(join(SKILL, "hosts", "codex.md"))).toBe(true)
  })

  it("contains no forbidden overclaim or partnership language", () => {
    for (const { path, text } of files) {
      const lc = text.toLowerCase()
      for (const phrase of FORBIDDEN) {
        expect(lc.includes(phrase), `${path} contains forbidden phrase "${phrase}"`).toBe(false)
      }
    }
  })

  it("states it installs nothing and never executes the target", () => {
    const skill = files.find((f) => f.path.endsWith("SKILL.md"))!.text.toLowerCase()
    expect(skill).toContain("installs nothing")
    expect(skill.includes("never execute") || skill.includes("never executes")).toBe(true)
    // UNKNOWN must not round up to SAFE.
    expect(skill.includes("unknown is never") || skill.includes("never treated as safe")).toBe(true)
  })

  it("runner shells to `calllint trust prepare` and never runs an install itself", () => {
    const runner = files.find((f) => f.path.endsWith("runner.sh"))!.text
    expect(runner).toContain("trust prepare")
    expect(runner).toContain("--evidence")
    // The runner must not invoke a package-install/enable command of its own.
    expect(/npm install|pnpm add|yarn add|npm i\b/.test(runner)).toBe(false)
  })
})
