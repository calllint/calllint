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
  /**
   * The snapshot entry's upstream release instant, or `null` when the registry declared none.
   *
   * DELIBERATELY NOT AN INPUT TO ANY STATUS. It becomes `upstreamAgeDays` on the served index entry
   * — a display fact only. Making it a resolution axis would be wrong on the committed corpus: the
   * oldest `publishedAt` is 2026-02-24, 162 days before the committed bake, so a stable package
   * nobody has had to republish would read as permanently STALE. Age-since-release measures the
   * PACKAGE's activity; staleness measures OUR knowledge (see `resolution.ts`).
   *
   * Absent on the incomplete branches above for the same reason `identity` is: an entry with
   * nothing to scan has no page to carry a display field.
   */
  publishedAt?: string | null
}

/**
 * A slug collision: two or more ORIGINAL registry names that flatten to one canonical slug.
 *
 * Reported as a first-class value by R-3, because `registryCohort`'s election — keep the
 * first, mark the rest incomplete — answers "which page gets baked" and cannot answer "are
 * these the same product". Only the second question decides whether one product's evidence
 * may appear on another's page, and a one-line `incompleteReason` string is not an answer a
 * caller can act on.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not decide, does not merge, and does not change
 * which entries bake: the elected entry is still elected and the rest still carry the same
 * `incompleteReason` BYTE FOR BYTE, because that string reaches `markIncomplete` and from
 * there the served tree. R-3 adds an observation, not a behaviour change — which is why
 * `apps/web/public/` cannot move.
 *
 * Flows OUTWARD as a plain value. `packages/trust-index` gains no dependency on
 * `@calllint/adoption-index`: the identity layer consumes this shape, never the reverse.
 *
 * WHAT ENFORCES THAT, MEASURED. This docblock first claimed the module-graph gate
 * (`tests/invariants/adoption-index-unreachable.invariants.test.ts`) would turn red on an import
 * here, because `registryCohort` is reachable from `emitCohort`/`emitSafeInstall`. It does not:
 * importing the store into THIS file leaves that suite at 11/11 green. Reachability from
 * `emitCohort` is not the question the gate asks — it walks from the two PUBLISHED bundle entry
 * points, and `calllint-mcp` reaches trust-index through exactly two `exports`-map subpaths
 * (`matchLexical`, `safe-install/agentRelay`), which the suite's own witness test pins as a set.
 * `emitCohort` is a BAKE-TIME module; no shipped bundle reaches it, so nothing under it is on
 * the graph under test. Corrected rather than deleted: the wrong claim is why the real
 * enforcement boundary is worth stating.
 *
 * Measured on a module that IS on the graph — the same import in `matchLexical.ts` fails three
 * ways at once: 15 adoption-index modules bundled (`subject.ts` and `resolveIdentity.ts`
 * included), the `@calllint/adoption-index` specifier named, and `better-sqlite3` named, the
 * last being the one that matters — a `.node` binary cannot be bundled at all.
 *
 * So the discipline here rests on the boundary being one-directional BY CONSTRUCTION, not on a
 * gate that happens to cover this file: collisions leave as plain structural values
 * (`registry-cohort-collision.test.ts` asserts the shape stayed structural, control #19), and
 * the identity layer imports trust-index, never the reverse.
 */
export interface RegistryCollision {
  /** The shared slug the names collapsed onto. */
  canonicalName: string
  /** Every ORIGINAL registry name involved, sorted. Two or more, by construction. */
  entryNames: string[]
}

/**
 * Every slug collision in a snapshot, sorted, with the original names preserved.
 *
 * MEASURED ON THE COMMITTED CORPUS: zero. All 19 retained entries produce 19 distinct slugs,
 * so this returns `[]` on real data today and the interesting path is reachable only from a
 * synthetic snapshot. That is stated rather than hidden — a guard that can never fire on real
 * input has to be graded on constructed input, or its green is unfalsifiable.
 *
 * The ORIGINAL names are what make the report useful: `registryCanonicalName` lowercases and
 * maps every `[^a-z0-9._-]` run to `-`, so two distinct names can arrive at one slug. Reporting
 * only the slug would name the symptom and discard the evidence.
 *
 * THE WITNESS, CORRECTED BY MEASUREMENT. This docblock first offered `a.b/c` / `a-b-c` as the
 * colliding pair, which does not collide: `.` and `-` are both INSIDE the preserved class
 * `[^a-z0-9._-]`, so only `/` is rewritten. `a.b/c` → `a.b-c` and `a-b-c` stays `a-b-c` — two
 * different slugs. The real pair is `a.b/c` / `a.b-c`, and `A.B/C` joins them via the lowercase
 * step. The conclusion the wrong witness was offered for is unchanged and is the reason this
 * function exists: the slug is lossy, so it is never an identity key.
 */
export function registryCollisions(snapshot: RegistrySnapshot): RegistryCollision[] {
  const bySlug = new Map<string, string[]>()
  for (const entry of snapshot.entries) {
    const slug = registryCanonicalName(entry.name)
    const names = bySlug.get(slug)
    if (names === undefined) bySlug.set(slug, [entry.name])
    else names.push(entry.name)
  }
  return [...bySlug.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([canonicalName, names]) => ({ canonicalName, entryNames: [...names].sort() }))
    .sort((a, b) => (a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0))
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
 *
 * THAT ELECTION IS A PATH DECISION, NOT AN IDENTITY DECISION — clarified by R-3, which is
 * why `registryCollisions` now exists beside it. Keeping the first entry answers "which file
 * owns this path"; it does NOT establish that the colliding entries are the same product, and
 * reading it as though it did is how one product's evidence would reach another's page. The
 * election stays exactly as it is (the served bytes depend on it, `incompleteReason` included);
 * the collision is now also reported, so identity resolution can refuse the merge instead of
 * inheriting a silent winner.
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
      // Carried through rather than dropped (R-10). This is the entry's UPSTREAM release instant,
      // which is a different fact from `observedAt` (when WE looked) — the distinction gaps §1.4
      // recorded when it noted `publishedAt` "measures the upstream release, not our observation".
      // 18 of the 19 committed entries carry one; the null is passed through as null, never
      // defaulted to `fetchedAt`, which would silently equate the two facts.
      publishedAt: entry.publishedAt,
    }
  })

  return plans.sort((a, b) =>
    a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0,
  )
}
