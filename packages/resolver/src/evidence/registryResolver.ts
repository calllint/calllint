/**
 * R3 — MCP Registry Resolver (new11 P1 §4.3 row E5). PURE-EDGE.
 *
 * Resolves an `mcp-registry-entry` subject (id = the server name) against the
 * Official MCP Registry. Reads the SAME shape trust-index ingests, but stays
 * self-contained: importing @calllint/trust-index would form a cycle
 * (resolver → trust-index → core → resolver), so the minimal parse lives here.
 *
 * Registry-tier evidence: identity.name, identity.version, repo.url.
 * Fail-closed: network→NETWORK_UNAVAILABLE(retryable), malformed→MALFORMED_METADATA,
 * entry-absent→REGISTRY_ENTRY_MISSING(degrading), no-repo→REPOSITORY_UNRESOLVED(degrading).
 */
import { makeGap } from "@calllint/evidence"
import type { EvidenceGap, EvidenceItem, EvidenceSubject, ResolverResult } from "@calllint/evidence"
import type { EvidenceResolver, ResolverContext } from "./resolverInterface.js"

const ID = "R3:mcp-registry"
export const REGISTRY_ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers"
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined

/** Find the active + isLatest server entry whose name matches, from a /v0/servers body. */
function findEntry(body: unknown, name: string): Record<string, unknown> | undefined {
  if (!isRecord(body) || !Array.isArray(body.servers)) return undefined
  for (const item of body.servers) {
    if (!isRecord(item)) continue
    const server = isRecord(item.server) ? item.server : undefined
    if (!server || str(server.name) !== name) continue
    const meta = isRecord(item._meta) && isRecord(item._meta[OFFICIAL_META])
      ? (item._meta[OFFICIAL_META] as Record<string, unknown>)
      : undefined
    // Prefer the latest active record, but return any name match so a stale-only
    // entry still resolves identity (it just won't be marked current here).
    if (meta && str(meta.status) === "active" && meta.isLatest === true) return server
  }
  // Fall back to the first name match regardless of latest flag.
  for (const item of body.servers) {
    if (isRecord(item) && isRecord(item.server) && str(item.server.name) === name) {
      return item.server as Record<string, unknown>
    }
  }
  return undefined
}

async function resolve(subject: EvidenceSubject, ctx: ResolverContext): Promise<ResolverResult> {
  let body: unknown
  try {
    body = await ctx.fetchJson(REGISTRY_ENDPOINT)
  } catch {
    return {
      resolver: ID,
      status: "retryable-failure",
      items: [],
      gaps: [
        makeGap("NETWORK_UNAVAILABLE", "MCP registry was unreachable", {
          missingFields: ["identity.version"],
          triedResolvers: [ID],
        }),
      ],
    }
  }
  if (!isRecord(body) || !Array.isArray((body as Record<string, unknown>).servers)) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("MALFORMED_METADATA", "registry body missing a servers array", {
          triedResolvers: [ID],
        }),
      ],
    }
  }

  const entry = findEntry(body, subject.id)
  if (!entry) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("REGISTRY_ENTRY_MISSING", `no MCP registry entry named "${subject.id}"`, {
          missingFields: ["identity.name"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  const items: EvidenceItem[] = [
    { field: "identity.name", value: subject.id, tier: "registry", source: ID },
  ]
  const gaps: EvidenceGap[] = []
  const version = str(entry.version)
  if (version) items.push({ field: "identity.version", value: version, tier: "registry", source: ID })

  const repoUrl = isRecord(entry.repository) ? str(entry.repository.url) : undefined
  if (repoUrl) {
    items.push({ field: "repo.url", value: repoUrl, tier: "registry", source: ID })
  } else {
    gaps.push(
      makeGap("REPOSITORY_UNRESOLVED", `registry entry "${subject.id}" declares no repository`, {
        missingFields: ["repo.url"],
        triedResolvers: [ID],
      }),
    )
  }
  return { resolver: ID, status: gaps.length === 0 ? "complete" : "partial", items, gaps }
}

/** R3 — the MCP Registry Resolver singleton. */
export const registryResolver: EvidenceResolver = {
  id: ID,
  handles: ["mcp-registry-entry"],
  resolve,
}
