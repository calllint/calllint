import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { buildAuthorityManifest } from "@calllint/core"
import { decideOverAuthority, loadPolicyOrDefault } from "@calllint/policy"
import { buildFlows, foldFlowsIntoReasons } from "@calllint/flow-analyzer"
import { hashJson } from "@calllint/fingerprint"
import {
  HOST_ADAPTERS,
  getHostAdapter,
  nodeFsPort,
  safeConfigPath,
  verifyPlanDigest,
  PathSafetyError,
  type InstallPlan,
  type ApplyResult,
} from "@calllint/install-planner"
import { discoverConfigs, type AgentType, type DiscoveredConfig } from "@calllint/discovery"
import { overlayForHost } from "@calllint/agent-triggers"
import type { NormalizedMcpServer } from "@calllint/types"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

/**
 * `calllint integrate` (new11 P2, PR-11) — the idempotent, discovery-driven
 * installer of CallLint's own preflight surface into detected agent hosts.
 *
 * It adds NO new writer and NO new engine. It composes the shipped pieces:
 *   @calllint/discovery      — detect installed hosts + their config paths
 *   integrateSpine           — resolve → authority → deterministic decision
 *   @calllint/install-planner — createPlan (pure) + applyPlan (THE audited writer:
 *                               revalidate → atomic write → verify → rollback)
 *
 * Bound by ADR 0051: installing the hook/preflight server does not install a
 * blocker. `integrate` writes STATIC config the user approves; it never enters
 * the verdict path and never executes a scanned server (INV1).
 *
 * Canonical name settled in ADR 0049 (`init` is only an alias). Plan-only by
 * default; `--apply --approve <digest>` is the only path that writes, and it
 * reuses `trust apply`'s exact atomic+rollback engine.
 */

export interface IntegrateDeps {
  cwd: string
  /** ISO-8601 UTC, injected from the CLI edge (determinism). */
  generatedAt: string
  /** Runtime CLI version (unused today; kept parallel to TrustDeps). */
  toolVersion?: string
  /** When false, `--apply` does not touch disk (tests). Default true. */
  write?: boolean
}

/**
 * The first-party MCP server `integrate` installs: CallLint itself, as a
 * preflight an agent host can call before approving ANOTHER server. This is a
 * fixed, known artifact — not a third-party target — so the authority read is
 * over our own published entry, and the decision is expected SAFE.
 */
const CALLLINT_MCP_SERVER_NAME = "calllint" as const

/** The stdio launch entry for the published `calllint-mcp` server (npx form). */
function calllintMcpEntry(): Record<string, unknown> {
  return { command: "npx", args: ["-y", "calllint-mcp"] }
}

/** Hosts `integrate --auto` will plan for: those with an audited applyPlan writer. */
function integrableHosts(): AgentType[] {
  // Reuse the install-planner registry as the single source of truth for which
  // hosts have the audited writer — never a hand-kept second list. Only Tier-A
  // adapters (those shipping applyPlan) are integrable.
  return Object.values(HOST_ADAPTERS)
    .filter((a) => typeof a.applyPlan === "function")
    .map((a) => a.id as AgentType)
    .sort()
}

/**
 * Build the deterministic decision over an authority manifest, mirroring the
 * exact spine `trust prepare` uses (authority → static flows → policy decision).
 * Pure; no I/O, no target execution (INV1).
 */
function decideForIntegrate(authority: ReturnType<typeof buildAuthorityManifest>) {
  const policy = loadPolicyOrDefault()
  const flows = buildFlows([authority])
  const flowReasons = foldFlowsIntoReasons(flows)
  return decideOverAuthority({ authority, policy, flowReasons })
}

export function integrateCommand(args: ParsedArgs, deps: IntegrateDeps): CommandResult {
  const sub = args.positionals[0]
  if (sub === "help") return integrateHelp()
  // `integrate` has no subcommands today; a stray positional is a usage error
  // (guards against `integrate appy` typos silently no-op'ing).
  if (sub !== undefined) {
    return usage(`Unexpected argument "${sub}". Run \`calllint integrate help\`.`)
  }

  const apply = flagBool(args.flags, "apply")
  return apply ? integrateApply(args, deps) : integratePlan(args, deps)
}

// ---------------------------------------------------------------------------
// Plan (default) — detect hosts, build one plan each, print plans + digests.
// READ-ONLY: reads host configs to compute add-vs-noop, writes nothing.
// ---------------------------------------------------------------------------

