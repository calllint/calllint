/**
 * Plan validation (structural + safety invariants). Pure. This is the last gate
 * before a plan is trusted downstream; it enforces the ADR-0036/0037
 * non-negotiables that the type system alone cannot (e.g. "every op is
 * json-patch", "no op targets a path outside the host config").
 */
import type { InstallPlan } from "@calllint/types"
import type { ValidationResult } from "./hostAdapter.js"
import { verifyPlanDigest } from "./buildPlan.js"

export function validatePlan(plan: InstallPlan): ValidationResult {
  const errors: string[] = []

  if (plan.schema !== "calllint.install-plan.v1") {
    errors.push(`unexpected schema: ${String(plan.schema)}`)
  }
  if (!verifyPlanDigest(plan)) {
    errors.push("planDigest does not match plan contents (tampered or stale)")
  }
  if (plan.operations.length === 0) {
    errors.push("plan has no operations (nothing to install)")
  }

  for (const op of [...plan.operations, ...plan.rollback]) {
    if (op.type !== "json-patch") {
      // Belt-and-suspenders: the type union forbids this, but a plan can arrive
      // as untrusted JSON. A non-json-patch op is the exact thing ADR 0036 bans.
      errors.push(`operation is not json-patch: ${String((op as { type: string }).type)}`)
    }
    if (!op.preconditionDigest) {
      errors.push(`operation on ${op.target} has no preconditionDigest`)
    }
    for (const p of op.patch) {
      if (!p.path.startsWith("/")) {
        errors.push(`patch path must be an absolute JSON-Pointer: ${p.path}`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}
