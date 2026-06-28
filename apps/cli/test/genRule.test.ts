import { describe, it, expect } from "vitest"
import { run, EXIT } from "../src/run.js"
import { genRuleCommand, generateAllRules } from "../src/commands/genRule.js"

const CLOCK = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
  writeCacheFile: false as const,
  readStdin: () => "",
}

const deps = (over: Record<string, unknown> = {}) => ({ cwd: "/repo", ...CLOCK, ...over })

describe("gen-rule command (P3.2)", () => {
  it("lists hosts when no --host is given", () => {
    const res = run(["gen-rule"], deps())
    expect(res.exitCode).toBe(EXIT.OK)
    expect(res.stdout).toContain("Hosts:")
    expect(res.stdout).toContain("claude")
    expect(res.stdout).toContain("CLAUDE.md")
  })

  it("prints the rule for a known host", () => {
    const res = run(["gen-rule", "--host", "claude"], deps())
    expect(res.exitCode).toBe(EXIT.OK)
    expect(res.stdout).toContain("CallLint Agent Tool Safety Rule")
    expect(res.stdout).toContain("npx -y calllint check")
  })

  it("rejects an unknown host", () => {
    const res = run(["gen-rule", "--host", "notahost"], deps())
    expect(res.exitCode).toBe(EXIT.USAGE)
    expect(res.stderr).toContain("Unknown host")
  })

  it("--write writes to the host's default path (injected writer)", () => {
    const written: Record<string, string> = {}
    // The write path takes an injected writer, so exercise genRuleCommand
    // directly (run() does not thread writeFile through RunDeps).
    const res = genRuleCommand(
      { command: "gen-rule", flags: { host: "cursor", write: true }, positionals: [] },
      { cwd: "/repo", writeFile: (p, c) => (written[p] = c) },
    )
    expect(res.exitCode).toBe(EXIT.OK)
    expect(res.stdout).toContain("Wrote .cursor/rules/calllint.mdc")
    const path = Object.keys(written)[0]!.replace(/\\/g, "/")
    expect(path).toContain(".cursor/rules/calllint.mdc")
    expect(written[Object.keys(written)[0]!]).toContain("alwaysApply: true")
  })

  it("--out overrides the output path", () => {
    const written: Record<string, string> = {}
    const res = genRuleCommand(
      {
        command: "gen-rule",
        flags: { host: "claude", write: true, out: "docs/agent-rules/CLAUDE.md" },
        positionals: [],
      },
      { cwd: "/repo", writeFile: (p, c) => (written[p] = c) },
    )
    expect(res.exitCode).toBe(EXIT.OK)
    expect(Object.keys(written)[0]!.replace(/\\/g, "/")).toContain("docs/agent-rules/CLAUDE.md")
  })
})

describe("generateAllRules (dogfood/docs)", () => {
  it("renders one file per host with the canonical rule", () => {
    const written: Record<string, string> = {}
    const paths = generateAllRules("docs/agent-rules", (p, c) => (written[p] = c))
    expect(paths).toContain("CLAUDE.md")
    expect(paths).toContain("AGENTS.md")
    for (const c of Object.values(written)) {
      expect(c).toContain("npx -y calllint check")
    }
  })
})
