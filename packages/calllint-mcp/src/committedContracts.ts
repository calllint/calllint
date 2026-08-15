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
 *  preserved opaquely so the bundle stays a verbatim copy (never a re-serialization).
 *
 *  P-6 widens the TYPING, never the data: `publicObservation`'s three extra fields and
 *  `authorityDelta` are already in every bundled byte (measured: `completeness: "complete"`
 *  on all 19, `adds|notObserved` = 1|8 ×17 and 0|9 ×2). They are typed here because the
 *  decision-relay notes are a PROJECTION of the sealed contract — a relay sentence may only
 *  name a field the contract carries — and an untyped read through `[key: string]: unknown`
 *  would make that basis a cast rather than a checked fact.
 *
 *  Every added field is OPTIONAL on purpose. A contract is read from bytes, so absence is a
 *  real answer; the composer treats a missing field as "no basis" and omits the sentence
 *  rather than inventing one. `[key: string]: unknown` stays, so the bundle is still carried
 *  through verbatim and no field is dropped by being untyped. */
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
  publicObservation: {
    verdict: string
    publicLabel: string
    /** Sealed reason codes, in contract order — the basis of the `reason` relay sentence. */
    reasonCodes?: readonly string[]
    /** E0–E3 evidence level — the other half of the `reason` sentence's basis. */
    evidenceLevel?: string
    /**
     * Whether the authority inventory was complete. GATES the `notObserved` relay
     * sentence, mirroring the contract builder's own gate: when the inventory is partial
     * the builder leaves `notObserved` empty precisely because silence is a GAP, not
     * evidence of absence.
     */
    completeness?: "complete" | "partial"
  }
  /**
   * What the install would add, and the high-authority complement that was NOT observed.
   * Present on every bundled contract; typed optional because a contract is read from bytes.
   */
  authorityDelta?: {
    readonly adds?: readonly { authority: string }[]
    readonly notObserved?: readonly string[]
  }
  /**
   * The route the contract recommends. `kind` is the ONLY field this package reads
   * (`publicFloor` switches on it and handles every kind plus an unrecognized default),
   * so the rest is typed as what the producer can actually emit rather than as what one
   * kind happens to carry.
   *
   * WHY `arguments` IS OPTIONAL, MEASURED. The producer's union
   * (`trust-index/src/agentAdoptionContract.ts:86-90`) has FOUR shapes and only
   * `PREPARE_LOCALLY` carries `arguments`; `EXPLAIN_ONLY` carries neither `arguments`
   * nor `tool`. Requiring `arguments` here was satisfied by coincidence for as long as
   * every bundled contract routed `PREPARE_LOCALLY` — true of the 25-entry cohort, false
   * at 100, where 3 of 100 route `LOCAL_PREFLIGHT_REQUIRED` (a subject with no exact
   * identity must be re-decided locally, so there are no digests to assert and emitting
   * an empty `arguments` would be a fabricated pin). Optional here is not a widening to
   * silence a compiler: it is the reader agreeing with the producer, and it matches how
   * `trust-index/src/phase24Eval.ts:598` already reads the same field.
   */
  recommendedNextAction: {
    kind: string
    tool?: string
    arguments?: Record<string, unknown>
  }
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
