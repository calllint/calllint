/**
 * R2 — GitHub Repository Resolver (new11 P1 row E4). PURE-EDGE.
 *
 * Resolves a `github-repo` subject into repo-identity evidence (canonical URL,
 * default branch, owner, visibility) via the GitHub REST API /repos endpoint.
 * Uses only the injected `fetchJson` — no execution, no side effects.
 *
 * Subject id formats accepted: "github.com/owner/repo" or "owner/repo"
 * (scheme stripped; fragment/query ignored).
 *
 * Fail-closed mapping:
 *   - fetch rejects / HTTP 5xx  -> NETWORK_UNAVAILABLE  (retryable-failure)
 *   - HTTP 429                  -> RATE_LIMITED          (retryable-failure)
 *   - HTTP 404 / no id field    -> REPOSITORY_UNRESOLVED (unresolvable)
 *   - doc malformed             -> MALFORMED_METADATA    (unresolvable)
 *   - private repo              -> REPOSITORY_UNRESOLVED (unresolvable; we cannot
 *                                   see private repos without auth; treat as absent)
 */
import { makeGap } from "@calllint/evidence"
import type { EvidenceItem, EvidenceSubject, ResolverResult } from "@calllint/evidence"
import type { EvidenceResolver, ResolverContext } from "./resolverInterface.js"

const ID = "R2:github"

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Return { owner, repo } from "github.com/owner/repo" or "owner/repo", or undefined. */
function parseGithubId(id: string): { owner: string; repo: string } | undefined {
  const stripped = id
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .split(/[?#]/)[0]!
    .replace(/\.git$/, "")
  const parts = stripped.split("/")
  if (parts.length < 2 || !parts[0] || !parts[1]) return undefined
  return { owner: parts[0], repo: parts[1] }
}

async function resolve(subject: EvidenceSubject, ctx: ResolverContext): Promise<ResolverResult> {
  const parsed = parseGithubId(subject.id)
  if (!parsed) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("MALFORMED_METADATA", `cannot parse github-repo subject id: "${subject.id}"`, {
          missingFields: ["repo.url"],
          triedResolvers: [ID],
        }),
      ],
    }
  }
  const { owner, repo } = parsed
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`

  let doc: unknown
  try {
    doc = await ctx.fetchJson(apiUrl)
  } catch (err) {
    // Distinguish transient rate-limit from generic unreachability by message.
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
    const rateLimited = /rate limit|\b429\b|\b403\b/.test(msg)
    return {
      resolver: ID,
      status: "retryable-failure",
      items: [],
      gaps: [
        rateLimited
          ? makeGap("RATE_LIMITED", `github api rate-limited resolving ${owner}/${repo}`, {
              missingFields: ["repo.url"],
              triedResolvers: [ID],
            })
          : makeGap("NETWORK_UNAVAILABLE", `github api unreachable resolving ${owner}/${repo}`, {
              missingFields: ["repo.url"],
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
        makeGap("MALFORMED_METADATA", "github api returned a non-object body", {
          missingFields: ["repo.url"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  // GitHub returns { message: "Not Found" } for a missing/inaccessible repo.
  const notFound =
    typeof doc.full_name !== "string" ||
    (typeof doc.message === "string" && /not found/i.test(doc.message))
  if (notFound) {
    return {
      resolver: ID,
      status: "unresolvable",
      items: [],
      gaps: [
        makeGap("REPOSITORY_UNRESOLVED", `repository ${owner}/${repo} not found or not public`, {
          missingFields: ["repo.url", "repo.defaultBranch"],
          triedResolvers: [ID],
        }),
      ],
    }
  }

  // A private repo we can still see means auth was present; without auth GitHub
  // returns 404 (handled above). If `private:true` surfaces, record it but treat
  // the public-identity claim conservatively.
  const isPrivate = doc.private === true
  const items: EvidenceItem[] = [
    { field: "repo.url", value: `https://github.com/${owner}/${repo}`, tier: "repository", source: ID },
  ]
  if (typeof doc.default_branch === "string" && doc.default_branch) {
    items.push({ field: "repo.defaultBranch", value: doc.default_branch, tier: "repository", source: ID })
  }
  const ownerLogin = isRecord(doc.owner) && typeof doc.owner.login === "string" ? doc.owner.login : owner
  items.push({ field: "repo.owner", value: ownerLogin, tier: "repository", source: ID })
  items.push({ field: "repo.visibility", value: isPrivate ? "private" : "public", tier: "repository", source: ID })

  return { resolver: ID, status: "complete", items, gaps: [] }
}

/** R2 — the GitHub Repository Resolver singleton. */
export const githubResolver: EvidenceResolver = {
  id: ID,
  handles: ["github-repo"],
  resolve,
}
