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

/** How many entries the first cohort caps at (ADR 0038 §6 kill-gate; user-chosen). */
export const DEFAULT_MAX_ENTRIES = 25

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
 * the only place a real fetch happens. Entries are sorted by name and capped.
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

  const entries = items
    .map(toSnapshotEntry)
    .filter((e): e is SnapshotEntry => e !== null)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, max)

  return {
    schema: "calllint.trust-snapshot.v0",
    source: "official-mcp-registry",
    endpoint,
    fetchedAt: opts.now,
    count: entries.length,
    entries,
  }
}
