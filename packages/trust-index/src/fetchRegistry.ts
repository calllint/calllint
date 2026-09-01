/**
 * fetchRegistry — the IMPURE ingestion edge (ADR 0038 §3: ingestion is a separate,
 * offline-style pipeline decoupled from serving). This is the ONLY module that does
 * network I/O, and it runs ONLY in the scheduled Actions workflow — never in serving,
 * never in the pure bake path, never in CI's reproducibility gate (CI re-bakes from
 * the committed snapshot this produces).
 *
 * It pulls the Official MCP Registry, keeps only `active` + `isLatest` entries (the
 * live, current cohort), caps the count (ADR 0038 §6: start small, not a crawl), and
 * normalizes each to the PII-free `SnapshotEntry` subset — dropping publisher contact
 * info, keywords, and categories (ADR 0038 §5). `fetchedAt` is captured once here and
 * carried in the snapshot so the downstream bake is reproducible.
 */
import type { RegistrySnapshot, SnapshotEntry, SnapshotPackage, SnapshotRemote } from "./snapshot.js"

export const DEFAULT_ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers"

/**
 * How many entries a cohort caps at (ADR 0038 §6 kill-gate; ADR 0074 raised it 25 → 100).
 *
 * **This number must never equal `S0_REQUIRED_RECORDS` (`scripts/gate-s0.ts`).** While both were
 * 25, the cohort size that satisfied Gate S0's requirement was the same size at which this cap
 * began evicting, and `io.github.calllint/calllint` sorts LAST in the cohort (reverse-DNS; the only
 * `io.*` name). So the action that closed S0's shortfall was the same action that deleted this
 * project's own trust page, and the gate reported success while it happened — S0-OPEN-4's
 * arithmetic. The inequality, not this value, is what defuses it; both are asserted by
 * `tests/invariants/registry-cohort-retention.invariants.test.ts`.
 *
 * The cap CANNOT remove that eviction, only defer it: at any cap the claimed subject is evicted at
 * cohort `cap + 1`, because the slice is alphabetical (`snapshotProjection.ts` step 3). Measured —
 * 25 → evicts at 26, 100 → evicts at 101, 500 → evicts at 501. Headroom is bought, not safety, and
 * ADR 0074 records that deliberately rather than presenting this as a fix.
 */
export const DEFAULT_MAX_ENTRIES = 100

/**
 * Cumulative coverage growth step — how many entries to add per scheduled run.
 * (Cumulative Coverage Amendment v1, Section E)
 */
export const CUMULATIVE_COVERAGE_STEP = 50

/**
 * Cumulative coverage hard ceiling — automatic growth stops at this count.
 * Manual operator overrides can still exceed it (Amendment Case 4).
 * (Cumulative Coverage Amendment v1, Section E)
 */
export const CUMULATIVE_COVERAGE_CEILING = 500

