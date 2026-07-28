import type { Policy } from "@calllint/types"

/**
 * The adoption-basis policy (ADR 0056 §10.7) — the deterministic policy the safe-install
 * local re-decode runs under when the caller supplies no stricter `--policy`. It is the
 * ONE source of truth shared by the CLI orchestrator (`safe-install`) and the MCP
 * `calllint_prepare_safe_install` tool, so the two surfaces decide identically.
 *
 * It differs from `defaultPolicy()` on exactly ONE axis: `arbitraryCommandExecution` is
 * `warn` (not `deny`). This is safe and STRICTER-than-public, not a loophole:
 *   - The orchestrator can synthesize ONLY a pinned `npx -y <registry-pkg>@<ver>` launch
 *     (hardcoded "npx", an ARG ARRAY — no shell string), which is the exact shape the
 *     PUBLIC scanner classifies SAFE. A dangerous `bash -c …` is structurally unreachable.
 *   - `warn` decides REVIEW, not SAFE — and REVIEW is EXCLUDED from AUTO_ALLOW, so the
 *     §10.7 single human-approval gate still fires before any write. REVIEW is strictly
 *     MORE cautious than the public SAFE it re-decodes.
 *   - A manifest `approvalRequirement:"block"` capability still forces BLOCK — the
 *     fail-closed floor a lenient policy cannot loosen. Every OTHER axis stays strict,
 *     and `allowedSources` is empty so nothing is auto-allowed by source.
 */
export function adoptionBasisPolicy(): Policy {
  return {
    schemaVersion: "calllint.policy.v0",
    defaults: {
      unknownSource: "deny",
      unpinnedPackage: "warn",
      broadFilesystemAccess: "deny",
      arbitraryCommandExecution: "warn",
      promptPoisoning: "deny",
      externalMutation: "warn",
      financialAction: "deny",
    },
    ci: { failOn: ["BLOCK", "UNKNOWN"], failOnReview: false },
    allowedSources: [],
    allowedPaths: ["${workspaceFolder}"],
    overrides: [],
  }
}

/** Pretty-printed adoption-basis policy — the exact bytes the CLI writes to its
 *  ephemeral scratch policy file (kept byte-identical so the delegated load matches). */
export function adoptionBasisPolicyJson(): string {
  return JSON.stringify(adoptionBasisPolicy(), null, 2) + "\n"
}
