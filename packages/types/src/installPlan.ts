/**
 * calllint.install-plan.v1 — Install Plan (object 5 of the six).
 *
 * The exact, reversible change the gateway WOULD make to a host's config, bound
 * to the full upstream digest chain (artifact → authority → decision → policy).
 * A plan is pure, typed data: generating it changes nothing on disk except
 * (optionally) the plan file under `.calllint/plans/<plan-id>.json`. Applying it
 * is a SEPARATE, later step (G6) and is the ONLY writer.
 *
 * Hard rules (ADR 0036):
 * - Operations are typed RFC-6902 JSON-Patch with a `preconditionDigest` of the
 *   target's current bytes. NEVER a shell string, NEVER a parsed README command.
 * - `planDigest` seals the whole plan; an approval binds this digest AND every
 *   upstream digest. Any mismatch at apply-time → PLAN_STALE (never auto-merge).
 * - `expiresAt` bounds validity; `idempotencyKey` makes re-apply a no-op.
 *
 * See ADR 0036 (Install Plan & Approval Binding), ADR 0037 (Host Adapter Safety
 * Contract) and schemas/install-plan.schema.json.
 */

/** RFC-6902 JSON-Patch operation (the only operation shape v1 supports). */
export interface JsonPatchOp {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test"
  path: string
  /** Present for add/replace/test; the value to write. */
  value?: unknown
  /** Present for move/copy; the source path. */
  from?: string
}

/**
 * One typed operation against one target file. `preconditionDigest` is the
 * sha256 of the target's CURRENT bytes (or the sentinel "absent" when the target
 * file does not yet exist) — apply refuses if it no longer matches (APPLY_CONFLICT).
 */
export interface InstallOperation {
  type: "json-patch"
  /** Host config path the patch applies to (e.g. "~/.claude.json"). */
  target: string
  /** sha256 of the target's current bytes, or "absent" if the file is missing. */
  preconditionDigest: `sha256:${string}` | "absent"
  /** RFC-6902 patch. Auditable, reversible, host-agnostic. */
  patch: JsonPatchOp[]
}

export interface InstallPlan {
  schema: "calllint.install-plan.v1"
  /** Deterministic short id derived from the upstream chain + operations. */
  planId: string
  /** sha256 over this plan minus `planDigest` (hashJson). An approval binds this. */
  planDigest: `sha256:${string}`
  /** Upstream chain — the exact objects this plan was derived from. */
  artifactDigest: string | null
  authorityDigest: string
  decisionDigest: string
  policyDigest: string
  /** Host id (e.g. "claude-code"). */
  host: string
  /** Host tier: A = apply+rollback, B = plan-only (user applies), C = analyze-only. */
  tier: "A" | "B" | "C"
  /** Forward operations (the change). */
  operations: InstallOperation[]
  /** Inverse operations that undo `operations` (restores the original bytes). */
  rollback: InstallOperation[]
  /** Where the original config is backed up before apply. */
  backup: { path: string }
  /** sha256 over host+target+operations — makes re-apply a no-op (already_applied). */
  idempotencyKey: `sha256:${string}`
  /** ISO-8601 UTC; applying after this instant is rejected as stale. */
  expiresAt: string
}

export const INSTALL_PLAN_SCHEMA_VERSION = "calllint.install-plan.v1" as const