interface HostPlan {
  host: AgentType
  configPath: string
  plan: InstallPlan | null
  /** Why no plan (host not integrable, unresolved, or already present). */
  note: string | null
}

function integratePlan(args: ParsedArgs, deps: IntegrateDeps): CommandResult {
  const only = flagStr(args.flags, "host") as AgentType | undefined
  const hosts = only ? [only] : integrableHosts()

  const detected = detectHosts(deps.cwd, hosts)
  const hostPlans: HostPlan[] = hosts.map((h) => planForHost(h, detected, deps))

  // --write-plan persists each sealed plan to .calllint/plans/<plan-id>.json so
  // the user can review it and pass it to `integrate --apply`. This is the only
  // disk write on the plan path, never on by default, and never a host config.
  const written = new Map<AgentType, string>()
  if (flagBool(args.flags, "write-plan") && deps.write !== false) {
    for (const hp of hostPlans) {
      if (hp.plan) written.set(hp.host, writePlanFile(hp.plan, deps.cwd))
    }
  }

  if (flagBool(args.flags, "json")) {
    const payload = {
      schema: "calllint.integrate-plan.v0",
      generatedAt: deps.generatedAt,
      hosts: hostPlans.map((hp) => ({
        host: hp.host,
        configPath: hp.configPath,
        planDigest: hp.plan?.planDigest ?? null,
        operations: hp.plan?.operations.length ?? 0,
        planFile: written.get(hp.host) ?? null,
        note: hp.note,
      })),
    }
    return { stdout: JSON.stringify(payload, null, 2), stderr: "", exitCode: EXIT.OK }
  }

  return { stdout: renderPlans(hostPlans, written), stderr: "", exitCode: EXIT.OK }
}

/** Persist a sealed plan to .calllint/plans/<plan-id>.json; returns the path. */
function writePlanFile(plan: InstallPlan, cwd: string): string {
  const planDir = join(cwd, ".calllint", "plans")
  mkdirSync(planDir, { recursive: true })
  const file = join(planDir, `${plan.planId}.json`)
  writeFileSync(file, JSON.stringify(plan, null, 2) + "\n", "utf8")
  return file
}

/**
 * Discover which of the requested hosts are present on this machine. Only hosts
 * whose config file actually EXISTS are integrable — `integrate` targets the
 * agent tools the user already uses; it does not create configs for hosts that
 * are not installed. `includeMissing:true` surfaces the searched path so the
 * "not detected" message can name it, but a non-existent config is not a host.
 *
 * Scope is PROJECT-LEVEL only: we consider configs under `cwd` and ignore the
 * user-home fallbacks discovery also returns (e.g. ~/.cursor/mcp.json). That
 * keeps `integrate` predictable (it acts on the repo you run it in, not your
 * global machine state) and its tests hermetic.
 */
function detectHosts(cwd: string, hosts: AgentType[]): Map<AgentType, DiscoveredConfig> {
  const result = discoverConfigs({ cwd, agentTypes: hosts, includeMissing: true })
  const cwdPrefix = resolve(cwd)
  const byHost = new Map<AgentType, DiscoveredConfig>()
  for (const d of result.discovered) {
    // Project-scoped only: skip configs outside the working directory.
    if (!resolve(d.configPath).startsWith(cwdPrefix)) continue
    // Prefer an existing config; keep the first (highest-priority) per host.
    const prior = byHost.get(d.agentType)
    if (!prior || (!prior.exists && d.exists)) byHost.set(d.agentType, d)
  }
  return byHost
}

