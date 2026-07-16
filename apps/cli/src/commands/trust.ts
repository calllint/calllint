/**
 * `calllint trust` — the Automated Trust Gateway (new8 Phase G).
 *
 *   trust prepare <git-url|dir|SKILL.md|mcp.json>   READ-ONLY; resolve → (evidence
 *                                                    → authority → decide → plan)
 *   trust show <preparation.json>                    human summary of a preparation
 *   trust explain <preparation.json>                 why this state / these notes
 *
 * Scope through G5: Artifact Identity + read-only prepare, evidence attach,
 * authority normalization, the deterministic policy decision, and — when a host
 * is named with --host — a typed, reversible Install Plan (calllint.install-plan.v1).
 * It touches NO live config and NEVER executes the target: it reads bytes to
 * digest them and reads the host config READ-ONLY to compute the plan. Applying
 * the plan (the only writer) is a separate, approved step in G6.
 *
 * The edge (this file) does all I/O and injects `resolvedAt`; the pure core
 * (@calllint/resolver resolveArtifactIdentity + @calllint/core prepare) is
 * deterministic, so `trust prepare` run twice on the same immutable artifact
 * yields byte-identical core output. See ADR 0035.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve as resolvePath } from "node:path"
import { homedir, userInfo } from "node:os"
import {
  resolveArtifactIdentity,
  type ArtifactInput,
  type FetchedEntry,
} from "@calllint/resolver"
import { prepare, prepareExitCode, parseTargetSpec, buildAuthorityManifest } from "@calllint/core"
import { parseConfigText } from "@calllint/config-parser"
import { importEvidence, type EvidenceFormat } from "@calllint/evidence"
import { decideOverAuthority, loadPolicyOrDefault } from "@calllint/policy"
import { buildFlows, foldFlowsIntoReasons } from "@calllint/flow-analyzer"
import { hashJson } from "@calllint/fingerprint"
import {
  getHostAdapter,
  claudeCodeServerEntry,
  CLAUDE_CODE_HOST_ID,
  cursorServerEntry,
  CURSOR_HOST_ID,
  nodeFsPort,
  safeConfigPath,
  PathSafetyError,
  buildDecisionReceipt,
  signDecisionReceipt,
  verifyDecisionReceipt,
  type PlanContext,
  type PlannedServer,
} from "@calllint/install-planner"
import { importKeypair } from "@calllint/signature"
import type {
  ApplyResult,
  ArtifactSourceType,
  AuthorityManifest,
  DocumentSurface,
  Flow,
  GatewayEvidence,
  InstallPlan,
  NormalizedMcpServer,
  TrustDecision,
  TrustPreparation,
} from "@calllint/types"
import type { CommandResult } from "./scan.js"
import { readDocumentSurfaces } from "./surfaces.js"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"

interface TrustDeps {
  cwd: string
  /** ISO-8601 UTC for this run (deterministic via --generated-at). */
  generatedAt: string
  /** Runtime CLI version — stamped into receipt.v1 (scanner-version drift basis). */
  toolVersion?: string
}

