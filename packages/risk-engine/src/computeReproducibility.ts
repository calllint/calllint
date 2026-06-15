import type {
  Finding,
  Reproducibility,
  RuntimeBinding,
} from "@mcpguard/types"

/**
 * Derive a reproducibility level. Unpinned packages and unverifiable remotes
 * mean a future scan may not match this one (TOCTOU, T11/T12).
 */
export function computeReproducibility(
  binding: RuntimeBinding,
  _findings: Finding[],
): Reproducibility {
  const reasons: string[] = []

  if (binding.packageName && !binding.isVersionPinned) {
    reasons.push("Package version is not pinned")
  }
  if (binding.remoteUrl && !binding.sourceKnown) {
    reasons.push("Remote endpoint could not be verified")
  }
  if (binding.runtimeExecutable && !binding.sourceKnown && !binding.remoteUrl) {
    reasons.push("Runtime source could not be identified")
  }

  let level: Reproducibility["level"]
  if (reasons.length === 0) level = "HIGH"
  else if (reasons.length === 1) level = "MEDIUM"
  else level = "LOW"

  return { level, reasons }
}
