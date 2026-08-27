#!/usr/bin/env node
/**
 * Claude Code plugin install probe — the third evidence arm for HD-07.
 *
 * WHY THIS EXISTS. `claude-code`/`claude-plugin` is the one channel where both of HD-07's
 * arms are structurally unreachable, not merely unsatisfied:
 *
 *   upstream: officialMcpRegistry   Wrong subject. That arm is about the MCP registry
 *                                   carrying our SERVER; this channel distributes a Claude
 *                                   Code PLUGIN. A registry record says nothing about it.
 *   liveUrl                         There is no shelf. Claude Code has no marketplace to be
 *                                   listed on — distribution is a user adding this repo as a
 *                                   marketplace. The only URL available is our own README,
 *                                   and a liveUrl pointing at ourselves is self-endorsement:
 *                                   exactly the 2026-08-23 cursor-plugin defect that HD-07
 *                                   was written to catch.
 *
 * So the channel sat at AUDIT_REQUIRED with a note explaining why it could never move, which
 * is an honest state but a permanent one. This probe supplies the missing third arm: rather
 * than pointing at a page someone else publishes, REPRODUCE THE INSTALL and observe that the
 * third-party tool accepts our manifest. The evidence is an act, not a link.
 *
 * WHAT IT ASSERTS, and each was measured on 2026-08-26 before being encoded:
 *   1. `claude plugin marketplace add <repo>` accepts this repo's .claude-plugin/marketplace.json
 *   2. the marketplace then appears in `claude plugin marketplace list`
 *   3. `claude plugin install calllint@calllint` installs it
 *   4. `claude plugin list` shows it enabled — i.e. registered, not merely reported
 *
 * THE TRAP THIS PROBE IS BUILT AROUND. `claude plugin` EXITS 0 ON FAILURE. Measured:
 *
 *     $ claude plugin install definitely-not-a-plugin@calllint
 *     ✘ Failed to install plugin ...: Plugin "definitely-not-a-plugin" not found
 *     $ echo $?
 *     0
 *
 * A probe that trusted the exit code would pass while installing nothing — this repo's
 * dominant fault class, a guard that cannot observe its subject. So every step is judged on
 * its OUTPUT, and the success marker must be present rather than the failure marker absent
 * (an empty output would satisfy the weaker test).
 *
 * NEGATIVE CONTROLS, run by --self-check, because a probe that only ever passes proves
 * nothing about the subject:
 *   a) installing a plugin name that does not exist in a real marketplace must be detected
 *      as failure despite exit 0
 *   b) adding a directory with no .claude-plugin/marketplace.json must be detected as failure
 * If either control is not detected, the probe reports itself broken instead of reporting the
 * channel healthy.
 *
 * STATE. The probe MUTATES user-level Claude Code settings (it really does install), so it
 * always reverts: uninstall + marketplace remove in a finally block, then re-reads the lists
 * to confirm the revert. It refuses to run if a `calllint` marketplace is already configured,
 * rather than removing something the user set up themselves.
 *
 * NOT A CI GATE. `claude` is not installed on GitHub Actions runners and this repo does not
 * add it: the probe is a local, human-run act whose RESULT is recorded in the SSOT, in the
 * same shape as ADR 0002's submission dates (the act is measured, the record is committed).
 * `--json` prints a record suitable for pasting into the channel's evidence field.
 *
 * Usage:
 *   node scripts/probe-claude-plugin-install.mjs              # probe, human-readable
 *   node scripts/probe-claude-plugin-install.mjs --json       # probe, machine-readable
 *   node scripts/probe-claude-plugin-install.mjs --self-check # + the two negative controls
 *
 * Exits 0 only when every step was observed to succeed AND (under --self-check) both controls
 * were observed to fail. Never publishes, never contacts a maintainer, never opens a PR: it
 * reads a local manifest with a local tool (§19 stays intact — this is not the watcher).
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..")

const MARKETPLACE = "calllint"
const PLUGIN = "calllint@calllint"
const MANIFEST = join(repoRoot, ".claude-plugin", "marketplace.json")

const args = new Set(process.argv.slice(2))
const asJson = args.has("--json")
const selfCheck = args.has("--self-check")

const steps = []
let failures = 0

const log = (...m) => {
  if (!asJson) console.log(...m)
}
const record = (name, ok, detail) => {
  steps.push({ name, ok, detail })
  if (!ok) failures++
  log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`)
}

/**
 * Locate the real `claude` executable.
 *
 * `execFileSync("claude")` does not work on Windows: npm installs a bare POSIX `claude` sh
 * script alongside `claude.cmd`/`claude.ps1`, and CreateProcess can run none of them. The
 * actual binary sits at `node_modules/@anthropic-ai/claude-code/bin/claude.exe` next to the
 * shims. Same class of problem `package-smoke.mjs` solves for npm, same shape of fix: find
 * the real entrypoint rather than trusting the shim. Falls back to bare `claude` on POSIX,
 * where the name on PATH is directly executable.
 */
