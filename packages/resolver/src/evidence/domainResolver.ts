/**
 * R4 — Domain Ownership Resolver (new11 P1 §4.3 row E6). PURE-EDGE.
 *
 * Resolves a `domain` subject (id = a bare host, e.g. "example.com") by reading a
 * well-known ownership file over HTTPS. It NEVER collects or exposes WHOIS PII
 * (§4.3) — the only signal is a publisher-declared file the domain owner controls.
 *
 * Well-known path: https://<host>/.well-known/mcp-publisher.json → { "publisher": "<id>" }.
 * A successful HTTPS fetch also establishes `domain.https = valid` (publisher-signed
 * tier — the owner proved control by serving the file).
 *
 * Fail-closed: fetchText throws→NETWORK_UNAVAILABLE(retryable); 404/absent→
 * REMOTE_OWNER_UNVERIFIED(degrading); present-but-unparseable→MALFORMED_METADATA;
 * no publisher field→REMOTE_OWNER_UNVERIFIED.
 */
import { makeGap } from "@calllint/evidence"
import type { EvidenceItem, EvidenceSubject, ResolverResult } from "@calllint/evidence"
import type { EvidenceResolver, ResolverContext } from "./resolverInterface.js"

const ID = "R4:domain"

/** Normalize a subject id to a bare lowercase host (strip scheme/path/port). */
export function normalizeHost(id: string): string | undefined {
  const h = id
    .trim()
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]!
    .split(":")[0]!
    .toLowerCase()
  // Minimal host validation: at least one dot, no spaces, label chars only.
  if (!h || /\s/.test(h) || !/^[a-z0-9.-]+$/.test(h) || !h.includes(".")) return undefined
  return h
}

function wellKnownUrl(host: string): string {
  return `https://${host}/.well-known/mcp-publisher.json`
}

async function resolve(subject: EvidenceSubject, ctx: ResolverContext): Promise<ResolverResult> {
  const host = normalizeHost(subject.id)
  if (!host) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("MALFORMED_METADATA", `subject id is not a valid host: "${subject.id}"`, {
          missingFields: ["domain.owner"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  let text: string | undefined
  try {
    text = await ctx.fetchText(wellKnownUrl(host))
  } catch {
    return {
      resolver: ID,
      status: "retryable-failure",
      items: [],
      gaps: [
        makeGap("NETWORK_UNAVAILABLE", `could not reach ${host} over HTTPS`, {
          missingFields: ["domain.owner"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  // A reachable HTTPS host with no well-known file = owner unverified (degrading).
  if (text === undefined) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [{ field: "domain.https", value: "valid", tier: "publisher-signed", source: ID }],
      gaps: [
        makeGap("REMOTE_OWNER_UNVERIFIED", `${host} serves no .well-known/mcp-publisher.json`, {
          missingFields: ["domain.owner"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  // Parse the well-known file and extract the publisher field.
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [{ field: "domain.https", value: "valid", tier: "publisher-signed", source: ID }],
      gaps: [
        makeGap("MALFORMED_METADATA", `${host} well-known file is not valid JSON`, {
          missingFields: ["domain.owner"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v)
  const publisher =
    isRecord(parsed) && typeof parsed.publisher === "string" && parsed.publisher.length > 0
      ? parsed.publisher
      : undefined

  if (!publisher) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [{ field: "domain.https", value: "valid", tier: "publisher-signed", source: ID }],
      gaps: [
        makeGap("REMOTE_OWNER_UNVERIFIED", `${host} well-known file has no "publisher" field`, {
          missingFields: ["domain.owner"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  const items: EvidenceItem[] = [
    { field: "domain.https", value: "valid", tier: "publisher-signed", source: ID },
    { field: "domain.owner", value: publisher, tier: "publisher-signed", source: ID },
  ]
  return { resolver: ID, status: "complete", items, gaps: [] }
}

/** R4 — the Domain Ownership Resolver singleton. */
export const domainResolver: EvidenceResolver = {
  id: ID,
  handles: ["domain"],
  resolve,
}