/**
 * The cap that produced a COMMITTED cohort of `count` entries — the served cohort cap at HEAD.
 *
 * WHY THIS EXISTS. Before the Cumulative Coverage Amendment, `DEFAULT_MAX_ENTRIES` *was* the cap:
 * one constant, and every guard that needed "today's cap" read it. The Amendment made the cap a
 * FUNCTION of the previous run (`resolveMaxEntries`: `min(CEILING, max(DEFAULT, prev + STEP))`) and
 * demoted this constant to the curve's STARTING POINT. Four assertions kept reading the constant,
 * so at cohort 150 they were handed 100 — and each failed honestly, reporting that the cap it was
 * given could not have produced the cohort it was measuring. `headroom` went to -50 and the probes
 * it feeds would have silently constructed cohorts SMALLER than the committed one; the overlap
 * scan's bound went negative and its loop stopped executing. A guard reading a number that is no
 * longer its subject is this repo's dominant fault class, not a cosmetic drift (ADR 0091).
 *
 * WHAT IT RETURNS. The smallest growth-curve point at or above `count`. The curve is
 * `DEFAULT_MAX_ENTRIES + k * CUMULATIVE_COVERAGE_STEP`, clamped at the ceiling. Since ingestion
 * only ever commits a cohort produced by exactly such a cap, the point at or above `count` IS the
 * cap that produced it — no snapshot field required, which is why this is a derivation and not a
 * schema change (a new `maxEntries` key would move the snapshot bytes, and those bytes feed
 * `artifactDigest`/`pageDigest`).
 *
 * NOT A LOOSENING. `servedCohortCap(DEFAULT_MAX_ENTRIES) === DEFAULT_MAX_ENTRIES`, so in the
 * pre-Amendment regime every caller reads exactly what it read before: this generalizes the READER
 * and leaves all four assertions at full strength. Asserted directly, at that boundary, in
 * `tests/invariants/cohort-cap-derivation.invariants.test.ts`.
 *
 * ABOVE THE CEILING it returns `count` unchanged. A manual override may commit more than 500
 * (Amendment Case 4), and clamping to 500 there would hand a guard a cap BELOW the cohort — the
 * exact failure this function exists to remove, reintroduced at the one boundary an operator
 * reaches by hand.
 */
export function servedCohortCap(count: number): number {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`servedCohortCap needs a non-negative integer cohort count, got ${count}`)
  }
  if (count >= CUMULATIVE_COVERAGE_CEILING) return count
  const steps = Math.max(0, Math.ceil((count - DEFAULT_MAX_ENTRIES) / CUMULATIVE_COVERAGE_STEP))
  return Math.min(CUMULATIVE_COVERAGE_CEILING, DEFAULT_MAX_ENTRIES + steps * CUMULATIVE_COVERAGE_STEP)
}

/**
 * Names the cohort slice must never evict, in the REGISTRY'S OWN KEY SPACE (reverse-DNS,
 * with the `/`). ADR 0075.
 *
 * Why this list exists: the slice is alphabetical, `io.github.calllint/calllint` is the only
 * `io.*` name upstream, so it sorts LAST and is the FIRST entry an alphabetical cap reaches.
 * ADR 0074 raised the cap 25 → 100 and measured that a cap can only DEFER that eviction
 * (25 → evicts at 26, 100 → at 101, 500 → at 501). This list removes it: at any cap, at any
 * cohort size, a reserved name that is in the live cohort is in the output.
 *
 * **Keyed on the registry name, NEVER on the slug, and matched by EXACT EQUALITY.**
 * `registryCanonicalName` lowercases and maps every `[^a-z0-9._-]` run to `-`, so
 * `io.github.calllint-calllint`, `IO.GITHUB.CALLLINT/CALLLINT` and
 * `io.github.calllint/CALLLINT` all collide onto the one slug
 * `mcp-registry/io.github.calllint-calllint` — measured, not supposed. Worse, `-` (45) sorts
 * before `/` (47), so an upstream publisher who registered the literal name
 * `io.github.calllint-calllint` would sort BEFORE the real subject AND be indistinguishable
 * from it by slug. A slug-keyed exemption is therefore impersonable. Exact equality over the
 * original name is the same defence `claim.ts`'s `namespaceCovers` already applies for the
 * same reason (`claim.ts:166-173`: a `startsWith` would let this account cover a foreign
 * `io.github.calllint-evil/*`).
 *
 * This is a STATIC constant on purpose. `refreshFromMirror.ts:290-296` records that feeding
 * any part of resolved identity into the projection's input breaks the byte-reproducibility
 * gate, so the reserved set may not be a claim-store lookup — even though
 * `claims/claim-store.json` does hold an active verified claim for exactly this subject.
 *
 * Duplicated verbatim in `adoption-index/src/projections/snapshotProjection.ts` rather than
 * imported: that package has zero imports of this one and the import-boundary gate keeps it
 * that way (`snapshotProjection.ts:27-32`). The equivalence is asserted behaviourally, by
 * byte-comparing both implementations over identical input.
 */
