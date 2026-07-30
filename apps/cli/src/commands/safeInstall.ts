/**
 * `calllint safe-install` — the Safe-Install orchestrator (new14 Phase 2.4 Batch 5;
 * ADR 0056 §10). A THIN interactive/agent command that turns an already-baked
 * `calllint.agent-adoption-contract.v1` into a local, exact-target adoption attempt
 * by DELEGATING to the shipped Trust Gateway (`trust prepare` → `trust apply` →
 * receipt verify). It builds NO scanner, NO verdict, NO writer, NO second config path.
 *
 *   fetch/read contract (guarded)
 *   → confirm exact-target identity (offline, vs the fetched contract)
 *   → apply the PUBLIC-verdict floor (fail-closed; a public BLOCK/UNKNOWN/unsupported
 *      short-circuits — it is NEVER laundered into a lenient local decision)
 *   → derive the exact local target and DELEGATE the deterministic decision to
 *      `trust prepare` (which re-resolves every fact — public observation is not
 *      local authorization, INV-2.4-02, and may only be STRICTER)
 *   → single explicit plan-digest approval
 *   → DELEGATE the write to the shipped apply engine (the ONE writer, INV-2.4-03)
 *   → verify the emitted decision receipt
 *   → emit one `calllint.safe-install-result.v1` envelope
 *
 * Boundaries (INV-2.4-03/05/07/09; project CLAUDE.md): ZERO direct host-config
 * writes (every live write goes through `trust apply`/`applyPlan`); the target is
 * NEVER executed/started/connected/authenticated/tested (only its identity is
 * pinned); no secret values are read; one-time mode installs ZERO persistent
 * CallLint components; publisher text never touches a verdict/authority/command.
 * Unsupported host / non-exact subject → an honest UNSUPPORTED / LOCAL_PREFLIGHT_REQUIRED,
 * never a guessed command.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve as resolvePath } from "node:path"
import {
  CLAUDE_CODE_HOST_ID,
  CURSOR_HOST_ID,
  WINDSURF_HOST_ID,
  receiptBodyDigest,
  verifyDecisionReceipt,
} from "@calllint/install-planner"
import {
  continuousProtectionOffer,
  isGuardHostId,
  prepareSafeInstall,
  renderContinuousProtectionOffer,
  type GuardHostId,
} from "@calllint/core"
import { adoptionBasisPolicyJson, loadPolicyOrDefault } from "@calllint/policy"
import type { ApplyResult, InstallPlan, TrustPreparation } from "@calllint/types"
import type { CommandResult } from "./scan.js"
import { trustCommand } from "./trust.js"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import type { ResolvedContract } from "./safeInstall/contractFetch.js"
import {
  emitSafeInstallResult,
  mapAppliedToOutcome,
  mapPrepareToOutcome,
  outcomeExitCode,
  type SafeInstallOutcome,
  type SafeInstallResultV1,
  type Sha256,
} from "./safeInstall/result.js"

export interface SafeInstallDeps {
  cwd: string
  /** ISO-8601 UTC for this run (deterministic via --generated-at). */
  generatedAt: string
  /** Runtime CLI version — threaded into the delegated receipt. */
  toolVersion?: string
  /** Reads the interactive approval line (injected; same port `check --stdin` uses). */
  readStdin: () => string
  /**
   * Writes the approval preview BEFORE `readStdin` blocks (R-2b).
   *
   * Why a port rather than appending to `stdout`: a `CommandResult.stdout` is returned
   * only after the command finishes, i.e. after the read. Without this, interactive
   * `--apply` was a BLIND SIGNATURE — the process blocked on stdin having printed
   * nothing, so the human approved a plan they were never shown. That defect is the
   * reason the install page could not honestly offer a one-command route.
   *
   * Absent ⇒ no preview is printed AND interactive `--apply` is refused, so a caller
   * that cannot show the plan can never collect an approval for it.
   */
  promptOut?: (text: string) => void
  /**
   * True when stdin is a real terminal. Interactive `--apply` requires it: without it,
   * piped bytes (`yes | calllint …`) would satisfy the approval gate, which is a
   * non-interactive auto-apply wearing an interactive costume. Absent ⇒ treated as
   * false (fail closed).
   */
  stdinIsTty?: boolean
  /**
   * The contract, already acquired + wire-shape-checked at the async CLI edge
   * (computeContractFetch, mirroring `online`). The command stays synchronous and
   * pure. undefined ⇒ no --contract/--stdin was given (a usage error).
   */
  contract?: ResolvedContract
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/

/** The subset of the adoption contract the orchestrator reads. Publisher text is
 *  deliberately NOT read (it can never influence a decision, INV-2.4-05). */
interface ContractView {
  canonicalName: string
  canonicalSlug: string
  packageType: string | null
  packageName: string | null
  version: string | null
  artifactDigest: Sha256 | null
  contractDigest: Sha256 | null
  verdict: string
  nextActionKind: string
}

function usageErr(message: string): CommandResult {
  return { stdout: "", stderr: `Error: ${message}`, exitCode: EXIT.USAGE }
}

/** How long a computed plan stays applicable. Enforced by the shipped apply engine. */
const PLAN_VALIDITY_MS = 60 * 60 * 1000

