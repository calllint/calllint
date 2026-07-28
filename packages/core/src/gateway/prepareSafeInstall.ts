/**
 * Safe-install prepare orchestration (ADR 0056 §10.4) — the ONE writer-free
 * sequence that both `calllint safe-install` (the CLI orchestrator, Batch 5) and
 * `calllint_prepare_safe_install` (the MCP tool, Batch 6) delegate to, so there is
 * no second copy of the gateway glue.
 *
 * It composes shipped primitives over an ALREADY-SYNTHESIZED mcp-config (a pinned
 * `npx -y <pkg>@<ver>` launch) — resolve identity → build authority manifest →
 * fold toxic flows → deterministic policy decision → (host-gated) install plan →
 * read-only `prepare`. PURE + DETERMINISTIC and OFFLINE by construction: an
 * `mcp-config` artifact is a LOCAL_TYPE (digested from the provided bytes, never
 * fetched), servers are parsed statically, and nothing is ever executed — so the
 * MCP server's no-network / no-exec invariant (ADR 0003/0025) holds unchanged.
 *
 * Every stage can only TIGHTEN: a BLOCK/UNKNOWN local decision withholds the plan,
 * and a public observation can never upgrade the local verdict (INV-2.4-02). The
 * host-config bytes are injected by the caller's edge (the ONLY disk read lives at
 * the edge, so this function itself touches neither disk, clock, nor network).
 */
import type {
  AuthorityManifest,
  GatewayEvidence,
  InstallPlan,
  NormalizedMcpServer,
  PlanAdoptionContract,
  Policy,
  TrustDecision,
  TrustPreparation,
} from "@calllint/types"
import { resolveArtifactIdentity } from "@calllint/resolver"
import { parseConfigText } from "@calllint/config-parser"
import { decideOverAuthority } from "@calllint/policy"
import { buildFlows, foldFlowsIntoReasons } from "@calllint/flow-analyzer"
import { hashJson } from "@calllint/fingerprint"
import {
  getHostAdapter,
  claudeCodeServerEntry,
  cursorServerEntry,
  windsurfServerEntry,
  withAdoptionContract,
  CLAUDE_CODE_HOST_ID,
  CURSOR_HOST_ID,
  WINDSURF_HOST_ID,
  type PlanContext,
  type PlannedServer,
} from "@calllint/install-planner"
import { buildAuthorityManifest } from "./authority.js"
import { prepare, type InstallExpectations } from "./prepare.js"

/** Host-plan context injected by the edge — the host-config bytes are the ONLY
 *  disk read, done by the caller (so this function stays pure). Absent ⇒ no plan
 *  (the state stops at DECIDED; the decision is host-independent). */
export interface SafeInstallHostPlan {
  /** Host id (e.g. "claude-code", "cursor", "windsurf"). */
  host: string
  /** Real absolute path of the host config the plan targets (recorded in the plan). */
  configPath: string
  /** Current host-config bytes read at the edge, or null when the file is absent. */
  hostConfigText: string | null
  /** ISO-8601 UTC plan-expiry, injected from the edge. */
  expiresAt: string
}

export interface PrepareSafeInstallInput {
  /** Synthesized mcp-config text — a pinned `npx -y <pkg>@<ver>` launch. */
  configText: string
  /** Stable source label for the synthesized config (e.g. `npm:pkg@ver`). */
  configPath: string
  /** Deterministic policy for the local re-decode (adoption-basis or caller's). */
  policy: Policy
  /** Optional external evidence (already imported at the edge; never re-scored). */
  evidence?: GatewayEvidence[]
  /** Host-plan context. Absent ⇒ prepare stops at DECIDED (no plan). */
  hostPlan?: SafeInstallHostPlan
  /** Exact-target expectations (INV-2.4-06); contractDigest also recorded as provenance. */
  expect?: InstallExpectations
  /** ISO-8601 UTC, injected from the edge. */
  preparedAt: string
}

/** Reduce parsed servers to the target host's known-schema entries. Mirrors the
 *  CLI's `plannedServersFor` (the ONLY place the install path shapes the config). */
function plannedServersFor(servers: NormalizedMcpServer[], host: string): PlannedServer[] {
  const entryByHost: Record<string, typeof claudeCodeServerEntry> = {
    [CLAUDE_CODE_HOST_ID]: claudeCodeServerEntry,
    [CURSOR_HOST_ID]: cursorServerEntry,
    [WINDSURF_HOST_ID]: windsurfServerEntry,
  }
  const entryFor = entryByHost[host] ?? claudeCodeServerEntry
  return servers.map((s) => ({
    name: s.name,
    entry: entryFor({ command: s.command, args: s.args, url: s.url, envKeys: s.envKeys }),
  }))
}

