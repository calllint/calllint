/**
 * HostAdapter contract (ADR 0037). An adapter is the ONLY code that translates
 * an approved Install Plan into a real edit of a host config — the single most
 * dangerous surface in CallLint. This file locks the shape; G5 implements the
 * plan-only half (detect/createPlan/validatePlan). apply/rollback land in G6.
 *
 * Absolute prohibitions (every adapter): no target execution · no README-command
 * parsing · arg-arrays only for any subprocess · known-schema writes only.
 */
import type { InstallPlan, TrustDecision, AuthorityManifest, ApplyResult } from "@calllint/types"
import type { ConfigFs } from "./fsPort.js"

/** A host config file discovered on disk (edge I/O produces these). */
export interface HostDetection {
  host: string
  /** Absolute (or ~-relative) path to the host config. */
  configPath: string
  /** True if the file exists; false ⇒ install would create it. */
  exists: boolean
}

/**
 * Everything the pure planner needs, gathered by the edge. The planner itself
 * does NO I/O: the edge reads the current config bytes + digest and passes them.
 */
export interface PlanContext {
  host: string
  tier: "A" | "B" | "C"
  configPath: string
  /** sha256 of the current config bytes, or "absent" when the file is missing. */
  configDigest: `sha256:${string}` | "absent"
  /** Parsed current config (for precise add-vs-replace + rollback). null ⇒ absent. */
  currentConfig: unknown | null
  /** The mcpServers to install, normalized to the host's known schema. */
  servers: PlannedServer[]
  /** Backup path template; the receipt-id is stitched in at apply (G6). */
  backupPath: string
  /** ISO-8601 UTC expiry, injected from the edge. */
  expiresAt: string
}

/** One server to install, reduced to the fields a host config stores. */
export interface PlannedServer {
  name: string
  entry: Record<string, unknown>
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

/**
 * Everything the apply engine needs from the edge (resolved absolute paths +
 * the injected FS port + the human's approval). The adapter never reads these
 * from disk itself — the edge computes safe paths and passes them.
 */
export interface ApplyContext {
  /** Digest the human passed via `--approve` (must equal plan.planDigest). */
  approvalDigest: string
  /** Absolute, home-expanded config path. */
  configPath: string
  /** Backup path with the receipt id stitched in. */
  backupPath: string
  /** Absolute lock-file path (.calllint/locks/<config-digest>.lock). */
  lockPath: string
  fs: ConfigFs
  /** ISO-8601 UTC, injected from the edge. */
  now: string
}

/**
 * The full contract (ADR 0037 §1). Every adapter ships createPlan/validatePlan.
 * A Tier-A adapter additionally ships `applyPlan` — the ONLY writer. Tier B/C
 * omit it (the user applies the emitted patch), so the type system prevents a
 * non-apply tier from ever writing.
 */
export interface HostAdapter {
  id: string
  tier: "A" | "B" | "C"
  createPlan(ctx: PlanContext, upstream: PlanUpstream): InstallPlan
  validatePlan(plan: InstallPlan): ValidationResult
  /** Tier A only: apply an approved plan atomically, verifying + rolling back. */
  applyPlan?(plan: InstallPlan, ctx: ApplyContext): ApplyResult
}

/** The upstream digest chain a plan must bind (from artifact → decision). */
export interface PlanUpstream {
  artifactDigest: string | null
  authority: AuthorityManifest
  decision: TrustDecision
}
