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

const GUARD_HOSTS = [
  "git",
  "git-pre-push",
  "github",
  "claude-code",
  "copilot",
  "gemini",
  "vscode",
] as const
type GuardHost = (typeof GUARD_HOSTS)[number]

/**
 * Write posture (ADR 0052 §3):
 *  - "dedicated": CallLint owns the artifact file; `install` writes it whole.
 *  - "shared":    the hook lives inside a user-owned config file; `install`
 *                 prints a JSON fragment to merge and refuses to clobber it.
 */
type WritePosture = "dedicated" | "shared"

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

// Every artifact is a declarative shim (ADR 0045 §4 / 0052 §4): it shells out to
// `calllint guard` and carries NO detection or verdict logic. Guard hooks bind
// ONLY to session-start / workspace-open events, never a per-call gating event
// (ADR 0052 §1) — so a wider host surface can never become a per-call blocker.
const GUARD_CMD = "npx -y calllint guard --no-emoji"

/** A git hook body — a declarative shim (ADR 0045 §4). */
function gitHookBody(when: string): string {
  return `#!/usr/bin/env bash
# CallLint Continuous Guard (ADR 0045). Re-decides the agent-tool authority
# surface ${when}; silent when nothing changed. Generated by \`calllint guard install\`.
# CallLint is static and NEVER executes a scanned server.
${GUARD_CMD}
`
}

/** Claude Code SessionStart hook — non-gating (ADR 0052 §1). Shared settings.json. */
const CLAUDE_CODE_HOOK =
  JSON.stringify(
    { hooks: { SessionStart: [{ hooks: [{ type: "command", command: GUARD_CMD }] }] } },
    null,
    2,
  ) + "\n"

/** Gemini CLI SessionStart hook — non-gating lifecycle (ADR 0052 §1). Shared settings.json. */
const GEMINI_HOOK =
  JSON.stringify(
    {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: GUARD_CMD, name: "calllint-guard" }] },
        ],
      },
    },
    null,
    2,
  ) + "\n"

/** Copilot CLI sessionStart hook — non-gating (ADR 0052 §1). Dedicated .github/hooks file. */
const COPILOT_HOOK =
  JSON.stringify(
    { version: 1, hooks: { sessionStart: [{ type: "command", command: GUARD_CMD }] } },
    null,
    2,
  ) + "\n"

/** VS Code folderOpen task — non-gating (ADR 0052 §1). Shared tasks.json. */
const VSCODE_TASK =
  JSON.stringify(
    {
      version: "2.0.0",
      tasks: [
        {
          label: "CallLint Continuous Guard",
          type: "shell",
          command: GUARD_CMD,
          runOptions: { runOn: "folderOpen" },
          presentation: { reveal: "silent", panel: "shared" },
          problemMatcher: [],
        },
      ],
    },
    null,
    2,
  ) + "\n"

interface GuardArtifact {
  path: string
  content: string
  label: string
  posture: WritePosture
}

function guardArtifact(host: GuardHost): GuardArtifact {
  switch (host) {
    case "git":
      return { path: join(".git", "hooks", "pre-commit"), content: gitHookBody("on commit"), label: "git pre-commit hook", posture: "dedicated" }
    case "git-pre-push":
      return { path: join(".git", "hooks", "pre-push"), content: gitHookBody("on push"), label: "git pre-push hook", posture: "dedicated" }
    case "github":
      // Reuse the shipped CI-gate workflow (drift mode) verbatim.
      return { path: join(".github", "workflows", "calllint.yml"), content: renderCiGate({ mode: "drift" }), label: "GitHub Actions drift-gate workflow", posture: "dedicated" }
    case "copilot":
      return { path: join(".github", "hooks", "calllint.json"), content: COPILOT_HOOK, label: "Copilot CLI sessionStart hook", posture: "dedicated" }
    case "claude-code":
      return { path: join(".claude", "settings.json"), content: CLAUDE_CODE_HOOK, label: "Claude Code SessionStart hook", posture: "shared" }
    case "gemini":
      return { path: join(".gemini", "settings.json"), content: GEMINI_HOOK, label: "Gemini CLI SessionStart hook", posture: "shared" }
    case "vscode":
      return { path: join(".vscode", "tasks.json"), content: VSCODE_TASK, label: "VS Code folderOpen guard task", posture: "shared" }
  }
}