/** The minimum a replayed plan must carry to serve as a time anchor. */
interface ReplayPlan {
  readonly planDigest: string
  readonly expiresAt: string
  readonly raw: Record<string, unknown>
}

/**
 * The digests the Trust Gateway itself uses to bind a decision to a plan. They are
 * invariant across a benign re-run (a plan recomputed after a successful apply
 * differs in `preconditionDigest`/`planId`/patch shape but binds the SAME decision)
 * and change whenever the contract, authority, or policy moves.
 *
 * Used ONLY to explain an abort, never to authorize a write.
 */
const DECISION_BINDING = ["adoptionContract", "decisionDigest", "authorityDigest", "policyDigest", "artifactDigest", "host", "tier"] as const

function sameDecisionBinding(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return DECISION_BINDING.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))
}

/**
 * Read the plan handed back via `--plan <file>` (written earlier by `--plan-out`).
 *
 * This is a REPLAY of a plan the caller already reviewed, not a shortcut: the only
 * thing taken from it is the non-security time anchor (`expiresAt`). Every safety
 * fact — public floor, exact-target identity, npm-only shape, local re-decide,
 * policy — is recomputed from live inputs, and the recomputed digest must still
 * match both this plan and `--approve`. A file that is missing, unparsable, or
 * lacks the two fields is a usage error, never a silent fresh-anchor fallback
 * (which would resurrect the unreproducible-digest bug it exists to fix).
 */
function resolveReplayPlan(args: ParsedArgs): { plan: ReplayPlan | null } | { error: string } {
  const path = flagStr(args.flags, "plan")
  if (!path) return { plan: null }
  const abs = resolvePath(path)
  if (!existsSync(abs)) return { error: `--plan file not found: ${abs}` }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(abs, "utf8"))
  } catch (e) {
    return { error: `--plan file is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  const p = parsed as { planDigest?: unknown; expiresAt?: unknown }
  if (typeof p.planDigest !== "string" || typeof p.expiresAt !== "string") {
    return { error: `--plan file is not a calllint.install-plan.v1 (missing planDigest/expiresAt): ${abs}` }
  }
  return { plan: { planDigest: p.planDigest, expiresAt: p.expiresAt, raw: parsed as Record<string, unknown> } }
}

/** Extract the fields we act on from a wire-checked contract. Fail-closed: a
 *  structurally-odd contract that passed the shape gate but lacks a usable subject
 *  identity yields null, and the caller degrades to a preflight rather than guess. */
function readContract(text: string): ContractView | null {
  let c: Record<string, unknown>
  try {
    c = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {})
  const asStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
  const asSha = (v: unknown): Sha256 | null => (typeof v === "string" && SHA256_RE.test(v) ? (v as Sha256) : null)

  const subject = asObj(c.subject)
  const observation = asObj(c.publicObservation)
  const rna = asObj(c.recommendedNextAction)
  const contractId = asObj(c.contract)

  const canonicalName = asStr(subject.canonicalName)
  if (!canonicalName) return null // no usable subject identity → caller degrades, never guesses
  return {
    canonicalName,
    canonicalSlug: asStr(subject.canonicalSlug) ?? canonicalName,
    packageType: asStr(subject.packageType),
    packageName: asStr(subject.packageName),
    version: asStr(subject.version),
    artifactDigest: asSha(subject.artifactDigest),
    contractDigest: asSha(contractId.contractDigest),
    verdict: asStr(observation.verdict) ?? "UNKNOWN",
    nextActionKind: asStr(rna.kind) ?? "LOCAL_PREFLIGHT_REQUIRED",
  }
}

/**
 * The exact-target identity gate (INV-2.4-06), OFFLINE and orchestrator-owned. A
 * caller that obtained a contract may STATE what it intends to install; here we
 * confirm the FETCHED contract IS that target. This is a pure string compare
 * against the contract's OWN subject/contract fields — a DIFFERENT digest space
 * from the gateway's `--expect-artifact-digest` (which pins the LOCAL bytes), so
 * the package digest is checked here, never fed into the local-bytes gate where it
 * would always mismatch. A mismatch means a substituted/stale contract → the
 * orchestrator aborts before any plan (it can only STOP, never improve — INV-2.4-02).
 * A malformed digest flag fails-closed as a usage error (a typo must never silently
 * never-match). Returns mismatch reasons ([] = pass), or a usage error.
 */
function checkIdentity(
  args: ParsedArgs,
  contract: ContractView,
): { mismatches: string[] } | { error: string } {
  const expectVersion = flagStr(args.flags, "expect-version")
  const expectArtifact = flagStr(args.flags, "expect-artifact-digest")
  const expectContract = flagStr(args.flags, "expect-contract-digest")

  for (const [name, v] of [
    ["--expect-artifact-digest", expectArtifact],
    ["--expect-contract-digest", expectContract],
  ] as const) {
    if (v !== undefined && !SHA256_RE.test(v)) {
      return { error: `${name} must be a sha256:<64-hex> digest` }
    }
  }

  const mismatches: string[] = []
  if (expectArtifact && contract.artifactDigest && expectArtifact !== contract.artifactDigest) {
    mismatches.push(
      `expected artifact digest ${expectArtifact} does not match the contract's ${contract.artifactDigest}`,
    )
  }
  if (expectContract && contract.contractDigest && expectContract !== contract.contractDigest) {
    mismatches.push(
      `expected contract digest ${expectContract} does not match the contract's ${contract.contractDigest}`,
    )
  }
  if (expectVersion && contract.version && expectVersion !== contract.version) {
    mismatches.push(`expected version ${expectVersion} does not match the contract's ${contract.version}`)
  }
  return { mismatches }
}

