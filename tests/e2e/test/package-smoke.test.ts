import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { goldenPath } from "@calllint/fixtures"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const cliDir = join(repoRoot, "apps", "cli")
const binary = join(cliDir, "dist", "index.js")
const cliPkg = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8"))

function runBin(args: string[], input?: string): { stdout: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [binary, ...args], {
      input: input ?? "",
      encoding: "utf8",
      cwd: repoRoot,
    })
    return { stdout, code: 0 }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { stdout: e.stdout ?? "", code: e.status ?? 1 }
  }
}

/**
 * Package smoke test: validates the *shipped artifact* the way a consumer would
 * receive it — the bin entry resolves, the bundle is self-contained, and a real
 * scan works through it. This is the release-readiness gate. It runs the built
 * bundle (per ADR/the monorepo's esbuild strategy); a true `npm pack` of the
 * private workspace package is a separate, documented release step (see
 * docs/release-checklist.md).
 */
describe("package smoke (shipped artifact)", () => {
  beforeAll(() => {
    execFileSync(process.execPath, ["./build.mjs"], { cwd: cliDir, stdio: "ignore" })
    expect(existsSync(binary)).toBe(true)
  })

  it("declares a bin entry pointing at the built artifact", () => {
    // npm canonicalizes to "dist/index.js" (no ./) on publish; accept either.
    expect(cliPkg.bin?.calllint?.replace(/^\.\//, "")).toBe("dist/index.js")
    expect(cliPkg.type).toBe("module")
  })

  it("ships an executable node shebang", () => {
    const firstLine = readFileSync(binary, "utf8").split("\n", 1)[0]
    expect(firstLine).toBe("#!/usr/bin/env node")
  })

  it("is a self-contained bundle (no unresolved @calllint/* runtime imports)", () => {
    const code = readFileSync(binary, "utf8")
    // workspace deps must be inlined by the bundler, not left as bare imports a
    // consumer's node_modules would have to resolve.
    expect(code).not.toMatch(/from\s+["']@calllint\//)
    expect(code).not.toMatch(/require\(["']@calllint\//)
  })

  it("prints usage and exits 0 with --help", () => {
    const { stdout, code } = runBin(["--help"])
    expect(code).toBe(0)
    expect(stdout).toContain("USAGE")
    expect(stdout).toContain("calllint")
  })

  it("runs a real scan through the bin entry", () => {
    const { stdout, code } = runBin(["scan", goldenPath("safe-time.json"), "--no-emoji"])
    expect(code).toBe(0)
    expect(stdout).toContain("SAFE")
  })

  it("reports a usage error (exit 2) for an unknown command", () => {
    const { code } = runBin(["definitely-not-a-command"])
    expect(code).toBe(2)
  })
})