export const RESERVED_COHORT_NAMES: readonly string[] = ["io.github.calllint/calllint"]

/**
 * Apply the cap as a RETAINED+RESERVED-FIRST selection (Cumulative Coverage Amendment v1, §D).
 *
 * Previously published names (retainedNames) are sticky: they survive even when new entries
 * sort before them alphabetically. Reserved names (RESERVED_COHORT_NAMES) remain protected.
 * Remaining slots are filled deterministically from alphabetically-first candidates.
 *
 * Contract, and every clause of it is asserted:
 *   - output stays sorted ascending by `name` (the bake and `presentation-lock.json` read
 *     cohort order; the claimed subject holds the last position in both)
 *   - `output.length === min(entries.length, max)` — the cap stays an absolute ceiling, so
 *     a retained/reserved name takes a slot, never an extra one. At `max === 0` the output is empty.
 *   - every retained name present in `entries` is present in the output (Amendment §D step 4)
 *   - every reserved name present in `entries` is present in the output whenever `max >= 1`
 *   - when retainedNames is omitted/empty and cap does not bind, this IS the old bare sort
 *
 * @param entries - Current live entries (already filtered to active+isLatest)
 * @param max - Absolute ceiling on output size
 * @param retainedNames - Previously published registry names (optional; enables cumulative coverage)
 */
export function selectCohortEntries<T extends { readonly name: string }>(
  entries: readonly T[],
  max: number,
  retainedNames?: readonly string[],
): T[] {
  const byName = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (byName.length <= max) return byName

  // A negative cap emits nothing (Amendment §D preserves this invariant from prior logic)
  if (max < 0) return []

  const retained = retainedNames ?? []
  const isRetained = (e: T): boolean => retained.includes(e.name)
  const isReserved = (e: T): boolean => RESERVED_COHORT_NAMES.includes(e.name)

  // Step 2-3 (Amendment §D): partition into retained, reserved (minus already-retained), and candidates
  const retainedPresent = byName.filter(isRetained)
  const reservedPresent = byName.filter((e) => isReserved(e) && !isRetained(e)).slice(0, max)

  // Step 4-5 (Amendment §D): fail closed if retained+reserved exceeds cap
  if (retainedPresent.length + reservedPresent.length > max) {
    throw new Error(
      `Cumulative coverage conflict: ${retainedPresent.length} retained + ${reservedPresent.length} reserved > ${max} cap`,
    )
  }

  // Step 6 (Amendment §D): fill remaining slots from alphabetically-first candidates
  const candidates = byName.filter((e) => !isRetained(e) && !isReserved(e))
  const remaining = max - retainedPresent.length - reservedPresent.length
  // `Math.max(0, …)` guards against negative `max` (Amendment §D unchanged from prior logic)
  const selected = candidates.slice(0, Math.max(0, remaining))

  // Step 7 (Amendment §D): final sort by name
  return [...retainedPresent, ...reservedPresent, ...selected].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
}

interface RawServer {
  name?: unknown
  description?: unknown
  version?: unknown
  repository?: { url?: unknown } | null
  packages?: unknown
  remotes?: unknown
}
interface RawItem {
  server?: RawServer
  _meta?: Record<string, { status?: unknown; isLatest?: unknown; publishedAt?: unknown } | undefined>
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)

function normalizePackages(raw: unknown): SnapshotPackage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((p): SnapshotPackage | null => {
      const id = str((p as Record<string, unknown>)?.identifier)
      const rt = str((p as Record<string, unknown>)?.registryType)
      if (!id || !rt) return null
      return {
        registryType: rt,
        identifier: id,
        version: str((p as Record<string, unknown>).version),
        transport: str((p as Record<string, unknown>).transport),
      }
    })
    .filter((p): p is SnapshotPackage => p !== null)
}