/** Real, absolute host-config path for a supported host. null ⇒ unsupported host
 *  (no guessed location). Project-scoped hosts resolve against the USER cwd; the
 *  home-relative hosts are cwd-independent. `--host-config` overrides all. */
function realHostConfigPath(host: string, userCwd: string, override?: string): string | null {
  if (override) return resolvePath(userCwd, override)
  if (host === CLAUDE_CODE_HOST_ID) return join(homedir(), ".claude.json")
  if (host === CURSOR_HOST_ID) return join(userCwd, ".cursor", "mcp.json")
  if (host === WINDSURF_HOST_ID) return join(homedir(), ".codeium", "mcp_config.json")
  return null
}

/** A deterministic, safe mcp-config server key from the canonical slug. */
function serverKey(view: ContractView): string {
  const base = (view.canonicalSlug || view.canonicalName).replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  return base.replace(/^-+|-+$/g, "") || "tool"
}

/**
 * Resolve the policy path the delegated re-decode runs under, written into the
 * ephemeral scratch dir (nothing persistent). Precedence:
 *   1. A caller-supplied `--policy` is threaded through verbatim — an operator/org
 *      can only ever TIGHTEN the decision, never loosen it (INV-2.4-02 holds; the
 *      gateway's block-base floor cannot be loosened by any policy anyway).
 *   2. Otherwise an ADOPTION-BASIS policy: `defaultPolicy()` (the CI-fail `deny`
 *      posture) with ONLY `arbitraryCommandExecution` relaxed to `warn`.
 *
 * Why relaxing that one axis here does NOT weaken the rule:
 *   - The orchestrator can synthesize ONLY a pinned `npx -y <registry-pkg>@<ver>`
 *     (hardcoded "npx", an ARG ARRAY so no shell string is interpolated, gated to
 *     an npm subject with a pinned version). A dangerous `bash -c …` is structurally
 *     unreachable, and this is the exact shape the PUBLIC scanner classifies SAFE.
 *   - `warn` decides REVIEW, not SAFE — REVIEW is EXCLUDED from AUTO_ALLOW, so the
 *     §10.7 single human approval gate still fires before any write. REVIEW is
 *     strictly MORE cautious than the public SAFE it re-decodes.
 *   - A manifest `approvalRequirement:"block"` capability (e.g. an embedded
 *     "run as root" instruction) still forces BLOCK→BLOCKED under this policy —
 *     the gateway's fail-closed floor a lenient policy cannot loosen.
 *   - Every OTHER axis (broad filesystem, financial, prompt poisoning, unknown
 *     remote, external mutation) stays at the strict default.
 *   - Scope is this one ephemeral scratch file; `defaultPolicy()`, CI, and every
 *     other `trust` invocation are untouched.
 */
function resolveDelegatedPolicy(args: ParsedArgs, scratch: string, userCwd: string): string {
  const caller = flagStr(args.flags, "policy")
  if (caller) return resolvePath(userCwd, caller)
  // The adoption-basis policy is the ONE shared source of truth (@calllint/policy),
  // used identically by the MCP `calllint_prepare_safe_install` tool — see its doc for
  // why relaxing arbitraryCommandExecution to `warn` cannot launder a dangerous command
  // past the §10.7 approval gate or loosen the gateway's fail-closed floor.
  const path = join(scratch, "adoption-policy.json")
  writeFileSync(path, adoptionBasisPolicyJson(), "utf8")
  return path
}

/** Drive the shipped `trust` command in-process with a constructed arg vector.
 *  This is the ONLY way to reuse the gateway's private resolve/authority/decide/
 *  plan glue without reimplementing it (§10.4 forbids reimplementing any of it). */
function delegateTrust(
  positionals: string[],
  flags: Record<string, string | boolean>,
  scratchCwd: string,
  deps: SafeInstallDeps,
): CommandResult {
  return trustCommand(
    { command: "trust", positionals, flags },
    { cwd: scratchCwd, generatedAt: deps.generatedAt, toolVersion: deps.toolVersion },
  )
}

