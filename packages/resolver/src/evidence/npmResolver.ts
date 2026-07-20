/**
 * R1 — npm Artifact Resolver (new11 P1 §4.3 — row E3). PURE-EDGE.
 *
 * Resolves an `npm-package` subject into identity evidence (name, pinned
 * version, integrity, provenance) by reading the registry over the injected
 * fetcher. Reuses `parseNpmSpec` (the same parser the offline binding uses).
 *
 * Fail-closed mapping (never throws):
 *   - fetch rejects            -> NETWORK_UNAVAILABLE (retryable-failure)
 *   - doc not an object        -> MALFORMED_METADATA  (unresolvable)
 *   - name absent from doc     -> PACKAGE_NOT_FOUND    (unresolvable)
 *   - requested version absent -> ARTIFACT_VERSION_UNRESOLVED (unresolvable)
 *   - no repository field      -> REPOSITORY_UNRESOLVED (degrading -> partial)
 *   - no dist.attestations     -> PROVENANCE_UNAVAILABLE (degrading -> partial)
 *   - no integrity/shasum      -> ARTIFACT_DIGEST_UNAVAILABLE (blocking -> partial)
 */
import { makeGap } from "@calllint/evidence"
import type {
  EvidenceGap,
  EvidenceItem,
  EvidenceSubject,
  ResolverResult,
} from "@calllint/evidence"
import { parseNpmSpec } from "../npmSpec.js"
import type { EvidenceResolver, ResolverContext } from "./resolverInterface.js"

const ID = "R1:npm"

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Strip an optional "npm:" scheme so "npm:foo@1" and "foo@1" both parse. */
function subjectSpec(id: string): string {
  return id.startsWith("npm:") ? id.slice(4) : id
}

/** Normalize a registry `repository` field to a plain URL string, or undefined. */
function repoUrl(repository: unknown): string | undefined {
  if (typeof repository === "string") return repository || undefined
  if (isRecord(repository) && typeof repository.url === "string") {
    return repository.url || undefined
  }
  return undefined
}

async function resolve(
  subject: EvidenceSubject,
  ctx: ResolverContext,
): Promise<ResolverResult> {
  const spec = parseNpmSpec(subjectSpec(subject.id))
  if (!spec) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("MALFORMED_METADATA", "subject id is not a parseable npm spec", {
          missingFields: ["identity.name"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  const url = `https://registry.npmjs.org/${spec.name.replace(/\//g, "%2f")}`
  let doc: unknown
  try {
    doc = await ctx.fetchJson(url)
  } catch {
    return {
      resolver: ID,
      status: "retryable-failure",
      items: [],
      gaps: [
        makeGap("NETWORK_UNAVAILABLE", "npm registry was unreachable", {
          missingFields: ["identity.version"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  if (!isRecord(doc)) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("MALFORMED_METADATA", "registry document was not a JSON object", {
          missingFields: ["identity.name"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  const docName = typeof doc.name === "string" ? doc.name : undefined
  const versions = isRecord(doc.versions) ? doc.versions : {}
  if (docName === undefined || Object.keys(versions).length === 0) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("PACKAGE_NOT_FOUND", `package "${spec.name}" not present in registry`, {
          missingFields: ["identity.name", "identity.version"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  const distTags = isRecord(doc["dist-tags"]) ? doc["dist-tags"] : {}
  const latest = typeof distTags.latest === "string" ? distTags.latest : undefined
  const floating =
    !spec.versionSpec || spec.versionSpec === "latest" || /[\^~><*]/.test(spec.versionSpec)
  const resolvedVersion = floating ? latest : spec.versionSpec
  const versionDoc =
    resolvedVersion && isRecord(versions[resolvedVersion])
      ? (versions[resolvedVersion] as Record<string, unknown>)
      : undefined

  if (!versionDoc || !resolvedVersion) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [{ field: "identity.name", value: docName, tier: "registry", source: ID }],
      gaps: [
        makeGap(
          "ARTIFACT_VERSION_UNRESOLVED",
          floating
            ? `no "latest" dist-tag to pin "${spec.name}"`
            : `version "${spec.versionSpec}" of "${spec.name}" not published`,
          { missingFields: ["identity.version"], triedResolvers: [ID] },
        ),
      ],
    }
  }

  const items: EvidenceItem[] = [
    { field: "identity.name", value: docName, tier: "registry", source: ID },
    { field: "identity.version", value: resolvedVersion, tier: "registry", source: ID },
  ]
  const gaps: EvidenceGap[] = []

  // Repository mapping (degrading if absent).
  const repo = repoUrl(versionDoc.repository ?? doc.repository)
  if (repo) {
    items.push({ field: "repo.url", value: repo, tier: "registry", source: ID })
  } else {
    gaps.push(
      makeGap("REPOSITORY_UNRESOLVED", `no repository field for "${spec.name}"`, {
        missingFields: ["repo.url"],
        triedResolvers: [ID],
      }),
    )
  }

  // Integrity + provenance from the version's `dist` block (artifact-bound tier).
  const dist = isRecord(versionDoc.dist) ? versionDoc.dist : {}
  const integrity =
    typeof dist.integrity === "string"
      ? dist.integrity
      : typeof dist.shasum === "string"
        ? `sha1:${dist.shasum}`
        : undefined
  if (integrity) {
    items.push({ field: "identity.integrity", value: integrity, tier: "artifact-bound", source: ID })
  } else {
    gaps.push(
      makeGap("ARTIFACT_DIGEST_UNAVAILABLE", `no dist integrity/shasum for "${spec.name}@${resolvedVersion}"`, {
        missingFields: ["identity.integrity"],
        triedResolvers: [ID],
      }),
    )
  }

  const hasProvenance =
    (Array.isArray(dist.attestations) && dist.attestations.length > 0) ||
    isRecord(dist.attestations) ||
    (isRecord(dist.signatures) && Object.keys(dist.signatures).length > 0) ||
    (Array.isArray(dist.signatures) && dist.signatures.length > 0)
  if (hasProvenance) {
    items.push({ field: "provenance.present", value: "true", tier: "artifact-bound", source: ID })
  } else {
    gaps.push(
      makeGap("PROVENANCE_UNAVAILABLE", `no provenance attestation for "${spec.name}@${resolvedVersion}"`, {
        missingFields: ["provenance.present"],
        triedResolvers: [ID],
      }),
    )
  }

  return { resolver: ID, status: gaps.length === 0 ? "complete" : "partial", items, gaps }
}

/** R1 — the npm Artifact Resolver singleton. */
export const npmResolver: EvidenceResolver = {
  id: ID,
  handles: ["npm-package"],
  resolve,
}
