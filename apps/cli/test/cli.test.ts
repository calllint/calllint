import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, EXIT } from "../src/run.js"
import { goldenPath } from "@calllint/fixtures"

const BASE = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-cli-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function deps(stdin = "") {
  return { cwd: dir, readStdin: () => stdin, ...BASE }
}

describe("help", () => {
  it("prints usage with no command", () => {
    const r = run([], deps())
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("USAGE")
  })
})

describe("scan via stdin", () => {
  it("BLOCK config without --ci exits 0 but reports BLOCK", () => {
    const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
    const r = run(["scan", "--stdin", "--no-emoji"], deps(text))
    expect(r.exitCode).toBe(EXIT.OK)
    expect(r.stdout).toContain("BLOCK")
  })

  it("BLOCK config with --ci exits 30", () => {
    const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
    const r = run(["scan", "--stdin", "--ci"], deps(text))
    expect(r.exitCode).toBe(EXIT.BLOCK)
  })

  it("UNKNOWN config with --ci exits 20", () => {
    const text = readFileSync(goldenPath("unknown-remote.json"), "utf8")
    const r = run(["scan", "--stdin", "--ci"], deps(text))
    expect(r.exitCode).toBe(EXIT.UNKNOWN)
  })

  it("SAFE config with --ci exits 0", () => {
    const text = readFileSync(goldenPath("safe-time.json"), "utf8")
    const r = run(["scan", "--stdin", "--ci"], deps(text))
    expect(r.exitCode).toBe(EXIT.OK)
  })

  it("REVIEW config with --ci exits 0 by default (failOnReview false)", () => {
    const text = readFileSync(goldenPath("review-github.json"), "utf8")
    const r = run(["scan", "--stdin", "--ci"], deps(text))
    expect(r.exitCode).toBe(EXIT.OK)
  })

  it("--json emits parseable emoji-free JSON", () => {
    const text = readFileSync(goldenPath("block-prompt-poison.json"), "utf8")
    const r = run(["scan", "--stdin", "--json"], deps(text))
    const parsed = JSON.parse(r.stdout)
    expect(parsed.verdict).toBe("BLOCK")
    expect(/\p{Extended_Pictographic}/u.test(r.stdout)).toBe(false)
  })

  it("malformed JSON exits with parse error", () => {
    const text = readFileSync(goldenPath("malformed.json"), "utf8")
    const r = run(["scan", "--stdin"], deps(text))
    expect(r.exitCode).toBe(EXIT.ERROR)
    expect(r.stderr).toContain("Parse error")
  })
})

describe("diagnostics", () => {
  it("--json emits the diagnostics.v0 schema with populated key-path entries", () => {
    const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
    const r = run(["diagnostics", "--stdin", "--json"], deps(text))
    expect(r.exitCode).toBe(EXIT.OK)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.schemaVersion).toBe("calllint.diagnostics.v0")
    expect(parsed.verdict).toBe("BLOCK")
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
    const broad = parsed.diagnostics.find(
      (d: { ruleId: string }) => d.ruleId === "files.broad-path",
    )
    expect(broad).toBeTruthy()
    expect(broad.keyPath).toBeTruthy()
    expect(broad.remediation).toBeTruthy()
    expect(broad.verdictContribution).toBe("blocker")
  })

  it("populates real line/column for a config-key finding, null when unmappable", () => {
    const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
    const r = run(["diagnostics", "--stdin", "--json"], deps(text))
    const parsed = JSON.parse(r.stdout)
    // A config-key finding (broad path on args) gets a real source position.
    const broad = parsed.diagnostics.find(
      (d: { ruleId: string }) => d.ruleId === "files.broad-path",
    )
    expect(typeof broad.line).toBe("number")
    expect(broad.line).toBeGreaterThan(0)
    // A binding-derived finding (unpinned package) has no source key → null.
    const unpinned = parsed.diagnostics.find(
      (d: { ruleId: string; keyPath: string }) =>
        d.ruleId === "supply.unpinned-package" && d.keyPath === "package",
    )
    if (unpinned) {
      expect(unpinned.line).toBeNull()
      expect(unpinned.column).toBeNull()
    }
  })

  it("a SAFE config yields a valid envelope with no diagnostics", () => {
    const text = readFileSync(goldenPath("safe-time.json"), "utf8")
    const r = run(["diagnostics", "--stdin", "--json"], deps(text))
    expect(r.exitCode).toBe(EXIT.OK)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.schemaVersion).toBe("calllint.diagnostics.v0")
    expect(parsed.verdict).toBe("SAFE")
    expect(parsed.diagnostics).toEqual([])
  })

  it("emits emoji-free JSON", () => {
    const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
    const r = run(["diagnostics", "--stdin", "--json"], deps(text))
    expect(/\p{Extended_Pictographic}/u.test(r.stdout)).toBe(false)
  })

  it("requires --json (usage error otherwise)", () => {
    const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
    const r = run(["diagnostics", "--stdin"], deps(text))
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("JSON only")
  })

  it("--ci maps the verdict to an exit code (BLOCK=30) without changing it", () => {
    const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
    const r = run(["diagnostics", "--stdin", "--json", "--ci"], deps(text))
    expect(r.exitCode).toBe(EXIT.BLOCK)
    expect(JSON.parse(r.stdout).verdict).toBe("BLOCK")
  })

  it("malformed JSON exits with parse error", () => {
    const text = readFileSync(goldenPath("malformed.json"), "utf8")
    const r = run(["diagnostics", "--stdin", "--json"], deps(text))
    expect(r.exitCode).toBe(EXIT.ERROR)
    expect(r.stderr).toContain("Parse error")
  })
})