function claudeBin() {
  const dirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")
  for (const dir of dirs) {
    if (!dir) continue
    const candidates =
      process.platform === "win32"
        ? [
            join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
            join(dir, "claude.exe"),
          ]
        : [join(dir, "claude")]
    const hit = candidates.find((c) => existsSync(c))
    if (hit) return hit
  }
  return "claude"
}

const CLAUDE = claudeBin()

/**
 * Run `claude` and return its combined output as a string.
 *
 * `claude` exits 0 even when the operation failed, so the exit status is deliberately NOT
 * consulted here; callers must judge the text. stderr is folded in because the failure
 * markers appear there on some paths.
 */
function claude(argv) {
  try {
    return execFileSync(CLAUDE, argv, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    })
  } catch (error) {
    // A real non-zero exit (or a timeout) still carries output worth judging.
    return `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`
  }
}

/** Success is asserted POSITIVELY: the marker must be present. Absence of "✘" is not enough. */
const succeeded = (out, marker) => out.includes("✔") && out.includes(marker)
const failed = (out) => out.includes("✘") || /\bFailed\b/.test(out)

function main() {
  log("Claude Code plugin install probe\n")

  if (!existsSync(MANIFEST)) {
    record("marketplace manifest exists", false, `${MANIFEST} not found`)
    return
  }
  record("marketplace manifest exists", true, ".claude-plugin/marketplace.json")

  const claudeVersion = claude(["--version"]).trim()
  if (!/\d+\.\d+\.\d+/.test(claudeVersion)) {
    record(
      "claude CLI available",
      false,
      "the `claude` CLI is not on PATH. This probe is a local act by design; it is not a CI gate.",
    )
    return
  }
  record("claude CLI available", true, claudeVersion)

  // Refuse to clobber a marketplace the user configured themselves.
  if (claude(["plugin", "marketplace", "list"]).includes(MARKETPLACE)) {
    record(
      "no pre-existing calllint marketplace",
      false,
      `a marketplace named "${MARKETPLACE}" is already configured. Remove it first — this ` +
        `probe will not delete a registration it did not create.`,
    )
    return
  }
  record("no pre-existing calllint marketplace", true, "clean slate")

  let added = false
  let installed = false
  try {
    const addOut = claude(["plugin", "marketplace", "add", repoRoot])
    added = succeeded(addOut, "added marketplace")
    record("marketplace add accepted our manifest", added, added ? undefined : addOut.trim().slice(0, 200))
    if (!added) return

    const listOut = claude(["plugin", "marketplace", "list"])
    record(
      "marketplace appears in the configured list",
      listOut.includes(MARKETPLACE),
      listOut.includes(MARKETPLACE) ? "Source: Directory" : listOut.trim().slice(0, 200),
    )

    const installOut = claude(["plugin", "install", PLUGIN])
    installed = succeeded(installOut, "installed plugin")
    record("plugin install succeeded", installed, installed ? PLUGIN : installOut.trim().slice(0, 200))
    if (!installed) return

    // The strongest of the four: not "the command said OK" but "the tool now lists it".
    const pluginList = claude(["plugin", "list"])
    const enabled = pluginList.includes(PLUGIN) && pluginList.includes("enabled")
    record(
      "plugin is registered and enabled",
      enabled,
      enabled ? "claude plugin list reports enabled" : pluginList.trim().slice(0, 200),
    )

    // STEP 5, added 2026-08-27 because the first four were all true while the product was
    // NOT reachable. Measured that day: the plugin installed and reported `enabled`, and
    // `claude mcp list` said "No MCP servers configured" — the MCP server, which is the
    // actual product, was silently absent. Cause: the manifest was `mcp.json` (Cursor's
    // shape) with no `.mcp.json` (the name Claude Code and Copilot CLI read).
    //
    // So "installed and enabled" is NOT evidence that the channel delivers CallLint, and a
    // probe that stopped at step 4 would have backed an AVAILABLE claim about a plugin that
    // shipped a skill and nothing else. Asserted positively on `✔ Connected`: a server that
    // is listed but unhealthy is not a working channel, and an empty output must not pass.
    const mcpList = claude(["mcp", "list"])
    const serverLive = /plugin:calllint:calllint\b/.test(mcpList) && mcpList.includes("✔ Connected")
    record(
      "the plugin's MCP server registers and connects",
      serverLive,
      serverLive
        ? "claude mcp list reports plugin:calllint:calllint ✔ Connected"
        : `NOT reachable — this is the 2026-08-27 defect recurring. ${mcpList.trim().slice(0, 200)}`,
    )

    if (selfCheck) runControls()
  } finally {
    // Always revert, including on an early return above.
    if (installed) claude(["plugin", "uninstall", PLUGIN])
    if (added) claude(["plugin", "marketplace", "remove", MARKETPLACE])

    const afterPlugins = claude(["plugin", "list"])
    const afterMarkets = claude(["plugin", "marketplace", "list"])
    record(
      "local state reverted",
      !afterPlugins.includes(PLUGIN) && !afterMarkets.includes(`❯ ${MARKETPLACE}\n`),
      "plugin uninstalled and marketplace removed",
    )
  }
}

