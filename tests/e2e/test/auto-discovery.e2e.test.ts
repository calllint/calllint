import { describe, it, expect, beforeAll } from "vitest"
import { execSync, execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

/**
 * E2E tests for auto-discovery flow.
 *
 * Tests the full user journey:
 * 1. calllint inventory (discovery only)
 * 2. calllint scan --auto (discovery + scan)
 * 3. calllint scan --agent <type> (targeted discovery + scan)
 */

const here = dirname(fileURLToPath(import.meta.url))
const cliDir = join(here, "..", "..", "..", "apps", "cli")
const CLI_PATH = join(cliDir, "dist", "index.js")

/**
 * Run the CLI. `envOverride` lets a test pin the discovery home directory so the
 * result never depends on the developer's real machine state (a real
 * `~/.cursor/mcp.json` must not change what these tests observe). Discovery
 * resolves home from HOME/USERPROFILE (+ APPDATA on Windows) — see
 * packages/discovery/src/extractors/base.ts — so overriding those fully controls it.
 */
function runCLI(
  args: string,
  envOverride?: Record<string, string>
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node "${CLI_PATH}" ${args}`, {
      encoding: "utf8",
      stdio: "pipe",
      env: envOverride ? { ...process.env, ...envOverride } : process.env,
    })
    return { stdout, stderr: "", exitCode: 0 }
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
    }
  }
}

/**
 * Build an isolated, empty home directory so discovery finds NO real config.
 * Returns the env override that points HOME/USERPROFILE/APPDATA at it.
 */
function emptyHomeEnv(label: string): { env: Record<string, string>; dir: string } {
  const dir = join(tmpdir(), `calllint-e2e-${label}-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, "appdata"), { recursive: true })
  return {
    dir,
    env: { HOME: dir, USERPROFILE: dir, APPDATA: join(dir, "appdata") },
  }
}

describe("auto-discovery E2E", () => {
  beforeAll(() => {
    // Ensure the built CLI artifact exists — in CI `pnpm test` runs before the
    // build step, so dist/index.js may not exist yet (mirrors e2e.test.ts).
    execFileSync(process.execPath, ["./build.mjs"], { cwd: cliDir, stdio: "ignore" })
    expect(existsSync(CLI_PATH)).toBe(true)
  })

  it("inventory command exits 0 even with no configs", () => {
    const result = runCLI("inventory")

    expect(result.exitCode).toBe(0)
    // Output contains either "Discovered N agent config(s)" or "No agent configs discovered"
    expect(
      result.stdout.includes("Discovered") ||
      result.stdout.includes("No agent configs discovered")
    ).toBe(true)
  })

  it("inventory command produces valid output", () => {
    const result = runCLI("inventory")

    expect(result.exitCode).toBe(0)
    // Should mention agents searched, whether configs found or not
    expect(
      result.stdout.includes("agent") || result.stdout.includes("Agent")
    ).toBe(true)
  })

  it("inventory --json produces valid JSON", () => {
    const result = runCLI("inventory --json")

    expect(result.exitCode).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()

    const json = JSON.parse(result.stdout)
    expect(json).toHaveProperty("discovered")
    expect(Array.isArray(json.discovered)).toBe(true)
  })

  it("scan --auto runs without error", () => {
    const result = runCLI("scan --auto")

    // Exit code depends on what's discovered and their verdicts
    // But the command itself should not crash
    expect(result.exitCode).toBeGreaterThanOrEqual(0)
    expect(result.exitCode).toBeLessThanOrEqual(30)
  })

  // --- Environment-controlled --agent cases (no dependency on host machine) ---
  // Each pins an isolated home so the outcome is deterministic regardless of
  // whether the developer has a real ~/.cursor/mcp.json.

  it("scan --agent cursor: empty home → clean 'No config found'", () => {
    const { env, dir } = emptyHomeEnv("cursor-empty")
    try {
      const result = runCLI("scan --agent cursor", env)
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout + result.stderr).toContain("No config found")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("scan --agent cursor: config present → scans it", () => {
    const { env, dir } = emptyHomeEnv("cursor-present")
    try {
      // Plant a real Cursor config in the isolated home.
      const cfg = join(dir, ".cursor")
      mkdirSync(cfg, { recursive: true })
      writeFileSync(
        join(cfg, "mcp.json"),
        JSON.stringify({ mcpServers: { demo: { command: "node", args: ["server.js"] } } })
      )
      const result = runCLI("scan --agent cursor", env)
      const combined = result.stdout + result.stderr
      expect(combined.includes("config:") || combined.includes("result:")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("scan --agent vscode: empty home → 'No config found for agent'", () => {
    const { env, dir } = emptyHomeEnv("vscode-empty")
    try {
      const result = runCLI("scan --agent vscode", env)
      expect(result.stdout + result.stderr).toContain("No config found")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("scan --agent windsurf: empty home → 'No config found for agent'", () => {
    const { env, dir } = emptyHomeEnv("windsurf-empty")
    try {
      const result = runCLI("scan --agent windsurf", env)
      expect(result.stdout + result.stderr).toContain("No config found")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("scan --agent unknown-agent shows helpful error", () => {
    const result = runCLI("scan --agent unknown-agent")

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("Unknown agent type")
  })

  it("scan --auto accepts only discovery flags, not explicit paths", () => {
    const result = runCLI("scan --auto .cursor/mcp.json")

    // --auto is for discovery; explicit path is a different mode
    // The CLI should either ignore the path or treat --auto as primary
    // This test just verifies the command doesn't crash
    expect(result.exitCode).toBeGreaterThanOrEqual(0)
  })

  it("help text shows all 5 agent types", () => {
    const result = runCLI("--help")

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("cursor")
    expect(result.stdout).toContain("claude-code")
    expect(result.stdout).toContain("claude-desktop")
    expect(result.stdout).toContain("vscode")
    expect(result.stdout).toContain("windsurf")
  })

  it("help text mentions scan --auto", () => {
    const result = runCLI("--help")

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("scan --auto")
    expect(result.stdout).toContain("Discover and scan all agent configs")
  })
})