export function safeInstallCommand(args: ParsedArgs, deps: SafeInstallDeps): CommandResult {
  if (args.positionals[0] === "help") {
    return { stdout: safeInstallHelp(), stderr: "", exitCode: EXIT.OK }
  }

  // 1) Contract acquisition (resolved at the edge; here we only consume it).
  const resolved = deps.contract
  if (!resolved) {
    return usageErr(
      "Missing contract\nUsage: calllint safe-install --contract <https://calllint.com/... | file> [--host <id>]\n" +
        "         [--plan-out <file>]                        write the computed plan for review\n" +
        "         [--plan <file> --apply --approve <digest>]  replay the reviewed plan and apply",
    )
  }
  if (resolved.error) return { stdout: "", stderr: `Error: ${resolved.error.message}`, exitCode: resolved.error.exitCode }
  const view = resolved.text ? readContract(resolved.text) : null
  if (!view) return usageErr("contract is not a usable calllint.agent-adoption-contract.v1 (no subject identity)")

  const json = flagBool(args.flags, "json")
  const nonInteractive = flagBool(args.flags, "non-interactive") || json

  // 2) Exact-target identity gate (offline; a substituted contract can only STOP).
  const identity = checkIdentity(args, view)
  if ("error" in identity) return usageErr(identity.error)
  if (identity.mismatches.length > 0) {
    return finish(
      emitSafeInstallResult({
        outcome: "ABORTED_ON_MISMATCH",
        canonicalName: view.canonicalName,
        version: view.version,
        artifactDigest: view.artifactDigest,
        contractDigest: view.contractDigest,
        notes: ["exact-target identity assertion failed — no writable plan was produced", ...identity.mismatches],
      }),
      json,
    )
  }

  // 3) Public-verdict floor (fail-closed). The contract's own machine route already
  // encodes verdict + exactness + host-support; a non-actionable route short-circuits
  // so a public BLOCK/UNKNOWN/unsupported is NEVER laundered by a lenient local
  // decision over a minimal synthesized config (INV-2.4-02, "UNKNOWN is not SAFE").
  const floor = publicFloor(view)
  if (floor) {
    return finish(
      emitSafeInstallResult({
        outcome: floor.outcome,
        canonicalName: view.canonicalName,
        version: view.version,
        artifactDigest: view.artifactDigest,
        contractDigest: view.contractDigest,
        notes: floor.notes,
      }),
      json,
    )
  }

  // 4) Actionable (contract route PREPARE_LOCALLY: SAFE/REVIEW + exact + supported).
  // Batch 5 can synthesize an exact LOCAL launch only for an npm subject with a
  // pinned version; anything else is an honest pre-flight, never a guessed command.
  if (view.packageType !== "npm" || !view.packageName || !view.version) {
    return finish(
      emitSafeInstallResult({
        outcome: "LOCAL_PREFLIGHT_REQUIRED",
        canonicalName: view.canonicalName,
        version: view.version,
        artifactDigest: view.artifactDigest,
        contractDigest: view.contractDigest,
        notes: [
          `only an npm subject with a pinned version is auto-preparable in this version (got ${view.packageType ?? "no"} type)`,
          "run local pre-flight (`calllint trust prepare`) for this target",
        ],
      }),
      json,
    )
  }

  const host = flagStr(args.flags, "host")
  if (!host) {
    return finish(
      emitSafeInstallResult({
        outcome: "LOCAL_PREFLIGHT_REQUIRED",
        canonicalName: view.canonicalName,
        version: view.version,
        artifactDigest: view.artifactDigest,
        contractDigest: view.contractDigest,
        notes: ["a target host is required to compute an actionable install plan — pass --host <id>"],
      }),
      json,
    )
  }
  const hostConfig = realHostConfigPath(host, deps.cwd, flagStr(args.flags, "host-config"))
  if (!hostConfig) {
    return finish(
      emitSafeInstallResult({
        outcome: "UNSUPPORTED",
        canonicalName: view.canonicalName,
        host: null,
        version: view.version,
        artifactDigest: view.artifactDigest,
        contractDigest: view.contractDigest,
        notes: [`host "${host}" has no supported install location — view manual setup`],
      }),
      json,
    )
  }

  // All CallLint working files (synthesized config, plan, locks) live in an
  // ephemeral scratch dir OUTSIDE the user's tree, so one-time mode leaves zero
  // persistent CallLint files (INV-2.4-07). The only durable write is the host
  // config, done by the shipped apply engine at its real (absolute) path.
  const scratch = mkdtempSync(join(tmpdir(), "calllint-safe-install-"))
  try {
    return runActionable(args, deps, view, host, hostConfig, scratch, { json, nonInteractive })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The fail-closed public floor: a terminal outcome when the contract's route is
 *  not actionable. null ⇒ actionable (PREPARE_LOCALLY) — proceed to local prepare. */
function publicFloor(view: ContractView): { outcome: SafeInstallOutcome; notes: string[] } | null {
  switch (view.nextActionKind) {
    case "EXPLAIN_ONLY":
      return { outcome: "UNSUPPORTED", notes: ["no supported install plan for this target — view manual setup"] }
    case "INSPECT_BLOCKERS":
      return { outcome: "BLOCKED", notes: [`public verdict ${view.verdict} — blocked by policy; inspect blockers before any install`] }
    case "LOCAL_PREFLIGHT_REQUIRED":
      return {
        outcome: "LOCAL_PREFLIGHT_REQUIRED",
        notes: [`public verdict ${view.verdict} — insufficient evidence / no exact target; run local pre-flight`],
      }
    case "PREPARE_LOCALLY":
      return null
    default:
      // Unknown route → fail closed.
      return { outcome: "LOCAL_PREFLIGHT_REQUIRED", notes: [`unrecognized contract action "${view.nextActionKind}" — run local pre-flight`] }
  }
}

function runActionable(
  args: ParsedArgs,
  deps: SafeInstallDeps,
  view: ContractView,
  host: string,
  hostConfig: string,
  scratch: string,
  modes: { json: boolean; nonInteractive: boolean },
): CommandResult {
  // Synthesize the exact local launch spec from the pinned npm subject. The
  // gateway sees these exact bytes (byte-identical to the prior delegated path).
  const key = serverKey(view)
  const synth = { mcpServers: { [key]: { command: "npx", args: ["-y", `${view.packageName}@${view.version}`] } } }
  const configText = JSON.stringify(synth, null, 2) + "\n"

  // The local re-decode runs under the adoption-basis policy (or a caller's
  // stricter --policy) — see resolveDelegatedPolicy for why this cannot launder a
  // dangerous command past the §10.7 approval gate or loosen the gateway floor.
  const policy = loadPolicyOrDefault(resolveDelegatedPolicy(args, scratch, deps.cwd))

  // Read the target host config once (the ONLY disk read; read-only) and hand its
  // bytes to the shared, writer-free prepare (ADR 0056 §10.4) — the SAME sequence
  // `trust prepare` runs, so the two surfaces cannot disagree. Never executes the
  // target; the contract digest is threaded as recorded plan PROVENANCE only.
  const hostConfigText = existsSync(hostConfig) ? readFileSync(hostConfig, "utf8") : null

  // The plan's validity window. `expiresAt` is SEALED into planDigest (buildPlan),
  // so deriving it from this process's clock would make the digest unreproducible
  // and the printed `--apply --approve <digest>` handshake could never succeed — a
  // second invocation would always recompute a different digest. When the caller
  // replays a plan they already saw (`--plan`), we therefore INHERIT that plan's
  // anchor. Nothing security-relevant is inherited: the full local re-decide below
  // runs again from live inputs, and the shipped apply engine still enforces this
  // window against real `now`, so replaying an old plan is refused as stale.
  const replay = resolveReplayPlan(args)
  if ("error" in replay) return { stdout: "", stderr: `Error: ${replay.error}`, exitCode: EXIT.USAGE }
  const expiresMs = Date.parse(deps.generatedAt)
  const freshExpiry = Number.isNaN(expiresMs)
    ? deps.generatedAt
    : new Date(expiresMs + PLAN_VALIDITY_MS).toISOString()
  let prep: TrustPreparation
  try {
    prep = prepareSafeInstall({
      configText,
      configPath: "mcp.json",
      policy,
      hostPlan: {
        host,
        configPath: hostConfig,
        hostConfigText,
        expiresAt: replay.plan?.expiresAt ?? freshExpiry,
      },
      expect: view.contractDigest ? { contractDigest: view.contractDigest as `sha256:${string}` } : undefined,
      preparedAt: deps.generatedAt,
    })
  } catch (e) {
    return { stdout: "", stderr: `Error: local prepare failed: ${e instanceof Error ? e.message : String(e)}`, exitCode: EXIT.ERROR }
  }

  // Persist the plan under scratch (ephemeral) so the shipped apply engine can read
  // it back — byte-identical to `trust prepare --write-plan`.
  if (prep.plan) {
    const plansDir = join(scratch, ".calllint", "plans")
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, `${prep.plan.planId}.json`), JSON.stringify(prep.plan, null, 2) + "\n", "utf8")
  }

  const base = {
    canonicalName: view.canonicalName,
    host,
    version: view.version,
    artifactDigest: view.artifactDigest,
    contractDigest: view.contractDigest,
  }
  const plan = prep.plan
  const localOutcome = mapPrepareToOutcome(prep)

  // No active plan (local re-decide was BLOCK/UNKNOWN, or produced nothing) → emit
  // the local outcome. This is where a LOCAL decision STRICTER than the public one
  // is honored (INV-2.4-02).
  if (!plan || localOutcome !== "PREPARED") {
    return finish(
      emitSafeInstallResult({ outcome: localOutcome, ...base, notes: preparationNotes(prep) }),
      modes.json,
    )
  }

  const planDigest = plan.planDigest as Sha256

  // A replayed plan must reproduce EXACTLY. The anchor is inherited, so any
  // remaining difference means an input moved since the caller reviewed it. Abort
  // and write nothing: the approval names a plan that is no longer the current one,
  // and we never substitute a digest the operator did not name (INV-2.4-06).
  if (replay.plan && replay.plan.planDigest !== planDigest) {
    // The decision binding tells the caller WHICH kind of change happened, so the
    // abort is actionable instead of alarming. It never softens the abort itself.
    const sameDecision = sameDecisionBinding(replay.plan.raw, plan as unknown as Record<string, unknown>)
    return finish(
      emitSafeInstallResult({
        outcome: "ABORTED_ON_MISMATCH",
        ...base,
        planDigest,
        notes: [
          "the replayed plan is no longer the current plan — nothing was written",
          `replayed ${replay.plan.planDigest.slice(0, 23)}…, recomputed ${planDigest.slice(0, 23)}…`,
          sameDecision
            ? "the decision is unchanged, so the host config moved — it may already be installed as reviewed; re-run prepare to get the current plan"
            : "a decision-relevant input changed (contract, authority, or policy) — re-run prepare and REVIEW the new plan before approving",
        ],
      }),
      modes.json,
    )
  }

  // Prepare-only unless an apply was explicitly requested.
  if (!flagBool(args.flags, "apply")) {
    const planOut = flagStr(args.flags, "plan-out")
    const notes = [`plan ${planDigest.slice(0, 23)}… computed for host "${host}" — NOT applied`]
    if (planOut) {
      // Hand the reviewed plan back to the caller so the apply step can REPLAY it.
      // Caller-requested output: not a CallLint-owned persistent component, so
      // one-time mode still reports `persistentComponents: []` (INV-2.4-07).
      //
      // `--plan <file>` on apply matches the shipped `trust`/`integrate` convention
      // exactly. This WRITE side deliberately does not: those use a boolean
      // `--write-plan` that persists into the workspace at
      // `.calllint/plans/<plan-id>.json`, which safe-install must never do — one-time
      // mode leaves ZERO workspace files. So the destination is caller-chosen and
      // explicit, and nothing is written unless it is asked for by name.
      const abs = resolvePath(planOut)
      try {
        mkdirSync(join(abs, ".."), { recursive: true })
        writeFileSync(abs, JSON.stringify(plan, null, 2) + "\n", "utf8")
      } catch (e) {
        return { stdout: "", stderr: `Error: could not write --plan-out ${abs}: ${e instanceof Error ? e.message : String(e)}`, exitCode: EXIT.ERROR }
      }
      notes.push(
        `plan written to ${abs}`,
        `to apply, re-run with:  --plan ${abs} --apply --approve ${planDigest}`,
      )
    } else {
      // `expiresAt` is sealed into planDigest, so a bare re-run recomputes a
      // DIFFERENT digest and the approval could never match. Point at the two
      // routes that actually work instead of printing an instruction that cannot.
      notes.push(
        "to apply non-interactively, re-run prepare with  --plan-out <file>  then:  --plan <file> --apply --approve <digest>",
        "to apply interactively, re-run with  --apply  and confirm at the prompt",
      )
    }
    return finish(emitSafeInstallResult({ outcome: "PREPARED", ...base, planDigest, notes }), modes.json)
  }

  // 5) Single explicit approval gate. Machine mode requires the exact plan digest
  // via --approve (§10.7 never auto-applies). Interactive mode reads one
  // confirmation line; a non-matching / negative / empty answer is a clean DECLINE.
  //
  // Show the plan FIRST. The read below blocks, and a `CommandResult.stdout` is only
  // returned after it returns — so anything not written through `promptOut` here is
  // invisible at the moment the human decides.
  if (!modes.nonInteractive && !flagStr(args.flags, "approve") && deps.promptOut) {
    deps.promptOut(approvalPreview(plan, view, host))
  }
  const approval = resolveApproval(args, deps, planDigest, modes.nonInteractive)
  if ("error" in approval) return usageErr(approval.error)
  if (approval.decision === "declined") {
    return finish(
      emitSafeInstallResult({ outcome: "DECLINED", ...base, planDigest, notes: ["operator did not approve the plan at the approval gate — nothing was written"] }),
      modes.json,
    )
  }

  // 6) Delegate the write to the shipped apply engine (the ONE writer). It
  // revalidates, writes atomically under a lock, verifies, and rolls back on
  // failure. We also request a decision receipt to verify + bind into the result.
  const planFile = join(scratch, ".calllint", "plans", `${plan.planId}.json`)
  const receiptFile = join(scratch, "receipt.json")
  const applied = delegateTrust(
    ["apply"],
    { plan: planFile, approve: approval.digest, receipt: receiptFile, json: true },
    scratch,
    deps,
  )
  let applyResult: ApplyResult
  try {
    applyResult = JSON.parse(applied.stdout) as ApplyResult
  } catch {
    return { stdout: "", stderr: `Error: delegated trust apply failed: ${applied.stderr || applied.stdout}`, exitCode: EXIT.ERROR }
  }

  // 7) Verify the emitted receipt (read-only, fail-closed). A missing/invalid
  // receipt means we cannot claim a verified apply.
  let receiptValid = false
  let receiptDigest: Sha256 | null = null
  if (existsSync(receiptFile)) {
    try {
      const receipt = JSON.parse(readFileSync(receiptFile, "utf8"))
      const v = verifyDecisionReceipt(receipt, { now: deps.generatedAt })
      receiptValid = v.valid
      if (v.valid) receiptDigest = receiptBodyDigest(receipt)
    } catch {
      receiptValid = false
    }
  }

  const outcome = mapAppliedToOutcome(applyResult, receiptValid)
  const notes = [...(applyResult.notes ?? [])]
  if (outcome !== "APPLIED_AND_VERIFIED") {
    notes.unshift(`apply did not durably verify (outcome ${applyResult.outcome}, receipt ${receiptValid ? "ok" : "unverified"}) — re-run local pre-flight`)
  }
  return finish(
    emitSafeInstallResult({
      outcome,
      ...base,
      planDigest,
      receiptDigest: outcome === "APPLIED_AND_VERIFIED" ? receiptDigest : null,
      persistentComponents: [], // one-time mode — always empty (INV-2.4-07)
      notes,
    }),
    modes.json,
    // Batch 8: offer the conversion only once the one-time install durably verified.
    outcome === "APPLIED_AND_VERIFIED" ? postSuccessOffer(host, deps.cwd) : undefined,
  )
}

