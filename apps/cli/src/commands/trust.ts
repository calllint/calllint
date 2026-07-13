/**
 * `calllint trust` — the Automated Trust Gateway (new8 Phase G).
 *
 *   trust prepare <git-url|dir|SKILL.md|mcp.json>   READ-ONLY; resolve → (evidence
 *                                                    → authority → decide → plan)
 *   trust show <preparation.json>                    human summary of a preparation
 *   trust explain <preparation.json>                 why this state / these notes
 *
 * G1 scope: Artifact Identity + read-only prepare. It touches NO live config and
 * NEVER executes the target — only reads bytes to digest them. Evidence /
 * Authority / Decision / Plan slots are filled by G2–G5.
 *
 * The edge (this file) does all I/O and injects `resolvedAt`; the pure core
 * (@calllint/resolver resolveArtifactIdentity + @calllint/core prepare) is
 * deterministic, so `trust prepare` run twice on the same immutable artifact
 * yields byte-identical core output. See ADR 0035.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join, resolve as resolvePath } from "node:path"
import {
  resolveArtifactIdentity,
  type ArtifactInput,
  type FetchedEntry,
} from "@calllint/resolver"
import { prepare, prepareExitCode, parseTargetSpec } from "@calllint/core"
import type { ArtifactSourceType, TrustPreparation } from "@calllint/types"
import type { CommandResult } from "./scan.js"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"

interface TrustDeps {
  cwd: string
  /** ISO-8601 UTC for this run (deterministic via --generated-at). */
  generatedAt: string
}

export function trustCommand(args: ParsedArgs, deps: TrustDeps): CommandResult {
  const subcommand = args.positionals[0]

  if (!subcommand || subcommand === "help") {
    return { stdout: trustHelp(), stderr: "", exitCode: EXIT.OK }
  }
  if (subcommand === "prepare") return trustPrepare(args, deps)
  if (subcommand === "show") return trustShow(args, deps)
  if (subcommand === "explain") return trustExplain(args, deps)

  return {
    stdout: "",
    stderr: `Unknown trust subcommand: ${subcommand}\nRun \`calllint trust help\`.`,
    exitCode: EXIT.USAGE,
  }
}

/** Max bytes read from any single file when digesting a target (matches scan caps). */
const MAX_FILE_BYTES = 5 * 1024 * 1024
/** Max entries hashed for a directory target (keeps prepare bounded). */
const MAX_DIR_ENTRIES = 2000
/** Max directory depth walked for a tree digest. */
const MAX_DIR_DEPTH = 8
/** Directories never descended (vendor / vcs / build output). */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
])

/** Classify a target into a source type + build the pure resolver input (edge I/O here). */
function loadArtifactInput(
  target: string,
  deps: TrustDeps,
): ArtifactInput | { error: string; exitCode: number } {
  // Remote targets: offline default. We can't pin them without network, so we
  // build an explicitly-unresolved input (never a silent pass). --online fetch
  // arrives with a later step; today they degrade with a clear reason.
  const spec = parseTargetSpec(target)
  if (spec.kind === "npm") {
    return {
      sourceType: "npm",
      source: target,
      requestedRef: spec.packageSpec?.includes("@")
        ? spec.packageSpec.slice(spec.packageSpec.lastIndexOf("@") + 1)
        : null,
      resolutionReasons: [
        "npm target requires network to pin an exact published version (offline default)",
      ],
      resolvedAt: deps.generatedAt,
    }
  }
  if (spec.kind === "github") {
    return {
      sourceType: "git",
      source: target,
      requestedRef: spec.ref ?? null,
      resolutionReasons: [
        "git target requires network to pin an immutable commit (offline default)",
      ],
      resolvedAt: deps.generatedAt,
    }
  }

  // Local path: file or directory. Read-only.
  const abs = resolvePath(deps.cwd, target)
  if (!existsSync(abs)) {
    return { error: `Target not found: ${target}`, exitCode: EXIT.USAGE }
  }

  let stat
  try {
    stat = statSync(abs)
  } catch (err) {
    return { error: `Cannot stat target: ${(err as Error).message}`, exitCode: EXIT.USAGE }
  }

  if (stat.isDirectory()) {
    const entries = readDirEntries(abs)
    return {
      sourceType: "dir",
      source: target,
      requestedRef: null,
      entries,
      resolutionReasons:
        entries.length === 0 ? ["directory has no readable files to digest"] : [],
      resolvedAt: deps.generatedAt,
    }
  }

  // Single file. mcp-config vs generic file by name.
  const name = basename(abs).toLowerCase()
  const sourceType: ArtifactSourceType =
    name.endsWith(".json") && (name.includes("mcp") || name.includes("settings"))
      ? "mcp-config"
      : "file"
  let content: string
  try {
    content = readFileSync(abs, "utf8").slice(0, MAX_FILE_BYTES)
  } catch (err) {
    return { error: `Cannot read target: ${(err as Error).message}`, exitCode: EXIT.USAGE }
  }
  return {
    sourceType,
    source: target,
    requestedRef: null,
    content,
    resolvedAt: deps.generatedAt,
  }
}

