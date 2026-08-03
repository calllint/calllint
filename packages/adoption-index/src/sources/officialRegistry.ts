/**
 * officialRegistry — the Official MCP Registry source adapter (§9.4).
 *
 * This is a MIRROR, not a replacement for the shipped ingestion edge. The relationship,
 * because it decides what may change:
 *
 *   `packages/trust-index/src/fetchRegistry.ts` does one GET, keeps `active` + `isLatest`,
 *   sorts by name, and slices to 25. Those 25 are the 25 ALPHABETICALLY FIRST, not the 25
 *   most recent, and the committed snapshot they produce feeds a reproducibility gate.
 *
 * So this adapter mirrors the FULL cursor-paginated source into `source_records`, and the
 * committed snapshot is then PROJECTED from the mirror using the same filter, the same
 * sort, and the same slice (see projections/snapshotProjection.ts). Unchanged upstream ⇒
 * byte-identical snapshot. Any other arrangement changes which records exist and moves
 * bytes that a green gate is watching.
 *
 * §9.4's checklist, and where each item lives:
 *   full cursor pagination        → `fullSync`, `nextCursor` from the source's own metadata
 *   incremental updated_since     → `incrementalSync`, watermark from the checkpoint
 *   safety overlap window         → `OVERLAP_WINDOW_MS`, subtracted from the watermark
 *   digest deduplication          → the store's UNIQUE(source, nativeId, payloadDigest)
 *   weekly full reconciliation    → the caller's schedule; `fullSync` is always available
 *   checkpoint after durable commit → `syncSource`, one transaction
 */
import { hashJson } from "@calllint/fingerprint"
import type { SourceCheckpoint } from "../domain/checkpoint.js"
import type {
  SourcePackageRef,
  SourceRecordV1,
  SourceRemoteRef,
  SourceLifecycleStatus,
} from "../domain/sourceRecord.js"
import { SOURCE_RECORD_SCHEMA } from "../domain/sourceRecord.js"
import type { SourceAdapter, SourceSyncContext, SyncOutcome } from "./sourceAdapter.js"

export const OFFICIAL_REGISTRY_SOURCE_ID = "official-mcp-registry"
export const DEFAULT_ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"

/** Default page-count ceiling. A cursor that never terminates must not spin forever. */
export const DEFAULT_MAX_PAGES = 40

/**
 * The §9.4 safety overlap window: 24 hours subtracted from the stored watermark before
 * it is sent as `updated_since`.
 *
 * WHY an overlap at all. Two independent races make an exact watermark lossy. A record
 * published at the same second the previous run cut off can be missed entirely, and a
 * source whose `publishedAt` is assigned before its record becomes queryable can publish
 * "into the past" relative to a watermark already advanced past it. Re-reading a day of
 * overlap costs nothing — the store deduplicates by payload digest, so an already-seen
 * record refreshes `last_seen_at` and inserts no row — while a missed record is invisible
 * until a weekly full reconciliation catches it.
 */
export const OVERLAP_WINDOW_MS = 24 * 60 * 60 * 1000

interface RawServer {
  name?: unknown
  description?: unknown
  version?: unknown
  repository?: { url?: unknown } | null
  packages?: unknown
  remotes?: unknown
}
interface RawMeta {
  status?: unknown
  isLatest?: unknown
  publishedAt?: unknown
  updatedAt?: unknown
}
interface RawItem {
  server?: RawServer
  _meta?: Record<string, RawMeta | undefined>
}
interface RawPage {
  servers?: RawItem[]
  metadata?: { nextCursor?: unknown; next_cursor?: unknown } | null
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)

function normalizePackages(raw: unknown): SourcePackageRef[] {
  if (!Array.isArray(raw)) return []
  const out: SourcePackageRef[] = []
  for (const p of raw) {
    const rec = p as Record<string, unknown> | null
    const identifier = str(rec?.identifier)
    const registryType = str(rec?.registryType)
    if (!identifier || !registryType) continue
    out.push({
      registryType,
      identifier,
      version: str(rec?.version),
      transport: str(rec?.transport),
    })
  }
  return out
}

function normalizeRemotes(raw: unknown): SourceRemoteRef[] {
  if (!Array.isArray(raw)) return []
  const out: SourceRemoteRef[] = []
  for (const r of raw) {
    const rec = r as Record<string, unknown> | null
    const url = str(rec?.url)
    if (!url) continue
    out.push({ type: str(rec?.type) ?? "", url })
  }
  return out
}

/**
 * Map a source lifecycle string onto the four states §7.1 admits.
 *
 * An unrecognized status becomes `unknown`, never `active`. "UNKNOWN is not SAFE" is a
 * product principle, and a source that invents a fifth status must not have it silently
 * read as healthy.
 */
export function normalizeLifecycle(raw: unknown): SourceLifecycleStatus {
  switch (str(raw)) {
    case "active":
      return "active"
    case "deprecated":
      return "deprecated"
    case "deleted":
      return "deleted"
    default:
      return "unknown"
  }
}

/**
 * Convert one raw item to a SourceRecordV1.
 *
 * NOTE what is NOT filtered here: `active` and `isLatest`. The mirror stores the source's
 * full observation including deprecated and non-latest records, because R-2's change
 * detector needs the history and a `deleted` record is evidence, not noise. The
 * active+isLatest filter belongs to the PROJECTION, where the shipped snapshot applies it.
 *
 * `payloadDigest` is computed over the raw item, so a change anywhere in the source's
 * bytes produces a new digest and therefore a new row.
 */
