import type { AssetReader, ApiEnvelope } from "./types.js"
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
  const s = sidecar as Record<string, string>
  return {
    schema: API_SCHEMA,
    kind,
    canonicalName: s.canonicalName ?? "",
    artifactDigest: s.artifactDigest ?? "",
    pageDigest: s.pageDigest ?? "",
    verdict: (s.verdict as ApiEnvelope["verdict"]) ?? "UNKNOWN",
    verdictLabel: s.verdictLabel ?? "Insufficient evidence",
    observedAt: s.observedAt ?? "",
    completeness: s.completeness ?? "unknown",
    trustPageUrl: `/trust/${s.canonicalName ?? ""}.html`,
    correctionUrl: s.correctionUrl ?? "",
    data,
  }
}