/**
 * Read a directory's files into a deterministic entry list (read-only, capped,
 * skipping vendor/vcs/build dirs). The whole tree is digested for identity — not
 * only "scannable" surfaces — so the artifact digest represents the artifact.
 * Paths are stored repo-relative with forward slashes so the tree digest is
 * stable across platforms. Never follows into skipped dirs; never executes.
 */
function readDirEntries(absDir: string): FetchedEntry[] {
  const entries: FetchedEntry[] = []

  function walk(dir: string, depth: number): void {
    if (depth > MAX_DIR_DEPTH || entries.length >= MAX_DIR_ENTRIES) return
    let dirents
    try {
      dirents = readdirSync(dir, { withFileTypes: true, encoding: "utf8" })
    } catch {
      return
    }
    // Sort names so traversal order is deterministic (the digest is
    // order-independent anyway, but this keeps the cap deterministic too).
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of dirents) {
      if (entries.length >= MAX_DIR_ENTRIES) return
      if (e.isSymbolicLink()) continue // never follow symlinks (path-escape safety)
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(full, depth + 1)
      } else if (e.isFile()) {
        let text: string
        try {
          text = readFileSync(full, "utf8").slice(0, MAX_FILE_BYTES)
        } catch {
          continue
        }
        const rel = full.slice(absDir.length).replace(/^[/\\]/, "").replace(/\\/g, "/")
        entries.push({ path: rel, content: text })
      }
    }
  }

  walk(absDir, 0)
  return entries
}

function trustPrepare(args: ParsedArgs, deps: TrustDeps): CommandResult {
  const target = args.positionals[1]
  if (!target) {
    return {
      stdout: "",
      stderr:
        "Error: Missing target\nUsage: calllint trust prepare <git-url|dir|SKILL.md|mcp.json> [--json]",
      exitCode: EXIT.USAGE,
    }
  }

  const input = loadArtifactInput(target, deps)
  if ("error" in input) {
    return { stdout: "", stderr: `Error: ${input.error}`, exitCode: input.exitCode }
  }

  const artifact = resolveArtifactIdentity(input)
  const preparation = prepare({ artifact, preparedAt: deps.generatedAt })
  const exitCode = prepareExitCode(preparation)

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(preparation, null, 2), stderr: "", exitCode }
  }
  return { stdout: renderPreparation(preparation), stderr: "", exitCode }
}

function loadPreparation(
  args: ParsedArgs,
  deps: TrustDeps,
): TrustPreparation | { error: string; exitCode: number } {
  const file = args.positionals[1]
  if (!file) {
    return { error: "Missing preparation file", exitCode: EXIT.USAGE }
  }
  let raw: string
  try {
    raw = readFileSync(join(deps.cwd, file), "utf8")
  } catch (err) {
    const e = err as Error & { code?: string }
    return {
      error: e.code === "ENOENT" ? `File not found: ${file}` : e.message,
      exitCode: EXIT.USAGE,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: `Not valid JSON: ${file}`, exitCode: EXIT.ERROR }
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { schema?: string }).schema !== "calllint.trust-preparation.v0"
  ) {
    return { error: `Not a calllint.trust-preparation.v0 document: ${file}`, exitCode: EXIT.ERROR }
  }
  return parsed as TrustPreparation
}

function trustShow(args: ParsedArgs, deps: TrustDeps): CommandResult {
  const prep = loadPreparation(args, deps)
  if ("error" in prep) return { stdout: "", stderr: `Error: ${prep.error}`, exitCode: prep.exitCode }
  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(prep, null, 2), stderr: "", exitCode: EXIT.OK }
  }
  return { stdout: renderPreparation(prep), stderr: "", exitCode: EXIT.OK }
}

function trustExplain(args: ParsedArgs, deps: TrustDeps): CommandResult {
  const prep = loadPreparation(args, deps)
  if ("error" in prep) return { stdout: "", stderr: `Error: ${prep.error}`, exitCode: prep.exitCode }
  return { stdout: renderExplanation(prep), stderr: "", exitCode: EXIT.OK }
}

