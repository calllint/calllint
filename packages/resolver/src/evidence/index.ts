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
export { registryResolver, REGISTRY_ENDPOINT } from "./registryResolver.js"
export { domainResolver, normalizeHost } from "./domainResolver.js"
export { toolResolver, normalizeAuthority } from "./toolResolver.js"
export { remoteResolver, httpsOrigin } from "./remoteResolver.js"
export { resolveSubject, memoize } from "./resolveSubject.js"

import { npmResolver } from "./npmResolver.js"
import { githubResolver } from "./githubResolver.js"
import { registryResolver } from "./registryResolver.js"
import { domainResolver } from "./domainResolver.js"
import { toolResolver } from "./toolResolver.js"
import { remoteResolver } from "./remoteResolver.js"
import type { EvidenceResolver } from "./resolverInterface.js"

/**
 * The P1 resolver set (npm + GitHub + MCP Registry + domain ownership).
 * Order is irrelevant to output — mergeResults resolves purely by tier rank.
 */
export const P1_RESOLVERS: readonly EvidenceResolver[] = [
  npmResolver,
  githubResolver,
  registryResolver,
  domainResolver,
  toolResolver,
  remoteResolver,
]
