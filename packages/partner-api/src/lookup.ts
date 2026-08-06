import type { AssetReader, ApiEnvelope, EnvelopePublisher, EnvelopeFreshness } from "./types.js"
import { API_SCHEMA, FRESHNESS_STATES } from "./types.js"

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

export function isDigest(s: string): boolean {
  return DIGEST_RE.test(s)
}

export interface IndexEntry {
  canonicalName: string
  status: string
  artifactDigest?: string
  pageDigest?: string
  verdict?: string
  observedAt?: string
  /**
   * The freshness projection (S-2). It lives HERE and not on the sidecar because
   * `observedAt` is sealed inside `pageDigest`, so a freshness field in the page body
   * would make every page digest a function of the wall clock. That is why the envelope
   * needs the entry as well as the sidecar — the two carry different halves.
   */
  freshness?: unknown
}

/** Read + parse the committed index; null if absent/malformed. */
export async function loadIndex(read: AssetReader): Promise<{ entries: IndexEntry[] } | null> {
  const text = await read("trust/index.json")
  if (text == null) return null
  try {
    const j = JSON.parse(text) as { entries?: IndexEntry[] }
    return { entries: Array.isArray(j.entries) ? j.entries : [] }
  } catch {
    return null
  }
}

/** Find a *baked* entry by canonicalName. */
export function findByName(idx: { entries: IndexEntry[] }, name: string): IndexEntry | null {
  return idx.entries.find((e) => e.canonicalName === name && e.status === "baked") ?? null
}

/** Find a *baked* entry by artifact digest. */
export function findByDigest(idx: { entries: IndexEntry[] }, digest: string): IndexEntry | null {
  return idx.entries.find((e) => e.artifactDigest === digest && e.status === "baked") ?? null
}

/** Load a sidecar for a canonicalName; null if the file is absent/malformed. */
export async function loadSidecar(read: AssetReader, canonicalName: string): Promise<Record<string, unknown> | null> {
  const text = await read(`trust/${canonicalName}.json`)
  if (text == null) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Load the Evidence Manifest sibling (`{name}.manifest.json`) for a canonicalName;
 * null if absent/malformed. The manifest is a committed, digest-addressed projection
 * of the page (PR-D4) — read verbatim like the sidecar, never resolved or re-scored.
 */
export async function loadManifest(read: AssetReader, canonicalName: string): Promise<Record<string, unknown> | null> {
  const text = await read(`trust/${canonicalName}.manifest.json`)
  if (text == null) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Wrap a pre-baked sidecar into the versioned public envelope.
 *
 * Takes the index `entry` as well as the sidecar because the two carry different halves
 * of the served truth: the sidecar holds everything inside `pageDigest`, the entry holds
 * the projections deliberately kept OUTSIDE it (`identity` from R-8, `freshness` from
 * S-2). `entry` is optional so a caller with only a sidecar still produces a valid
 * envelope — one that omits `freshness` rather than fabricating it.
 */
export function toEnvelope(
  kind: ApiEnvelope["kind"],
  sidecar: Record<string, unknown>,
  data: unknown,
  entry?: IndexEntry | null,
): ApiEnvelope {
  const s = sidecar as Record<string, unknown>
  const name = typeof s.canonicalName === "string" ? s.canonicalName : ""
  return {
    schema: API_SCHEMA,
    kind,
    canonicalName: name,
    artifactDigest: typeof s.artifactDigest === "string" ? s.artifactDigest : "",
    pageDigest: typeof s.pageDigest === "string" ? s.pageDigest : "",
    verdict: (s.verdict as ApiEnvelope["verdict"]) ?? "UNKNOWN",
    verdictLabel: typeof s.verdictLabel === "string" ? s.verdictLabel : "Insufficient evidence",
    observedAt: typeof s.observedAt === "string" ? s.observedAt : "",
    completeness: typeof s.completeness === "string" ? s.completeness : "unknown",
    // Surface the claim overlay verbatim IFF the baked sidecar carried one. Spread so
    // an absent claim omits the key entirely (existing envelopes are unchanged).
    ...toPublisher(s.verifiedPublisher),
    // Same spread discipline: an entry without freshness omits the key entirely, so a
    // pre-S-2 tree serves byte-identical envelopes.
    ...toFreshness(entry?.freshness),
    trustPageUrl: `/trust/${name}.html`,
    correctionUrl: typeof s.correctionUrl === "string" ? s.correctionUrl : "",
    data,
  }
}

/**
 * Normalize a baked `verifiedPublisher` into `{ verifiedPublisher }` (or `{}`).
 * Defensive: only surfaces an overlay with a non-empty string `owner`, so a
 * malformed baked field can never produce a half-populated claim on the API.
 */
/**
 * Normalize a baked `freshness` into `{ freshness }` (or `{}`).
 *
 * FAILS TO OMISSION, never to a default. A malformed baked value yields `{}` — the key
 * disappears and the consumer sees "not measured". The alternative, substituting a
 * plausible default, would report an unmeasured age as `FRESH`, which is the single most
 * misleading value on this axis; the calculator itself refuses the same input for the
 * same reason. Omission is the honest projection of a value we could not read.
 *
 * `ageDays: null` is VALID and load-bearing (it is exactly the `TIMELESS` case), so the
 * check is `null`-or-finite-number rather than a truthiness test — a truthy test would
 * also throw away a legitimately zero-day age.
 */
function toFreshness(raw: unknown): { freshness?: EnvelopeFreshness } {
  if (!raw || typeof raw !== "object") return {}
  const f = raw as Record<string, unknown>
  // Derived from the exported constant, never re-listed here: a locally re-typed state
  // list would accept a state the mirror does not model, or reject one it does.
  const state = FRESHNESS_STATES.find((s) => s === f.state)
  if (!state) return {}
  const ageOk = f.ageDays === null || (typeof f.ageDays === "number" && Number.isFinite(f.ageDays))
  if (!ageOk) return {}
  if (typeof f.cadenceDays !== "number" || !Number.isFinite(f.cadenceDays)) return {}
  return {
    freshness: {
      ageDays: f.ageDays as number | null,
      state,
      cadenceDays: f.cadenceDays,
      basis: typeof f.basis === "string" ? f.basis : "",
    },
  }
}

function toPublisher(raw: unknown): { verifiedPublisher?: EnvelopePublisher } {
  if (!raw || typeof raw !== "object") return {}
  const p = raw as Record<string, unknown>
  if (typeof p.owner !== "string" || p.owner.length === 0) return {}
  return {
    verifiedPublisher: {
      owner: p.owner,
      verifiedAt: typeof p.verifiedAt === "string" ? p.verifiedAt : "",
      observedArtifactDigest:
        typeof p.observedArtifactDigest === "string" ? p.observedArtifactDigest : "",
    },
  }
}
