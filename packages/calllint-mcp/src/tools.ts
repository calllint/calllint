// ---------------------------------------------------------------------------
// calllint-mcp — tool registry (ADR 0025). Pure delegators: each tool validates
// its input, calls @calllint/core, and returns an MCP tool result. NO scoring,
// NO verdict logic here — that all lives in core. Each function is total: bad
// input returns an isError result; it never throws across the JSON-RPC boundary.
// ---------------------------------------------------------------------------

import {
  scanConfigFile,
  scanConfigText,
  checkParsed,
  loadSurfaceText,
  inferOrigin,
  buildBaseline,
  computeDrift,
  renderHostRule,
  renderCiGate,
  RULE_HOSTS,
  CI_GATE_MODES,
  ConfigParseError,
  prepareSafeInstall,
  type ScanOptions,
} from "@calllint/core"
import { adoptionBasisPolicy } from "@calllint/policy"
import { rememberPlanAnchor, recallPlanAnchor } from "./planAnchors.js"
import { renderExplain, NO_EMOJI_STYLE } from "@calllint/report-renderer"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import type { ApplyResult, Baseline, InstallPlan, TrustPreparation } from "@calllint/types"
import { matchLexical } from "@calllint/trust-index/matchLexical"
import {
  applyPlan,
  buildDecisionReceipt,
  nodeFsPort,
  receiptBodyDigest,
  verifyDecisionReceipt,
  CLAUDE_CODE_HOST_ID,
  CURSOR_HOST_ID,
  WINDSURF_HOST_ID,
} from "@calllint/install-planner"
import { existsSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { COMMITTED_LOOKUP_ENTRIES } from "./committedLookup.js"
import {
  GUARD_HOST_IDS,
  continuousProtectionOffer,
  isGuardHostId,
  renderContinuousProtectionOffer,
} from "@calllint/core"
import { findCommittedContract, type AdoptionContract } from "./committedContracts.js"
import { VERSION } from "./version.js"

/** MCP tool result shape (text content only — CallLint emits JSON/text). */
export interface ToolResult {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, opts: ScanOptions) => ToolResult
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}
function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true }
}
function json(value: unknown): ToolResult {
  return ok(JSON.stringify(value, null, 2))
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === "string" ? v : undefined
}

/** Wrap a handler so any throw becomes an isError result, never a transport crash. */
function safe(
  fn: (args: Record<string, unknown>, opts: ScanOptions) => ToolResult,
): ToolDef["handler"] {
  return (args, opts) => {
    try {
      return fn(args, opts)
    } catch (e) {
      if (e instanceof ConfigParseError) return err(`Parse error: ${e.message}`)
      return err(e instanceof Error ? e.message : String(e))
    }
  }
}

/**
 * Map the read-only TrustPreparation to the safe-install outcome enum — the SAME
 * projection the CLI orchestrator uses (mirrored here because `apps/cli` result.ts
 * is not an importable package; ADR 0056 §10.4 forbids reimplementing the gateway
 * glue, which lives in the shared core prepareSafeInstall — this is only the terminal
 * label). Fail-closed: anything not confidently prepared → LOCAL_PREFLIGHT_REQUIRED.
 */
function outcomeForPreparation(prep: TrustPreparation): string {
  const verdict = prep.decision?.verdict
  switch (prep.state) {
    case "TARGET_MISMATCH":
      return "ABORTED_ON_MISMATCH"
    case "PLAN_READY":
    case "DECIDED":
      if (verdict === "BLOCK") return "BLOCKED"
      if (verdict === "UNKNOWN") return "LOCAL_PREFLIGHT_REQUIRED"
      return "PREPARED"
    default:
      return "LOCAL_PREFLIGHT_REQUIRED"
  }
}

/** The honest public-route floor from the committed contract's recommendedNextAction.
 *  Returns a terminal outcome when the route is not locally preparable, else null. */
