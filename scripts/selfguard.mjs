#!/usr/bin/env node
/**
 * CallLint self-guard — opt-in dogfooding script.
 *
 * Scans this repo's own MCP config with the built CallLint CLI and prints the
 * verdict. Intended to be run manually, in CI, or wired into a Claude Code
 * PreToolUse hook by the user (see README "Self-guard"). This script does NOT
 * install itself anywhere and does not modify agent behavior on its own.
 *
 * Usage:
 *   node scripts/selfguard.mjs                    # advisory: always exits 0
 *   node scripts/selfguard.mjs --ci               # exits non-zero on BLOCK/UNKNOWN
 *   node scripts/selfguard.mjs path/to/mcp.json   # scan an explicit config
 */
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..")
const cli = join(repoRoot, "apps", "cli", "dist", "index.js")

const CANDIDATES = [
  ".mcp.json",
  ".cursor/mcp.json",
  ".vscode/mcp.json",
  "examples/sample-mcp.json",
]
const argv = process.argv.slice(2)
const ci = argv.includes("--ci")
const explicit = argv.find((a) => !a.startsWith("-"))

function findConfig() {
  if (explicit) return resolve(process.cwd(), explicit)
  for (const rel of CANDIDATES) {
    const p = join(repoRoot, rel)
    if (existsSync(p)) return p
  }
  return undefined
}

if (!existsSync(cli)) {
  process.stderr.write("[calllint] CLI not built. Run `pnpm build` first.\n")
  process.exit(ci ? 3 : 0)
}

const config = findConfig()
if (!config) {
  process.stderr.write("[calllint] No MCP config found in this repo. Nothing to scan.\n")
  process.exit(0)
}

const args = ["scan", config, "--compact", "--no-emoji"]
if (ci) args.push("--ci")

try {
  const out = execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" })
  process.stdout.write(out)
  process.exit(0)
} catch (err) {
  // With --ci, a failing verdict exits non-zero; surface stdout + the code.
  if (err && typeof err === "object" && "stdout" in err) {
    process.stdout.write(String(err.stdout ?? ""))
    process.exit(typeof err.status === "number" ? err.status : 1)
  }
  process.stderr.write("[calllint] self-guard error: " + String(err) + "\n")
  process.exit(ci ? 3 : 0)
}