function planForHost(
  host: AgentType,
  detected: Map<AgentType, DiscoveredConfig>,
  deps: IntegrateDeps,
): HostPlan {
  const adapter = getHostAdapter(host)
  const overlay = overlayForHost(host)
  const discovered = detected.get(host)
  const configFromDiscovery = discovered?.configPath
  const configPath = configFromDiscovery ?? "(no default config path)"

  if (!adapter || !adapter.applyPlan) {
    return { host, configPath, plan: null, note: `host "${host}" has no audited writer (plan-only elsewhere)` }
  }
  // A host is only integrable if its config actually exists — `integrate` targets
  // the agent tools the user already uses, never creating a config for a host
  // that is not installed on this machine.
  if (!configFromDiscovery || !discovered?.exists) {
    return { host, configPath, plan: null, note: `host "${host}" not detected on this machine` }
  }

  // Read the current config bytes (read-only) to build an accurate add-vs-noop plan.
  let currentConfig: unknown | null = null
  let configDigest: `sha256:${string}` | "absent" = "absent"
  if (existsSync(configFromDiscovery)) {
    try {
      const bytes = readFileSync(configFromDiscovery, "utf8")
      configDigest = hashJson(bytes) as `sha256:${string}`
      currentConfig = JSON.parse(bytes)
    } catch {
      return { host, configPath, plan: null, note: `host config exists but is not valid JSON: ${configFromDiscovery}` }
    }
  }

  // Idempotency: if the calllint server is already present, no plan is produced.
  if (serverAlreadyPresent(currentConfig)) {
    return { host, configPath, plan: null, note: "already integrated (calllint server present) — no change" }
  }

  // Build the authority + deterministic decision over our OWN first-party entry.
  // The server is CallLint's published stdio MCP server (npx -y calllint-mcp) —
  // a fixed, known artifact, not a third-party target.
  const calllintServer: NormalizedMcpServer = {
    name: CALLLINT_MCP_SERVER_NAME,
    sourceConfigPath: configFromDiscovery,
    transport: "stdio",
    command: "npx",
    args: ["-y", "calllint-mcp"],
    envKeys: [],
    env: {},
    providedTools: [],
    raw: calllintMcpEntry(),
  }
  const authority = buildAuthorityManifest({ artifactDigest: null, servers: [calllintServer], surfaces: [] })
  const decision = decideForIntegrate(authority)

  const backupPath = `${configFromDiscovery}.calllint-backup`
  const expiresAt = planExpiry(deps.generatedAt)
  const ctx = {
    host,
    tier: adapter.tier,
    configPath: configFromDiscovery,
    configDigest,
    currentConfig,
    servers: [{ name: CALLLINT_MCP_SERVER_NAME, entry: calllintMcpEntry() }],
    backupPath,
    expiresAt,
  }
  const plan = adapter.createPlan(ctx, { artifactDigest: null, authority, decision })
  void overlay // overlay drives the recommend copy in a later PR; detection only here
  return { host, configPath, plan, note: null }
}

/** True when a parsed host config already lists a server named `calllint`. */
function serverAlreadyPresent(config: unknown): boolean {
  if (!config || typeof config !== "object") return false
  const servers = (config as { mcpServers?: unknown }).mcpServers
  if (!servers || typeof servers !== "object") return false
  return Object.prototype.hasOwnProperty.call(servers, CALLLINT_MCP_SERVER_NAME)
}

// ---------------------------------------------------------------------------
// Apply — reuse the audited writer verbatim (revalidate → atomic → verify →
// rollback). The ONLY path that writes. Requires --plan <file> --approve <digest>.
// ---------------------------------------------------------------------------

function integrateApply(args: ParsedArgs, deps: IntegrateDeps): CommandResult {
  const planFile = flagStr(args.flags, "plan")
  const approve = flagStr(args.flags, "approve")
  if (!planFile) return usage("Missing --plan <file>\nUsage: calllint integrate --apply --plan <plan.json> --approve <plan-digest>")
  if (!approve) return usage("Missing --approve <plan-digest>\nApproval must name the exact plan digest you reviewed.")

  let plan: InstallPlan
  try {
    plan = JSON.parse(readFileSync(resolve(deps.cwd, planFile), "utf8")) as InstallPlan
  } catch (err) {
    const e = err as Error & { code?: string }
    return { stdout: "", stderr: e.code === "ENOENT" ? `Plan file not found: ${planFile}` : `Plan file is not valid JSON: ${e.message}`, exitCode: EXIT.ERROR }
  }
  if (plan?.schema !== "calllint.install-plan.v1") {
    return { stdout: "", stderr: `Not a calllint.install-plan.v1 document: ${planFile}`, exitCode: EXIT.ERROR }
  }
  // Fail-closed on a tampered plan before touching the adapter.
  if (!verifyPlanDigest(plan)) {
    return { stdout: "", stderr: "Plan digest does not match its contents (tampered or hand-edited). Re-run `calllint integrate` to regenerate.", exitCode: EXIT.ERROR }
  }

  const adapter = getHostAdapter(plan.host)
  if (!adapter) return usage(`Unknown host "${plan.host}".`)
  if (!adapter.applyPlan) return usage(`Host "${plan.host}" is tier ${adapter.tier} — plan-only; cannot apply.`)

  const rawTarget = plan.operations[0]?.target
  if (!rawTarget) return usage("Plan has no operations to apply.")
  let configPath: string
  try {
    configPath = safeConfigPath(rawTarget, { cwd: deps.cwd, home: homedir() })
  } catch (err) {
    if (err instanceof PathSafetyError) return { stdout: "", stderr: `Unsafe target path in plan: ${err.message}`, exitCode: EXIT.ERROR }
    throw err
  }

  const rid = shortReceiptId(plan.planDigest, deps.generatedAt)
  const backupPath = `${configPath}.calllint-backup-${rid}`
  const lockPath = join(deps.cwd, ".calllint", "locks", `${hashJson(configPath).slice("sha256:".length, "sha256:".length + 16)}.lock`)

  const result: ApplyResult = adapter.applyPlan(plan, {
    approvalDigest: approve,
    configPath,
    backupPath,
    lockPath,
    fs: nodeFsPort(),
    now: deps.generatedAt,
  })

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(result, null, 2), stderr: "", exitCode: applyExitCode(result) }
  }
  return { stdout: renderApply(result), stderr: "", exitCode: applyExitCode(result) }
}

