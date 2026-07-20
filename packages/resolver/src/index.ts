export {
  parseNpmSpec,
  isPackageRunner,
  isPinnedVersion,
  SHELL_COMMANDS,
  type NpmSpec,
} from "./npmSpec.js"
export { resolveRuntimeBinding } from "./resolveRuntimeBinding.js"
export {
  resolveArtifactIdentity,
  type ArtifactInput,
  type FetchedEntry,
} from "./resolveArtifactIdentity.js"
// Evidence resolvers (new11 P1 §4.2–4.4): subject -> EvidenceBundle.
export {
  type EvidenceResolver,
  type ResolverContext,
  type FetchJson,
  type FetchText,
  npmResolver,
  githubResolver,
  registryResolver,
  domainResolver,
  toolResolver,
  remoteResolver,
  REGISTRY_ENDPOINT,
  normalizeHost,
  normalizeAuthority,
  httpsOrigin,
  resolveSubject,
  memoize,
  P1_RESOLVERS,
} from "./evidence/index.js"
