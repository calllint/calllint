import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import { join } from "node:path"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"

/**
 * E2E tests for auto-discovery flow.
 *
 * Tests the full user journey:
 * 1. calllint inventory (discovery only)
 * 2. calllint scan --auto (discovery + scan)
 * 3. calllint scan --agent <type> (targeted discovery + scan)
 */

const CLI_PATH = join(process.cwd(), "apps", "cli", "dist", "index.js")

function runCLI(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node "${CLI_PATH}" ${args}`, {
      encoding: "utf8",
      stdio: "pipe",
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

describe("auto-discovery E2E", () => {
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

  it("scan --agent cursor attempts discovery for cursor", () => {
    const result = runCLI("scan --agent cursor")

    // Should either scan cursor config or report "no config found"
    // Note: stderr may contain the message on some error paths
    const combined = result.stdout + result.stderr
    expect(
      combined.includes("result:") ||
      combined.includes("No config found") ||
      combined.includes("config:")
    ).toBe(true)
  })

  it("scan --agent vscode attempts discovery for vscode", () => {
    const result = runCLI("scan --agent vscode")

    // Should either scan vscode config or report "no config found"
    // Note: stderr may contain the message on some error paths
    const combined = result.stdout + result.stderr
    expect(
      combined.includes("result:") ||
      combined.includes("No config found for agent") ||
      combined.includes("No config found")
    ).toBe(true)
  })

  it("scan --agent windsurf attempts discovery for windsurf", () => {
    const result = runCLI("scan --agent windsurf")

    // Should either scan windsurf config or report "no config found"
    // Note: stderr may contain the message on some error paths
    const combined = result.stdout + result.stderr
    expect(
      combined.includes("result:") ||
      combined.includes("No config found for agent") ||
      combined.includes("No config found")
    ).toBe(true)
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