// ---------------------------------------------------------------------------
// Pure helpers (deterministic; no clock, no random).
// ---------------------------------------------------------------------------

/** 30-day plan expiry from the injected generatedAt (no Date.now()). */
function planExpiry(generatedAt: string): string {
  const ms = Date.parse(generatedAt)
  if (Number.isNaN(ms)) return generatedAt
  return new Date(ms + 30 * 24 * 60 * 60 * 1000).toISOString()
}

/** Deterministic short id from the plan digest + generatedAt (backup file suffix). */
function shortReceiptId(planDigest: string, generatedAt: string): string {
  return hashJson({ planDigest, generatedAt }).slice("sha256:".length, "sha256:".length + 12)
}

/** apply outcome → exit code. A non-applied/rolled-back outcome is not OK. */
function applyExitCode(result: ApplyResult): number {
  switch (result.outcome) {
    case "applied":
    case "already_applied":
      return EXIT.OK
    case "stale":
    case "conflict":
      return EXIT.ERROR
    case "rolled_back":
    case "rollback_failed":
      return EXIT.ERROR
  }
}

function renderPlans(hostPlans: HostPlan[], written: Map<AgentType, string>): string {
  const lines: string[] = ["CallLint integrate — preflight install plan (read-only; nothing written)\n"]
  for (const hp of hostPlans) {
    if (hp.plan) {
      lines.push(`  ${hp.host}: ${hp.plan.operations.length} op(s) → ${hp.configPath}`)
      lines.push(`    plan digest: ${hp.plan.planDigest}`)
      const planRef = written.get(hp.host) ?? "<saved-plan.json>"
      lines.push(`    apply with:  calllint integrate --apply --plan ${planRef} --approve ${hp.plan.planDigest}`)
    } else {
      lines.push(`  ${hp.host}: no change — ${hp.note}`)
    }
  }
  lines.push("\nInstalling the CallLint preflight server does not block your agent (ADR 0051); it recommends. CallLint never executes the servers it judges.")
  return lines.join("\n") + "\n"
}

function renderApply(result: ApplyResult): string {
  const head = `integrate apply: ${result.outcome} (${result.state}) — host ${result.host}`
  const trail = result.notes.map((n) => `  ${n}`).join("\n")
  const rb = result.rolledBack ? "\n  rolled back to the original config (verify failed)." : ""
  return `${head}\n${trail}${rb}\n`
}

function integrateHelp(): CommandResult {
  return {
    stdout: [
      "calllint integrate — install the CallLint preflight server into your agent hosts",
      "",
      "  calllint integrate                 detect hosts + print an install plan (read-only)",
      "  calllint integrate --host cursor   plan for one host only",
      "  calllint integrate --write-plan    persist each plan to .calllint/plans/<id>.json",
      "  calllint integrate --json          machine-readable plan",
      "  calllint integrate --apply --plan <p.json> --approve <digest>",
      "                                     apply an approved plan (atomic, verified, auto-rollback)",
      "",
      "Idempotent: a host that already has the calllint server yields no change.",
      "Plan-only by default; --apply is the only writer and reuses the audited",
      "trust-apply engine. Installing the preflight does not block your agent (ADR 0051).",
    ].join("\n") + "\n",
    stderr: "",
    exitCode: EXIT.OK,
  }
}

function usage(msg: string): CommandResult {
  return { stdout: "", stderr: msg, exitCode: EXIT.USAGE }
}
