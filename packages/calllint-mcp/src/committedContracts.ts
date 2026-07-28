/**
 * The committed Agent-Adoption-Contracts bundled into the published MCP server so
 * `calllint_get_adoption_contract` (and the `calllint://adoption/{slug}` resource)
 * can serve a shipped contract WITHOUT reading the served tree at runtime or making
 * a network call (ADR 0056 §7/§8; ADR 0025 — pure delegators, no network/no exec).
 *
 * Each entry is a byte-for-byte copy of a baked `apps/web/public/install/<slug>/index.json`
 * sidecar (`application/vnd.calllint.agent-adoption+json;version=1`), keyed by the subject's
 * `canonicalSlug` — the SAME canonical slug the Trust Pages use (no second slug function).
 * An anti-drift test (`committed-contracts-drift.test.ts`) pins the bundle to the baked
 * sidecars, so the published server can never quietly serve a stale or invented contract.
 *
 * esbuild inlines this JSON into `dist/index.js`, so the bundle stays self-contained (no
 * `@calllint/*` import survives, no `readFileSync` of a served path). Nothing here computes
 * a verdict, a score, or a route — every field is carried through verbatim from the bake.
 */
import committed from "./data/adoption-contracts.json" with { type: "json" }

/** The bundled projection: a schema tag + a slug→contract map (deterministic key order). */
interface CommittedContracts {
  schema: "calllint.mcp-committed-contracts.v1"
  /** canonicalSlug → the full baked Agent-Adoption-Contract JSON (opaque, carried verbatim). */
  contracts: Record<string, AdoptionContract>
}

/** The baked contract shape — only the fields the MCP tools project are typed; the rest is
 *  preserved opaquely so the bundle stays a verbatim copy (never a re-serialization). */
export interface AdoptionContract {
  schema: string
  contract: { contractDigest: string; generatedAt: string; expiresAt: string | null }
  subject: {
    canonicalName: string
    canonicalSlug: string
    packageType: string | null
    packageName: string | null
    version: string | null
    artifactDigest: string
    sourceLocator: string | null
  }
  publicObservation: { verdict: string; publicLabel: string }
  recommendedNextAction: { kind: string; tool: string; arguments: Record<string, unknown> }
  [key: string]: unknown
}

const BUNDLE = committed as CommittedContracts

/** The committed contracts, keyed by canonicalSlug, exactly as baked. */
export const COMMITTED_CONTRACTS: Readonly<Record<string, AdoptionContract>> = BUNDLE.contracts

/** All committed slugs, sorted (the bundle is already key-sorted; copy, never mutate). */
export const COMMITTED_CONTRACT_SLUGS: readonly string[] = Object.keys(BUNDLE.contracts)

/**
 * Look up a committed contract by canonicalSlug, optionally pinned to an exact version.
 * Returns null on any miss (unknown slug, or a version that is not the committed one) —
 * the caller fails closed, never guessing or fetching. Pure: no clock, no network, no I/O.
 */
export function findCommittedContract(slug: string, version?: string): AdoptionContract | null {
  const c = COMMITTED_CONTRACTS[slug]
  if (!c) return null
  if (version !== undefined && c.subject.version !== version) return null
  return c
}
