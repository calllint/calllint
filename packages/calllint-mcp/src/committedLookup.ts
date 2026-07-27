/**
 * The committed Trust-lookup projection, bundled into the published MCP server so
 * `calllint_search_agent_tools` can surface shipped verdicts WITHOUT reading the served
 * tree at runtime or shipping it in the tarball (ADR 0055 §4/§5). It is a byte-copy of the
 * baked `apps/web/public/trust/lookup-index.json`, pinned byte-identical by an anti-drift
 * test (`committed-lookup-drift.test.ts`) — the package-boundary form of the same "a lookup
 * entry can never exist without a baked index entry" invariant the trust-index tests pin.
 *
 * esbuild inlines this JSON into `dist/index.js`, so the bundle stays self-contained (no
 * `@calllint/*` import survives, no `readFileSync` of a served path — the two properties the
 * distribution smoke asserts). Each entry carries the SHIPPED verdict + boundary-safe label
 * verbatim; nothing here computes a verdict or a score (Product Principle 4/5; ADR 0053 §3).
 */
import type { Verdict } from "@calllint/types"
import lookupIndex from "./data/lookup-index.json" with { type: "json" }

/** One projected Trust-lookup entry — the exact shape of a `lookup-index.json` entry. */
export interface CommittedLookupEntry {
  canonicalName: string
  url: string
  verdict: Verdict
  verdictLabel: string
  artifactDigest: string
  observedAt: string
  /**
   * Safe-install linkage (Phase 2.4 / ADR 0056), carried through VERBATIM from the baked
   * index — the search tool never derives or recomputes these. Non-null only when the
   * resource has a baked acquisition page: `installUrl` is the human Install page,
   * `contractUrl` the machine Agent-Adoption-Contract sidecar, `installability` the shipped
   * human/route enum (a projection of the verdict, never a new score). Null when the
   * resource has a Trust Page but no install page.
   */
  installUrl: string | null
  contractUrl: string | null
  installability: string | null
}

/**
 * The committed entries, exactly as baked. Already sorted by `canonicalName` (the baked
 * projection is), carried through verbatim — the search tool orders a copy, never mutates
 * this, and never recomputes a field.
 */
export const COMMITTED_LOOKUP_ENTRIES: readonly CommittedLookupEntry[] = (
  lookupIndex as { entries: CommittedLookupEntry[] }
).entries