export function trustCommand(args: ParsedArgs, deps: TrustDeps): CommandResult {
  const subcommand = args.positionals[0]

  if (!subcommand || subcommand === "help") {
    return { stdout: trustHelp(), stderr: "", exitCode: EXIT.OK }
  }
  if (subcommand === "prepare") return trustPrepare(args, deps)
  if (subcommand === "show") return trustShow(args, deps)
  if (subcommand === "explain") return trustExplain(args, deps)
  if (subcommand === "apply") return trustApply(args, deps)
  if (subcommand === "verify") return trustVerify(args, deps)

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

/** Instruction-file basenames that confer authority when an agent reads them. */
const INSTRUCTION_SURFACES: { match: (rel: string) => boolean; kind: DocumentSurface["kind"] }[] = [
  { match: (r) => r === "SKILL.md", kind: "skill" },
  { match: (r) => r === "AGENTS.md" || r === "CLAUDE.md", kind: "agents" },
  { match: (r) => r === "README.md", kind: "readme" },
  { match: (r) => r.startsWith(".cursor/rules/") && r.endsWith(".md"), kind: "agents" },
]

function surfaceKindFor(rel: string): DocumentSurface["kind"] | null {
  for (const s of INSTRUCTION_SURFACES) if (s.match(rel)) return s.kind
  return null
}

/**
 * Build the Authority Manifest (object 3) at the edge from material already read
 * for the artifact — no new disk I/O, so the authority is read over the SAME bytes
 * that were digested. Config-side authority comes from parsing an mcp-config;
 * instruction-side authority comes from the allowlisted doc surfaces. Both feed the
 * pure `buildAuthorityManifest`. Never executes anything.
 */
function buildAuthorityForTarget(
  input: ArtifactInput,
  artifactDigest: string | null,
): AuthorityManifest {
  const servers: NormalizedMcpServer[] = []
  const surfaces: DocumentSurface[] = []

  if (input.sourceType === "mcp-config" && typeof input.content === "string") {
    try {
      servers.push(...parseConfigText(input.content, input.source).servers)
    } catch {
      // A malformed config is not fatal to authority reading — it simply yields no
      // config-side capabilities. The artifact digest / resolution already records
      // the target; the manifest stays honest (empty here, not a false pass).
    }
  }

  if (input.sourceType === "dir" && input.entries) {
    // Reuse the exact bytes already fetched for the tree digest.
    for (const e of input.entries) {
      const kind = surfaceKindFor(e.path)
      if (kind) {
        surfaces.push({
          path: e.path,
          kind,
          text: e.content,
          truncated: e.content.length >= MAX_FILE_BYTES,
        })
      }
    }
  } else if (input.sourceType === "file" && typeof input.content === "string") {
    const rel = basename(input.source)
    const kind = surfaceKindFor(rel) ?? (rel.toLowerCase().endsWith(".md") ? "readme" : null)
    if (kind) {
      surfaces.push({
        path: rel,
        kind,
        text: input.content,
        truncated: input.content.length >= MAX_FILE_BYTES,
      })
    }
  }

  return buildAuthorityManifest({ artifactDigest, servers, surfaces })
}

/** Default host config paths (edge knowledge; the adapter stays path-agnostic). */
function defaultHostConfigPath(host: string, cwd: string): string | null {
  if (host === CLAUDE_CODE_HOST_ID) return join(homedir(), ".claude.json")
  // Cursor is project-scoped: `.cursor/mcp.json` under the working directory.
  // (The global Cursor config is a later refinement; use --host-config for it.)
  if (host === CURSOR_HOST_ID) return join(cwd, ".cursor", "mcp.json")
  return null
}

/**
 * Parse the servers to install from the target (mcp-config only for G5) and
 * reduce them to each host's known-schema entry. This is the ONLY place the
 * install path touches the target config, and it reuses bytes already read for
 * the artifact — the planner package itself never parses for analysis.
 */
function plannedServersFor(input: ArtifactInput, host: string): PlannedServer[] {
  if (input.sourceType !== "mcp-config" || typeof input.content !== "string") return []
  let servers: NormalizedMcpServer[]
  try {
    servers = parseConfigText(input.content, input.source).servers
  } catch {
    return []
  }
  // Reduce each server to the host's known-schema entry. Cursor and Claude Code
  // share the `mcpServers` entry shape; the per-host entry fn keeps the write
  // surface explicit (never a blind passthrough).
  const entryFor = host === CURSOR_HOST_ID ? cursorServerEntry : claudeCodeServerEntry
  return servers.map((s) => ({
    name: s.name,
    entry: entryFor({ command: s.command, args: s.args, url: s.url, envKeys: s.envKeys }),
  }))
}

/**
 * Build the Install Plan at the edge: read the current host config (I/O here),
 * digest it, and hand a pure PlanContext to the adapter. Returns null when there
 * is nothing installable (no servers) so the state simply stays DECIDED. Reading
 * the host config is the only disk touch and it is READ-ONLY — apply is G6.
 */
function buildPlanForHost(
  host: string,
  input: ArtifactInput,
  artifactDigest: string | null,
  authority: AuthorityManifest,
  decision: TrustDecision,
  deps: TrustDeps,
  configPathOverride?: string,
): InstallPlan | { error: string; exitCode: number } | null {
  const adapter = getHostAdapter(host)
  if (!adapter) {
    return { error: `Unknown host "${host}". Known hosts: ${CLAUDE_CODE_HOST_ID}, ${CURSOR_HOST_ID}`, exitCode: EXIT.USAGE }
  }
  const servers = plannedServersFor(input, host)
  if (servers.length === 0) return null // nothing to install → no plan

  const configPath = configPathOverride
    ? resolvePath(deps.cwd, configPathOverride)
    : defaultHostConfigPath(host, deps.cwd)
  if (!configPath) {
    return { error: `No default config path known for host "${host}"; pass --host-config <path>`, exitCode: EXIT.USAGE }
  }
  let currentConfig: unknown | null = null
  let configDigest: `sha256:${string}` | "absent" = "absent"
  if (existsSync(configPath)) {
    try {
      const bytes = readFileSync(configPath, "utf8")
      configDigest = hashJson(bytes) as `sha256:${string}`
      currentConfig = JSON.parse(bytes)
    } catch {
      // Unreadable/unparseable host config: keep digest "absent"-style honest by
      // failing closed — we do not guess its shape. Return an explicit error so
      // the user fixes it rather than getting a plan against unknown bytes.
      return { error: `Host config exists but is not readable/valid JSON: ${configPath}`, exitCode: EXIT.ERROR }
    }
  }

  // Backup path template (receipt-id stitched in at apply, G6).
  const backupPath = `${configPath}.calllint-backup`
  const ctx: PlanContext = {
    host,
    tier: adapter.tier,
    configPath,
    configDigest,
    currentConfig,
    servers,
    backupPath,
    expiresAt: planExpiry(deps.generatedAt),
  }
  const plan = adapter.createPlan(ctx, { artifactDigest, authority, decision })
  const check = adapter.validatePlan(plan)
  if (!check.ok) {
    return { error: `Generated plan failed validation: ${check.errors.join("; ")}`, exitCode: EXIT.ERROR }
  }
  return plan
}

/** Plan expiry: 1 hour after generation. Deterministic given --generated-at. */
function planExpiry(generatedAt: string): string {
  const t = Date.parse(generatedAt)
  if (Number.isNaN(t)) return generatedAt
  return new Date(t + 60 * 60 * 1000).toISOString()
}

/** Write the plan under .calllint/plans/<plan-id>.json (the only disk write; opt-in). */
function writePlanFile(plan: InstallPlan, deps: TrustDeps): string {
  const dir = join(deps.cwd, ".calllint", "plans")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${plan.planId}.json`)
  writeFileSync(file, JSON.stringify(plan, null, 2) + "\n", "utf8")
  return file
}

/**
 * Import an external evidence file at the edge (I/O here; import is pure and
 * fail-closed). A missing file or an unparseable report never throws — a bad
 * report becomes a `completeness:"failed"` envelope so it can only tighten the
 * preparation, never read as a pass (ADR 0034).
 */
function loadEvidence(
  file: string,
  deps: TrustDeps,
  format?: EvidenceFormat,
  provider?: string,
): GatewayEvidence | { error: string; exitCode: number } {
  let rawText: string
  try {
    rawText = readFileSync(resolvePath(deps.cwd, file), "utf8")
  } catch (err) {
    const e = err as Error & { code?: string }
    return {
      error: e.code === "ENOENT" ? `Evidence file not found: ${file}` : e.message,
      exitCode: EXIT.USAGE,
    }
  }
  return importEvidence(rawText, { provider, format }) as GatewayEvidence
}

function trustPrepare(args: ParsedArgs, deps: TrustDeps): CommandResult {
  const target = args.positionals[1]
  if (!target) {
    return {
      stdout: "",
      stderr:
        "Error: Missing target\nUsage: calllint trust prepare <git-url|dir|SKILL.md|mcp.json> [--evidence <file>] [--json]",
      exitCode: EXIT.USAGE,
    }
  }

  const input = loadArtifactInput(target, deps)
  if ("error" in input) {
    return { stdout: "", stderr: `Error: ${input.error}`, exitCode: input.exitCode }
  }

  // --with-skillspector would run SkillSpector via a pinned-commit/container
  // runner. Executing an external tool safely (pinned digest, sandbox, --no-llm
  // default) is deferred; until then we NEVER silently run anything — we tell the
  // user to import a report explicitly. This keeps the "never execute" posture.
  if (flagBool(args.flags, "with-skillspector")) {
    return {
      stdout: "",
      stderr:
        "Error: --with-skillspector (pinned runner) is not wired yet.\n" +
        "Run SkillSpector yourself, then attach its report:\n" +
        "  calllint trust prepare " +
        target +
        " --evidence skillspector-report.json",
      exitCode: EXIT.USAGE,
    }
  }

  // Optional external evidence (--evidence <file>). Provenance-preserved, never
  // re-scored. `--no-llm` is the default posture (we never invoke an LLM in the
  // verdict path); the flag is accepted for forward-compat and is a no-op today.
  const evidenceFile = typeof args.flags["evidence"] === "string" ? args.flags["evidence"] : undefined
  const formatFlag = args.flags["format"]
  const format: EvidenceFormat | undefined =
    formatFlag === "sarif" ? "sarif" : formatFlag === "json" ? "json" : undefined
  const providerFlag = typeof args.flags["provider"] === "string" ? args.flags["provider"] : undefined

  let evidence: GatewayEvidence[] | undefined
  if (evidenceFile) {
    const imported = loadEvidence(evidenceFile, deps, format, providerFlag)
    if ("error" in imported) {
      return { stdout: "", stderr: `Error: ${imported.error}`, exitCode: imported.exitCode }
    }
    evidence = [imported]
  }

  const artifact = resolveArtifactIdentity(input)
  const authority = buildAuthorityForTarget(input, artifact.digest ?? null)

  // G4 — deterministic policy decision over the manifest. Only meaningful once the
  // artifact resolved; on an unresolved target we skip it (the artifact/evidence
  // gate already fails-closed) so we never manufacture a verdict over nothing.
  const policyPath = flagStr(args.flags, "policy")
  const policy = loadPolicyOrDefault(policyPath ? resolvePath(deps.cwd, policyPath) : undefined)

  // Static toxic-flow analysis (ADR 0040): enumerate cross-capability compositions over
  // the sealed manifest, then fold the dangerous ones (BLOCK/REVIEW) into the decision as
  // TOXIC_FLOW_COMPOSITION reasons. A dangerous flow RAISES the verdict (never lowers it,
  // I-04); an ALLOW flow contributes nothing. Pure, offline, target never executed.
  const flows = buildFlows([authority])
  const flowReasons = foldFlowsIntoReasons(flows)

  const decision: TrustDecision | undefined =
    artifact.resolution === "resolved"
      ? decideOverAuthority({ authority, evidence, policy, flowReasons })
      : undefined

  // G5 — Install Plan. HOST-GATED: only when the user names a host with --host.
  // We plan only for a non-blocking decision (the reducer enforces this too); a
  // BLOCK/UNKNOWN never yields a plan. Reading the host config is read-only.
  let plan: InstallPlan | undefined
  const hostFlag = flagStr(args.flags, "host")
  // Build a plan for any confident verdict (SAFE/REVIEW/BLOCK). UNKNOWN never
  // yields a plan (the reducer refuses to activate it) — you cannot present an
  // install plan for what you don't understand. The verdict rides in the plan's
  // decisionDigest and drives the exit code, so a BLOCK plan never reads as a pass.
  if (hostFlag && decision && decision.verdict !== "UNKNOWN") {
    const hostConfig = flagStr(args.flags, "host-config")
    const built = buildPlanForHost(hostFlag, input, artifact.digest ?? null, authority, decision, deps, hostConfig)
    if (built && "error" in built) {
      return { stdout: "", stderr: `Error: ${built.error}`, exitCode: built.exitCode }
    }
    plan = built ?? undefined
  }

  const preparation = prepare({
    artifact,
    evidence,
    authority,
    decision,
    plan,
    preparedAt: deps.generatedAt,
  })
  const exitCode = prepareExitCode(preparation)

  // --write-plan persists the plan (the ONLY disk write; never on by default).
  let planNote = ""
  if (preparation.plan && flagBool(args.flags, "write-plan")) {
    const file = writePlanFile(preparation.plan, deps)
    planNote = `\nplan written: ${file}\n`
  }

  // --flows surfaces the raw calllint.flow.v0 objects behind the decision's
  // TOXIC_FLOW_COMPOSITION reasons (no new top-level command — a prepare output switch).
  const showFlows = flagBool(args.flags, "flows")

  if (flagBool(args.flags, "json")) {
    const payload = showFlows ? { preparation, flows } : preparation
    return { stdout: JSON.stringify(payload, null, 2), stderr: "", exitCode }
  }
  const flowNote = showFlows ? renderFlows(flows) : ""
  // H2 — non-persisting conversion prompt on the human-readable path only.
  const conversion = renderConversionPrompt(preparation)
  return {
    stdout: renderPreparation(preparation) + flowNote + planNote + conversion,
    stderr: "",
    exitCode,
  }
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

/** Deterministic short receipt id from the plan digest + apply instant. */
function receiptId(planDigest: string, now: string): string {
  return "clrec_" + hashJson({ planDigest, now }).slice("sha256:".length, "sha256:".length + 16)
}

/** Map an ApplyResult outcome to the CLI exit convention (0 / 10 / 20). */
function applyExitCode(r: ApplyResult): number {
  if (r.outcome === "applied") return EXIT.OK
  if (r.outcome === "already_applied") return EXIT.REVIEW // 10 — nothing written, worth a look
  return EXIT.UNKNOWN // 20 — stale · conflict · rolled_back · rollback_failed → fail-closed
}

/**
 * `trust apply --plan <file> --approve <plan-digest>` — the ONLY writer.
 *
 * The edge does the I/O and path-safety; the audited apply engine (via the host
 * adapter) does the dangerous write behind a lock with backup + verify +
 * rollback. The plan carries its own absolute target path (authored at prepare),
 * so apply never re-derives where to write — it revalidates against exactly what
 * was planned. A Tier-B/C host (no applyPlan) can never be applied.
 */
function trustApply(args: ParsedArgs, deps: TrustDeps): CommandResult {
  const planFile = flagStr(args.flags, "plan")
  const approve = flagStr(args.flags, "approve")
  if (!planFile) {
    return usageErr("Missing --plan <file>\nUsage: calllint trust apply --plan <plan.json> --approve <plan-digest>")
  }
  if (!approve) {
    return usageErr("Missing --approve <plan-digest>\nApproval must name the exact plan digest you reviewed (see `trust prepare`).")
  }

  let plan: InstallPlan
  try {
    plan = JSON.parse(readFileSync(resolvePath(deps.cwd, planFile), "utf8")) as InstallPlan
  } catch (err) {
    const e = err as Error & { code?: string }
    return { stdout: "", stderr: e.code === "ENOENT" ? `Plan file not found: ${planFile}` : `Plan file is not valid JSON: ${e.message}`, exitCode: EXIT.ERROR }
  }
  if (plan?.schema !== "calllint.install-plan.v1") {
    return { stdout: "", stderr: `Not a calllint.install-plan.v1 document: ${planFile}`, exitCode: EXIT.ERROR }
  }

  const adapter = getHostAdapter(plan.host)
  if (!adapter) return usageErr(`Unknown host "${plan.host}". Known hosts: ${CLAUDE_CODE_HOST_ID}, ${CURSOR_HOST_ID}`)
  if (!adapter.applyPlan) {
    // A Tier-B/C host declares no writer — the user applies the emitted patch.
    return usageErr(`Host "${plan.host}" is tier ${adapter.tier} — plan-only; copy the patch or use a Tier-A host to apply.`)
  }

  // The target path lives on the (single, v1) operation; resolve it safely.
  const rawTarget = plan.operations[0]?.target
  if (!rawTarget) return usageErr("Plan has no operations to apply.")
  let configPath: string
  try {
    configPath = safeConfigPath(rawTarget, { cwd: deps.cwd, home: homedir() })
  } catch (err) {
    if (err instanceof PathSafetyError) return { stdout: "", stderr: `Unsafe target path in plan: ${err.message}`, exitCode: EXIT.ERROR }
    throw err
  }

  const rid = receiptId(plan.planDigest, deps.generatedAt)
  const backupPath = `${configPath}.calllint-backup-${rid}`
  const lockPath = join(deps.cwd, ".calllint", "locks", `${hashJson(configPath).slice("sha256:".length, "sha256:".length + 16)}.lock`)

  const result = adapter.applyPlan(plan, {
    approvalDigest: approve,
    configPath,
    backupPath,
    lockPath,
    fs: nodeFsPort(),
    now: deps.generatedAt,
  })

  // Optional G7 decision receipt (calllint.receipt.v1). Emitted only when asked;
  // apply's outcome/exit code is unchanged whether or not a receipt is written.
  let receiptNote = ""
  const receiptOut = flagStr(args.flags, "receipt")
  if (receiptOut) {
    const err = emitReceipt(result, plan, args, deps, receiptOut)
    if (err) return err
    receiptNote = `\nreceipt:      ${resolvePath(deps.cwd, receiptOut)}\n`
  }

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(result, null, 2), stderr: "", exitCode: applyExitCode(result) }
  }
  return { stdout: renderApplyResult(result) + receiptNote, stderr: "", exitCode: applyExitCode(result) }
}

/**
 * Build (and optionally sign) a `calllint.receipt.v1` for an apply outcome and
 * write it. Deterministic body: `approvedAt` defaults to this run's injected
 * timestamp, `approver` to the OS user (overridable). Returns a CommandResult
 * only on error; otherwise writes the file and returns null.
 */
function emitReceipt(
  result: ApplyResult,
  plan: InstallPlan,
  args: ParsedArgs,
  deps: TrustDeps,
  outFile: string,
): CommandResult | null {
  const approver = flagStr(args.flags, "approver") ?? (userInfo().username || null)
  let receipt = buildDecisionReceipt(result, plan, {
    approvedAt: deps.generatedAt,
    approver,
    scannerVersion: deps.toolVersion ?? "0.0.0-dev",
    policyVersion: null,
  })

  const keyFile = flagStr(args.flags, "key")
  if (flagBool(args.flags, "sign") || keyFile) {
    if (!keyFile) return usageErr("--sign requires --key <keyfile> (a local ed25519 keypair from `receipt keygen`)")
    try {
      const kp = importKeypair(JSON.parse(readFileSync(resolvePath(deps.cwd, keyFile), "utf8")))
      receipt = signDecisionReceipt(receipt, kp)
    } catch (err) {
      return { stdout: "", stderr: `Cannot load signing key: ${(err as Error).message}`, exitCode: EXIT.ERROR }
    }
  }

  try {
    writeFileSync(resolvePath(deps.cwd, outFile), JSON.stringify(receipt, null, 2) + "\n")
  } catch (err) {
    return { stdout: "", stderr: `Cannot write receipt: ${(err as Error).message}`, exitCode: EXIT.ERROR }
  }
  return null
}

/**
 * `trust verify <receipt.json> [--public-key <keyfile>]` — read-only.
 *
 * Validates a `calllint.receipt.v1` decision receipt: structure, the six-digest
 * chain, the approval binding (approvedDigest == installPlanDigest), expiry, and
 * — when a public key is given and the receipt is signed — the ed25519 signature.
 * It NEVER re-judges, re-scans, executes the target, or touches the network.
 * Exit 0 = valid, 1 = invalid/tampered.
 */
function trustVerify(args: ParsedArgs, deps: TrustDeps): CommandResult {
  const file = args.positionals[1]
  if (!file) return usageErr("Usage: calllint trust verify <receipt.json> [--public-key <keyfile>]")

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(resolvePath(deps.cwd, file), "utf8"))
  } catch (err) {
    const e = err as Error & { code?: string }
    return { stdout: "", stderr: e.code === "ENOENT" ? `Receipt file not found: ${file}` : `Receipt is not valid JSON: ${e.message}`, exitCode: EXIT.ERROR }
  }

  let publicKey: string | undefined
  const pkFile = flagStr(args.flags, "public-key")
  if (pkFile) {
    try {
      const j = JSON.parse(readFileSync(resolvePath(deps.cwd, pkFile), "utf8")) as Record<string, unknown>
      publicKey = (j.public_key as string) ?? (j.publicKey as string)
      if (typeof publicKey !== "string") throw new Error("no public_key field")
    } catch (err) {
      return { stdout: "", stderr: `Cannot load public key: ${(err as Error).message}`, exitCode: EXIT.ERROR }
    }
  }

  const res = verifyDecisionReceipt(parsed, { now: deps.generatedAt, publicKey })

  // Invalid/tampered → exit 1 (matches `receipt verify` v0). File/parse errors
  // above use EXIT.ERROR (3); a structurally-invalid receipt is a distinct case.
  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(res, null, 2), stderr: "", exitCode: res.valid ? EXIT.OK : 1 }
  }
  let out = `\nCallLint trust verify\n`
  out += `receipt:   ${resolvePath(deps.cwd, file)}\n`
  out += `structure: ${res.valid ? "✅ valid" : "⛔ invalid"}\n`
  out += `signed:    ${res.signed ? (publicKey ? (res.tampered ? "⛔ signature INVALID" : "✅ signature verified") : "◇ present (no --public-key; not checked)") : "◇ unsigned"}\n`
  out += `expiry:    ${res.expired ? "⚠ EXPIRED" : "✅ within validity window"}\n`
  if (res.errors.length > 0) {
    out += `\nerrors:\n`
    for (const e of res.errors) out += `  • ${e}\n`
  }
  return { stdout: out, stderr: "", exitCode: res.valid ? EXIT.OK : 1 }
}

function usageErr(msg: string): CommandResult {
  return { stdout: "", stderr: `Error: ${msg}`, exitCode: EXIT.USAGE }
}

const STATE_BADGE: Record<string, string> = {
  PLAN_READY: "◇ prepared (read-only)",
  AUTHORITY_NORMALIZED: "◇ authority normalized (read-only)",
  DECIDED: "◇ decided (read-only)",
  FETCH_REJECTED: "⚠ not a verified target",
  RESOLUTION_FAILED: "⛔ could not resolve",
  EVIDENCE_PARTIAL: "⚠ evidence partial",
  EVIDENCE_FAILED: "⛔ evidence failed",
  POLICY_UNKNOWN: "◇ policy unknown (insufficient evidence)",
  VERIFIED: "✅ applied + verified",
  APPLY_CONFLICT: "⛔ config conflict",
  PLAN_STALE: "⛔ plan stale",
  VERIFICATION_FAILED: "↩ verify failed — rolled back",
  ROLLBACK_REQUIRED: "🚨 rollback required",
}

/** Developer-mode symbol for a decision verdict (mirrors VERDICT_CLI_SYMBOL). */
const VERDICT_SYMBOL: Record<string, string> = {
  SAFE: "🛡 SAFE",
  REVIEW: "⚠ REVIEW",
  BLOCK: "⛔ BLOCK",
  UNKNOWN: "◇ UNKNOWN",
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
  if (p.evidence === null) {
    out += `evidence:     (none attached — pass --evidence <file>)\n`
  } else {
    out += `evidence:     ${p.evidence.length} provider(s)\n`
    for (const e of p.evidence) {
      out += `  • ${e.provider} (${e.providerVersion}) — ${e.scanMode}, ${e.completeness}, ${e.findings.length} finding(s), not re-scored\n`
    }
  }
  if (p.authority === null) {
    out += `authority:    (not normalized — G3)\n`
  } else {
    const caps = p.authority.capabilities
    out += `authority:    ${caps.length} capabilit${caps.length === 1 ? "y" : "ies"}`
    out += p.authority.completeness === "partial" ? " (partial)\n" : "\n"
    for (const c of caps) {
      const dst = c.destination ? ` → ${c.destination}` : ""
      const appr = c.approvalRequirement === "none" ? "" : ` [${c.approvalRequirement}]`
      out += `  • ${c.action} ${c.resource}${dst}${appr}  (${c.evidenceSource})\n`
    }
    if (p.authority.approval.required.length > 0) {
      out += `  approvals required: ${p.authority.approval.required.join(", ")}\n`
    }
  }
  if (p.decision === null) {
    out += `decision:     (not decided — G4)\n`
  } else {
    const d = p.decision
    out += `decision:     ${VERDICT_SYMBOL[d.verdict] ?? d.verdict}`
    out += d.completeness === "partial" ? " (over partial evidence)\n" : "\n"
    for (const r of d.reasons) {
      out += `  • ${r.code} → ${r.contributes}  (${r.evidenceSource})\n`
    }
    if (d.requiredApprovals.length > 0) {
      out += `  approvals required: ${d.requiredApprovals.join(", ")}\n`
    }
  }
  if (p.plan === null) {
    out += `plan:         (none — pass --host <id> for an install plan)\n`
  } else {
    const pl = p.plan
    out += `plan:         host "${pl.host}" (tier ${pl.tier}) — ${pl.operations.length} op(s), ${pl.rollback.length} rollback op(s)\n`
    out += `  plan id:    ${pl.planId}\n`
    out += `  plan digest:${pl.planDigest}\n`
    out += `  expires:    ${pl.expiresAt}\n`
    out += `  NOT applied — review, then: calllint trust apply --plan <file> --approve ${pl.planDigest}\n`
  }
  if (p.notes.length > 0) {
    out += `\nnotes:\n`
    for (const n of p.notes) out += `  • ${n}\n`
  }
  out += `\nThis is the READ-ONLY half of the Trust Gateway. It touched no live config\n`
  out += `and never executed the target. An unresolved target is never a pass.\n`
  return out
}

/**
 * H2 — one-use → persistent conversion (roadmap H1/H2; ADR 0045 §5). After a
 * *usable* preparation, offer the concrete persistence actions — but persist
 * NOTHING by default. This is suggestion-only text: it lists the exact commands
 * a user can run to convert a one-off prepare into a standing workflow (baseline,
 * Continuous Guard, CI gate, agent rule). It emits no telemetry (that is a
 * separate M-metrics ADR) and writes no files.
 *
 * Gated on a non-blocking outcome: only when a decision was reached and its
 * verdict is not BLOCK/UNKNOWN. A blocked or unverifiable prepare must not read
 * as "great, now make it permanent."
 */
function renderConversionPrompt(p: TrustPreparation): string {
  const d = p.decision
  if (!d || d.verdict === "BLOCK" || d.verdict === "UNKNOWN") return ""
  return (
    `\nNext step (nothing is persisted unless you run one of these):\n` +
    `  • Record this surface as approved:   calllint approve\n` +
    `  • Re-decide on every authority change: calllint guard install --host git\n` +
    `  • Gate pull requests in CI:           calllint guard install --host github\n` +
    `  • Teach your agent the safety rule:   calllint gen-rule --host claude --write\n`
  )
}

/** Developer-mode symbol for a flow decision hint. */
const FLOW_HINT_SYMBOL: Record<string, string> = {
  BLOCK: "⛔ BLOCK",
  REVIEW: "⚠ REVIEW",
  ALLOW: "🛡 ALLOW",
}

/**
 * Render the static toxic-flow paths behind the decision (calllint.flow.v0). Read-only
 * view: each flow's source trust class → sink, its hint, and the evidence grounding it.
 */
function renderFlows(flows: readonly Flow[]): string {
  if (flows.length === 0) {
    return `\ntoxic-flows:   (none — no cross-capability composition detected)\n`
  }
  let out = `\ntoxic-flows:   ${flows.length} path(s) [calllint.flow.v0]\n`
  for (const f of flows) {
    const dst = f.sink.destination ? ` → ${f.sink.destination}` : ""
    out += `  ${FLOW_HINT_SYMBOL[f.decisionHint] ?? f.decisionHint}  ${f.flowId}  (${f.risk.class})\n`
    out += `      source: ${f.source.trustSource}  →  sink: ${f.sink.action} ${f.sink.resource}${dst}\n`
    out += `      evidence: ${f.evidence.join(", ")}\n`
  }
  out += `  A dangerous flow is folded into the decision as a TOXIC_FLOW_COMPOSITION reason;\n`
  out += `  it can only raise the verdict, never lower it. An ALLOW flow contributes nothing.\n`
  return out
}

function renderExplanation(p: TrustPreparation): string {
  let out = `\nCallLint trust explain\n`
  out += `state: ${p.state}\n\n`
  switch (p.state) {
    case "AUTHORITY_NORMALIZED": {
      const caps = p.authority?.capabilities.length ?? 0
      out += `The artifact resolved to an immutable, digested identity\n`
      out += `(${p.artifact.resolvedRef}) and its authority was normalized into a\n`
      out += `manifest of ${caps} capabilit${caps === 1 ? "y" : "ies"}, each pinned to the evidence byte\n`
      out += `that granted it. This is an inventory, not a verdict — the deterministic\n`
      out += `decision (G4) will bind this manifest's digest. UNKNOWN is never SAFE.\n`
      break
    }
    case "DECIDED": {
      const d = p.decision
      out += `The artifact resolved and its authority was normalized, then the\n`
      out += `deterministic policy decided ${d?.verdict ?? "?"} over the manifest —\n`
      out += `binding the artifact, authority, and policy digests. The verdict comes\n`
      out += `from normalized authority + policy, never from a scanner: external\n`
      out += `evidence can add reasons or lower confidence, but never sets it alone.\n`
      break
    }
    case "POLICY_UNKNOWN":
      out += `The policy could not reach a confident verdict — authority or evidence\n`
      out += `was incomplete, so the decision is UNKNOWN. Insufficient evidence is\n`
      out += `fail-closed: UNKNOWN outranks REVIEW and never reads as a pass.\n`
      break
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

const APPLY_BADGE: Record<string, string> = {
  applied: "✅ applied + verified",
  already_applied: "◇ already applied (no change)",
  stale: "⛔ plan stale — not applied",
  conflict: "⛔ config conflict — not applied",
  rolled_back: "↩ verify failed — rolled back to original",
  rollback_failed: "🚨 rollback FAILED — manual intervention required",
}

function renderApplyResult(r: ApplyResult): string {
  let out = `\nCallLint trust apply\n`
  out += `host:         ${r.host}\n`
  out += `config:       ${r.configPath}\n`
  out += `plan id:      ${r.planId}\n`
  out += `plan digest:  ${r.planDigest}\n`
  out += `state:        ${r.state}\n`
  out += `outcome:      ${APPLY_BADGE[r.outcome] ?? r.outcome}\n`
  out += `before:       ${r.configDigestBefore}\n`
  out += `after:        ${r.configDigestAfter ?? "(unchanged / not written)"}\n`
  if (r.backupPath) out += `backup:       ${r.backupPath}\n`
  if (r.notes.length > 0) {
    out += `\nnotes:\n`
    for (const n of r.notes) out += `  • ${n}\n`
  }
  if (r.outcome === "applied") {
    out += `\nThe config was written atomically and re-verified. To undo, restore the\n`
    out += `backup above (the plan also carries typed rollback operations).\n`
  } else if (r.outcome === "rollback_failed") {
    out += `\nThe write could not be verified AND the automatic rollback failed. Your\n`
    out += `original config is preserved at the backup path — restore it by hand.\n`
  }
  return out
}

function trustHelp(): string {
  return `
calllint trust — Automated Trust Gateway (prepare → approve → apply → verify)

USAGE
  calllint trust prepare <target> [--evidence <file>] [--host <id>] [--json]
  calllint trust show <preparation.json>       Human summary of a preparation
  calllint trust explain <preparation.json>    Why this state / these notes
  calllint trust apply --plan <p> --approve <plan-digest>   Apply an approved plan
  calllint trust verify <receipt.json> [--public-key <k>]   Verify a decision receipt

DESCRIPTION
  \`trust prepare\` resolves a target (a directory, SKILL.md, mcp.json, or a
  remote git/npm ref) to an immutable, digest-pinned Artifact Identity
  (calllint.artifact.v1) and produces a READ-ONLY preview. It touches no live
  config and NEVER executes the target — it only reads bytes to digest them.

  Attach a third-party scanner report with --evidence <file>: it is imported
  provenance-preserved and NEVER re-scored. Degraded or failed evidence can only
  tighten the preparation (fail-closed) — a degraded external scan never reads
  as a pass. An external SAFE never upgrades a CallLint verdict.

  Remote git/npm targets need network to pin an immutable ref; offline they
  degrade explicitly (never a silent pass). Authority, Decision, and Install
  Plan slots are populated by later Phase-G steps.

OPTIONS (prepare)
  --evidence <file>     Attach a third-party scanner report (JSON or SARIF)
  --format json|sarif   Force the evidence format (default: auto-detect)
  --provider <name>     Force the evidence provider adapter (default: auto-detect)
  --policy <file>       Use a policy file for the decision (default: built-in defaults)
  --host <id>           Build an install plan for a host: claude-code (Tier A,
                        applies) or cursor (Tier B, plan-only — you apply the
                        emitted patch). Reads the host config READ-ONLY; never
                        applies. Plan is emitted only for a non-blocking decision.
  --host-config <path>  Override the host config path (default: per host —
                        ~/.claude.json for claude-code, .cursor/mcp.json for cursor)
  --write-plan          Persist the plan to .calllint/plans/<plan-id>.json
  --flows               Show static toxic-flow paths (calllint.flow.v0) behind the
                        decision's TOXIC_FLOW_COMPOSITION reasons. With --json, emits
                        { preparation, flows }. A dangerous flow only raises the verdict.
  --no-llm              Default posture: no LLM in the verdict path (accepted, no-op)
  --json                Emit the raw calllint.trust-preparation.v0 document

OPTIONS (apply)
  --plan <file>         The install plan to apply (from prepare --write-plan)
  --approve <digest>    The exact plan digest you reviewed — binds the approval.
                        A mismatch, a tampered plan, or an expired plan is refused
                        (PLAN_STALE) before any write. Apply re-checks the target's
                        precondition digest (drift → APPLY_CONFLICT), writes
                        atomically with a backup, re-verifies, and rolls back on
                        failure. Re-applying the same plan is a no-op.
  --receipt <file>      After apply, write a calllint.receipt.v1 decision receipt
                        (durable proof of the six-digest chain + approval + result)
  --sign --key <file>   Sign the receipt with a local ed25519 keypair (\`receipt keygen\`)
  --approver <name>     Attribution for the receipt (default: OS user)
  --json                Emit the raw calllint.apply-result.v1 document

OPTIONS (verify)
  --public-key <file>   Public key JSON to check the receipt's ed25519 signature.
                        Without it, a signature is shape-checked but not verified.
                        verify is READ-ONLY: it never re-judges, re-scans, or writes.
  --json                Emit the raw verification result

TARGETS
  ./path/to/dir            a local directory (tree-digested, read-only)
  ./SKILL.md               a single file
  ./.cursor/mcp.json       an MCP config
  npm:<pkg>[@version]      an npm package  (needs network to pin — offline: unresolved)
  github:<owner/repo>[@ref] a git repo     (needs network to pin — offline: unresolved)

EXIT CODES
  0   decision SAFE (or resolved read-only preview with no blocking authority)
  10  decision REVIEW / target not fully pinned / evidence partial
  20  decision BLOCK or UNKNOWN / unresolved / fail-closed (never a pass)
  2   usage error / target not found
  3   malformed preparation document

SEE ALSO
  ADR 0035  — Automated Trust Gateway & Authority Manifest
  ADR 0036  — Install Plan & Approval Binding
  ADR 0037  — Host Adapter Safety Contract
`
}
