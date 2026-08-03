/**
 * SourceRecordV1 — a source-specific OBSERVATION, verbatim from the execution plan
 * §7.1. Not a truth claim: it records what one source said at one retrieval time.
 *
 * Two properties of this shape are load-bearing and easy to lose:
 *
 * 1. `untrustedPublisherContent` is named for what it is. Description, keywords and
 *    categories are publisher-supplied strings. They travel INSIDE this envelope so
 *    that no downstream reader can mistake them for verified fact, and they must
 *    never reach a decision group (INV-2.4-05, already enforced on the serving side).
 *
 * 2. `retrievedAt` belongs to source provenance, not to the compile (§9.5). It is an
 *    explicit input carried on the record, which is what lets a projection be
 *    reproducible without any wall-clock read (INV-R6).
 */

/** The four source classes §7.1 admits. A fifth would be a schema change. */
export type SourceType = "official-mcp-registry" | "third-party-registry" | "package-index" | "github"

/**
 * Lifecycle as the SOURCE reports it. `unknown` is a real, distinct state and never
 * an alias for `active` — the product rule "UNKNOWN is not SAFE" applies to source
 * lifecycle exactly as it applies to verdicts.
 */
export type SourceLifecycleStatus = "active" | "deprecated" | "deleted" | "unknown"

export interface SourcePackageRef {
  registryType: string
  identifier: string
  version: string | null
  transport: string | null
}

export interface SourceRemoteRef {
  type: string
  url: string
}

export interface SourceRecordV1 {
  schema: "calllint.source-record.v1"
  source: {
    sourceId: string
    sourceType: SourceType
    sourceRecordId: string
    sourceUrl?: string
    retrievedAt: string
    payloadDigest: string
  }
  claimedIdentity: {
    canonicalName?: string
    displayName?: string
    version?: string
    repositoryUrl?: string
    packages: SourcePackageRef[]
    remotes: SourceRemoteRef[]
  }
  lifecycle: {
    status: SourceLifecycleStatus
    isLatest?: boolean
    publishedAt?: string
  }
  untrustedPublisherContent?: {
    description?: string
    keywords?: string[]
    categories?: string[]
  }
}

export const SOURCE_RECORD_SCHEMA = "calllint.source-record.v1" as const
