import type { Policy, PolicyOverride } from "@calllint/types"

export interface PolicyValidationIssue {
  path: string
  message: string
}

export class PolicyValidationError extends Error {
  constructor(readonly issues: PolicyValidationIssue[]) {
    super(
      "Invalid policy:\n" +
        issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n"),
    )
    this.name = "PolicyValidationError"
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Symbols an override may not silently allow without dangerousOverride. */
const DANGEROUS_SYMBOLS = new Set(["EXEC", "MONEY"])

function validateOverride(
  o: unknown,
  index: number,
  issues: PolicyValidationIssue[],
): void {
  const base = `overrides[${index}]`
  if (!isRecord(o)) {
    issues.push({ path: base, message: "must be an object" })
    return
  }
  if (typeof o.target !== "string" || !o.target) {
    issues.push({ path: `${base}.target`, message: "is required" })
  }
  if (typeof o.reason !== "string" || !o.reason.trim()) {
    issues.push({
      path: `${base}.reason`,
      message: "is required (overrides without a reason are not allowed)",
    })
  }
  // owner is optional (ADR 0017-B), but if present must be a non-empty string.
  if (o.owner !== undefined && (typeof o.owner !== "string" || !o.owner.trim())) {
    issues.push({
      path: `${base}.owner`,
      message: "must be a non-empty string when present",
    })
  }
  if (typeof o.expiresAt !== "string" || Number.isNaN(Date.parse(o.expiresAt))) {
    issues.push({
      path: `${base}.expiresAt`,
      message: "must be a valid ISO timestamp (overrides must expire)",
    })
  }
  const allow = Array.isArray(o.allow) ? (o.allow as unknown[]) : []
  const allowsDangerous = allow.some(
    (s) => typeof s === "string" && DANGEROUS_SYMBOLS.has(s),
  )
  if (allowsDangerous && o.dangerousOverride !== true) {
    issues.push({
      path: `${base}.allow`,
      message:
        "may not allow EXEC or MONEY unless dangerousOverride is set to true",
    })
  }
}

/**
 * Validate a parsed policy object. Throws PolicyValidationError on any issue.
 * Returns the value typed as Policy on success.
 */
export function validatePolicy(value: unknown): Policy {
  const issues: PolicyValidationIssue[] = []

  if (!isRecord(value)) {
    throw new PolicyValidationError([{ path: "", message: "must be an object" }])
  }
  if (value.schemaVersion !== "calllint.policy.v0") {
    issues.push({
      path: "schemaVersion",
      message: 'must be "calllint.policy.v0"',
    })
  }
  if (!isRecord(value.defaults)) {
    issues.push({ path: "defaults", message: "is required" })
  }
  if (!isRecord(value.ci)) {
    issues.push({ path: "ci", message: "is required" })
  }

  const overrides = Array.isArray(value.overrides) ? value.overrides : []
  overrides.forEach((o, i) => validateOverride(o, i, issues))

  if (issues.length > 0) throw new PolicyValidationError(issues)
  return value as unknown as Policy
}

/** True when an override is currently active (not expired) for a target. */
export function isOverrideActive(o: PolicyOverride, now: number): boolean {
  const exp = Date.parse(o.expiresAt)
  return !Number.isNaN(exp) && exp > now
}
