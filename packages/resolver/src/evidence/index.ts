/**
 * Evidence resolvers (new11 P1 §4.2–4.4) — the identity-resolution surface of
 * @calllint/resolver. Distinct from the runtime-binding resolver: these turn a
 * subject into an EvidenceBundle of tiered facts + coded gaps.
 */
export {
  type EvidenceResolver,
  type ResolverContext,
  type FetchJson,
  type FetchText,
} from "./resolverInterface.js"
export { npmResolver } from "./npmResolver.js"
export { githubResolver } from "./githubResolver.js"
export { resolveSubject, memoize } from "./resolveSubject.js"

import { npmResolver } from "./npmResolver.js"
import { githubResolver } from "./githubResolver.js"
import type { EvidenceResolver } from "./resolverInterface.js"

/** The resolvers shipped in P1 PR-06 (npm + GitHub). Order is irrelevant to output. */
export const P1_RESOLVERS: readonly EvidenceResolver[] = [npmResolver, githubResolver]