/** Build the Install Plan from injected host-config bytes (no disk I/O here). Returns
 *  null when nothing is installable; throws only on an unreadable/unknown host. */
function buildPlan(
  hostPlan: SafeInstallHostPlan,
  servers: NormalizedMcpServer[],
  artifactDigest: string | null,
  authority: AuthorityManifest,
  decision: TrustDecision,
): InstallPlan {
  const adapter = getHostAdapter(hostPlan.host)
  if (!adapter) throw new Error(`Unknown host "${hostPlan.host}"`)
  const planned = plannedServersFor(servers, hostPlan.host)
  let configDigest: `sha256:${string}` | "absent" = "absent"
  let currentConfig: unknown | null = null
  if (hostPlan.hostConfigText !== null) {
    configDigest = hashJson(hostPlan.hostConfigText) as `sha256:${string}`
    currentConfig = JSON.parse(hostPlan.hostConfigText)
  }
  const ctx: PlanContext = {
    host: hostPlan.host,
    tier: adapter.tier,
    configPath: hostPlan.configPath,
    configDigest,
    currentConfig,
    servers: planned,
    backupPath: `${hostPlan.configPath}.calllint-backup`,
    expiresAt: hostPlan.expiresAt,
  }
  const plan = adapter.createPlan(ctx, { artifactDigest, authority, decision })
  const check = adapter.validatePlan(plan)
  if (!check.ok) throw new Error(`Generated plan failed validation: ${check.errors.join("; ")}`)
  return plan
}

/**
 * The shared safe-install prepare (ADR 0056 §10.4). Composes the shipped read-only
 * gateway over a synthesized mcp-config and returns the read-only TrustPreparation
 * — identical to what `trust prepare mcp.json --host … --policy …` produces, so the
 * CLI and MCP surfaces cannot disagree. Writes nothing; a plan (when host-gated) is
 * inert data whose verdict rides in its decisionDigest and the caller's exit mapping.
 */
export function prepareSafeInstall(input: PrepareSafeInstallInput): TrustPreparation {
  // Parse the synthesized config statically (a malformed synth yields no servers —
  // honest-empty, never a false pass). Never executed.
  let servers: NormalizedMcpServer[] = []
  try {
    servers = parseConfigText(input.configText, input.configPath).servers
  } catch {
    servers = []
  }

  // G1 — resolve identity over the provided bytes (mcp-config is a LOCAL_TYPE:
  // digested from bytes, no fetch). G3 — authority manifest (inventory, not verdict).
  const artifact = resolveArtifactIdentity({
    sourceType: "mcp-config",
    source: input.configPath,
    requestedRef: null,
    content: input.configText,
    resolvedAt: input.preparedAt,
  })
  const authority = buildAuthorityManifest({
    artifactDigest: artifact.digest ?? null,
    servers,
    surfaces: [],
  })

  // G4 — deterministic decision, with toxic-flow composition folded in (raises,
  // never lowers, I-04). Only meaningful once the artifact resolved.
  const flowReasons = foldFlowsIntoReasons(buildFlows([authority]))
  const decision: TrustDecision | undefined =
    artifact.resolution === "resolved"
      ? decideOverAuthority({ authority, evidence: input.evidence, policy: input.policy, flowReasons })
      : undefined

  // G5 — host-gated install plan. Built for any CONFIDENT verdict (SAFE/REVIEW/BLOCK);
  // UNKNOWN never yields a plan. The verdict rides in the plan's decisionDigest.
  let plan: InstallPlan | undefined
  if (input.hostPlan && decision && decision.verdict !== "UNKNOWN" && servers.length > 0) {
    plan = buildPlan(input.hostPlan, servers, artifact.digest ?? null, authority, decision)
  }

  // Contract-digest provenance (Batch 4): recorded on the plan, never a gate. Absent
  // ⇒ byte-identical to a plan with no provenance.
  if (plan && input.expect?.contractDigest) {
    const provenance: PlanAdoptionContract = { contractDigest: input.expect.contractDigest }
    if (input.expect.version) provenance.expectedVersion = input.expect.version
    if (input.expect.artifactDigest) provenance.expectedArtifactDigest = input.expect.artifactDigest
    plan = withAdoptionContract(plan, provenance)
  }

  return prepare({
    artifact,
    evidence: input.evidence,
    authority,
    decision,
    plan,
    expect: input.expect,
    preparedAt: input.preparedAt,
  })
}
