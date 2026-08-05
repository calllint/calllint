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

/**
 * Default page-count ceiling. A cursor that never terminates must not spin forever.
 *
 * BOUNDED FROM BOTH SIDES, and the upper bound is the part that is easy to miss. Below, the
 * ceiling must clear the source or every run truncates. Above, it must stay REACHABLE INSIDE
 * THE JOB'S WALL-CLOCK BUDGET — because a ceiling the run cannot reach in time is not the
 * limit that binds. The job timeout is, and a timeout is a SILENT truncation: the runner kills
 * the process, no `MirrorIncompleteError` is ever constructed, and the guard this file exists
 * to feed is simply bypassed. A number chosen only for headroom can therefore disable the
 * fail-closed path by being too large.
 *
 * All three inputs are MEASURED, none assumed:
 *   - page size 100 — the source's hard maximum (`limit=101`/`200`/`500`/`999` all HTTP 422)
 *   - source size — walked TO EXHAUSTION 2026-08-04: `pages=653 total=65235 elapsed=7090s`
 *   - throughput — 7090s / 653 pages ≈ 10.9 s/page against this source
 *
 * So 1000 pages x `PAGE_SIZE` = 100_000 records ≈ 1.53x the measured source, and reaching that
 * ceiling costs ≈ 10_900s ≈ 181 min against the ingest job's pinned 300-min budget
 * (`trust-ingest.yml`). Both inequalities hold with room: 65_235 < 100_000, and 181 min < 300 min.
 * 2000 pages would satisfy the first and BREAK the second — ≈362 min, past the budget and past
 * GitHub's own 360-min job maximum — which is precisely the failure mode where a bigger number
 * looks safer and is not.
 *
 * TWO PRIOR FIGURES HERE WERE WRONG, BOTH THE SAME WAY. This docblock said "well over 21_000
 * (a walk stopped at 210 pages was still not exhausted)" and before that reasoned from the
 * SNAPSHOT's 19-of-25 occupancy. 21_000 was 210 pages x 100 — the PROBE'S OWN CEILING, not the
 * source's size; a second probe capped at 500 pages duly reported "50_000+" for the same
 * reason. Only a walk that ran to `reason=exhausted` measured the source. House rule, turned on
 * my own instruments: suspect the probe before the source.
 *
 * It is still a CEILING and still fails closed — `assertMirrorComplete` refuses to project past
 * it rather than shipping a short snapshot.
 */
export const DEFAULT_MAX_PAGES = 1000

/**
 * Records requested per page.
 *
 * The source's own default is 30, and `paginate` previously sent no `limit` at all, so it took
 * that 30. That made the page ceiling bind 3.3x sooner than necessary — the SAME number of
 * HTTP round trips carries 3.3x the records. Measured: `limit=100` returns 100 records,
 * `limit=101`/`200`/`500`/`999` are all refused with HTTP 422, so 100 is the source's hard
 * maximum rather than a number chosen here.
 *
 * Fewer, larger requests is also the politer read, and it is what makes the source reachable at
 * all: the full walk measured 653 pages / 65_235 records / 7090s at 100 per page. The same
 * records at the source's default 30 per page would be 2_175 requests and, at the measured
 * ~10.9s per request, roughly 6.6 hours — past GitHub's 360-minute job maximum. At 30/page this
 * source cannot be mirrored in one job at any page ceiling.
 */
export const PAGE_SIZE = 100

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
    // `limit` is sent on EVERY request, including the first. Omitting it took the source's
    // default of 30 and made the page ceiling bind 3.3x sooner for the same round trips.
    const params: Record<string, string> = { limit: String(PAGE_SIZE) }
    if (cursor !== null) params.cursor = cursor
    if (updatedSince !== null) params.updated_since = updatedSince
    const url = withParams(endpoint, params)

    const res = await ctx.fetchImpl(url)
    if (!res.ok) throw new Error(`registry fetch failed: HTTP ${res.status}`)
    const page = (await res.json()) as RawPage
    pages += 1

    for (const item of Array.isArray(page.servers) ? page.servers : []) {
      const record = toSourceRecord(item, ctx.retrievedAt)
      if (record === null) continue
      yield record
      yielded += 1
      // The record cap. Reported even though the caller can also infer this one from
      // `records.length`, so that ALL THREE exits arrive on one channel — a caller that
      // handles truncation should not have to handle two of them differently.
      if (yielded >= ctx.maxEntries) {
        ctx.onTruncated?.("record-cap")
        return
      }
    }

    const next = readNextCursor(page)
    // A source that echoes the same cursor back would loop forever; treat a repeat as
    // the end of the read rather than trusting the source to terminate. That is a
    // SOURCE-SIDE fault, not exhaustion, so it is reported: `next === null` means the
    // source said there is no more, while `next === cursor` means it said there is more
    // and then failed to advance. Collapsing both to `cursor = null` — as this did — makes
    // a broken cursor indistinguishable from a complete read.
    if (next !== null && next === cursor) {
      ctx.onTruncated?.("cursor-repeat")
      return
    }
    cursor = next
  } while (cursor !== null && pages < maxPages)

  // Fell out of the loop with a cursor still in hand ⇒ the page ceiling bound, not the
  // source. THIS is the exit that was silent: `capReached` is computed by the caller as
  // `records.length >= maxEntries`, which is false here, so a truncated mirror was passing
  // `assertMirrorComplete` as complete.
  if (cursor !== null) ctx.onTruncated?.("page-cap")
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