/**
 * The approval preview — what a human sees BEFORE the read blocks (R-2b).
 *
 * Renders from the plan's own operations, so it cannot describe a write the plan does
 * not contain: every target path and every JSON-Patch path is enumerated from
 * `plan.operations`, not from a summary someone maintains by hand. This is the text
 * that makes an interactive approval an informed one.
 */
function approvalPreview(plan: InstallPlan, view: ContractView, host: string): string {
  const lines = [
    "",
    `  CallLint — review before writing`,
    "",
    `    server    ${view.canonicalName}${view.version ? `@${view.version}` : ""}`,
    `    host      ${host} (tier ${plan.tier})`,
  ]
  if (view.artifactDigest) lines.push(`    artifact  ${view.artifactDigest}`)
  lines.push(`    plan      ${plan.planDigest}`, "", "  Writes:")
  for (const op of plan.operations) {
    lines.push(`    ${op.target}${op.preconditionDigest === "absent" ? "  (new file)" : ""}`)
    for (const p of op.patch) lines.push(`      ${op.type === "json-patch" ? op.type : "write"}  ${p.op} ${p.path}`)
  }
  lines.push(
    "",
    "  Nothing has been written yet. Type  yes  to approve, anything else to decline.",
    "  approve> ",
  )
  return lines.join("\n")
}

