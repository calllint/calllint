import type { RiskSymbol } from "./symbols.js"
import type { Verdict } from "./verdict.js"

export const POLICY_ACTIONS = ["allow", "warn", "deny"] as const
export type PolicyAction = (typeof POLICY_ACTIONS)[number]

/** Recommended runtime policy attached to every ScanReport. */
export interface RecommendedPolicy {
  autonomousUse: "allow" | "warn" | "deny"
  manualApproval: "none" | "recommended" | "required"
  sandbox: "none" | "recommended" | "required"
}

export interface PolicyDefaults {
  unknownSource: PolicyAction
  unpinnedPackage: PolicyAction
  broadFilesystemAccess: PolicyAction
  arbitraryCommandExecution: PolicyAction
  promptPoisoning: PolicyAction
  externalMutation: PolicyAction
  financialAction: PolicyAction
}

export interface PolicyCi {
  failOn: Verdict[]
  failOnReview: boolean
}

export interface PolicyOverride {
  /** Server name this override applies to. */
  target: string
  /** ISO timestamp; required. Overrides without expiry are invalid. */
  expiresAt: string
  /** Human reason; required. Overrides without a reason are invalid. */
  reason: string
  /**
   * Accountable identity for this exception (handle, team, or email). Optional;
   * when present it must be a non-empty string. CallLint records and echoes it,
   * it does not interpret or verify it. See ADR 0017 (option B).
   */
  owner?: string
  /** Risk symbols this override tolerates. */
  allow?: RiskSymbol[]
  /** Extra requirements imposed by the override. */
  require?: Array<"manualApproval" | "sandbox">
  /** Must be true to allow EXEC or MONEY symbols. */
  dangerousOverride?: boolean
}

export interface Policy {
  schemaVersion: "calllint.policy.v0"
  defaults: PolicyDefaults
  ci: PolicyCi
  allowedSources: string[]
  allowedPaths: string[]
  overrides: PolicyOverride[]
}
