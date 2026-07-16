import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  decideRepoSurfaces,
  verifyApproved,
  readApproved,
  defaultApprovedPath,
  assessGuardDrift,
  guardFailClosed,
  renderCiGate,
  type GuardAssessment,
} from "@calllint/core"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface GuardDeps {
  cwd: string
  now: number
  generatedAt: string
  /** When false, `guard install` / disable / enable do not write to disk (tests). */
  writeFile?: boolean
  /** Injected env for the disable check; defaults to the real process env. */
  env?: Record<string, string | undefined>
}

// ---------------------------------------------------------------------------
// H1 — Continuous Guard command (ADR 0045). A thin lifecycle + presentation
// layer over the shipped approved-state drift engine (verifyApproved, ADR 0024)
// and the pure retention engine (assessGuardDrift, ADR 0045). It adds NO new
// drift engine and NO new verdict vocabulary — only silence-when-unchanged, a
// verdict-aware exit, and install/status/disable.
// ---------------------------------------------------------------------------

const GUARD_HOSTS = ["git", "github"] as const
type GuardHost = (typeof GUARD_HOSTS)[number]

interface GuardConfig {
  schemaVersion: "calllint.guard-config.v0"
  enabled: boolean
}

function guardConfigPath(cwd: string): string {
  return join(cwd, ".calllint", "guard.json")
}

/** Read the local guard config. Absent file = enabled (the default). */
function readGuardConfig(cwd: string): GuardConfig | undefined {
  const path = guardConfigPath(cwd)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GuardConfig
  } catch {
    return undefined
  }
}

/** Guard is disabled by an env override OR a committed `enabled:false` flag. */
function isDisabled(cwd: string, env: Record<string, string | undefined>): boolean {
  if (env["CALLLINT_GUARD"] === "0") return true
  return readGuardConfig(cwd)?.enabled === false
}

/**
 * `calllint guard [install|status|disable|enable]`.
 *   guard             assess authority-surface drift; silent when unchanged.
 *   guard install     write a host hook that shells out to `calllint guard`.
 *   guard status      report baseline / disable / installed-hook state.
 *   guard disable     write `.calllint/guard.json { enabled: false }`.
 *   guard enable      clear the disable flag.
 */
export function guardCommand(args: ParsedArgs, deps: GuardDeps): CommandResult {
  // positionals[0] is the guard subcommand (run.ts strips the top-level command).
  const sub = args.positionals[0]
  const env = deps.env ?? process.env
  switch (sub) {
    case "install":
      return guardInstall(args, deps)
    case "status":
      return guardStatus(args, deps, env)
    case "disable":
      return guardSetEnabled(deps, false)
    case "enable":
      return guardSetEnabled(deps, true)
    case undefined:
      return guardRun(args, deps, env)
    default:
      return {
        stdout: "",
        stderr: `Unknown guard subcommand: ${sub}\nRun \`calllint guard\` (assess) or \`calllint guard install|status|disable|enable\`.`,
        exitCode: EXIT.USAGE,
      }
  }
}

/** Map the pure assessment's action onto the stable CLI exit codes (ADR 0045 §2). */
function exitForAction(a: GuardAssessment): number {
  switch (a.action) {
    case "silent":
    case "note":
      return EXIT.OK
    case "prompt":
      return EXIT.REVIEW // 10
    case "request-evidence":
      return EXIT.UNKNOWN // 20
    case "refuse":
      return EXIT.BLOCK // 30
    case "fail-closed":
      return EXIT.ERROR // 3 — the guard itself could not verify
  }
}

/** The core verb: assess drift and respond, silent when nothing changed. */
function guardRun(
  args: ParsedArgs,
  deps: GuardDeps,
  env: Record<string, string | undefined>,
): CommandResult {
  const json = flagBool(args.flags, "json")

  // Disabled: never silently pass. Exit 0 but say so, so the state is visible.
  if (isDisabled(deps.cwd, env)) {
    const note = "Continuous Guard is disabled (CALLLINT_GUARD=0 or .calllint/guard.json)."
    return {
      stdout: json ? JSON.stringify({ enabled: false, note }) : note,
      exitCode: EXIT.OK,
    }
  }

  // Read the approved baseline. Missing = a usage error telling the user to seed
  // it (never a silent pass — ADR 0045 §3).
  const approvedPath = flagStr(args.flags, "approved") ?? defaultApprovedPath(deps.cwd)
  const approved = readApproved(approvedPath)
  if (!approved) {
    return {
      stdout: "",
      stderr: `No approved baseline at ${approvedPath}. Run \`calllint approve\` first.`,
      exitCode: EXIT.USAGE,
    }
  }

  // Compute the current surface and assess. Any failure of the guard's OWN
  // machinery fails closed (UNKNOWN, non-zero) — never a pass (ADR 0045 §3).
  let assessment: GuardAssessment
  try {
    const current = decideRepoSurfaces(deps.cwd, { now: deps.now, generatedAt: deps.generatedAt })
    const drift = verifyApproved(current, approved, deps.generatedAt)
    assessment = assessGuardDrift(drift)
  } catch (err) {
    assessment = guardFailClosed(err instanceof Error ? err.message : String(err))
  }

  const exitCode = exitForAction(assessment)

  if (json) {
    return { stdout: JSON.stringify(assessment), exitCode }
  }

  // Silent-when-unchanged: no stdout on the clean path (the retention promise).
  if (assessment.action === "silent") {
    return { stdout: "", exitCode: EXIT.OK }
  }

  const prefix =
    assessment.action === "fail-closed"
      ? "GUARD FAILED CLOSED"
      : assessment.action === "refuse"
        ? "BLOCK"
        : assessment.action === "request-evidence"
          ? "UNKNOWN"
          : assessment.action === "prompt"
            ? "REVIEW"
            : "NOTE"
  const failLine = assessment.failure ? `\n  reason: ${assessment.failure}` : ""
  return { stdout: `${prefix}: ${assessment.summary}${failLine}`, exitCode }
}

