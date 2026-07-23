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

/** The `sourceLabel` prefix that marks a registry-derived bake input. Single source. */
const SOURCE_LABEL_PREFIX = "official-mcp-registry:"

/**
 * Recover the ORIGINAL reverse-DNS registry name (e.g. `io.github.calllint/calllint`)
 * from a `BakeInput.sourceLabel`, or `undefined` for any non-registry input (fixtures,
 * expansion). The inverse of the `sourceLabel` construction below; the namespace-claim
 * matcher (ADR 0047 §3, D6) keys off this original name — NEVER the lossy `canonicalName`
 * slug, which flattens the reverse-DNS `/` boundary into `-`.
 */
export function registryNameFromSourceLabel(sourceLabel: string): string | undefined {
  return sourceLabel.startsWith(SOURCE_LABEL_PREFIX)
    ? sourceLabel.slice(SOURCE_LABEL_PREFIX.length)
    : undefined
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
        sourceLabel: `${SOURCE_LABEL_PREFIX}${entry.name}`,
        observedAt: snapshot.fetchedAt,
      },
    }
  })

  return plans.sort((a, b) =>
    a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0,
  )
}
