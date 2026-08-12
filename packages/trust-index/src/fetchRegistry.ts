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
 * Apply the cap as a RESERVED-FIRST selection instead of a bare alphabetical prefix.
 *
 * Contract, and every clause of it is asserted:
 *   - output stays sorted ascending by `name` (the bake and `presentation-lock.json` read
 *     cohort order; the claimed subject holds the last position in both)
 *   - `output.length === min(entries.length, max)` — the cap stays an absolute ceiling, so
 *     a reserved name takes a slot, never an extra one. At `max === 0` the output is empty:
 *     the caller asked for nothing, and the cap wins over the reservation.
 *   - every reserved name present in `entries` is present in the output whenever `max >= 1`
 *   - when the cap does not bind, this IS the old bare sort
 *
 * That last clause is why today's committed bytes cannot move: the cohort is 19 against a cap
 * of 100, so control returns at the early exit and never reaches the partition. Zero movement
 * is structural here, not a coincidence to be re-measured each batch.
 */
export function selectCohortEntries<T extends { readonly name: string }>(entries: readonly T[], max: number): T[] {
  const byName = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (byName.length <= max) return byName
  const isReserved = (e: T): boolean => RESERVED_COHORT_NAMES.includes(e.name)
  const reserved = byName.filter(isReserved).slice(0, max)
  // `Math.max(0, …)` matters ONLY for a negative `max`, and that is the measured shape, not the
  // one this comment first claimed. `reserved` is itself sliced to `max`, so `reserved.length <= max`
  // and the budget cannot go negative on its own for any `max >= 0` — at `max === 0` it is exactly 0.
  // A negative `max` is where it bites, and it bites backwards: `slice(0, -1)` means "all but the
  // last" in JS, so unclamped, `max === -1` returns TWO entries from a four-name cohort and `-2`
  // returns one — the more negative the ceiling, the MORE the function admits. Measured, then
  // pinned by the `max < 0` case in `registry-cohort-retention.invariants.test.ts`, so this line
  // now has a failing mode of its own rather than resting on prose.
  const rest = byName.filter((e) => !isReserved(e)).slice(0, Math.max(0, max - reserved.length))
  return [...reserved, ...rest].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
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

/** Keep only active + isLatest entries; normalize to the PII-free subset. */
function toSnapshotEntry(item: RawItem): SnapshotEntry | null {
  const s = item.server
  const meta = item._meta?.[OFFICIAL_META]
  const name = str(s?.name)
  if (!name) return null
  if (str(meta?.status) !== "active" || meta?.isLatest !== true) return null
  return {
    name,
    description: str(s?.description) ?? "",
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
 * `selectCohortEntries`, which reserves `RESERVED_COHORT_NAMES` against the cap.
 */
export async function fetchRegistrySnapshot(opts: {
  now: string
  endpoint?: string
  maxEntries?: number
  fetchImpl?: typeof fetch
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
