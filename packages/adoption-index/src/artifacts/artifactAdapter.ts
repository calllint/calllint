/**
 * ArtifactAdapter — the port for "where do this package type's bytes live, and what does its
 * registry claim about them". One adapter per package type; the resolver knows none of them.
 *
 * Mirrors `sources/sourceAdapter.ts` deliberately, including the injected-`fetchImpl` shape:
 * there is no ambient network access, so a test drives a real adapter with a stub and the
 * offline gates stay offline.
 *
 * The type is also where ADR 0061 §2 is enforced structurally, the same way
 * `packages/resolver/src/evidence/resolverInterface.ts` documents. An adapter is handed a fetch
 * and a clock and NOTHING else — no `spawn`, no `exec`, no filesystem handle, no package
 * manager. It therefore cannot execute the subject it describes even if a future adapter author
 * wanted to; the capability is not in scope. The complementary enforcement is dependency
 * absence, measured by the INV-04 gate over this whole package.
 *
 * Adapters return metadata and a URL. They never download: fetching bytes, verifying them, and
 * writing them is `operations/resolveArtifacts.ts`'s job, so the two risk classes stay in two
 * places and one adapter cannot quietly become an extraction engine.
 */
import type { StoredArtifactVersion } from "../storage/store.js"

export interface ArtifactFetchContext {
  /** Injected fetch. Tests pass a stub; there is no ambient network access. */
  fetchImpl: typeof fetch
  /**
   * Retrieval time, captured ONCE at the edge and passed inward, so every artifact in one run
   * shares one stamp and no module below the edge reads a clock (§9.5, INV-R6).
   */
  now: string
  /** Per-request timeout, ms. A hung registry must not hang the ingestion run. */
  requestTimeoutMs: number
  /** Hard ceiling on a downloaded artifact's compressed size. */
  maxArtifactBytes: number
}

/**
 * What Phase A establishes: the registry host, the exact version, the download URL, and the
 * registry's own integrity claim.
 *
 * `integrity` is optional because a registry may genuinely not state one, and the honest
 * recording of that is absence rather than an empty string.
 *
 * TWO FIELDS HERE ARE RESOLVED BUT NOT PERSISTED, both for reasons measured rather than assumed:
 *
 *   - `packageRegistry` has NO column. `migrations/001` gives `artifact_versions` twelve columns
 *     and `package_registry` is not among them, while `calllint.artifact-version.v1` requires the
 *     property — a divergence `domain/subject.ts` records deliberately ("the schema requires a
 *     `packageRegistry` the DDL has no column for ... neither is a defect"). R-4 runs zero
 *     migrations, so it resolves the host to build a URL and stores nothing. The column that
 *     would hold it is a later batch's decision, not a gap this one silently fills.
 *   - `resolvedVersion` must NOT be written back to `version`. `artifact_version_id` is
 *     `hashJson({subjectId, packageType, packageIdentifier, version})`, so rewriting `version`
 *     would make the row's primary key no longer derivable from its own contents — every
 *     downstream reference would dangle. Pinning a floating spec is therefore used to select the
 *     version document and nothing else. Both corpus artifacts are already pinned, so this path
 *     is an edge case in the corpus and a correctness requirement regardless.
 */
export interface ArtifactMetadata {
  /** Registry base URL, e.g. `https://registry.npmjs.org`. */
  packageRegistry: string
  /** The concrete version resolved, with any floating spec (`latest`, `^1.2.0`) already pinned. */
  resolvedVersion: string
  /** Absolute URL of the artifact bytes. */
  tarballUrl: string
  /** The registry's integrity claim, verbatim and unparsed, or undefined when it stated none. */
  integrity?: string
}

/**
 * Why Phase A could not produce metadata.
 *
 * Every value here means "we could not obtain a usable description of the bytes", which upstream
 * becomes `UNAVAILABLE` — tried and failed. None of them can mean `REJECTED`, because rejecting
 * requires having bytes in hand to refuse. The names are reused from
 * `packages/resolver/src/evidence/npmResolver.ts` rather than invented, so one vocabulary
 * describes a registry read wherever it happens.
 */
export type ArtifactMetadataFailure =
  | "NETWORK_UNAVAILABLE"
  | "PACKAGE_NOT_FOUND"
  | "MALFORMED_METADATA"
  | "ARTIFACT_VERSION_UNRESOLVED"
  | "ARTIFACT_DIGEST_UNAVAILABLE"

export type ArtifactMetadataResult =
  | { readonly ok: true; readonly metadata: ArtifactMetadata }
  | { readonly ok: false; readonly failure: ArtifactMetadataFailure; readonly detail: string }

export interface ArtifactAdapter {
  /** The `package_type` this adapter serves, matching `RESOLVABLE_PACKAGE_TYPES`. */
  packageType: string
  /**
   * Phase A: one metadata read. Must never throw — a registry is untrusted input, and an
   * ingestion run that crashes on one malformed document loses the whole cohort. Failures are
   * returned so the caller can record `UNAVAILABLE` and move to the next artifact.
   */
  resolveMetadata(artifact: StoredArtifactVersion, ctx: ArtifactFetchContext): Promise<ArtifactMetadataResult>
}

/**
 * The registry of adapters, keyed by package type.
 *
 * A `Map` with one entry today (npm — the only type the corpus declares). Each further adapter
 * is additive and its own PR. A type with no adapter is NOT tried, so it must not be recorded as
 * `UNAVAILABLE` ("tried and failed"); see `domain/artifactTransitions.ts`.
 */
export type ArtifactAdapterRegistry = Map<string, ArtifactAdapter>

export function createAdapterRegistry(adapters: readonly ArtifactAdapter[]): ArtifactAdapterRegistry {
  const registry = new Map<string, ArtifactAdapter>()
  for (const adapter of adapters) {
    const existing = registry.get(adapter.packageType)
    if (existing !== undefined) {
      // Fail closed and loudly. Two adapters for one type is ambiguous authority over what an
      // artifact's bytes are, and silently keeping the last one registered would make the
      // resolution depend on array order.
      throw new Error(`two adapters registered for package type "${adapter.packageType}"`)
    }
    registry.set(adapter.packageType, adapter)
  }
  return registry
}
