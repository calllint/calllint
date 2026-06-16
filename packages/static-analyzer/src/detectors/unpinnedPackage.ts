import type { Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

/**
 * Flags packages that are not pinned to an exact version (latest, ranges, or
 * a bare package name). Unpinned packages make the verdict non-reproducible
 * and open a supply-chain drift / rug-pull window (T10/T12).
 */
export function detectUnpinnedPackage(ctx: DetectorContext): Finding[] {
  const { binding } = ctx
  if (!binding.packageName) return []
  if (binding.isVersionPinned) return []

  const spec = binding.packageVersionSpec
  const display = spec ? `${binding.packageName}@${spec}` : binding.packageName

  return [
    {
      id: "supply.unpinned-package",
      title: "Package version is not pinned",
      severity: "high",
      blocker: false,
      symbol: "SUPPLY",
      riskClass: "S1",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "runtime-binding",
      evidence: [
        {
          type: "runtime-binding",
          key: "package",
          value: display,
        },
      ],
      impact:
        "The installed code can change between scans and runs, so this verdict may not match what actually executes.",
      fix: `Pin the package to an exact version, e.g. ${binding.packageName}@1.0.0.`,
      falsePositiveNote:
        "Intentional during local development, but should be pinned before autonomous or CI use.",
    },
  ]
}
