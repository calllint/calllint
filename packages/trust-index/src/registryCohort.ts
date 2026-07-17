/**
 * The Official MCP Registry cohort (I1b) — PURE. Given a loaded, committed snapshot
 * it deterministically maps each retained entry to a `BakeInput` (the synthesized
 * config we scan) or marks it `incomplete` when there is nothing to scan (ADR 0038
 * §5 completeness — malformed/empty entries are recorded, never silently dropped).
 *
 * The observation time is the snapshot's `fetchedAt`, injected into every entry, so
 * a re-bake from the same committed snapshot is byte-identical (ADR 0046 §4). The
 * file read is the caller's job (bin/CI) — this module touches no I/O and no clock.
 */
import type { BakeInput } from "./bakeTrustPage.js"
import {
  registryCanonicalName,
  synthesizeConfigText,
  type RegistrySnapshot,
} from "./snapshot.js"

/** One planned registry page: a bakeable input, or an incomplete marker. */
export interface RegistryEntryPlan {
  canonicalName: string
  /** null ⇒ nothing to scan; recorded as incomplete, no page baked. */
  input: BakeInput | null
  incompleteReason?: string
}

/**
 * Build the deterministic registry cohort from a committed snapshot. Sorted by
 * canonical name so ingestion order (and the emitted index) is stable across runs
 * and platforms. Duplicate canonical names (post-slug collision) keep the first and
 * mark the rest incomplete, so the emitted tree can never have two files fighting
 * for one path.
 */
export function registryCohort(snapshot: RegistrySnapshot): RegistryEntryPlan[] {
  const seen = new Set<string>()
  const plans: RegistryEntryPlan[] = snapshot.entries.map((entry) => {
    const canonicalName = registryCanonicalName(entry.name)
    if (seen.has(canonicalName)) {
      return {
        canonicalName,
        input: null,
        incompleteReason: `duplicate canonical name after slug — kept the first "${canonicalName}"`,
      }
    }
    seen.add(canonicalName)

    const configText = synthesizeConfigText(entry)
    if (configText === null) {
      return {
        canonicalName,
        input: null,
        incompleteReason: "entry declares neither a remote nor a package — nothing to scan",
      }
    }
    return {
      canonicalName,
      input: {
        canonicalName,
        configText,
        sourceLabel: `official-mcp-registry:${entry.name}`,
        observedAt: snapshot.fetchedAt,
      },
    }
  })

  return plans.sort((a, b) =>
    a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0,
  )
}