/** Resolve the approval decision at the single gate. */
function resolveApproval(
  args: ParsedArgs,
  deps: SafeInstallDeps,
  planDigest: Sha256,
  nonInteractive: boolean,
): { decision: "approved"; digest: string } | { decision: "declined" } | { error: string } {
  const approve = flagStr(args.flags, "approve")
  if (nonInteractive) {
    // Machines must name the exact digest they reviewed — never auto-apply (§10.7).
    if (!approve) {
      return { error: "in non-interactive/--json mode, --apply requires --approve <exact-plan-digest>" }
    }
    // A digest from an earlier invocation cannot match a freshly anchored plan
    // (`expiresAt` is sealed into planDigest), so a bare `--approve` would fail with
    // a confusing digest mismatch. Name the actual cause and the working route.
    if (!flagStr(args.flags, "plan")) {
      return {
        error:
          "non-interactive --apply also requires --plan <file> (the plan you reviewed)\n" +
          "  step 1:  calllint safe-install --contract <c> --host <h> --json --plan-out plan.json\n" +
          "  step 2:  calllint safe-install --contract <c> --host <h> --json --plan plan.json --apply --approve <digest>\n" +
          "  (a plan digest seals the plan's validity window, so it is only reproducible when the reviewed plan is replayed)",
      }
    }
    // Pass the caller's value through verbatim; the apply engine binds approval to
    // the plan digest and fails closed on any mismatch (we do not pre-judge it here).
    return { decision: "approved", digest: approve }
  }
  // Interactive: an explicit --approve wins; otherwise read one confirmation line.
  if (approve) return { decision: "approved", digest: approve }
  // Two preconditions for collecting a typed approval, both fail-closed. Without a
  // terminal, `yes | calllint … --apply` would satisfy this gate — a non-interactive
  // auto-apply in interactive clothing. Without a preview port the human cannot have
  // seen the plan, so the keystroke would authorize bytes they never read.
  if (deps.stdinIsTty !== true) {
    return {
      error:
        "interactive --apply needs a terminal (stdin is not a TTY)\n" +
        "  to apply from a script, review a plan first, then name its digest:\n" +
        "    calllint safe-install --contract <c> --host <h> --json --plan-out plan.json\n" +
        "    calllint safe-install --contract <c> --host <h> --json --plan plan.json --apply --approve <digest>",
    }
  }
  if (!deps.promptOut) {
    return { error: "interactive --apply is unavailable in this context (no way to show the plan for review)" }
  }
  const answer = deps.readStdin().trim()
  if (answer === planDigest || answer.toLowerCase() === "yes" || answer.toLowerCase() === "y") {
    return { decision: "approved", digest: planDigest }
  }
  return { decision: "declined" }
}

