/**
 * Resolver dispatch + per-run memoization (new11 P1 §4.2/§4.5). PURE-EDGE.
 *
 * `resolveSubject` routes a subject to the resolver(s) that handle its type and
 * folds their results into one EvidenceBundle via the priority ladder. When no
 * resolver handles the type, it fails closed with UNSUPPORTED_SUBJECT_TYPE.
 *
 * `memoize` wraps a resolver set in an in-memory cache keyed by subject id, so
 * one run never fetches the same subject twice. It holds no TTL and no clock —
 * cache lifetime is exactly the object's lifetime, which the CLI edge owns.
 */
import { makeGap, mergeResults } from "@calllint/evidence"
import type { EvidenceBundle, EvidenceSubject, ResolverResult } from "@calllint/evidence"
import type { EvidenceResolver, ResolverContext } from "./resolverInterface.js"

/** Route a subject to matching resolvers, run them, and merge into a bundle. */
export async function resolveSubject(
  subject: EvidenceSubject,
  resolvers: readonly EvidenceResolver[],
  ctx: ResolverContext,
): Promise<EvidenceBundle> {
  const matching = resolvers.filter((r) => r.handles.includes(subject.subjectType))
  if (matching.length === 0) {
    return mergeResults(subject, [
      {
        resolver: "dispatch",
        status: "unresolvable",
        items: [],
        gaps: [
          makeGap("UNSUPPORTED_SUBJECT_TYPE", `no resolver handles subject type "${subject.subjectType}"`, {
            triedResolvers: [],
          }),
        ],
      },
    ])
  }
  const results: ResolverResult[] = []
  for (const r of matching) {
    results.push(await r.resolve(subject, ctx))
  }
  return mergeResults(subject, results)
}

/**
 * Wrap a resolver so repeat resolutions of the same subject id reuse the first
 * ResolverResult. Deterministic: identical id -> identical cached value.
 */
export function memoize(inner: EvidenceResolver): EvidenceResolver {
  const cache = new Map<string, ResolverResult>()
  return {
    id: inner.id,
    handles: inner.handles,
    async resolve(subject: EvidenceSubject, ctx: ResolverContext): Promise<ResolverResult> {
      const cached = cache.get(subject.id)
      if (cached) return cached
      const result = await inner.resolve(subject, ctx)
      cache.set(subject.id, result)
      return result
    },
  }
}