function publicFloor(kind: string): { outcome: string; note: string } | null {
  switch (kind) {
    case "EXPLAIN_ONLY":
      return { outcome: "UNSUPPORTED", note: "no supported install plan for this target — view manual setup" }
    case "INSPECT_BLOCKERS":
      return { outcome: "BLOCKED", note: "public verdict blocked by policy; inspect blockers before any install" }
    case "LOCAL_PREFLIGHT_REQUIRED":
      return { outcome: "LOCAL_PREFLIGHT_REQUIRED", note: "insufficient evidence / no exact target; run local pre-flight" }
    case "PREPARE_LOCALLY":
      return null
    default:
      return { outcome: "LOCAL_PREFLIGHT_REQUIRED", note: `unrecognized contract action "${kind}" — run local pre-flight` }
  }
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/
/** The Tier-A hosts an adoption plan can target, from the shipped adapter ids (never
 *  a second host list). Typed as Set<string> so an arbitrary caller-supplied string
 *  can be membership-tested against it. */
const PLAN_HOSTS: ReadonlySet<string> = new Set<string>([CLAUDE_CODE_HOST_ID, CURSOR_HOST_ID, WINDSURF_HOST_ID])
const SAFE_INSTALL_RESULT_SCHEMA = "calllint.safe-install-result.v1"
const VERIFY_RESULT_SCHEMA = "calllint.verify-tool-install-result.v1"

/**
 * The host's own MCP-config location, for the two hosts whose config is at a
 * cwd-independent home-relative path. Cursor's config is PROJECT-scoped, so it has
 * no server-side default — an explicit `hostConfigPath` is required there rather
 * than a guessed location (INV-2.4-08: unsupported means unsupported).
 */
function defaultHostConfigPath(host: string): string | null {
  if (host === CLAUDE_CODE_HOST_ID) return join(homedir(), ".claude.json")
  if (host === WINDSURF_HOST_ID) return join(homedir(), ".codeium", "mcp_config.json")
  return null
}

/** Read host-config bytes at the edge (read-only). null ⇒ the file is absent. */
function readHostConfig(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null
}

/**
 * Project a delegated apply outcome onto the safe-install outcome enum — the SAME
 * fail-closed projection the CLI's `mapAppliedToOutcome` uses (mirrored because
 * `apps/cli` result.ts is not an importable package). APPLIED_AND_VERIFIED requires
 * BOTH a durable apply AND a structurally-valid receipt; every other apply outcome
 * (stale / conflict / rolled_back / rollback_failed) degrades to a re-preflight.
 */
function outcomeForApply(result: ApplyResult, receiptValid: boolean): string {
  const durable = result.outcome === "applied" || result.outcome === "already_applied"
  return durable && receiptValid ? "APPLIED_AND_VERIFIED" : "LOCAL_PREFLIGHT_REQUIRED"
}

/** A deterministic, filesystem-safe suffix for this apply's backup + lock files,
 *  taken straight from the sealed plan digest (already a sha256 — no rehash). Same
 *  plan ⇒ same suffix, so a retried apply reuses one lock instead of racing. */
function planSuffix(plan: InstallPlan): string {
  return plan.planDigest.slice("sha256:".length, "sha256:".length + 16)
}

/** Assert the caller's stated exact target against the contract's own fields (offline;
 *  a substituted contract can only STOP). Returns the mismatch reasons (empty ⇒ match). */
function targetMismatches(
  contract: AdoptionContract,
  expect: { version?: string; artifact?: string; contract?: string },
): string[] {
  const m: string[] = []
  const subj = contract.subject
  if (expect.artifact && subj.artifactDigest && expect.artifact !== subj.artifactDigest) {
    m.push(`expected artifact digest ${expect.artifact} does not match the contract's ${subj.artifactDigest}`)
  }
  if (expect.contract && contract.contract.contractDigest && expect.contract !== contract.contract.contractDigest) {
    m.push(`expected contract digest ${expect.contract} does not match the contract's ${contract.contract.contractDigest}`)
  }
  if (expect.version && subj.version && expect.version !== subj.version) {
    m.push(`expected version ${expect.version} does not match the contract's ${subj.version}`)
  }
  return m
}

/** A stable server key from the canonical slug — the SAME derivation the CLI uses. */
function serverKeyForSlug(slug: string): string {
  const base = slug.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  return base.replace(/^-+|-+$/g, "") || "tool"
}

/** The nothing-was-written closing note. Both the prepare tool and every apply
 *  REFUSAL path end here: in both cases no byte moved, so the honest statement is
 *  identical and cannot drift between the two surfaces. */
const NO_WRITE_NOTE =
  "Nothing was executed and no config was written. A PREPARED plan authorizes nothing; applying it is a separate step that requires naming its exact plan digest."

/** Emit the safe-install result envelope (schema-aligned with the CLI's v1 shape).
 *  Used for prepare results and for every apply path that refuses BEFORE the write
 *  (a successful apply emits its own richer envelope with the receipt attached). */
function emitResult(fields: {
  outcome: string
  canonicalName: string
  /** Emitting tool name; defaults to the prepare tool. */
  tool?: string
  host?: string | null
  version: string | null
  artifactDigest: string | null
  contractDigest: string | null
  planDigest?: string | null
  notes: string[]
}): ToolResult {
  return json({
    schema: SAFE_INSTALL_RESULT_SCHEMA,
    mode: "ONE_TIME_PROTECTED_SETUP",
    host: fields.host ?? null,
    ...fields,
    tool: fields.tool ?? "calllint_prepare_safe_install",
    // Stable schema: planDigest is always present, null when no writable plan exists.
    planDigest: fields.planDigest ?? null,
    persistentComponents: [],
    note: NO_WRITE_NOTE,
  })
}

function prepareSafeInstallHandler(args: Record<string, unknown>, opts: ScanOptions): ToolResult {
  const slug = str(args, "canonicalName")
  if (!slug) return err("canonicalName is required")
  const expectVersion = str(args, "expectedVersion")
  const expectArtifact = str(args, "expectedArtifactDigest")
  const expectContract = str(args, "expectedContractDigest")
  for (const [name, v] of [
    ["expectedArtifactDigest", expectArtifact],
    ["expectedContractDigest", expectContract],
  ] as const) {
    if (v !== undefined && !SHA256_RE.test(v)) return err(`${name} must be a sha256:<64-hex> digest`)
  }

  // Look up by canonical slug ONLY — an expectedVersion is an exact-target ASSERTION
  // (a mismatch must STOP with ABORTED_ON_MISMATCH, not read as "not found").
  const contract = findCommittedContract(slug)
  if (!contract) {
    return emitResult({
      outcome: "UNSUPPORTED",
      canonicalName: slug,
      version: null,
      artifactDigest: null,
      contractDigest: null,
      notes: [
        `No committed CallLint adoption contract for "${slug}". Absence is not a verdict — cannot prepare a target with no published contract.`,
      ],
    })
  }
  const subj = contract.subject
  const base = {
    canonicalName: subj.canonicalName,
    version: subj.version,
    artifactDigest: subj.artifactDigest ?? null,
    contractDigest: contract.contract.contractDigest ?? null,
  }

  // 1) Exact-target identity gate (offline; a substituted contract can only STOP).
  const mismatches = targetMismatches(contract, {
    version: expectVersion,
    artifact: expectArtifact,
    contract: expectContract,
  })
  if (mismatches.length > 0) {
    return emitResult({
      ...base,
      outcome: "ABORTED_ON_MISMATCH",
      notes: ["exact-target identity assertion failed — no writable plan was produced", ...mismatches],
    })
  }

  // 2) Public-verdict floor (fail-closed). A non-actionable public route short-circuits
  // BEFORE any local re-decode, so a public BLOCK/UNKNOWN/unsupported is never laundered.
  const floor = publicFloor(contract.recommendedNextAction.kind)
  if (floor) return emitResult({ ...base, outcome: floor.outcome, notes: [floor.note] })

  // 3) npm gate — only a pinned npm subject is auto-preparable (mirrors the CLI Batch 5).
  if (subj.packageType !== "npm" || !subj.packageName || !subj.version) {
    return emitResult({
      ...base,
      outcome: "LOCAL_PREFLIGHT_REQUIRED",
      notes: [
        `only a pinned npm subject is auto-preparable in this version (got ${subj.packageType ?? "no"} type)`,
        "run local pre-flight (`calllint trust prepare`) for this target",
      ],
    })
  }

  // 4) Actionable — synthesize the exact pinned launch and delegate to the shared,
  // writer-free core sequence (the SAME one the CLI runs). Host-gated: a plan is built
  // only when a supported host is named; otherwise the local decision is returned alone.
  return runPrepare(args, opts, contract, base)
}

function runPrepare(
  args: Record<string, unknown>,
  opts: ScanOptions,
  contract: AdoptionContract,
  base: { canonicalName: string; version: string | null; artifactDigest: string | null; contractDigest: string | null },
): ToolResult {
  const subj = contract.subject
  const key = serverKeyForSlug(subj.canonicalSlug)
  const synth = { mcpServers: { [key]: { command: "npx", args: ["-y", `${subj.packageName}@${subj.version}`] } } }
  const configText = JSON.stringify(synth, null, 2) + "\n"

  const host = str(args, "host")
  if (host !== undefined && !PLAN_HOSTS.has(host)) {
    return err(`unsupported host "${host}" — expected one of: ${[...PLAN_HOSTS].join(", ")}`)
  }

  // Read the named host config once (read-only; the ONLY disk touch). Absent file ⇒ plan
  // against a fresh/empty config. Contract digest rides as recorded PROVENANCE, never a gate.
  //
  // The target path is resolved the SAME way apply resolves it (explicit hostConfigPath,
  // else the host's own default; null for project-scoped cursor). This matters: the path
  // is part of the sealed plan, so if prepare planned against a placeholder while apply
  // resolved a real path, the digests could never match and the approval gate would abort
  // every honest hand-off. Planning against an unresolvable path stays symbolic — that
  // plan is inert by construction, and apply refuses it with UNSUPPORTED rather than
  // guessing a location.
  let hostPlan
  if (host) {
    const hostConfigPath = str(args, "hostConfigPath") ?? defaultHostConfigPath(host)
    const hostConfigText = hostConfigPath ? readHostConfig(hostConfigPath) : null
    hostPlan = {
      host,
      configPath: hostConfigPath ?? `<${host}-config>`,
      hostConfigText,
      // Anchored to the REAL clock, not the server's pinned report clock: this
      // window is what the engine's staleness guard is checked against on apply.
      // Pinning it to server start made that guard inert (see planAnchors.ts).
      expiresAt: planWindowFrom(planNow(opts)),
    }
  }

  const prep = prepareSafeInstall({
    configText,
    configPath: `npm:${subj.packageName}@${subj.version}`,
    policy: adoptionBasisPolicy(),
    hostPlan,
    expect: base.contractDigest ? { contractDigest: base.contractDigest as `sha256:${string}` } : undefined,
    preparedAt: opts.generatedAt ?? new Date(opts.now ?? 0).toISOString(),
  })

  const outcome = outcomeForPreparation(prep)
  const planDigest = (prep.plan?.planDigest as string | undefined) ?? null
  // Remember the window this digest was sealed with so the separate apply call can
  // reproduce the digest without re-anchoring to a fresh (and therefore different)
  // window. The anchor decides nothing — apply still recomputes every safety fact.
  if (planDigest && hostPlan?.expiresAt) rememberPlanAnchor(planDigest, hostPlan.expiresAt)
  const notes: string[] = []
  if (!host) {
    notes.push("no host named — returning the local decision only; pass host to compute an install plan")
  }
  if (outcome === "PREPARED" && planDigest) {
    notes.push(`plan ${planDigest.slice(0, 23)}… computed for host "${host}" — NOT applied (apply is a separate human-approved step)`)
  } else if (outcome === "PREPARED" && !planDigest) {
    notes.push(`local verdict ${prep.decision?.verdict ?? "?"} — preparable; name a host to compute the applyable plan`)
  }
  return emitResult({ ...base, host: host ?? null, outcome, planDigest, notes })
}

/** The identity/route/subject gates every actionable safe-install shares, run in the
 *  SAME fail-closed order as prepare. Returns a terminal ToolResult to short-circuit
 *  on, or the resolved contract + carried identity when the target is actionable. */
type GateOutcome =
  | { stop: ToolResult }
  | {
      contract: AdoptionContract
      base: { canonicalName: string; version: string | null; artifactDigest: string | null; contractDigest: string | null }
    }

function gateActionableTarget(
  args: Record<string, unknown>,
  slug: string,
  tool: string,
  host: string | null,
): GateOutcome {
  const expectVersion = str(args, "expectedVersion")
  const expectArtifact = str(args, "expectedArtifactDigest")
  const expectContract = str(args, "expectedContractDigest")
  for (const [name, v] of [
    ["expectedArtifactDigest", expectArtifact],
    ["expectedContractDigest", expectContract],
  ] as const) {
    if (v !== undefined && !SHA256_RE.test(v)) return { stop: err(`${name} must be a sha256:<64-hex> digest`) }
  }

  const contract = findCommittedContract(slug)
  if (!contract) {
    return {
      stop: emitResult({
        tool,
        outcome: "UNSUPPORTED",
        canonicalName: slug,
        host,
        version: null,
        artifactDigest: null,
        contractDigest: null,
        notes: [
          `No committed CallLint adoption contract for "${slug}". Absence is not a verdict — nothing was written.`,
        ],
      }),
    }
  }
  const subj = contract.subject
  const base = {
    canonicalName: subj.canonicalName,
    version: subj.version,
    artifactDigest: subj.artifactDigest ?? null,
    contractDigest: contract.contract.contractDigest ?? null,
  }

  // 1) Exact-target identity gate (offline; a substituted contract can only STOP).
  const mismatches = targetMismatches(contract, {
    version: expectVersion,
    artifact: expectArtifact,
    contract: expectContract,
  })
  if (mismatches.length > 0) {
    return {
      stop: emitResult({
        ...base,
        tool,
        host,
        outcome: "ABORTED_ON_MISMATCH",
        notes: ["exact-target identity assertion failed — nothing was written", ...mismatches],
      }),
    }
  }

  // 2) Public-verdict floor (fail-closed) — a public BLOCK/UNKNOWN/unsupported route
  // short-circuits BEFORE any local re-decode, so it is never laundered into a write.
  const floor = publicFloor(contract.recommendedNextAction.kind)
  if (floor) return { stop: emitResult({ ...base, tool, host, outcome: floor.outcome, notes: [floor.note] }) }

  // 3) npm gate — only a pinned npm subject is auto-preparable.
  if (subj.packageType !== "npm" || !subj.packageName || !subj.version) {
    return {
      stop: emitResult({
        ...base,
        tool,
        host,
        outcome: "LOCAL_PREFLIGHT_REQUIRED",
        notes: [
          `only a pinned npm subject is auto-preparable in this version (got ${subj.packageType ?? "no"} type)`,
          "run local pre-flight (`calllint trust prepare`) for this target",
        ],
      }),
    }
  }
  return { contract, base }
}

/** How long a prepared plan stays applyable. */
const PLAN_TTL_MS = 60 * 60 * 1000

/**
 * The clock a plan's validity WINDOW is measured on — deliberately separate from
 * `opts.generatedAt`, which the server pins once at startup so scan reports stay
 * reproducible per call. A window measured on that pinned clock can never elapse
 * (see planAnchors.ts), so this reads real time.
 *
 * `opts.planNowMs` exists only so tests can place a session at a chosen instant;
 * production never sets it and falls through to `Date.now()`.
 */
function planNow(opts: ScanOptions & { planNowMs?: number }): number {
  return opts.planNowMs ?? Date.now()
}

function planNowIso(opts: ScanOptions & { planNowMs?: number }): string {
  return new Date(planNow(opts)).toISOString()
}

function planWindowFrom(nowMs: number): string {
  return new Date(nowMs + PLAN_TTL_MS).toISOString()
}

const APPLY_TOOL = "calllint_apply_prepared_install"

/**
 * Apply an already-prepared, explicitly-approved install plan (ADR 0056 §12.3).
 * Two mandatory gates before any byte is written:
 *   - a supported host MUST be named (no guessed install location), and
 *   - `approvalDigest` MUST equal the FRESHLY recomputed plan digest — the caller
 *     proves it reviewed this exact plan. Any drift in the host config or contract
 *     since prepare changes the digest and aborts (INV-2.4-06).
 * The write itself is DELEGATED to the shipped apply engine (the ONE writer,
 * INV-2.4-03) — this handler holds zero direct `node:fs` writes, never executes the
 * installed target (INV-2.4-09), and installs zero persistent CallLint components
 * (one-time mode, INV-2.4-07).
 */
function applyPreparedInstallHandler(args: Record<string, unknown>, opts: ScanOptions): ToolResult {
  const slug = str(args, "canonicalName")
  if (!slug) return err("canonicalName is required")

  // Host permission is MANDATORY for apply — there is no "decide only" mode here.
  const host = str(args, "host")
  if (!host) return err(`host is required to apply — expected one of: ${[...PLAN_HOSTS].join(", ")}`)
  if (!PLAN_HOSTS.has(host)) {
    return err(`unsupported host "${host}" — expected one of: ${[...PLAN_HOSTS].join(", ")}`)
  }

  // The exact plan digest the caller reviewed. Never optional, never inferred.
  const approvalDigest = str(args, "approvalDigest")
  if (!approvalDigest) {
    return err("approvalDigest is required — pass the exact planDigest calllint_prepare_safe_install returned")
  }
  if (!SHA256_RE.test(approvalDigest)) return err("approvalDigest must be a sha256:<64-hex> digest")

  const configPath = str(args, "hostConfigPath") ?? defaultHostConfigPath(host)
  if (!configPath) {
    return emitResult({
      tool: APPLY_TOOL,
      outcome: "UNSUPPORTED",
      canonicalName: slug,
      host,
      version: null,
      artifactDigest: null,
      contractDigest: null,
      notes: [
        `host "${host}" keeps its MCP config in the project, so it has no server-side default — pass hostConfigPath explicitly (no location is ever guessed)`,
      ],
    })
  }

  const gate = gateActionableTarget(args, slug, APPLY_TOOL, host)
  if ("stop" in gate) return gate.stop
  return runApply(opts, gate.contract, gate.base, host, configPath, approvalDigest)
}

function runApply(
  opts: ScanOptions,
  contract: AdoptionContract,
  base: { canonicalName: string; version: string | null; artifactDigest: string | null; contractDigest: string | null },
  host: string,
  configPath: string,
  approvalDigest: string,
): ToolResult {
  const subj = contract.subject
  const generatedAt = opts.generatedAt ?? new Date(opts.now ?? 0).toISOString()
  // Inherit the window the approved plan was sealed with (prepare remembered it) so
  // the digest below can reproduce. Falling back to a fresh window is deliberate and
  // harmless: the digest then cannot match and the approval gate aborts — the honest
  // outcome when this session never prepared the plan being approved.
  const inherited = recallPlanAnchor(approvalDigest)
  const nowIso = planNowIso(opts)
  const expiresAt = inherited ?? planWindowFrom(planNow(opts))

  // Re-run the SAME shared, writer-free prepare the prepare tool runs. Deterministic
  // over identical inputs, so an unchanged target reproduces the digest the caller
  // approved; ANY drift (host config, contract, policy) changes it and aborts below.
  const key = serverKeyForSlug(subj.canonicalSlug)
  const synth = { mcpServers: { [key]: { command: "npx", args: ["-y", `${subj.packageName}@${subj.version}`] } } }
  const prep = prepareSafeInstall({
    configText: JSON.stringify(synth, null, 2) + "\n",
    configPath: `npm:${subj.packageName}@${subj.version}`,
    policy: adoptionBasisPolicy(),
    hostPlan: {
      host,
      configPath,
      hostConfigText: readHostConfig(configPath),
      expiresAt,
    },
    expect: base.contractDigest ? { contractDigest: base.contractDigest as `sha256:${string}` } : undefined,
    preparedAt: generatedAt,
  })

  const localOutcome = outcomeForPreparation(prep)
  const plan = prep.plan
  // No applyable plan (local re-decide was BLOCK/UNKNOWN, or produced nothing). This
  // is where a LOCAL decision STRICTER than the public one is honored (INV-2.4-02).
  if (!plan || localOutcome !== "PREPARED") {
    return emitResult({
      ...base,
      tool: APPLY_TOOL,
      host,
      outcome: localOutcome,
      notes: [
        `local Trust Gateway state ${prep.state}${prep.decision ? ` (verdict ${prep.decision.verdict})` : ""} — nothing was written`,
        ...(prep.decision?.verdict === "UNKNOWN"
          ? ["local decision is UNKNOWN — insufficient evidence; never treated as safe"]
          : []),
      ],
    })
  }

  // The approval gate (§10.7): the caller must name the digest of the plan it read.
  const planDigest = plan.planDigest as string
  if (planDigest !== approvalDigest) {
    return emitResult({
      ...base,
      tool: APPLY_TOOL,
      host,
      outcome: "ABORTED_ON_MISMATCH",
      planDigest,
      notes: [
        "approvalDigest does not match the freshly recomputed plan — nothing was written",
        `recomputed plan ${planDigest.slice(0, 23)}…, approved ${approvalDigest.slice(0, 23)}…`,
        "the host config or the pinned target changed since you prepared — re-run calllint_prepare_safe_install and review the new plan",
      ],
    })
  }

  // DELEGATE the write to the shipped apply engine — the ONE writer (INV-2.4-03). It
  // revalidates the sealed plan, takes an exclusive lock, backs up, writes atomically,
  // verifies, and rolls back on failure. CallLint working files stay OUTSIDE the user's
  // tree (the lock lives in tmp), so one-time mode leaves zero persistent files.
  const suffix = planSuffix(plan)
  let applied: ApplyResult
  try {
    applied = applyPlan({
      plan,
      approvalDigest,
      configPath,
      backupPath: `${configPath}.calllint-backup-${suffix}`,
      lockPath: join(tmpdir(), "calllint-mcp-locks", `${suffix}.lock`),
      fs: nodeFsPort(),
      // The REAL clock, not the server's pinned report clock. Passing the pinned
      // clock made `now > expiresAt` unreachable, so the engine's staleness guard
      // could never fire no matter how long the session had been running.
      now: nowIso,
    })
  } catch (e) {
    return emitResult({
      ...base,
      tool: APPLY_TOOL,
      host,
      outcome: "LOCAL_PREFLIGHT_REQUIRED",
      planDigest,
      notes: [`delegated apply failed: ${e instanceof Error ? e.message : String(e)}`],
    })
  }

  // The decision receipt (calllint.receipt.v1) is built + verified in memory and
  // returned inline — MCP is stateless between calls, so the caller keeps the record
  // and can re-verify it later with calllint_verify_tool_install.
  const receipt = buildDecisionReceipt(applied, plan, {
    approvedAt: generatedAt,
    approver: null,
    scannerVersion: VERSION,
    policyVersion: null,
  })
  const verified = verifyDecisionReceipt(receipt, { now: generatedAt })
  const outcome = outcomeForApply(applied, verified.valid)
  const notes = [...applied.notes]
  if (outcome !== "APPLIED_AND_VERIFIED") {
    notes.unshift(
      `apply did not durably verify (outcome ${applied.outcome}, receipt ${verified.valid ? "ok" : "unverified"}) — re-run local pre-flight`,
    )
  }

  return json({
    tool: APPLY_TOOL,
    schema: SAFE_INSTALL_RESULT_SCHEMA,
    mode: "ONE_TIME_PROTECTED_SETUP",
    outcome,
    ...base,
    host,
    planDigest,
    receiptDigest: verified.valid ? receiptBodyDigest(receipt) : null,
    receipt,
    configPath: applied.configPath,
    configDigestBefore: applied.configDigestBefore,
    configDigestAfter: applied.configDigestAfter,
    backupPath: applied.backupPath,
    rolledBack: applied.rolledBack,
    // One-time protected setup installs NO CallLint MCP / plugin / hook / Guard
    // (INV-2.4-07). Persistent protection needs its own explicit approval.
    persistentComponents: [],
    notes,
    note: "Written by the shipped CallLint Trust Gateway apply engine (backup → atomic write → verify → rollback on failure). One-time protected setup: zero persistent CallLint components were installed, and the installed target was never started, connected to, or tested. Keep `receipt` to re-verify this apply later.",
  })
}

const VERIFY_TOOL = "calllint_verify_tool_install"

/**
 * Read-only verification of an applied install (ADR 0056 §12.3). Confirms the exact
 * pinned launch the contract names is what actually sits in the host config, and
 * (optionally) that a decision receipt from the apply is structurally sound with its
 * approval binding intact. It re-decides NOTHING: no scanner, no policy, no verdict —
 * it observes and compares, so it can only report drift, never bless it.
 */
function verifyToolInstallHandler(args: Record<string, unknown>, opts: ScanOptions): ToolResult {
  const slug = str(args, "canonicalName")
  if (!slug) return err("canonicalName is required")
  const host = str(args, "host")
  if (!host) return err(`host is required — expected one of: ${[...PLAN_HOSTS].join(", ")}`)
  if (!PLAN_HOSTS.has(host)) {
    return err(`unsupported host "${host}" — expected one of: ${[...PLAN_HOSTS].join(", ")}`)
  }
  const configPath = str(args, "hostConfigPath") ?? defaultHostConfigPath(host)
  if (!configPath) {
    return err(
      `host "${host}" keeps its MCP config in the project — pass hostConfigPath explicitly (no location is ever guessed)`,
    )
  }

  const contract = findCommittedContract(slug)
  const subj = contract?.subject
  const serverKey = serverKeyForSlug(subj?.canonicalSlug ?? slug)
  // The exact pinned launch the committed contract pins, for an npm subject. null ⇒
  // we can confirm PRESENCE but cannot assert the exact command (honest, not a guess).
  const expectedArg =
    subj?.packageType === "npm" && subj.packageName && subj.version ? `${subj.packageName}@${subj.version}` : null

  let configText: string | null
  try {
    configText = readHostConfig(configPath)
  } catch (e) {
    return err(`cannot read host config at ${configPath}: ${e instanceof Error ? e.message : String(e)}`)
  }

  const notes: string[] = []
  let entry: Record<string, unknown> | null = null
  let parsed = false
  if (configText === null) {
    notes.push(`host config is absent at ${configPath} — nothing is installed there`)
  } else {
    try {
      const cfg = JSON.parse(configText) as Record<string, unknown>
      parsed = true
      const servers = cfg.mcpServers
      const bag = servers && typeof servers === "object" ? (servers as Record<string, unknown>) : {}
      const found = bag[serverKey]
      if (found && typeof found === "object") entry = found as Record<string, unknown>
      if (!entry) notes.push(`server "${serverKey}" is not present in ${configPath} — this target is not installed there`)
    } catch {
      notes.push(`host config at ${configPath} is not valid JSON — cannot verify its contents`)
    }
  }

  // Exact-pin comparison: the recorded args must still carry the pinned package@version.
  let pinnedExact: boolean | null = null
  if (entry) {
    notes.push(`server "${serverKey}" is present in ${configPath}`)
    if (expectedArg === null) {
      notes.push("the committed contract pins no npm package@version, so the exact command was not asserted")
    } else {
      const argv = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : []
      pinnedExact = argv.includes(expectedArg)
      notes.push(
        pinnedExact
          ? `installed launch still pins the exact target ${expectedArg}`
          : `installed launch does NOT pin ${expectedArg} — the entry drifted from the contract's exact target`,
      )
    }
  }

  // Optional receipt check — structural + approval binding only (no re-decision).
  const receiptJson = str(args, "receipt")
  let receiptValid: boolean | null = null
  let receiptDigest: string | null = null
  let receiptExpired: boolean | null = null
  let receiptPlanDigest: string | null = null
  if (receiptJson !== undefined) {
    const generatedAt = opts.generatedAt ?? new Date(opts.now ?? 0).toISOString()
    try {
      const receipt = JSON.parse(receiptJson) as Record<string, unknown>
      const v = verifyDecisionReceipt(receipt, { now: generatedAt })
      receiptValid = v.valid
      receiptExpired = v.expired
      if (typeof receipt.installPlanDigest === "string") receiptPlanDigest = receipt.installPlanDigest
      if (v.valid) {
        receiptDigest = receiptBodyDigest(receipt as never)
        notes.push(
          `receipt verified — approval binding intact${v.expired ? " (expired: a true record of a past approval, not a current authorization)" : ""}`,
        )
      } else {
        notes.push(`receipt did NOT verify: ${v.errors.join("; ")}`)
      }
      if (v.tampered) notes.push("receipt signature failed verification — treat the record as untrusted")
    } catch {
      receiptValid = false
      notes.push("receipt is not valid JSON — cannot verify it")
    }
  }

  // Fail-closed summary: "installed" requires a parsed config, the exact server entry,
  // and (when assertable) the exact pin. A supplied receipt must also verify.
  const installed = parsed && entry !== null && pinnedExact !== false
  const verifiedOk = installed && receiptValid !== false
  return json({
    tool: VERIFY_TOOL,
    schema: VERIFY_RESULT_SCHEMA,
    canonicalName: subj?.canonicalName ?? slug,
    contractFound: contract !== null,
    host,
    configPath,
    configPresent: configText !== null,
    configParsed: parsed,
    serverKey,
    serverPresent: entry !== null,
    expectedPinnedTarget: expectedArg,
    pinnedExact,
    receiptChecked: receiptJson !== undefined,
    receiptValid,
    receiptExpired,
    receiptDigest,
    receiptPlanDigest,
    installed,
    verified: verifiedOk,
    notes,
    note: "Read-only observation of the host config and the supplied receipt. It compares what is installed against the committed contract's exact pinned target; it runs no scanner, applies no policy, decides no verdict, writes nothing, and never starts or connects to the installed server. A passing check means this exact entry is present now — not that the target is safe.",
  })
}

const GUARD_TOOL = "calllint_enable_continuous_guard"
const GUARD_RESULT_SCHEMA = "calllint.continuous-protection-result.v1"

/**
 * Continuous-protection conversion (ADR 0056 §7 / INV-2.4-07; new14 Batch 8).
 *
 * Deliberately NOT a writer. A one-time protected setup never authorizes a persistent
 * component, so this tool's whole job is the *second explicit disclosure*: enumerate
 * every persistent component with the artifact it creates, the command that installs it
 * and the command that removes it, digest that set, and hand back the exact command the
 * OPERATOR runs to opt in. It installs nothing even when handed a matching
 * approvalDigest — an agent naming a digest is not a human granting permission, and
 * introducing a guard-artifact writer here would create a second writer (INV-2.4-03).
 *
 * Every fact comes from the shared `@calllint/core` disclosure, so the CLI post-success
 * offer and this tool can never drift into two different component stories.
 */
function enableContinuousGuardHandler(args: Record<string, unknown>): ToolResult {
  const requested = args.hosts
  const rawHosts: string[] = Array.isArray(requested)
    ? requested.filter((h): h is string => typeof h === "string")
    : typeof requested === "string"
      ? [requested]
      : []
  // An empty request discloses the full shipped Guard matrix — a complete disclosure is
  // always honest; a guessed host never is (INV-2.4-08).
  const hosts = rawHosts.length > 0 ? rawHosts : [...GUARD_HOST_IDS]
  const unknown = hosts.filter((h) => !isGuardHostId(h))
  if (unknown.length > 0) {
    return err(
      `unsupported guard host(s) ${unknown.join(", ")} — expected one of: ${GUARD_HOST_IDS.join(", ")}. No hook location is ever guessed.`,
    )
  }

  const offer = continuousProtectionOffer({ hosts: hosts.filter(isGuardHostId) })
  const approvalDigest = str(args, "approvalDigest")
  const disclosureMatches = approvalDigest === undefined ? null : approvalDigest === offer.disclosureDigest

  const notes: string[] = []
  if (disclosureMatches === false) {
    notes.push(
      `approvalDigest does not match the current disclosure (${offer.disclosureDigest}) — the component set you reviewed is not the one on offer`,
    )
  }
  notes.push(
    "this tool installed nothing: enabling persistent protection is a separate operator action, run from a terminal",
  )
  notes.push(`decline at any time — ${offer.declineOption} leaves the one-time install untouched`)

  return json({
    tool: GUARD_TOOL,
    schema: GUARD_RESULT_SCHEMA,
    // Outcome vocabulary is the honest state, not a fake success. DISCLOSED = here is
    // exactly what enabling would install; ABORTED_ON_MISMATCH = a stale disclosure.
    outcome: disclosureMatches === false ? "ABORTED_ON_MISMATCH" : "DISCLOSED",
    mode: "CONTINUOUS_PROTECTION",
    recommendation: offer.recommendation,
    reason: offer.reason,
    requiresSeparateAuthorization: true,
    enabled: false,
    installedComponents: [],
    disclosedComponents: offer.components,
    capabilities: offer.capabilities,
    disclosureDigest: offer.disclosureDigest,
    approvalDigestMatches: disclosureMatches,
    enableCommands: offer.components.map((c) => c.installCommand),
    uninstallCommands: offer.components.map((c) => c.uninstallCommand),
    disableCommand: offer.disableCommand,
    declineOption: offer.declineOption,
    humanOffer: renderContinuousProtectionOffer(offer),
    scannerVersion: VERSION,
    notes,
    note: "Disclosure only. CallLint's continuous protection re-decides your approved agent-tool authority surface on session start; it is a persistent installation and therefore a separate decision from any one-time install. This tool writes nothing and enables nothing — it lists every component, where it lands, and how to remove it, so a person can decide and run the enable command themselves. Continuous protection never executes, starts, or connects to a scanned server.",
  })
}

export const TOOLS: ToolDef[] = [
  {
    name: "scan_mcp_config_path",
    description:
      "Scan an MCP config file on disk and return the full ScanReport (verdict + evidence). Static; never executes the server.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the MCP config file." } },
      required: ["path"],
    },
    handler: safe((args, opts) => {
      const path = str(args, "path")
      if (!path) return err("`path` (string) is required.")
      return json(scanConfigFile(path, opts))
    }),
  },
  {
    name: "scan_mcp_config_json",
    description:
      "Scan MCP config JSON text and return compact decisions (one per server: verdict, fingerprint hash, reason codes). Static; never executes the server.",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "string", description: "Raw MCP config JSON." },
        surface: { type: "string", description: "Optional surface label (e.g. .cursor/mcp.json)." },
      },
      required: ["json"],
    },
    handler: safe((args, opts) => {
      const text = str(args, "json")
      if (!text) return err("`json` (string) is required.")
      const surface = str(args, "surface") ?? "inline:json"
      const loaded = loadSurfaceText(text, surface)
      const results = checkParsed(loaded.parsed, surface, inferOrigin(surface), opts)
      return json(results.map((r) => r.decision))
    }),
  },
  {
    name: "verify_baseline",
    description:
      "Compare a fresh scan of MCP config JSON against a recorded baseline and report drift / rug-pull signals. Static; never executes the server.",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "string", description: "Current MCP config JSON to verify." },
        baseline: {
          type: "string",
          description:
            "Optional baseline JSON (calllint.baseline.v0). If omitted, a baseline is built from `json` and returned for first-time approval.",
        },
        surface: { type: "string", description: "Optional surface label." },
      },
      required: ["json"],
    },
    handler: safe((args, opts) => {
      const text = str(args, "json")
      if (!text) return err("`json` (string) is required.")
      const surface = str(args, "surface")
      const summary = scanConfigText(text, surface, opts)
      const baselineText = str(args, "baseline")
      const generatedAt = opts?.generatedAt ?? new Date().toISOString()
      if (!baselineText) {
        // First-time: emit a baseline to approve and commit.
        return json(buildBaseline(summary, generatedAt))
      }
      let baseline: Baseline
      try {
        baseline = JSON.parse(baselineText) as Baseline
      } catch {
        return err("`baseline` is not valid JSON.")
      }
      return json(computeDrift(baseline, summary, generatedAt))
    }),
  },
  {
    name: "explain_finding",
    description:
      "Return the full evidence-backed explanation for the servers in an MCP config JSON (why each verdict was reached).",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "string", description: "MCP config JSON." },
        server: { type: "string", description: "Optional server name to explain (default: all)." },
        surface: { type: "string", description: "Optional surface label." },
      },
      required: ["json"],
    },
    handler: safe((args, opts) => {
      const text = str(args, "json")
      if (!text) return err("`json` (string) is required.")
      const surface = str(args, "surface") ?? "inline:json"
      const wanted = str(args, "server")
      const loaded = loadSurfaceText(text, surface)
      const results = checkParsed(loaded.parsed, surface, inferOrigin(surface), opts)
      const picked = wanted
        ? results.filter((r) => r.report.target.name === wanted)
        : results
      if (picked.length === 0) {
        const names = results.map((r) => r.report.target.name).join(", ")
        return err(`Server "${wanted}" not found. Available: ${names || "(none)"}`)
      }
      const text_ = picked.map((r) => renderExplain(r.report, NO_EMOJI_STYLE)).join("\n\n")
      return ok(text_)
    }),
  },
  {
    name: "generate_agent_rule",
    description:
      "Generate the CallLint agent-safety rule text for a host (e.g. claude, cursor, copilot, agents). Paste into the host's rules file.",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: `Target host. One of: ${RULE_HOSTS.join(", ")}.`,
          enum: [...RULE_HOSTS],
        },
      },
      required: ["host"],
    },
    handler: safe((args) => {
      const host = str(args, "host")
      if (!host) return err("`host` (string) is required.")
      if (!(RULE_HOSTS as readonly string[]).includes(host)) {
        return err(`Unknown host "${host}". One of: ${RULE_HOSTS.join(", ")}.`)
      }
      return ok(renderHostRule(host as (typeof RULE_HOSTS)[number]))
    }),
  },
  {
    name: "generate_ci_gate_snippet",
    description:
      "Generate a GitHub Actions workflow (.github/workflows/calllint.yml) that gates a repo on its agent-tool surface. mode=drift fails on approved-state drift; mode=scan-all is report-only.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: `CI gate mode. One of: ${CI_GATE_MODES.join(", ")}. Default: drift.`,
          enum: [...CI_GATE_MODES],
        },
      },
    },
    handler: safe((args) => {
      const mode = str(args, "mode")
      if (mode && !(CI_GATE_MODES as readonly string[]).includes(mode)) {
        return err(`Unknown mode "${mode}". One of: ${CI_GATE_MODES.join(", ")}.`)
      }
      return ok(renderCiGate(mode ? { mode: mode as (typeof CI_GATE_MODES)[number] } : {}))
    }),
  },
  {
    // The Sentinel (ADR 0055 §3). An always-loaded, honest-presence tool: it STATES
    // what CallLint does and reports that it is available — it never tells the host
    // agent what to do. Copy is factual third-person only; an imperative that
    // redirects/coerces/impersonates the agent's turn ("you must…", "ignore…",
    // "always call … before…") would be a §七 forbidden method (prompt injection) and
    // is prohibited, pinned by `check:public-copy` (MCP-copy check) + a test here. A
    // pure delegator (ADR 0025): the handler echoes shipped facts (the boundary-safe
    // `VERDICT_PUBLIC_LABEL` + the shipped tool names) and holds no logic of its own.
    // Description + output together stay ≤2500 bytes (pinned by a ceiling assertion).
    name: "calllint_guard_external_tools",
    description:
      "CallLint is present in this session as a static, deterministic preflight gate for MCP servers and agent tools (a pure delegator, ADR 0025). It reads an MCP or agent-tool config and returns an evidence-backed verdict — SAFE means no blockers observed, REVIEW means human judgment required, BLOCK means a dangerous surface, UNKNOWN means it cannot verify statically; UNKNOWN is never SAFE. Verdicts come from deterministic rules, never an LLM, and CallLint never executes the server or tool it judges. Its tools: scan_mcp_config_json and scan_mcp_config_path (a verdict for a config), explain_finding (the evidence behind a verdict), verify_baseline (drift versus an approved baseline), generate_agent_rule and generate_ci_gate_snippet (wire it into a host or CI). This tool only reports that CallLint is available; it changes no verdict and performs no action of its own.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: safe(() => {
      // No logic: echo shipped facts. Verdict labels are the boundary-safe public
      // labels from @calllint/types; the tool list mirrors the registry above.
      return json({
        tool: "calllint_guard_external_tools",
        present: true,
        what: "CallLint is a static, deterministic preflight gate for MCP servers and agent tools. It returns an evidence-backed verdict; it never executes the target and never decides with an LLM.",
        verdictLabels: VERDICT_PUBLIC_LABEL,
        unknownIsNeverSafe: true,
        tools: {
          scan_mcp_config_json: "Scan MCP config JSON text; returns compact per-server decisions.",
          scan_mcp_config_path: "Scan an MCP config file on disk; returns the full ScanReport.",
          explain_finding: "Return the evidence behind each verdict.",
          verify_baseline: "Compare a config against an approved baseline (drift / rug-pull).",
          generate_agent_rule: "Emit the CallLint agent-safety rule text for a host.",
          generate_ci_gate_snippet: "Emit a CI workflow that gates a repo on its agent-tool surface.",
        },
        note: "This tool reports presence only. It changes no verdict and performs no action.",
      })
    }),
  },
  {
    // Safe Search (ADR 0055 §4). A pure delegator (ADR 0025) over a COMMITTED projection of
    // the published Trust index: it finds already-baked Trust Pages by name and surfaces each
    // page's SHIPPED verdict + boundary-safe label VERBATIM. It is deterministic lexical only —
    // exact, then prefix, then substring; alphabetical within a tier — the ONE shared
    // `matchLexical` ranker the lookup page also uses (no second ranker; Product Principle 4/5).
    // NO LLM, NO embedding, NO fuzzy distance, NO new score, and it NEVER computes or moves a
    // verdict (ADR 0053 §3). It reads bundled committed data — it never executes a server, never
    // reaches the network, and never reads the served tree at runtime.
    name: "calllint_search_agent_tools",
    description:
      "Search already-published CallLint Trust Pages for MCP servers and agent tools by name, and get each match's existing verdict. Deterministic name match only (exact, then prefix, then substring; alphabetical within a tier) over a committed index — no LLM, no fuzzy or semantic ranking, and no new score. Each result carries the page's shipped verdict verbatim — SAFE (no blockers observed), REVIEW (human judgment required), BLOCK (a dangerous surface), or UNKNOWN (could not verify statically; UNKNOWN is never SAFE) — plus its boundary-safe label, artifact digest, observed-at time, and Trust Page URL. When the resource also has a CallLint acquisition page, the result includes installUrl (the human Install page), contractUrl (the machine Agent Adoption Contract), and installability (the route: PREPARE_AVAILABLE, REVIEW_REQUIRED, BLOCKED, LOCAL_PREFLIGHT_REQUIRED, or UNSUPPORTED); these link existing pages and authorize nothing — installing always re-decides locally. A match reports an existing observation at a specific digest and time; it is not a certification, an endorsement, or a guarantee of safety, and this tool never executes a server and changes no verdict. A resource with no CallLint Trust Page simply does not appear; absence is not a verdict. To scan a config that has no page yet, use scan_mcp_config_json.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Resource name (or fragment) to match, e.g. mcp-registry/io.github.example. Blank returns every indexed page, sorted by name.",
        },
        limit: {
          type: "number",
          description: "Optional cap on the number of matches returned (default: all matches).",
        },
      },
    },
    handler: safe((args) => {
      const query = str(args, "query") ?? ""
      const rawLimit = args["limit"]
      const matches = matchLexical(COMMITTED_LOOKUP_ENTRIES, query)
      const limited =
        typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit >= 0
          ? matches.slice(0, rawLimit)
          : matches
      // Pure projection: carry each committed entry through verbatim — no field is
      // recomputed, no verdict is decided, nothing is scored or ranked beyond the name match.
      return json({
        tool: "calllint_search_agent_tools",
        query,
        matchCount: matches.length,
        returned: limited.length,
        results: limited.map((e) => ({
          canonicalName: e.canonicalName,
          verdict: e.verdict,
          verdictLabel: e.verdictLabel,
          artifactDigest: e.artifactDigest,
          observedAt: e.observedAt,
          url: e.url,
          // Safe-install linkage (ADR 0056), carried through verbatim. Non-null only when a
          // baked acquisition page exists; these route to the human Install page + machine
          // Agent Adoption Contract, and never authorize a write — prepare re-decides locally.
          installUrl: e.installUrl,
          contractUrl: e.contractUrl,
          installability: e.installability,
        })),
        note: "Each result is an existing CallLint observation at a specific artifact digest and time — not a certification or a guarantee of safety. installUrl/contractUrl (when present) link the human Install page and the machine Agent Adoption Contract; they authorize nothing — a local prepare always re-decides. A resource with no Trust Page does not appear; absence is not a verdict.",
      })
    }),
  },
  {
    // Serve a committed Agent-Adoption-Contract verbatim from the bundle (ADR 0056 §7/§8).
    // Never fetches, never executes, never decides — it hands back the exact baked sidecar
    // an agent needs to STATE its exact target before a local prepare. A slug with no baked
    // contract simply is not served (absence is not a verdict).
    name: "calllint_get_adoption_contract",
    description:
      "Fetch the committed CallLint Agent Adoption Contract for a published MCP server / agent tool, by its canonical name (the same canonicalName/slug calllint_search_agent_tools returns). Returns the exact machine contract CallLint already published: the pinned subject (package, version, artifact digest), the public observation (verdict + boundary-safe label), the authority delta, and the recommendedNextAction telling you how to proceed (usually calllint_prepare_safe_install with the exact version/artifact/contract digests to assert). The contract is served verbatim from a committed bundle — no network, no execution, no new verdict. Optionally pass version to require an exact pinned version (a mismatch returns not-found rather than a different version). A resource with no committed contract is not served; absence is not a verdict. Use this to obtain the exact target to assert, then calllint_prepare_safe_install to re-decide locally before any install.",
    inputSchema: {
      type: "object",
      properties: {
        canonicalName: {
          type: "string",
          description: "The resource's canonical name / slug, e.g. mcp-registry/io.github.example (as returned by calllint_search_agent_tools).",
        },
        version: {
          type: "string",
          description: "Optional exact version to require; a mismatch returns not-found (never a different version).",
        },
      },
      required: ["canonicalName"],
    },
    handler: safe((args) => {
      const slug = str(args, "canonicalName")
      if (!slug) return err("canonicalName is required")
      const version = str(args, "version")
      const contract = findCommittedContract(slug, version)
      if (!contract) {
        return json({
          tool: "calllint_get_adoption_contract",
          canonicalName: slug,
          found: false,
          note: version
            ? `No committed CallLint adoption contract for "${slug}" at version ${version}. Absence is not a verdict — the resource may have no acquisition page, or a different pinned version.`
            : `No committed CallLint adoption contract for "${slug}". Absence is not a verdict — the resource may have a Trust Page but no acquisition page yet.`,
        })
      }
      // Serve the baked contract verbatim (never re-serialize a subset — the digest is over
      // the exact baked bytes). The tool authorizes nothing; installing re-decides locally.
      return json({
        tool: "calllint_get_adoption_contract",
        canonicalName: contract.subject.canonicalName,
        found: true,
        contract,
        note: "This is an existing published contract at a specific artifact digest — not a certification or a guarantee of safety. It authorizes no install; run calllint_prepare_safe_install to re-decide locally before any write.",
      })
    }),
  },
  {
    // Local, read-only safe-install PREPARE (ADR 0056 §10). Delegates the whole gateway
    // sequence to the shared core prepareSafeInstall — the SAME writer-free function the
    // CLI `safe-install` runs — so the two surfaces cannot disagree. Never executes the
    // target, never writes a config: it returns the local verdict + (host-gated) inert
    // plan an agent must review before any apply. A public BLOCK/UNKNOWN/unsupported route
    // short-circuits BEFORE the local re-decode (INV-2.4-02, "UNKNOWN is not SAFE").
    name: "calllint_prepare_safe_install",
    description:
      "Locally and statically PREPARE a safe install of a published MCP server, re-deciding its trust verdict on THIS machine before anything is written. Give the canonical name (and ideally the exact version/artifact/contract digests from calllint_get_adoption_contract to assert you got the target you meant). This never executes the server and never writes any config — it synthesizes the exact pinned launch, re-runs the full CallLint gateway locally (resolve → authority manifest → toxic-flow fold → policy decision), and, when you name a host, computes the inert install plan you would later apply. The local decision can only be STRICTER than the public one: a public BLOCK/UNKNOWN/unsupported target is refused before the local re-decode, an exact-target mismatch aborts with no plan, and only a pinned npm subject is auto-preparable in this version (anything else returns LOCAL_PREFLIGHT_REQUIRED — run `calllint trust prepare`). Outcomes: PREPARED (a plan is ready for a separate, explicitly-approved apply — never auto-applied), BLOCKED, LOCAL_PREFLIGHT_REQUIRED, ABORTED_ON_MISMATCH, or UNSUPPORTED. The returned plan authorizes nothing on its own; applying it is a separate human-gated step.",
    inputSchema: {
      type: "object",
      properties: {
        canonicalName: { type: "string", description: "The resource's canonical name / slug (as returned by calllint_search_agent_tools / calllint_get_adoption_contract)." },
        host: { type: "string", description: "Target host for the install plan: claude-code, cursor, or windsurf. Omit to get the local decision only (no plan)." },
        hostConfigPath: { type: "string", description: "Optional path to the host's MCP config to plan against (read-only). Omit to plan against an absent (fresh) config." },
        expectedVersion: { type: "string", description: "Optional exact version to assert; a mismatch aborts with no plan." },
        expectedArtifactDigest: { type: "string", description: "Optional sha256:<64-hex> artifact digest to assert against the contract; a mismatch aborts." },
        expectedContractDigest: { type: "string", description: "Optional sha256:<64-hex> contract digest to assert + record as plan provenance; a mismatch aborts." },
      },
      required: ["canonicalName"],
    },
    handler: safe((args, opts) => prepareSafeInstallHandler(args, opts)),
  },
  {
    // Safe-install APPLY (ADR 0056 §12.3). The one MCP tool that writes — and it does
    // not write itself: it DELEGATES to the shipped apply engine (the ONE writer,
    // INV-2.4-03), holding zero direct node:fs writes. Two mandatory gates first: a
    // named supported host, and an `approvalDigest` equal to the FRESHLY recomputed
    // plan digest. The public floor + local re-decode both run again before any byte
    // moves, so a public BLOCK/UNKNOWN can never be laundered into a write. Never
    // starts/connects to the installed target (INV-2.4-09).
    name: "calllint_apply_prepared_install",
    description:
      "Apply an install plan you already prepared and explicitly approved, writing the pinned MCP server into a host's config. This is a WRITE — it is the only CallLint tool that changes a file, and it refuses unless you name a supported host AND pass approvalDigest equal to the exact planDigest calllint_prepare_safe_install returned. Before writing it re-runs the full local gateway from scratch and recomputes the plan: if the host config or the pinned target changed since you prepared, the digest differs and the apply aborts with nothing written. A public BLOCK/UNKNOWN/unsupported route, a local BLOCK/UNKNOWN decision, or an exact-target mismatch all refuse before the write. The write itself is delegated to CallLint's shipped apply engine, which backs up the current config, writes atomically under a lock, re-reads to verify, and rolls back on any failure — so a failed apply leaves the original config in place. Outcomes: APPLIED_AND_VERIFIED (written and verified, with a decision receipt returned inline for later verification), ABORTED_ON_MISMATCH, BLOCKED, LOCAL_PREFLIGHT_REQUIRED, or UNSUPPORTED. This is a one-time protected setup: it installs no CallLint components, leaves no persistent CallLint files, and never starts, connects to, authenticates to, or tests the server it installed.",
    inputSchema: {
      type: "object",
      properties: {
        canonicalName: { type: "string", description: "The resource's canonical name / slug (the same one you prepared)." },
        host: { type: "string", description: "Target host to write: claude-code, cursor, or windsurf. Required — an apply never guesses a host." },
        approvalDigest: {
          type: "string",
          description:
            "The exact sha256:<64-hex> planDigest calllint_prepare_safe_install returned and you reviewed. Required; a mismatch against the freshly recomputed plan aborts with nothing written.",
        },
        hostConfigPath: {
          type: "string",
          description:
            "Path to the host's MCP config to write. Optional for claude-code and windsurf (their own config path is used); REQUIRED for cursor, whose config is project-scoped.",
        },
        expectedVersion: { type: "string", description: "Optional exact version to assert; a mismatch aborts with nothing written." },
        expectedArtifactDigest: { type: "string", description: "Optional sha256:<64-hex> artifact digest to assert against the contract; a mismatch aborts." },
        expectedContractDigest: { type: "string", description: "Optional sha256:<64-hex> contract digest to assert + record as plan provenance; a mismatch aborts." },
      },
      required: ["canonicalName", "host", "approvalDigest"],
    },
    handler: safe((args, opts) => applyPreparedInstallHandler(args, opts)),
  },
  {
    // Safe-install VERIFY (ADR 0056 §12.3). Read-only observation: does the host config
    // still carry the contract's EXACT pinned launch, and does a supplied decision
    // receipt still verify (structure + approval binding)? It re-decides nothing — no
    // scanner, no policy, no verdict — so it can report drift but never bless it.
    name: "calllint_verify_tool_install",
    description:
      "Verify that an MCP server install is actually in place and unchanged, by reading the host's config and comparing it against the published contract's exact pinned target. Read-only: it writes nothing, runs no scan, applies no policy, decides no verdict, and never starts or connects to the installed server. It reports whether the config exists and parses, whether the expected server entry is present, and whether that entry still pins the exact package@version the contract names (drift is reported, never accepted). Optionally pass the decision receipt from calllint_apply_prepared_install to also confirm its structure and approval binding are intact (an expired receipt is reported as a true record of a past approval, not a current authorization). A passing check means this exact entry is present right now — it is not a safety verdict.",
    inputSchema: {
      type: "object",
      properties: {
        canonicalName: { type: "string", description: "The resource's canonical name / slug to verify." },
        host: { type: "string", description: "Host whose config to read: claude-code, cursor, or windsurf." },
        hostConfigPath: {
          type: "string",
          description:
            "Path to the host's MCP config to read. Optional for claude-code and windsurf; REQUIRED for cursor, whose config is project-scoped.",
        },
        receipt: {
          type: "string",
          description:
            "Optional decision-receipt JSON text (the `receipt` calllint_apply_prepared_install returned) to structurally verify alongside the config.",
        },
      },
      required: ["canonicalName", "host"],
    },
    handler: safe((args, opts) => verifyToolInstallHandler(args, opts)),
  },
  {
    // Continuous-protection conversion (ADR 0056 §7 / INV-2.4-07). Disclosure only —
    // it enumerates every persistent component with its uninstall command and returns
    // the operator's enable command. It installs nothing, so an agent can present the
    // choice honestly but cannot make it.
    name: "calllint_enable_continuous_guard",
    description:
      "List exactly what CallLint's continuous protection would install, so a person can decide whether to enable it. Continuous protection is persistent: unlike a one-time install it adds CallLint components to the project (a session-start hook, a git hook, or a CI workflow, depending on host) that re-decide the approved agent-tool authority surface, detect drift, and re-check upgrades. Because it is persistent it is always a separate decision, never bundled into an install: this tool writes nothing, enables nothing, and installs nothing even if you pass approvalDigest. It returns every component with the file it creates, the command that enables it, and the command that removes it, plus a disclosureDigest over that set and a disableCommand. Report the components and both choices — enable, or not now — and let the person run the enable command themselves in a terminal. Declining changes nothing about an install already completed.",
    inputSchema: {
      type: "object",
      properties: {
        hosts: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional guard hosts to disclose (git, git-pre-push, github, copilot, claude-code, gemini, vscode). Omit to disclose every supported host; an unrecognized host is rejected rather than guessed.",
        },
        approvalDigest: {
          type: "string",
          description:
            "Optional sha256:<64-hex> disclosureDigest a person already reviewed. Used only to detect that the component set changed since they saw it; it does not authorize an install, and a matching digest still installs nothing.",
        },
      },
      required: [],
    },
    handler: safe((args) => enableContinuousGuardHandler(args)),
  },
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))