// --- H1c: install / status / disable ---------------------------------------

function isGuardHost(v: string | undefined): v is GuardHost {
  return v !== undefined && (GUARD_HOSTS as readonly string[]).includes(v)
}

/** The local git pre-commit hook body — a declarative shim (ADR 0045 §4). */
const GIT_HOOK = `#!/usr/bin/env bash
# CallLint Continuous Guard (ADR 0045). Re-decides the agent-tool authority
# surface on commit; silent when nothing changed. Generated by \`calllint guard install\`.
# CallLint is static and NEVER executes a scanned server.
npx -y calllint guard --no-emoji
`

function guardArtifact(host: GuardHost): { path: string; content: string; label: string } {
  if (host === "git") {
    return { path: join(".git", "hooks", "pre-commit"), content: GIT_HOOK, label: "git pre-commit hook" }
  }
  // github: reuse the shipped CI-gate workflow (drift mode) verbatim.
  return {
    path: join(".github", "workflows", "calllint.yml"),
    content: renderCiGate({ mode: "drift" }),
    label: "GitHub Actions drift-gate workflow",
  }
}

function guardInstall(args: ParsedArgs, deps: GuardDeps): CommandResult {
  const host = flagStr(args.flags, "host")
  if (!host) {
    const list = GUARD_HOSTS.map((h) => `  ${h.padEnd(8)} → ${guardArtifact(h).label}`).join("\n")
    return {
      stdout: `Usage: calllint guard install --host <host>\n\nHosts:\n${list}`,
      exitCode: EXIT.OK,
    }
  }
  if (!isGuardHost(host)) {
    return {
      stdout: "",
      stderr: `Unknown guard host: ${host}\nRun \`calllint guard install\` to list hosts.`,
      exitCode: EXIT.USAGE,
    }
  }

  const art = guardArtifact(host)
  const rel = flagStr(args.flags, "out") ?? art.path
  if (deps.writeFile === false) {
    return { stdout: `Would write ${rel} (${art.label})`, exitCode: EXIT.OK }
  }
  const abs = resolve(deps.cwd, rel)
  try {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, art.content, "utf8")
  } catch (e) {
    return {
      stdout: "",
      stderr: `Failed to write ${rel}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }
  const note =
    host === "git"
      ? `\nMake it executable: chmod +x ${rel}`
      : ""
  return { stdout: `Wrote ${rel} (${art.label})${note}`, exitCode: EXIT.OK }
}

function guardStatus(
  args: ParsedArgs,
  deps: GuardDeps,
  env: Record<string, string | undefined>,
): CommandResult {
  const approvedPath = flagStr(args.flags, "approved") ?? defaultApprovedPath(deps.cwd)
  const hasBaseline = existsSync(approvedPath)
  const disabled = isDisabled(deps.cwd, env)
  const gitHook = existsSync(join(deps.cwd, ".git", "hooks", "pre-commit"))
  const ghWorkflow = existsSync(join(deps.cwd, ".github", "workflows", "calllint.yml"))

  const status = {
    enabled: !disabled,
    disabledBy: disabled
      ? env["CALLLINT_GUARD"] === "0"
        ? "env:CALLLINT_GUARD=0"
        : "flag:.calllint/guard.json"
      : null,
    approvedBaseline: hasBaseline ? approvedPath : null,
    installedHooks: {
      "git:pre-commit": gitHook,
      "github:workflow": ghWorkflow,
    },
  }

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(status), exitCode: EXIT.OK }
  }

  const lines = [
    `Continuous Guard: ${status.enabled ? "enabled" : `disabled (${status.disabledBy})`}`,
    `Approved baseline: ${hasBaseline ? approvedPath : "none — run `calllint approve`"}`,
    `git pre-commit hook: ${gitHook ? "installed" : "not installed"}`,
    `GitHub workflow: ${ghWorkflow ? "installed" : "not installed"}`,
  ]
  return { stdout: lines.join("\n"), exitCode: EXIT.OK }
}

function guardSetEnabled(deps: GuardDeps, enabled: boolean): CommandResult {
  const cfg: GuardConfig = { schemaVersion: "calllint.guard-config.v0", enabled }
  if (deps.writeFile === false) {
    return { stdout: enabled ? "Would enable Continuous Guard" : "Would disable Continuous Guard", exitCode: EXIT.OK }
  }
  const path = guardConfigPath(deps.cwd)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(cfg, null, 2), "utf8")
  } catch (e) {
    return {
      stdout: "",
      stderr: `Failed to write ${path}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }
  return {
    stdout: enabled
      ? "Continuous Guard enabled (.calllint/guard.json)."
      : "Continuous Guard disabled (.calllint/guard.json). Re-enable with `calllint guard enable`.",
    exitCode: EXIT.OK,
  }
}
