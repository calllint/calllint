/**
 * The apply engine (ADR 0036 §G.3 apply-half, ADR 0037). This is the ONLY code
 * path that writes a live host config. It is deliberately paranoid and
 * fails-closed at every step:
 *
 *   REVALIDATING → APPLIED → VERIFIED
 *      │ tamper/expiry/approval mismatch → PLAN_STALE (no write)
 *      │ target drifted since planning    → APPLY_CONFLICT (no write)
 *      │ lock held by another apply       → APPLY_CONFLICT (no write)
 *      │ post-write re-parse fails         → rollback → ROLLBACK_REQUIRED / rolled_back
 *
 * Idempotency is decided by EFFECT, not bookkeeping: if applying the forward
 * patch changes nothing, the plan is already in effect (already_applied) — this
 * is checked BEFORE the precondition so a re-apply is never mis-read as a conflict.
 *
 * All I/O goes through the injected ConfigFs port; the atomic write dance
 * (temp → fsync → rename) is performed HERE so the in-memory test port and the
 * Node port exercise the identical sequence.
 */
import { hashJson, stableStringify } from "@calllint/fingerprint"
import type { ApplyResult, ApplyOutcome, InstallPlan, TrustPrepareState } from "@calllint/types"
import { APPLY_RESULT_SCHEMA } from "@calllint/types"
import type { ConfigFs } from "./fsPort.js"
import { applyJsonPatch, JsonPatchError } from "./jsonPatch.js"
import { validatePlan } from "./validate.js"
import { verifyPlanDigest } from "./buildPlan.js"

export interface ApplyOptions {
  plan: InstallPlan
  /** The digest the human passed via `--approve`; must equal plan.planDigest. */
  approvalDigest: string
  /** Absolute, home-expanded config path (edge resolves ~ before calling). */
  configPath: string
  /** Backup path with the receipt id already stitched in. */
  backupPath: string
  /** Absolute path to the exclusive lock file (.calllint/locks/<digest>.lock). */
  lockPath: string
  fs: ConfigFs
  /** ISO-8601 UTC, injected from the edge. */
  now: string
}

/** sha256 of config bytes using the SAME formula G5 used for preconditionDigest. */
function digestBytes(bytes: string): `sha256:${string}` {
  return hashJson(bytes) as `sha256:${string}`
}