/**
 * The two negative controls. Each must be DETECTED as a failure; if the probe's own
 * failure-detection cannot see them, the probe is broken and says so.
 */
function runControls() {
  log("\nNegative controls (the probe must be able to fail):")

  const bogusPlugin = claude(["plugin", "install", `definitely-not-a-plugin@${MARKETPLACE}`])
  record(
    "CONTROL: a nonexistent plugin name is detected as failure",
    failed(bogusPlugin) && !succeeded(bogusPlugin, "installed plugin"),
    "exit code is 0 here — detection is by output, which is the point",
  )

  const emptyDir = mkdtempSync(join(tmpdir(), "calllint-probe-control-"))
  try {
    const bogusMarket = claude(["plugin", "marketplace", "add", emptyDir])
    record(
      "CONTROL: a directory with no marketplace.json is detected as failure",
      failed(bogusMarket) && !succeeded(bogusMarket, "added marketplace"),
      "Marketplace file not found",
    )
  } finally {
    rmSync(emptyDir, { recursive: true, force: true })
  }
}

main()

if (asJson) {
  console.log(
    JSON.stringify(
      {
        probe: "claude-plugin-install",
        channel: "claude-code/claude-plugin",
        ok: failures === 0,
        selfChecked: selfCheck,
        steps,
      },
      null,
      2,
    ),
  )
} else {
  console.log(
    failures === 0
      ? `\n✅ Probe PASSED — ${steps.length} step(s) observed, local state reverted.`
      : `\n❌ Probe FAILED — ${failures} of ${steps.length} step(s).`,
  )
}

process.exit(failures === 0 ? 0 : 1)