/** Surface a few honest, non-decision notes from a delegated preparation. */
function preparationNotes(prep: TrustPreparation): string[] {
  const verdict = prep.decision?.verdict
  const notes: string[] = [`local Trust Gateway state ${prep.state}${verdict ? ` (verdict ${verdict})` : ""}`]
  // The local decision is authoritative and may be stricter than the public one.
  if (verdict === "BLOCK") notes.push("local decision is BLOCK — blocked by policy")
  if (verdict === "UNKNOWN") notes.push("local decision is UNKNOWN — insufficient evidence; never treated as safe")
  return notes
}

/** Render the envelope (machine `--json` prints ONLY the envelope) + exit code. */
function finish(result: SafeInstallResultV1, json: boolean, offer?: string): CommandResult {
  const exitCode = outcomeExitCode(result.outcome)
  // `--json` prints ONLY the envelope (agent contract). The conversion offer is human
  // presentation, not a new machine field — an agent gets it from the dedicated MCP
  // tool, so the shipped result schema stays unchanged.
  if (json) return { stdout: JSON.stringify(result, null, 2), stderr: "", exitCode }
  const body = renderResult(result)
  return { stdout: offer ? `${body}\n${offer}` : body, stderr: "", exitCode }
}

/**
 * Batch 8 — the post-success continuous-protection offer (INV-2.4-07). Shown ONLY after
 * a durably verified one-time install, because the conversion argument is "value first,
 * commitment second". It is pure presentation: nothing is pre-selected, `[Not now]` is
 * always printed, and it installs nothing. Returns undefined when there is no honest
 * Guard host to disclose for the install host — never a guessed one (INV-2.4-08).
 */
