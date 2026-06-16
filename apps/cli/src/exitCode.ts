import type { ConfigSummaryReport, Verdict } from "@calllint/types"
import type { Policy } from "@calllint/types"
import { shouldFailCi } from "@calllint/policy"
import { EXIT } from "./args.js"

/**
 * Map an aggregate verdict to a CI exit code, honoring the policy's failOn set.
 * Returns OK when the policy would not fail on this verdict.
 */
export function exitCodeFor(
  summary: ConfigSummaryReport,
  policy: Policy,
): number {
  const verdict: Verdict = summary.verdict
  if (!shouldFailCi(verdict, policy)) return EXIT.OK
  switch (verdict) {
    case "BLOCK":
      return EXIT.BLOCK
    case "UNKNOWN":
      return EXIT.UNKNOWN
    case "REVIEW":
      return EXIT.REVIEW
    case "SAFE":
      return EXIT.OK
  }
}
