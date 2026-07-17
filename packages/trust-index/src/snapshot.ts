/**
 * The Official MCP Registry snapshot — the retained raw input (ADR 0038 §1:
 * "the registry is an input, never the only store; raw snapshots are retained").
 *
 * This module is the boundary between the impure fetch (fetchRegistry.ts, run only
 * by the scheduled workflow) and the PURE bake. The snapshot is a committed JSON
 * file; the bake reads it deterministically. `fetchedAt` is captured ONCE at fetch
 * time and stored in the snapshot — the bake injects it as the observation time, so
 * a re-bake from the same committed snapshot is byte-identical (ADR 0046 §4).
 *
 * The snapshot is PII-free by construction: we retain only the substantive resolve
 * fields (name, description, version, repository, packages, remotes, status). We do
 * NOT retain publisher contact info, keywords, or categories (ADR 0038 §5).
 */

/** A stdio install descriptor as the registry states it. */
export interface SnapshotPackage {
  registryType: string
  identifier: string
  version: string | null
  transport: string | null
}

/** A remote transport endpoint as the registry states it. */
export interface SnapshotRemote {
  type: string
  url: string
}

/** One retained registry entry — the PII-free subset we resolve over. */
export interface SnapshotEntry {
  name: string
  description: string
  version: string | null
  repositoryUrl: string | null
  packages: SnapshotPackage[]
  remotes: SnapshotRemote[]
  status: string | null
  publishedAt: string | null
}

/** The committed snapshot document. */
export interface RegistrySnapshot {
  schema: "calllint.trust-snapshot.v0"
  source: "official-mcp-registry"
  endpoint: string
  /** ISO-8601 UTC captured at fetch; injected as the bake observation time. */
  fetchedAt: string
  count: number
  entries: SnapshotEntry[]
}

/** The reserved namespace all Official MCP Registry pages live under. */
export const REGISTRY_NAMESPACE = "mcp-registry"

/**
 * Parse + validate a committed snapshot from its JSON text. Pure. Throws on a wrong
 * schema or a non-array `entries` so a corrupt snapshot fails the bake loudly rather
 * than silently baking nothing. Field-level tolerance (missing optional fields) is
 * left to the cohort mapper, which records thin entries as incomplete.
 */
export function parseSnapshot(text: string): RegistrySnapshot {
  const doc = JSON.parse(text) as Partial<RegistrySnapshot>
  if (doc.schema !== "calllint.trust-snapshot.v0") {
    throw new Error(`snapshot: unexpected schema ${JSON.stringify(doc.schema)}`)
  }
  if (!Array.isArray(doc.entries)) {
    throw new Error("snapshot: entries must be an array")
  }
  if (typeof doc.fetchedAt !== "string" || doc.fetchedAt.length === 0) {
    throw new Error("snapshot: fetchedAt must be a non-empty ISO-8601 string")
  }
  return doc as RegistrySnapshot
}

/**
 * Canonical, filesystem- and URL-safe `{ns}/{name}` for a registry entry. Registry
 * names are reverse-DNS with slashes (e.g. `ac.inference.sh/mcp`); we slugify to a
 * single stable segment so the page never nests unexpectedly and never collides
 * with the reserved fixtures namespace. Digest-addressing is the real key; this is
 * the human-facing label.
 */
export function registryCanonicalName(entryName: string): string {
  const slug = entryName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
  return `${REGISTRY_NAMESPACE}/${slug}`
}

/**
 * Synthesize the mcp.json config text we scan for one entry, from what the registry
 * declares. Remotes become url servers (transport preserved); packages become the
 * runner command the registry implies (npm→npx, pypi/uv→uvx, else a bare command).
 * Keys are sorted and JSON is pinned so the synthesized bytes — and therefore the
 * artifact digest — are stable. Returns null when the entry declares neither a
 * remote nor a package (nothing to scan → the caller records it `incomplete`).
 */
export function synthesizeConfigText(entry: SnapshotEntry): string | null {
  const servers: Record<string, Record<string, unknown>> = {}

  entry.remotes.forEach((r, i) => {
    const key = entry.remotes.length === 1 ? "remote" : `remote-${i + 1}`
    servers[key] = r.type ? { type: r.type, url: r.url } : { url: r.url }
  })

  entry.packages.forEach((p, i) => {
    const key = entry.packages.length === 1 ? "package" : `package-${i + 1}`
    const spec = p.version ? `${p.identifier}@${p.version}` : p.identifier
    const rt = (p.registryType || "").toLowerCase()
    if (rt === "npm") servers[key] = { command: "npx", args: ["-y", spec] }
    else if (rt === "pypi" || rt === "uv") servers[key] = { command: "uvx", args: [spec] }
    else servers[key] = { command: p.identifier, args: p.version ? [p.version] : [] }
  })

  const keys = Object.keys(servers)
  if (keys.length === 0) return null
  // Sort server keys for byte-stability regardless of remotes/packages order.
  const sorted: Record<string, Record<string, unknown>> = {}
  for (const k of keys.sort()) sorted[k] = servers[k]!
  return JSON.stringify({ mcpServers: sorted }, null, 2) + "\n"
}