const STATE_BADGE: Record<string, string> = {
  PLAN_READY: "◇ prepared (read-only)",
  FETCH_REJECTED: "⚠ not a verified target",
  RESOLUTION_FAILED: "⛔ could not resolve",
  EVIDENCE_PARTIAL: "⚠ evidence partial",
  EVIDENCE_FAILED: "⛔ evidence failed",
  POLICY_UNKNOWN: "◇ policy unknown",
}

function renderPreparation(p: TrustPreparation): string {
  const a = p.artifact
  let out = `\nCallLint trust prepare (read-only)\n`
  out += `target:       ${a.source}\n`
  out += `source type:  ${a.sourceType}\n`
  out += `requested:    ${a.requestedRef ?? "(none)"}\n`
  out += `resolved ref: ${a.resolvedRef ?? "(unresolved)"}\n`
  out += `digest:       ${a.digest ?? "(none)"}\n`
  out += `resolution:   ${a.resolution}\n`
  out += `state:        ${STATE_BADGE[p.state] ?? p.state}\n`
  out += `evidence:     ${p.evidence === null ? "(not collected — G2)" : `${p.evidence.length}`}\n`
  out += `authority:    ${p.authority === null ? "(not normalized — G3)" : "present"}\n`
  out += `decision:     ${p.decision === null ? "(not decided — G4)" : "present"}\n`
  out += `plan:         ${p.plan === null ? "(not planned — G5)" : "present"}\n`
  if (p.notes.length > 0) {
    out += `\nnotes:\n`
    for (const n of p.notes) out += `  • ${n}\n`
  }
  out += `\nThis is the READ-ONLY half of the Trust Gateway. It touched no live config\n`
  out += `and never executed the target. An unresolved target is never a pass.\n`
  return out
}

function renderExplanation(p: TrustPreparation): string {
  let out = `\nCallLint trust explain\n`
  out += `state: ${p.state}\n\n`
  switch (p.state) {
    case "PLAN_READY":
      out += `The artifact resolved to an immutable, digested identity\n`
      out += `(${p.artifact.resolvedRef}). Downstream evidence, authority, and a\n`
      out += `deterministic decision will bind this digest as Phase G lands.\n`
      break
    case "FETCH_REJECTED":
      out += `The artifact could not be fully pinned — either an immutable ref or\n`
      out += `the bytes to digest were missing. It is NOT a verified target and the\n`
      out += `gateway will not advance to a plan.\n`
      break
    case "RESOLUTION_FAILED":
      out += `The target could not be resolved to an immutable, digested identity.\n`
      out += `Nothing can be evaluated. UNKNOWN is never SAFE.\n`
      break
    default:
      out += `The read-only preparation stopped in a state that does not read as a\n`
      out += `pass. See the notes for why.\n`
  }
  if (p.notes.length > 0) {
    out += `\nwhy:\n`
    for (const n of p.notes) out += `  • ${n}\n`
  }
  return out
}

function trustHelp(): string {
  return `
calllint trust — Automated Trust Gateway (prepare → approve → apply → verify)

USAGE
  calllint trust prepare <target> [--json]     Read-only: resolve + preview
  calllint trust show <preparation.json>       Human summary of a preparation
  calllint trust explain <preparation.json>    Why this state / these notes

DESCRIPTION
  \`trust prepare\` resolves a target (a directory, SKILL.md, mcp.json, or a
  remote git/npm ref) to an immutable, digest-pinned Artifact Identity
  (calllint.artifact.v1) and produces a READ-ONLY preview. It touches no live
  config and NEVER executes the target — it only reads bytes to digest them.

  Remote git/npm targets need network to pin an immutable ref; offline they
  degrade explicitly (never a silent pass). Evidence, Authority, Decision, and
  Install Plan slots are populated by later Phase-G steps.

TARGETS
  ./path/to/dir            a local directory (tree-digested, read-only)
  ./SKILL.md               a single file
  ./.cursor/mcp.json       an MCP config
  npm:<pkg>[@version]      an npm package  (needs network to pin — offline: unresolved)
  github:<owner/repo>[@ref] a git repo     (needs network to pin — offline: unresolved)

EXIT CODES
  0   prepared (artifact resolved, read-only preview ready)
  10  partial (target not fully pinned / evidence partial)
  20  unresolved / fail-closed (never a pass)
  2   usage error / target not found
  3   malformed preparation document

SEE ALSO
  ADR 0035  — Automated Trust Gateway & Authority Manifest
  ADR 0036  — Install Plan & Approval Binding
`
}
