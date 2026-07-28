// ---------------------------------------------------------------------------
// calllint-mcp — MCP resources (ADR 0056 §8; ADR 0025). Exposes the committed
// Agent-Adoption-Contracts as read-only resources under the `calllint://adoption/`
// URI scheme, so a resource-aware client can browse/read a shipped contract without
// a tool call. Pure: every contract is served verbatim from the bundle — no network,
// no execution, no verdict logic. Byte-identical to the baked served sidecars (pinned
// by committed-contracts-drift.test.ts).
// ---------------------------------------------------------------------------

import { COMMITTED_CONTRACTS, COMMITTED_CONTRACT_SLUGS } from "./committedContracts.js"

const SCHEME = "calllint://adoption/"
const MIME = "application/vnd.calllint.agent-adoption+json;version=1"

/** An MCP resource descriptor (resources/list entry). */
export interface ResourceDescriptor {
  uri: string
  name: string
  description: string
  mimeType: string
}

/** An MCP resource-template descriptor (resources/templates/list entry). */
export interface ResourceTemplate {
  uriTemplate: string
  name: string
  description: string
  mimeType: string
}

/** A resources/read content block (text form — the exact baked contract JSON bytes). */
export interface ResourceContents {
  uri: string
  mimeType: string
  text: string
}

/** One concrete resource per committed contract, keyed by canonicalSlug. Deterministic
 *  order (the bundle is key-sorted). Nothing here computes a verdict or a route. */
export const RESOURCES: readonly ResourceDescriptor[] = COMMITTED_CONTRACT_SLUGS.map((slug) => {
  const c = COMMITTED_CONTRACTS[slug]!
  return {
    uri: `${SCHEME}${slug}`,
    name: c.subject.canonicalName,
    description: `CallLint Agent Adoption Contract for ${c.subject.canonicalName} — public verdict ${c.publicObservation.verdict} (${c.publicObservation.publicLabel}). Served verbatim; authorizes nothing.`,
    mimeType: MIME,
  }
})

/** The parameterized form advertised to clients (slug, with an optional pinned version). */
export const RESOURCE_TEMPLATES: readonly ResourceTemplate[] = [
  {
    uriTemplate: `${SCHEME}{canonicalSlug}`,
    name: "CallLint Agent Adoption Contract",
    description:
      "The committed machine adoption contract for a published resource, by canonical slug (e.g. calllint://adoption/mcp-registry/io.github.example). Optionally pin a version with calllint://adoption/{canonicalSlug}@{version}. Served verbatim from a committed bundle — no network, no execution, no new verdict.",
    mimeType: MIME,
  },
]

/**
 * Read a `calllint://adoption/<canonicalSlug>[@<version>]` resource. Returns the committed
 * contract serialized as JSON text, or null on any miss (unknown scheme, unknown slug, or a
 * version that is not the committed one — fail closed, never fetch or guess). Slugs may contain
 * `/` (e.g. mcp-registry/io.github.example); an optional trailing `@<version>` pins the version.
 */
export function readResource(uri: string): ResourceContents[] | null {
  if (!uri.startsWith(SCHEME)) return null
  const rest = uri.slice(SCHEME.length)
  if (!rest) return null

  // Split an optional trailing @version (only at the LAST @, so scoped npm-ish slugs are safe).
  let slug = rest
  let version: string | undefined
  const at = rest.lastIndexOf("@")
  if (at > 0) {
    slug = rest.slice(0, at)
    version = rest.slice(at + 1)
  }

  const contract = COMMITTED_CONTRACTS[slug]
  if (!contract) return null
  if (version !== undefined && contract.subject.version !== version) return null

  return [{ uri, mimeType: MIME, text: JSON.stringify(contract, null, 2) + "\n" }]
}