function normalizeRemotes(raw: unknown): SnapshotRemote[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r): SnapshotRemote | null => {
      const url = str((r as Record<string, unknown>)?.url)
      if (!url) return null
      return { type: str((r as Record<string, unknown>).type) ?? "", url }
    })
    .filter((r): r is SnapshotRemote => r !== null)
}

const OFFICIAL_META = "io.modelcontextprotocol.registry/official"

/**
 * An email-like token in upstream free text. Byte-identical to `claim.ts:79` and to
 * `check-public-copy.mjs:439` — the guard this redaction exists to satisfy. Three copies of one
 * regex is deliberate: each is a defense at a different plane (store, boundary, served bytes), and
 * a shared import would let one edit silently retire all three.
 */
const EMAIL_LIKE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

/**
 * Strip email-like tokens from upstream free text.
 *
 * WHY THIS EXISTS (2026-09-01, ADR 0096). `toSnapshotEntry` has claimed "the PII-free subset" since
 * commit one, and the module docblock says it drops "publisher contact" — true of the FIELDS it
 * selects, and false of their CONTENTS. `description` is upstream free text and was copied verbatim,
 * so a publisher who writes their address into the description walked it straight onto a served page.
 *
 * `ai.byteray/byteray-mcp` did exactly that ("… invite: hi@byteray.ai") and `check:public-copy` #17
 * caught it on the served bytes — the last guard before publication, and the only one that could
 * still see it. Selecting a PII-free field set is not the same as producing PII-free values; the
 * docblock asserted the second while implementing the first.
 *
 * Redacted rather than dropped: the description is the page's only human-readable summary, and
 * discarding it to remove one token would degrade 199 clean pages' worth of surface to defend
 * against a rare one. The marker is visible so the redaction is auditable rather than silent.
 */
function redactPii(text: string): string {
  return text.replace(EMAIL_LIKE, "[contact redacted]")
}

/** Keep only active + isLatest entries; normalize to the PII-free subset. */
function toSnapshotEntry(item: RawItem): SnapshotEntry | null {
  const s = item.server
  const meta = item._meta?.[OFFICIAL_META]
  const name = str(s?.name)
  if (!name) return null
  if (str(meta?.status) !== "active" || meta?.isLatest !== true) return null
  return {
    name,
    description: redactPii(str(s?.description) ?? ""),
    version: str(s?.version),
    repositoryUrl: str(s?.repository?.url),
    packages: normalizePackages(s?.packages),
    remotes: normalizeRemotes(s?.remotes),
    status: "active",
    publishedAt: str(meta?.publishedAt),
  }
}

/**
 * Fetch the registry and build a snapshot. `now` and `fetch` are injected so the
 * workflow controls the clock and tests can stub the network — this module stays
 * the only place a real fetch happens. Entries are sorted by name and capped by
 * `selectCohortEntries`, which reserves `RESERVED_COHORT_NAMES` and optionally
 * retains previously-published names (Cumulative Coverage Amendment v1).
 */
export async function fetchRegistrySnapshot(opts: {
  now: string
  endpoint?: string
  maxEntries?: number
  fetchImpl?: typeof fetch
  /** Previously published registry names (Cumulative Coverage Amendment v1, §G1) */
  retainedNames?: readonly string[]
}): Promise<RegistrySnapshot> {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT
  const max = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  const doFetch = opts.fetchImpl ?? fetch

  const res = await doFetch(endpoint)
  if (!res.ok) throw new Error(`registry fetch failed: HTTP ${res.status}`)
  const body = (await res.json()) as { servers?: RawItem[] }
  const items = Array.isArray(body.servers) ? body.servers : []

  const entries = selectCohortEntries(
    items.map(toSnapshotEntry).filter((e): e is SnapshotEntry => e !== null),
    max,
    opts.retainedNames,
  )

  return {
    schema: "calllint.trust-snapshot.v0",
    source: "official-mcp-registry",
    endpoint,
    fetchedAt: opts.now,
    count: entries.length,
    entries,
  }
}
