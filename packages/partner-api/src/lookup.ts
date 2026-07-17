import type { AssetReader, ApiEnvelope, EnvelopePublisher } from "./types.js"
import { API_SCHEMA } from "./types.js"

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

export function isDigest(s: string): boolean {
  return DIGEST_RE.test(s)
}

interface IndexEntry {
  canonicalName: string
  status: string
  artifactDigest?: string
  pageDigest?: string
  verdict?: string
  observedAt?: string
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

/** Wrap a pre-baked sidecar into the versioned public envelope. */
export function toEnvelope(
  kind: ApiEnvelope["kind"],
  sidecar: Record<string, unknown>,
  data: unknown,
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
