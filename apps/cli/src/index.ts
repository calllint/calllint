#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import { nodeHandlerRegistry } from "./commands/urlHandler/nodeRegistry.js"
import { run } from "./run.js"
import { computeOnlineEnrichment } from "./online.js"
import { computeContractFetch, type ContractFetch } from "./commands/safeInstall/contractFetch.js"
import { computeAdoptionRewrite } from "./commands/urlHandler.js"
import { resolveClock } from "./clock.js"
import { breathe } from "./breathe.js"
import { resolveToolVersion } from "./version.js"
import { buildCliEmitter } from "./telemetry.js"

/**
 * The first locally-present host a deep link can actually reach.
 *
 * Deliberately mirrors `realHostConfigPath`'s three APPLYABLE hosts and no others: a
 * plan-only host would let the click dead-end at "cannot apply", which is a worse
 * outcome than the honest "no supported host detected". Existence of the config file is
 * the signal — the same signal the safe-install path itself resolves against.
 */
function detectFirstHost(cwd: string): string | null {
  const candidates: readonly [string, string][] = [
    ["cursor", join(cwd, ".cursor", "mcp.json")],
    ["claude-code", join(homedir(), ".claude.json")],
    ["windsurf", join(homedir(), ".codeium", "mcp_config.json")],
  ]
  for (const [host, path] of candidates) if (existsSync(path)) return host
  return null
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

/**
 * Real contract fetcher over Node's global fetch. The guarded reader
 * (fetchGuardedContract) owns every safety decision — origin allowlist, https,
 * redirect/size/timeout caps, no credentials — and passes the init through; this
 * adapter only bridges Node's fetch to the tiny ContractResponse shape.
 */
const realContractFetch: ContractFetch = (url, init) =>
  fetch(url, init as RequestInit)

/**
 * Changed files for `scan --changed`, via git.  Best-effort: a non-repo, a
 * missing git, or any git error returns "" (the command then reports "nothing
 * to scan" rather than crashing).  `--name-only HEAD` lists staged + unstaged
 * changes against the last commit.
 */
function gitChangedFiles(cwd: string): string {
  try {
    return execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    return ""
  }
}

async function main(): Promise<void> {
  const invoked = process.argv.slice(2)

  // Early exit for telemetry commands (async state operations)
  if (invoked[0] === "telemetry") {
    const { executeTelemetryCommand } = await import("./commands/telemetry.js")
    const exitCode = await executeTelemetryCommand({ command: "telemetry", positional: invoked, flags: {} } as any)
    process.exitCode = exitCode
    return
  }

  // A clicked `calllint://` link continues INTO the authority prompt instead of
  // printing a command to copy (R-2b / ADR 0057 §1+§6). The rewrite happens here,
  // before anything reads argv, so the contract fetch below sees the safe-install
  // command it needs to resolve. Returns null for every other argv and whenever
  // stdin is not a terminal, in which case `url-handler open` prints as before.
  const rewritten =
    computeAdoptionRewrite(invoked, {
      // The SAME detector `url-handler open` uses, so the rewritten command and the
      // printed one can never disagree about which host the click targets.
      detectHost: () => detectFirstHost(process.cwd()),
      stdinIsTty: process.stdin.isTTY === true,
    })
  const argv: string[] = rewritten === null ? invoked : [...rewritten]
  if (rewritten !== null) {
    // Name the command the click became, before it runs. The user reads the command
    // they are about to be asked to approve — the property ADR 0057 §5 protected by
    // printing, kept while continuing into the prompt.
    process.stderr.write(`calllint link → ${["calllint", ...argv].join(" ")}\n`)
  }
  // One clock for the whole run: reports' generatedAt and online findings'
  // fetchedAt share the same timestamp, so a report is internally consistent.
  // `--generated-at <iso>` pins it for deterministic output (corpus / CI).
  let clock
  try {
    clock = resolveClock(argv, () => new Date())
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 2
    return
  }
  const { generatedAt, now } = clock

  let online
  try {
    online = await computeOnlineEnrichment(argv, { fetchedAt: generatedAt })
  } catch (err) {
    process.stderr.write(`--online failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 3
    return
  }

  if (online?.note) process.stderr.write(`online: ${online.note}\n`)

  // Safe-install contract acquisition at the async edge (mirrors --online): resolve
  // the guarded fetch/read here so the synchronous command stays pure + testable.
  // Returns undefined for every non-safe-install command, so all other paths are
  // unchanged and network-free.
  let contract
  try {
    contract = await computeContractFetch(argv, {
      cwd: process.cwd(),
      readStdin,
      fetchImpl: realContractFetch,
    })
  } catch (err) {
    process.stderr.write(`contract fetch failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 3
    return
  }

  // A tiny breathing brand mark on interactive runs (stderr only, never on
  // machine output). Best-effort — must never delay or break the command.
  try {
    await breathe(argv)
  } catch {
    // ignore: branding is cosmetic
  }

  // Telemetry emitter (new11 §3.5 / M1) — wired but DARK: local `cli` tier, no
  // consent, default noopSink. `shouldEmit` returns false, so nothing is emitted
  // and CLI output is byte-identical. This is the only place with process env; the
  // universal CALLLINT_TELEMETRY kill-switch is honored via the injected env.
  const emitter = buildCliEmitter(process.env)

  const result = run(argv, {
    cwd: process.cwd(),
    readStdin,
    // The approval preview must reach the screen before `readStdin` blocks, so it is
    // written directly rather than returned in `CommandResult.stdout`. stderr, so a
    // `--json` consumer's stdout stays a single machine-readable document.
    promptOut: (text: string) => process.stderr.write(text),
    stdinIsTty: process.stdin.isTTY === true,
    now,
    generatedAt,
    online,
    toolVersion: resolveToolVersion(),
    getChangedFilesDiff: () => gitChangedFiles(process.cwd()),
    emitter,
    contract,
    urlHandler: {
      platform: process.platform,
      home: homedir(),
      // `process.execPath` is the node binary; argv[1] is this script. Quoting is the
      // planner's business — this is just the path the OS will invoke.
      binPath: process.argv[1] ?? "calllint",
      registry: nodeHandlerRegistry,
      detectHost: () => detectFirstHost(process.cwd()),
    },
  })

  if (result.stdout) process.stdout.write(result.stdout + "\n")
  if (result.stderr) process.stderr.write(result.stderr + "\n")
  process.exitCode = result.exitCode

  // Best-effort telemetry flush: runs AFTER command completion, never affects output or exit code
  try {
    const { flushTelemetry } = await import("./flush.js")
    await flushTelemetry()
  } catch {
    // Telemetry flush is best-effort, never breaks the CLI
  }
}

void main()