function guardInstall(args: ParsedArgs, deps: GuardDeps): CommandResult {
  const host = flagStr(args.flags, "host")
  if (!host) {
    const list = GUARD_HOSTS.map((h) => {
      const a = guardArtifact(h)
      const tag = a.posture === "shared" ? " (fragment)" : ""
      return `  ${h.padEnd(13)} → ${a.label}${tag}`
    }).join("\n")
    return {
      stdout: `Usage: calllint guard install --host <host>\n\nHosts:\n${list}\n\n(fragment) hosts live inside a shared config file; install prints a snippet to merge and never overwrites it.`,
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
  const outFlag = flagStr(args.flags, "out")
  const rel = outFlag ?? art.path

  // Shared-config hosts (ADR 0052 §3): the hook lives inside a user-owned file.
  // Default = print the fragment to merge and DO NOT write. Only materialize a
  // whole file at an explicit --out path that does not yet exist; never clobber.
  if (art.posture === "shared") {
    if (outFlag) {
      const abs = resolve(deps.cwd, rel)
      if (existsSync(abs)) {
        return {
          stdout: "",
          stderr: `Refusing to overwrite ${rel} — CallLint will not clobber a shared config file.\nMerge this fragment into it instead:\n\n${art.content}`,
          exitCode: EXIT.USAGE,
        }
      }
      if (deps.writeFile === false) {
        return { stdout: `Would write ${rel} (${art.label})`, exitCode: EXIT.OK }
      }
      try {
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, art.content, "utf8")
      } catch (e) {
        return { stdout: "", stderr: `Failed to write ${rel}: ${e instanceof Error ? e.message : String(e)}`, exitCode: EXIT.ERROR }
      }
      return { stdout: `Wrote ${rel} (${art.label})`, exitCode: EXIT.OK }
    }
    // Default: print the fragment to merge into the shared config file.
    return {
      stdout: `${art.label} — merge this into ${rel} (a shared config file CallLint will not overwrite):\n\n${art.content}`,
      exitCode: EXIT.OK,
    }
  }

  // Dedicated-file hosts: CallLint owns the artifact; write it whole.
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
    host === "git" || host === "git-pre-push"
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

  // Stable status keys per host. Detection is honest (ADR 0052 §3): a dedicated
  // artifact is "installed" when its file exists; a shared-config host is only
  // "installed" when its file BOTH exists AND carries our `calllint guard` marker
  // — the file existing alone is the user's own config, not proof of our hook.
  const HOST_STATUS_KEY: Record<GuardHost, string> = {
    git: "git:pre-commit",
    "git-pre-push": "git:pre-push",
    github: "github:workflow",
    copilot: "copilot:sessionStart",
    "claude-code": "claude-code:sessionStart",
    gemini: "gemini:sessionStart",
    vscode: "vscode:folderOpen",
  }
  const installedHooks: Record<string, boolean> = {}
  for (const host of GUARD_HOSTS) {
    const art = guardArtifact(host)
    const abs = join(deps.cwd, art.path)
    installedHooks[HOST_STATUS_KEY[host]] = hookInstalled(abs, art.posture)
  }

  const status = {
    enabled: !disabled,
    disabledBy: disabled
      ? env["CALLLINT_GUARD"] === "0"
        ? "env:CALLLINT_GUARD=0"
        : "flag:.calllint/guard.json"
      : null,
    approvedBaseline: hasBaseline ? approvedPath : null,
    installedHooks,
  }

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(status), exitCode: EXIT.OK }
  }

  const lines = [
    `Continuous Guard: ${status.enabled ? "enabled" : `disabled (${status.disabledBy})`}`,
    `Approved baseline: ${hasBaseline ? approvedPath : "none — run `calllint approve`"}`,
    ...GUARD_HOSTS.map(
      (h) => `${HOST_STATUS_KEY[h]}: ${installedHooks[HOST_STATUS_KEY[h]] ? "installed" : "not installed"}`,
    ),
  ]
  return { stdout: lines.join("\n"), exitCode: EXIT.OK }
}

/**
 * Is a guard artifact installed at `abs`? A dedicated file counts when it exists;
 * a shared-config file counts only when it also carries the `calllint guard`
 * marker (so we never report a user's own settings.json as our hook). Read-only.
 */
function hookInstalled(abs: string, posture: WritePosture): boolean {
  if (!existsSync(abs)) return false
  if (posture === "dedicated") return true
  try {
    return readFileSync(abs, "utf8").includes("calllint guard")
  } catch {
    return false
  }
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