export function toSourceRecord(item: RawItem, retrievedAt: string): SourceRecordV1 | null {
  const s = item.server
  const name = str(s?.name)
  if (!name) return null
  const meta = item._meta?.[OFFICIAL_META]

  const record: SourceRecordV1 = {
    schema: SOURCE_RECORD_SCHEMA,
    source: {
      sourceId: OFFICIAL_REGISTRY_SOURCE_ID,
      sourceType: "official-mcp-registry",
      // The registry's stable native key is the server name. A version-qualified id
      // would make every republish a new subject instead of a new observation.
      sourceRecordId: name,
      retrievedAt,
      payloadDigest: hashJson(item),
    },
    claimedIdentity: {
      packages: normalizePackages(s?.packages),
      remotes: normalizeRemotes(s?.remotes),
    },
    lifecycle: {
      status: normalizeLifecycle(meta?.status),
    },
  }

  // Optional fields are ASSIGNED ONLY WHEN PRESENT. Writing `undefined` would serialize
  // differently from omitting the key under JSON.stringify in some shapes, and the
  // payload is digested — an absent field and a present-but-undefined one must not be
  // able to produce two digests for one observation.
  const canonicalName = str(s?.name)
  if (canonicalName) record.claimedIdentity.canonicalName = canonicalName
  const version = str(s?.version)
  if (version) record.claimedIdentity.version = version
  const repositoryUrl = str(s?.repository?.url)
  if (repositoryUrl) record.claimedIdentity.repositoryUrl = repositoryUrl
  if (typeof meta?.isLatest === "boolean") record.lifecycle.isLatest = meta.isLatest
  const publishedAt = str(meta?.publishedAt)
  if (publishedAt) record.lifecycle.publishedAt = publishedAt

  // Publisher-supplied prose is quarantined in its own labelled object (§7.1). It is
  // stored because the projection needs the description, and it is named `untrusted…`
  // so no reader can mistake it for verified fact.
  const description = str(s?.description)
  if (description) record.untrustedPublisherContent = { description }

  return record
}

function readNextCursor(page: RawPage): string | null {
  const meta = page.metadata
  return str(meta?.nextCursor) ?? str(meta?.next_cursor)
}

/** Append a query parameter without assuming the endpoint has no query string already. */
function withParams(endpoint: string, params: Record<string, string>): string {
  const url = new URL(endpoint)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

/**
 * Subtract the safety overlap from a watermark. Returns null for an unparseable input so
 * the caller falls back to an unfiltered read rather than sending a garbage filter — a
 * bad `updated_since` could otherwise silently return zero records and look like
 * "nothing changed".
 */
export function overlappedWatermark(updatedSince: string | null, windowMs = OVERLAP_WINDOW_MS): string | null {
  if (updatedSince === null) return null
  const t = Date.parse(updatedSince)
  if (Number.isNaN(t)) return null
  return new Date(t - windowMs).toISOString()
}

async function* paginate(
  endpoint: string,
  ctx: SourceSyncContext,
  updatedSince: string | null,
): AsyncIterable<SourceRecordV1> {
  const maxPages = ctx.maxPages ?? DEFAULT_MAX_PAGES
  let cursor: string | null = null
  let pages = 0
  let yielded = 0

  do {
    const params: Record<string, string> = {}
    if (cursor !== null) params.cursor = cursor
    if (updatedSince !== null) params.updated_since = updatedSince
    const url = Object.keys(params).length > 0 ? withParams(endpoint, params) : endpoint

    const res = await ctx.fetchImpl(url)
    if (!res.ok) throw new Error(`registry fetch failed: HTTP ${res.status}`)
    const page = (await res.json()) as RawPage
    pages += 1

    for (const item of Array.isArray(page.servers) ? page.servers : []) {
      const record = toSourceRecord(item, ctx.retrievedAt)
      if (record === null) continue
      yield record
      yielded += 1
      if (yielded >= ctx.maxEntries) return
    }

    const next = readNextCursor(page)
    // A source that echoes the same cursor back would loop forever; treat a repeat as
    // the end of the read rather than trusting the source to terminate.
    cursor = next !== null && next !== cursor ? next : null
  } while (cursor !== null && pages < maxPages)
}

export function createOfficialRegistryAdapter(endpoint: string = DEFAULT_ENDPOINT): SourceAdapter {
  return {
    sourceId: OFFICIAL_REGISTRY_SOURCE_ID,

    fullSync(ctx: SourceSyncContext): AsyncIterable<SourceRecordV1> {
      return paginate(endpoint, ctx, null)
    },

    incrementalSync(checkpoint: SourceCheckpoint, ctx: SourceSyncContext): AsyncIterable<SourceRecordV1> {
      this.validateCheckpoint(checkpoint)
      return paginate(endpoint, ctx, overlappedWatermark(checkpoint.updatedSince))
    },

    validateCheckpoint(checkpoint: SourceCheckpoint): void {
      if (checkpoint.sourceId !== OFFICIAL_REGISTRY_SOURCE_ID) {
        throw new Error(
          `checkpoint belongs to source ${checkpoint.sourceId}, not ${OFFICIAL_REGISTRY_SOURCE_ID}`,
        )
      }
      if (checkpoint.updatedSince !== null && Number.isNaN(Date.parse(checkpoint.updatedSince))) {
        throw new Error(`checkpoint updatedSince is not a parseable timestamp: ${checkpoint.updatedSince}`)
      }
    },
  }
}

/** The highest `publishedAt` across records, or null when none carried one. */
export function highWaterMark(records: readonly SourceRecordV1[]): string | null {
  let best: string | null = null
  let bestT = Number.NEGATIVE_INFINITY
  for (const r of records) {
    const p = r.lifecycle.publishedAt
    if (!p) continue
    const t = Date.parse(p)
    if (Number.isNaN(t) || t <= bestT) continue
    bestT = t
    best = p
  }
  return best
}

export type { SyncOutcome }