function postSuccessOffer(host: string | null, cwd: string): string | undefined {
  const guardHost = guardHostFor(host)
  if (!guardHost) return undefined
  const offer = continuousProtectionOffer({
    hosts: [guardHost],
    alreadyInstalled: guardArtifactPresent(guardHost, cwd),
  })
  return renderContinuousProtectionOffer(offer)
}

/**
 * Map the install host onto a Guard host. `claude-code` is the only Tier-A install host
 * that is also a shipped Guard host; `cursor`/`windsurf` have no Guard hook, so the repo
 * -level `git` pre-commit hook is disclosed instead (it guards the same authority surface
 * regardless of which editor changed it). Anything else → no offer.
 */
function guardHostFor(host: string | null): GuardHostId | undefined {
  if (host === null) return undefined
  if (isGuardHostId(host)) return host
  if (host === CURSOR_HOST_ID || host === WINDSURF_HOST_ID) return "git"
  return undefined
}

/** Honest "already protected" check: the artifact exists AND names `calllint guard`. */
function guardArtifactPresent(guardHost: GuardHostId, cwd: string): boolean {
  const offer = continuousProtectionOffer({ hosts: [guardHost] })
  const path = join(cwd, offer.components[0]!.artifactPath)
  if (!existsSync(path)) return false
  try {
    return readFileSync(path, "utf8").includes("calllint guard")
  } catch {
    return false
  }
}

/** A compact human transcript of the outcome (never marketing prose). */
function renderResult(r: SafeInstallResultV1): string {
  const lines = [
    `safe-install: ${r.outcome}`,
    `  tool:     ${r.canonicalName}${r.version ? `@${r.version}` : ""}`,
    `  mode:     ${r.mode}`,
  ]
  if (r.host) lines.push(`  host:     ${r.host}`)
  if (r.planDigest) lines.push(`  plan:     ${r.planDigest}`)
  if (r.receiptDigest) lines.push(`  receipt:  ${r.receiptDigest}`)
  for (const n of r.notes) lines.push(`  - ${n}`)
  return lines.join("\n")
}

function safeInstallHelp(): string {
  return `calllint safe-install — adopt a tool from its Agent Adoption Contract

USAGE
  calllint safe-install --contract <https://calllint.com/... | file> [options]

The command DELEGATES to the Trust Gateway: it re-resolves the exact target
locally, runs the deterministic decision, computes a reversible install plan, and
(only with an explicit approval) delegates the write to the shipped apply engine.
It never executes the target and never writes host config directly.

OPTIONS
  --contract <url|file>   The calllint.agent-adoption-contract.v1 to adopt
                          (https://calllint.com only, or a local file)
  --stdin                 Read the contract JSON from stdin instead
  --host <id>             Target host (claude-code | cursor | windsurf)
  --host-config <path>    Override the host config path (default: the host's own)
  --apply                 Attempt to apply the prepared plan (default: prepare only)
  --approve <plan-digest> The exact plan digest you reviewed (required to apply
                          in --json / --non-interactive mode)
  --plan-out <file>       Write the computed plan for review (agent flow, step 1)
  --plan <file>           Replay the plan you reviewed, then apply it (required with
                          --apply in --json / --non-interactive mode). A plan digest
                          seals the plan's validity window, so it only reproduces
                          when the reviewed plan is replayed; drift aborts.
  --expect-version <v>            Assert the contract's exact version (offline gate)
  --expect-artifact-digest <sha>  Assert the contract's artifact digest (offline gate)
  --expect-contract-digest <sha>  Assert the contract digest (offline gate + provenance)
  --json                  Emit only the calllint.safe-install-result.v1 envelope
  --non-interactive       Agent mode: never prompt; apply only with
                          --plan <file> --apply --approve <digest>

EXAMPLES
  calllint safe-install --contract https://calllint.com/install/acme/tool/index.json --host cursor
  calllint safe-install --contract ./contract.json --host cursor --apply   # interactive approval
  # agent flow — review the plan, then replay exactly what you reviewed:
  calllint safe-install --contract ./c.json --host cursor --json --plan-out plan.json
  calllint safe-install --contract ./c.json --host cursor --json --plan plan.json --apply --approve sha256:...
  cat contract.json | calllint safe-install --stdin --host claude-code --json
`
}