describe("scan file + default discovery", () => {
  it("scans an explicit path", () => {
    const p = join(dir, "mcp.json")
    writeFileSync(p, readFileSync(goldenPath("safe-time.json"), "utf8"))
    const r = run(["scan", p, "--no-emoji"], deps())
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("SAFE")
  })

  it("discovers .cursor/mcp.json when no path given", () => {
    const cur = join(dir, ".cursor")
    mkdirSync(cur, { recursive: true })
    writeFileSync(join(cur, "mcp.json"), readFileSync(goldenPath("safe-time.json"), "utf8"))
    const r = run(["scan", "--no-emoji"], deps())
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("time")
  })

  it("errors when no config found", () => {
    const r = run(["scan"], deps())
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("No config")
  })
})

describe("explain", () => {
  it("explains a server from the cached scan", () => {
    const text = readFileSync(goldenPath("block-filesystem.json"), "utf8")
    run(["scan", "--stdin"], deps(text))
    const r = run(["explain", "filesystem", "--no-emoji"], deps())
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Findings")
    expect(r.stdout).toContain("files.broad-path")
  })

  it("errors for unknown server", () => {
    const text = readFileSync(goldenPath("safe-time.json"), "utf8")
    run(["scan", "--stdin"], deps(text))
    const r = run(["explain", "nope"], deps())
    expect(r.exitCode).toBe(EXIT.USAGE)
  })
})

describe("policy", () => {
  it("init writes a default policy and explain reads it", () => {
    const r = run(["policy", "init"], deps())
    expect(r.exitCode).toBe(0)
    expect(existsSync(join(dir, "calllint.policy.json"))).toBe(true)

    const explain = run(["policy", "explain", "--policy", join(dir, "calllint.policy.json")], deps())
    expect(explain.exitCode).toBe(0)
    expect(JSON.parse(explain.stdout).schemaVersion).toBe("calllint.policy.v0")
  })

  it("init refuses to overwrite without --force", () => {
    run(["policy", "init"], deps())
    const second = run(["policy", "init"], deps())
    expect(second.exitCode).toBe(EXIT.USAGE)
  })
})

describe("synthetic targets (npm / github)", () => {
  it("scans an npm package offline", () => {
    const r = run(["scan", "npm:mcp-weather@latest", "--no-emoji"], deps())
    expect(r.exitCode).toBe(EXIT.OK)
    expect(r.stdout).toContain("REVIEW")
    expect(r.stdout).toContain("mcp-weather")
  })

  it("npm target works with --json and is parseable", () => {
    const r = run(["scan", "npm:mcp-stripe-pay@1.0.0", "--json"], deps())
    const parsed = JSON.parse(r.stdout)
    expect(parsed.configPath).toBe("npm:mcp-stripe-pay@1.0.0")
    expect(parsed.reports[0].symbols).toContain("MONEY")
  })

  it("github target offline tells the user to use --online", () => {
    const r = run(["scan", "github:owner/repo"], deps())
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("--online")
  })
})

describe("unknown command", () => {
  it("exits 2", () => {
    const r = run(["frobnicate"], deps())
    expect(r.exitCode).toBe(2)
  })
})

describe("baseline + verify (drift)", () => {
  const v1 = JSON.stringify({
    mcpServers: { weather: { command: "npx", args: ["-y", "mcp-weather@1.0.0"] } },
  })
  const v2 = JSON.stringify({
    mcpServers: { weather: { command: "npx", args: ["-y", "mcp-weather@2.0.0"] } },
  })

  it("baseline writes a file, verify reports no drift on identical config", () => {
    const b = run(["baseline", "--stdin"], deps(v1))
    expect(b.exitCode).toBe(EXIT.OK)
    expect(existsSync(join(dir, ".calllint", "baseline.json"))).toBe(true)

    const v = run(["verify", "--stdin", "--ci"], deps(v1))
    expect(v.exitCode).toBe(EXIT.OK)
    expect(v.stdout).toContain("no drift")
  })

  it("verify flags a pinned-version bump as a rug-pull and exits 40 under --ci", () => {
    run(["baseline", "--stdin"], deps(v1))
    const v = run(["verify", "--stdin", "--ci"], deps(v2))
    expect(v.exitCode).toBe(EXIT.DRIFT)
    expect(v.stdout).toContain("RUG-PULL")
  })

  it("verify without a baseline errors", () => {
    const v = run(["verify", "--stdin"], deps(v1))
    expect(v.exitCode).toBe(EXIT.ERROR)
    expect(v.stderr).toContain("No baseline")
  })

  it("drift without --ci still exits 0 (advisory)", () => {
    run(["baseline", "--stdin"], deps(v1))
    const v = run(["verify", "--stdin"], deps(v2))
    expect(v.exitCode).toBe(EXIT.OK)
    expect(v.stdout).toContain("RUG-PULL")
  })
})