/** Detect the indent unit of an existing JSON document (default 2 spaces). */
function detectIndent(bytes: string): string | number {
  const m = bytes.match(/\n([ \t]+)"/)
  if (!m) return 2
  return m[1]!.includes("\t") ? "\t" : m[1]!.length
}

/** Serialize a config, preserving the original indent + trailing-newline style. */
function serializeLike(original: string | null, value: unknown): string {
  const indent = original === null ? 2 : detectIndent(original)
  const body = JSON.stringify(value, null, indent)
  const trailing = original === null || original.endsWith("\n") ? "\n" : ""
  return body + trailing
}

/** Semantic equality (formatting-independent) via stable stringify. */
function sameConfig(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function mk(
  plan: InstallPlan,
  opts: ApplyOptions,
  state: TrustPrepareState,
  outcome: ApplyOutcome,
  before: `sha256:${string}` | "absent",
  extra: Partial<ApplyResult>,
  notes: string[],
): ApplyResult {
  return {
    schema: APPLY_RESULT_SCHEMA,
    state,
    outcome,
    planId: plan.planId,
    planDigest: plan.planDigest,
    host: plan.host,
    configPath: opts.configPath,
    configDigestBefore: before,
    configDigestAfter: null,
    backupPath: null,
    rolledBack: false,
    notes,
    appliedAt: opts.now,
    ...extra,
  }
}

/**
 * Apply an approved plan. Pure orchestration over the injected FS port; every
 * failure lands a terminal state and NEVER a partial write.
 */
export function applyPlan(opts: ApplyOptions): ApplyResult {
  const { plan, fs } = opts
  const notes: string[] = []

  // ── Guard 1: plan integrity + approval binding (no I/O) ───────────────────
  const v = validatePlan(plan)
  if (!v.ok) {
    return mk(plan, opts, "PLAN_STALE", "stale", "absent", {}, [...notes, ...v.errors.map((e) => `invalid plan: ${e}`)])
  }
  if (!verifyPlanDigest(plan)) {
    return mk(plan, opts, "PLAN_STALE", "stale", "absent", {}, [...notes, "plan digest does not seal its contents — tampered"])
  }
  if (opts.approvalDigest !== plan.planDigest) {
    return mk(plan, opts, "PLAN_STALE", "stale", "absent", {}, [
      ...notes,
      `approval digest does not match plan digest (approved ${opts.approvalDigest.slice(0, 16)}…, plan ${plan.planDigest.slice(0, 16)}…)`,
    ])
  }
  if (opts.now > plan.expiresAt) {
    return mk(plan, opts, "PLAN_STALE", "stale", "absent", {}, [...notes, `plan expired at ${plan.expiresAt} (now ${opts.now})`])
  }
  // G6 first host is Tier A only; a Tier-B/C plan must never reach apply.
  if (plan.tier !== "A") {
    return mk(plan, opts, "PLAN_STALE", "stale", "absent", {}, [...notes, `host "${plan.host}" is tier ${plan.tier} — not approved for apply`])
  }

  // ── Read current target (single op supported in v1) ───────────────────────
  const op = plan.operations[0]
  if (!op) {
    return mk(plan, opts, "VERIFIED", "already_applied", "absent", { configDigestAfter: null }, [...notes, "plan has no operations — nothing to apply"])
  }
  const exists = fs.exists(opts.configPath)
  const currentBytes = exists ? fs.readFile(opts.configPath) : null
  const before: `sha256:${string}` | "absent" = currentBytes === null ? "absent" : digestBytes(currentBytes)
  const currentConfig = currentBytes === null ? null : safeParse(currentBytes)
  if (currentBytes !== null && currentConfig === PARSE_FAILED) {
    return mk(plan, opts, "APPLY_CONFLICT", "conflict", before, {}, [...notes, "current config is not valid JSON — refusing to overwrite"])
  }

  // ── Guard 2: idempotency by EFFECT (checked before precondition) ──────────
  let next: unknown
  try {
    next = applyJsonPatch(currentConfig ?? {}, op.patch)
  } catch (e) {
    const msg = e instanceof JsonPatchError ? e.message : String(e)
    return mk(plan, opts, "APPLY_CONFLICT", "conflict", before, {}, [...notes, `patch does not apply to current config: ${msg}`])
  }
  if (currentConfig !== null && sameConfig(next, currentConfig)) {
    notes.push("plan already in effect — no change needed (idempotent)")
    return mk(plan, opts, "VERIFIED", "already_applied", before, { configDigestAfter: before === "absent" ? null : before }, notes)
  }

  // ── Guard 3: precondition digest (target must match what we planned against) ─
  if (op.preconditionDigest !== before) {
    return mk(plan, opts, "APPLY_CONFLICT", "conflict", before, {}, [
      ...notes,
      `target config changed since planning (precondition ${op.preconditionDigest.slice(0, 16)}…, now ${before === "absent" ? "absent" : before.slice(0, 16) + "…"}) → not auto-merging`,
    ])
  }

  // ── Lock (atomic O_EXCL). A held lock ⇒ another apply is in flight. ───────
  fs.ensureDir(opts.lockPath)
  if (!fs.acquireLock(opts.lockPath)) {
    return mk(plan, opts, "APPLY_CONFLICT", "conflict", before, {}, [...notes, "another apply holds the config lock — try again"])
  }

  try {
    return writeVerifyRollback(opts, op.patch, currentBytes, before, next, notes)
  } finally {
    fs.remove(opts.lockPath) // always release
  }
}

const PARSE_FAILED = Symbol("parse-failed")
function safeParse(bytes: string): unknown {
  try {
    return JSON.parse(bytes)
  } catch {
    return PARSE_FAILED
  }
}

/**
 * The write half, run under the lock: backup → atomic write → re-read + verify →
 * rollback on failure. `next` is the already-computed post-config; we serialize
 * it preserving the original file's formatting to avoid unrelated churn.
 */
function writeVerifyRollback(
  opts: ApplyOptions,
  patch: InstallPlan["operations"][number]["patch"],
  currentBytes: string | null,
  before: `sha256:${string}` | "absent",
  next: unknown,
  notes: string[],
): ApplyResult {
  const { plan, fs } = opts
  const nextBytes = serializeLike(currentBytes, next)
  const after = digestBytes(nextBytes)

  // Backup the original bytes first (only when a file exists to restore to).
  let backupPath: string | null = null
  if (currentBytes !== null) {
    fs.ensureDir(opts.backupPath)
    fs.writeFile(opts.backupPath, currentBytes)
    fs.fsync(opts.backupPath)
    backupPath = opts.backupPath
    notes.push(`backed up original config → ${opts.backupPath}`)
  }

  // Atomic write: temp → fsync → rename onto the target.
  const tmp = opts.configPath + ".calllint-tmp"
  fs.ensureDir(opts.configPath)
  fs.writeFile(tmp, nextBytes)
  fs.fsync(tmp)
  fs.rename(tmp, opts.configPath)
  notes.push("config written atomically (temp → fsync → rename)")

  // ── Verify: re-read, re-parse, confirm the patch's effect is present ──────
  const verifyOk = verify(fs, opts.configPath, patch, next)
  if (verifyOk) {
    notes.push("post-apply verify OK — resulting config re-parses and matches the plan")
    return mk(plan, opts, "VERIFIED", "applied", before, { configDigestAfter: after, backupPath }, notes)
  }

  // ── Verify failed → roll back to the original bytes ───────────────────────
  notes.push("post-apply verify FAILED — attempting rollback to the original config")
  if (currentBytes === null) {
    // Nothing to restore to (we created the file) — remove our write.
    fs.remove(opts.configPath)
    const restored = !fs.exists(opts.configPath)
    return mk(plan, opts, restored ? "VERIFICATION_FAILED" : "ROLLBACK_REQUIRED", restored ? "rolled_back" : "rollback_failed", before, { configDigestAfter: null, backupPath, rolledBack: restored }, [
      ...notes,
      restored ? "rollback OK — created file removed, original absence restored" : "rollback FAILED — file still present; manual intervention required",
    ])
  }
  const rtmp = opts.configPath + ".calllint-rollback-tmp"
  fs.writeFile(rtmp, currentBytes)
  fs.fsync(rtmp)
  fs.rename(rtmp, opts.configPath)
  const restoredDigest = digestBytes(fs.readFile(opts.configPath))
  const rolledBack = restoredDigest === before
  return mk(plan, opts, rolledBack ? "VERIFICATION_FAILED" : "ROLLBACK_REQUIRED", rolledBack ? "rolled_back" : "rollback_failed", before, { configDigestAfter: null, backupPath, rolledBack }, [
    ...notes,
    rolledBack ? "rollback OK — original config restored (digest matches)" : "rollback FAILED — restored digest does not match original; manual intervention required",
  ])
}

/** Re-read the written config and confirm it parses AND carries the patch effect. */
function verify(fs: ConfigFs, path: string, patch: InstallPlan["operations"][number]["patch"], expected: unknown): boolean {
  if (!fs.exists(path)) return false
  const parsed = safeParse(fs.readFile(path))
  if (parsed === PARSE_FAILED) return false
  // The persisted config must be semantically the post-config we computed.
  if (stableStringify(parsed) !== stableStringify(expected)) return false
  void patch
  return true
}
