/**
 * R6 — Remote Endpoint Resolver (new11 P1 §4.3 row E8). PURE-EDGE.
 *
 * Resolves a `remote-endpoint` subject (id = endpoint URL) into identity-only
 * evidence: URL identity, TLS (HTTPS scheme), declared auth model, and domain
 * ownership — read from ONE well-known descriptor at the origin. It MUST NOT
 * (§4.3): call business tools, send destructive requests, probe unauthorized
 * paths, or scan for vulnerabilities. The only network touch is GET
 * <origin>/.well-known/mcp.json.
 *
 * There is no TLS/redirect-specific gap code (the 16 are frozen); TLS validity and
 * auth model are recorded as evidence ITEMS. Gaps use the frozen vocabulary only:
 * fetch throws→NETWORK_UNAVAILABLE(retryable); non-https→MALFORMED_METADATA
 * (we refuse to resolve plaintext endpoints — fail closed); no descriptor→
 * REMOTE_OWNER_UNVERIFIED(degrading); bad descriptor→MALFORMED_METADATA.
 */
import { makeGap } from "@calllint/evidence"
import type { EvidenceGap, EvidenceItem, EvidenceSubject, ResolverResult } from "@calllint/evidence"
import type { EvidenceResolver, ResolverContext } from "./resolverInterface.js"

const ID = "R6:remote"

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Parse an https origin from a subject id; undefined if not a valid https URL. */
export function httpsOrigin(id: string): { origin: string; host: string } | undefined {
  let u: URL
  try {
    u = new URL(id.trim())
  } catch {
    return undefined
  }
  if (u.protocol !== "https:") return undefined
  return { origin: u.origin, host: u.host }
}

function descriptorUrl(origin: string): string {
  return `${origin}/.well-known/mcp.json`
}

async function resolve(subject: EvidenceSubject, ctx: ResolverContext): Promise<ResolverResult> {
  const parsed = httpsOrigin(subject.id)
  if (!parsed) {
    // Non-URL or plaintext http:// — refuse to resolve (fail closed, no probing).
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("MALFORMED_METADATA", `remote endpoint is not a valid https URL: "${subject.id}"`, {
          missingFields: ["endpoint.url"],
          triedResolvers: [ID],
        }),
      ],
    }
  }
  const { origin, host } = parsed

  // URL identity + TLS are known from the id itself, before any fetch.
  const items: EvidenceItem[] = [
    { field: "endpoint.url", value: origin, tier: "repository", source: ID },
    { field: "endpoint.tls", value: "https", tier: "repository", source: ID },
    { field: "endpoint.host", value: host, tier: "repository", source: ID },
  ]
  const gaps: EvidenceGap[] = []

  let text: string | undefined
  try {
    text = await ctx.fetchText(descriptorUrl(origin))
  } catch {
    return {
      resolver: ID,
      status: "retryable-failure",
      items,
      gaps: [
        makeGap("NETWORK_UNAVAILABLE", `could not reach ${host} over HTTPS`, {
          missingFields: ["endpoint.authModel"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  if (text === undefined) {
    // Reachable over HTTPS but no descriptor → owner/auth unverified (degrading).
    gaps.push(
      makeGap("REMOTE_OWNER_UNVERIFIED", `${host} serves no .well-known/mcp.json descriptor`, {
        missingFields: ["endpoint.authModel", "endpoint.owner"],
        triedResolvers: [ID],
      }),
    )
    return { resolver: ID, status: "partial", items, gaps }
  }

  let parsedDoc: unknown
  try {
    parsedDoc = JSON.parse(text)
  } catch {
    return {
      resolver: ID,
      status: "unresolvable",
      items,
      gaps: [
        makeGap("MALFORMED_METADATA", `${host} descriptor is not valid JSON`, {
          missingFields: ["endpoint.authModel"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  if (isRecord(parsedDoc)) {
    // Declared auth model (identity metadata; we never exercise it).
    if (typeof parsedDoc.authModel === "string" && parsedDoc.authModel) {
      items.push({ field: "endpoint.authModel", value: parsedDoc.authModel, tier: "repository", source: ID })
    }
    if (typeof parsedDoc.owner === "string" && parsedDoc.owner) {
      items.push({ field: "endpoint.owner", value: parsedDoc.owner, tier: "publisher-signed", source: ID })
    } else {
      gaps.push(
        makeGap("REMOTE_OWNER_UNVERIFIED", `${host} descriptor declares no owner`, {
          missingFields: ["endpoint.owner"],
          triedResolvers: [ID],
        }),
      )
    }
  }

  return { resolver: ID, status: gaps.length === 0 ? "complete" : "partial", items, gaps }
}

/** R6 — the Remote Endpoint Resolver. Identity/TLS/auth only; never probes or calls tools. */
export const remoteResolver: EvidenceResolver = { id: ID, handles: ["remote-endpoint"], resolve }
