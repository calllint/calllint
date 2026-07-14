/**
 * Pure Install-Plan assembly (ADR 0036). No I/O, no clock, no randomness: the
 * edge reads config bytes + digest and injects `expiresAt`, so the same inputs
 * yield a byte-identical plan (property: plan change ⇒ digest change). This
 * module is analysis-free — it never parses a config for findings, only shapes
 * the typed JSON-Patch that installs already-normalized servers.
 */
import { hashJson } from "@calllint/fingerprint"
import type { InstallPlan, InstallOperation, JsonPatchOp } from "@calllint/types"
import type { PlanContext, PlanUpstream } from "./hostAdapter.js"

/** Escape a JSON-Pointer path segment (RFC-6901): ~ → ~0, / → ~1. */
function ptr(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1")
}

/**
 * Build the forward + rollback operations for installing servers under an
 * `mcpServers` object. Precise add-vs-replace so rollback restores the exact
 * prior bytes: a brand-new server rolls back with `remove`; a replaced one rolls
 * back with `replace` to its prior value.
 */
export function buildServerOps(ctx: PlanContext): {
  operations: InstallOperation[]
  rollback: InstallOperation[]
} {
  const forward: JsonPatchOp[] = []
  const inverse: JsonPatchOp[] = []
  const cfg = (ctx.currentConfig as { mcpServers?: Record<string, unknown> } | null) ?? null
  const hasContainer = !!cfg && typeof cfg === "object" && !!cfg.mcpServers

  // Ensure the container exists (only when the file/key is absent).
  if (!hasContainer) {
    forward.push({ op: "add", path: "/mcpServers", value: {} })
    // Inverse of creating the container is removing it (restores absence).
    inverse.unshift({ op: "remove", path: "/mcpServers" })
  }

  for (const s of ctx.servers) {
    const path = `/mcpServers/${ptr(s.name)}`
    const prior = hasContainer && cfg?.mcpServers ? cfg.mcpServers[s.name] : undefined
    forward.push({ op: "add", path, value: s.entry })
    if (prior === undefined) {
      // New server: rollback removes it. Only meaningful when the container
      // itself survives rollback (i.e. it already existed).
      if (hasContainer) inverse.unshift({ op: "remove", path })
    } else {
      // Replaced an existing server: rollback restores its prior value.
      inverse.unshift({ op: "replace", path, value: prior })
    }
  }

  const op: InstallOperation = {
    type: "json-patch",
    target: ctx.configPath,
    preconditionDigest: ctx.configDigest,
    patch: forward,
  }
  const rb: InstallOperation = {
    type: "json-patch",
    target: ctx.configPath,
    preconditionDigest: ctx.configDigest,
    patch: inverse,
  }
  return { operations: [op], rollback: inverse.length > 0 ? [rb] : [] }
}

/**
 * Assemble a sealed InstallPlan from a context + upstream chain. Deterministic:
 * planId + idempotencyKey are derived from content; planDigest = hashJson over
 * the plan minus planDigest. Binds artifact/authority/decision/policy digests.
 */
export function buildInstallPlan(ctx: PlanContext, upstream: PlanUpstream): InstallPlan {
  const { operations, rollback } = buildServerOps(ctx)

  // idempotencyKey identifies THIS exact change (host + target + operations), so
  // a re-apply of the same plan is a no-op (already_applied) rather than a second write.
  const idempotencyKey = hashJson({
    host: ctx.host,
    operations,
  }) as `sha256:${string}`

  // planId: deterministic short id from the whole upstream chain + operations.
  const planId = hashJson({
    artifactDigest: upstream.artifactDigest,
    authorityDigest: upstream.authority.digest,
    decisionDigest: upstream.decision.digest,
    host: ctx.host,
    operations,
  }).slice("sha256:".length, "sha256:".length + 16)

  const sealed: Omit<InstallPlan, "planDigest"> = {
    schema: "calllint.install-plan.v1",
    planId,
    artifactDigest: upstream.artifactDigest,
    authorityDigest: upstream.authority.digest,
    decisionDigest: upstream.decision.digest,
    policyDigest: upstream.decision.policyDigest,
    host: ctx.host,
    tier: ctx.tier,
    operations,
    rollback,
    backup: { path: ctx.backupPath },
    idempotencyKey,
    expiresAt: ctx.expiresAt,
  }
  return { ...sealed, planDigest: hashJson(sealed) as `sha256:${string}` }
}

/** Recompute a plan's digest and compare (tamper check for apply-side consumers). */
export function verifyPlanDigest(plan: InstallPlan): boolean {
  const { planDigest, ...rest } = plan
  return planDigest === hashJson(rest)
}
