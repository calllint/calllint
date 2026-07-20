/**
 * P1-G — the fixed 100-object benchmark corpus (new11 §4.7 / §P1-acceptance / §10.3).
 *
 * Every object carries RECORDED fetch maps (no live network) and a fixed expected
 * outcome, and is built so it exercises the REAL P1 resolvers end-to-end via
 * resolveSubject. Categories mirror §10.3; malicious objects cover the ten attack
 * classes and are engineered to fail closed through genuine resolver logic (never
 * a bespoke "malicious" branch). Conflict objects carry two equal-tier
 * ResolverResults to drive the CONFLICTING_EVIDENCE path through mergeResults.
 */
import type { EvidenceSubject, ResolverResult } from "@calllint/evidence"

export interface CorpusObject {
  id: string
  category: string
  subject: EvidenceSubject
  json: Record<string, unknown>
  text: Record<string, string | undefined>
  /** identity is expected to resolve/pin (denominator for identity + completeness rates). */
  resolvable: boolean
  /** a repo.url is expected (denominator for repo-mapping rate). */
  repoExpected: boolean
  expectClean: boolean
  malicious?: boolean
  /** equal-tier disagreement fed directly to mergeResults (bypasses dispatch). */
  conflict?: [ResolverResult, ResolverResult]
}

const NPM = (name: string) => `https://registry.npmjs.org/${name.replace(/\//g, "%2f")}`
const GH = (owner: string, repo: string) => `https://api.github.com/repos/${owner}/${repo}`
const REG = "https://registry.modelcontextprotocol.io/v0/servers"
const WK = (host: string) => `https://${host}/.well-known/mcp-publisher.json`
const MCP = (origin: string) => `${origin}/.well-known/mcp.json`

const subj = (subjectType: EvidenceSubject["subjectType"], id: string): EvidenceSubject => ({
  schema: "calllint.evidence-subject.v0",
  subjectType,
  id,
})

/** npm with valid provenance → COMPLETE (clean). */
function npmValid(i: number): CorpusObject {
  const name = `good-pkg-${i}`
  return {
    id: `npm-valid-${i}`,
    category: "npm-valid-provenance",
    subject: subj("npm-package", `npm:${name}@1.2.3`),
    json: {
      [NPM(name)]: {
        name,
        "dist-tags": { latest: "1.2.3" },
        repository: { url: `git+https://github.com/acme/${name}.git` },
        versions: {
          "1.2.3": {
            name,
            version: "1.2.3",
            repository: { url: `git+https://github.com/acme/${name}.git` },
            dist: { integrity: "sha512-abc", attestations: { url: "https://x/att" } },
          },
        },
      },
    },
    text: {},
    resolvable: true,
    repoExpected: true,
    expectClean: true,
  }
}

/** npm with integrity but no provenance → PARTIAL (degrading). */
function npmNoProv(i: number): CorpusObject {
  const name = `bare-pkg-${i}`
  return {
    id: `npm-noprov-${i}`,
    category: "npm-no-provenance",
    subject: subj("npm-package", `npm:${name}@0.1.0`),
    json: {
      [NPM(name)]: {
        name,
        "dist-tags": { latest: "0.1.0" },
        repository: `https://github.com/acme/${name}`,
        versions: { "0.1.0": { name, version: "0.1.0", dist: { integrity: "sha512-x" } } },
      },
    },
    text: {},
    resolvable: true,
    repoExpected: true,
    expectClean: false,
  }
}

/** npm where the requested version was never published → UNRESOLVABLE. */
function npmMissingVersion(i: number): CorpusObject {
  const name = `partial-pkg-${i}`
  return {
    id: `npm-missing-${i}`,
    category: "missing-version",
    subject: subj("npm-package", `npm:${name}@9.9.9`),
    json: { [NPM(name)]: { name, "dist-tags": { latest: "2.0.0" }, versions: { "2.0.0": { name, version: "2.0.0", dist: { integrity: "sha512-q" } } } } },
    text: {},
    resolvable: false,
    repoExpected: false,
    expectClean: false,
  }
}

/** public GitHub repo → COMPLETE. */
function githubValid(i: number): CorpusObject {
  const repo = `repo-${i}`
  return {
    id: `gh-valid-${i}`,
    category: "github-verified",
    subject: subj("github-repo", `github.com/acme/${repo}`),
    json: { [GH("acme", repo)]: { full_name: `acme/${repo}`, default_branch: "main", private: false, owner: { login: "acme" } } },
    text: {},
    resolvable: true,
    repoExpected: true,
    expectClean: true,
  }
}

/** GitHub 404 → UNRESOLVABLE (REPOSITORY_UNRESOLVED). */
function githubMissing(i: number): CorpusObject {
  const repo = `missing-${i}`
  return {
    id: `gh-missing-${i}`,
    category: "repository-mismatch",
    subject: subj("github-repo", `github.com/acme/${repo}`),
    json: { [GH("acme", repo)]: { message: "Not Found" } },
    text: {},
    resolvable: false,
    repoExpected: false,
    expectClean: false,
  }
}

/** MCP registry entry with repository → COMPLETE. */
function registryValid(i: number): CorpusObject {
  const name = `io.acme/server-${i}`
  return {
    id: `reg-valid-${i}`,
    category: "registry-valid",
    subject: subj("mcp-registry-entry", name),
    json: {
      [REG]: {
        servers: [
          {
            server: { name, description: "s", version: "1.0.0", repository: { url: `https://github.com/acme/server-${i}` } },
            _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true, publishedAt: "2026-01-01" } },
          },
        ],
      },
    },
    text: {},
    resolvable: true,
    repoExpected: true,
    expectClean: true,
  }
}

/** verified domain → COMPLETE. */
function domainVerified(i: number): CorpusObject {
  const host = `acme-${i}.com`
  return {
    id: `domain-ok-${i}`,
    category: "remote-domain-verified",
    subject: subj("domain", host),
    json: {},
    text: { [WK(host)]: JSON.stringify({ publisher: `acme-${i}` }) },
    resolvable: true,
    repoExpected: false,
    expectClean: true,
  }
}

/** domain with no well-known file → UNRESOLVABLE (REMOTE_OWNER_UNVERIFIED). */
function domainUnverified(i: number): CorpusObject {
  const host = `unknown-${i}.com`
  return {
    id: `domain-no-${i}`,
    category: "remote-domain-unverified",
    subject: subj("domain", host),
    json: {},
    text: { [WK(host)]: undefined },
    resolvable: false,
    repoExpected: false,
    expectClean: false,
  }
}

/** tool manifest, one tool fully annotated → COMPLETE. */
function toolComplete(i: number): CorpusObject {
  const url = `https://tools-${i}.example.com/tools.json`
  return {
    id: `tool-ok-${i}`,
    category: "tool-metadata-complete",
    subject: subj("tool", url),
    json: {
      [url]: {
        tools: [
          {
            name: `t${i}`,
            inputSchema: { type: "object" },
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          },
        ],
      },
    },
    text: {},
    resolvable: true,
    repoExpected: false,
    expectClean: true,
  }
}

/** tool manifest with a sparse tool (missing hints/schema) → PARTIAL. */
function toolMissing(i: number): CorpusObject {
  const url = `https://tools-x-${i}.example.com/tools.json`
  return {
    id: `tool-miss-${i}`,
    category: "tool-metadata-missing",
    subject: subj("tool", url),
    json: { [url]: { tools: [{ name: `t${i}`, annotations: { destructiveHint: true } }] } },
    text: {},
    resolvable: true,
    repoExpected: false,
    expectClean: false,
  }
}

/** remote endpoint with a well-known descriptor → COMPLETE. */
function remoteVerified(i: number): CorpusObject {
  const origin = `https://api-${i}.acme.com`
  return {
    id: `remote-ok-${i}`,
    category: "remote-domain-verified",
    subject: subj("remote-endpoint", `${origin}/mcp`),
    json: {},
    text: { [MCP(origin)]: JSON.stringify({ owner: `acme-${i}`, authModel: "oauth2" }) },
    resolvable: true,
    repoExpected: false,
    expectClean: true,
  }
}

/** The ten §10.3 malicious classes. Each MUST fail closed through real logic. */
function maliciousObjects(): CorpusObject[] {
  const mal = (id: string, subject: EvidenceSubject, json: Record<string, unknown>, text: Record<string, string | undefined> = {}): CorpusObject => ({
    id: `mal-${id}`,
    category: "malicious-metadata",
    subject,
    json,
    text,
    resolvable: false,
    repoExpected: false,
    expectClean: false,
    malicious: true,
  })
  const oversized = "A".repeat(200_000)
  return [
    // 1. path traversal in the package name → parseNpmSpec rejects (MALFORMED_METADATA)
    mal("path-traversal", subj("npm-package", "npm:../../../etc/passwd@1.0.0"), {}),
    // 2. oversized metadata → package doc present but empty versions (PACKAGE_NOT_FOUND)
    mal("oversized", subj("npm-package", "npm:huge@1.0.0"), { [NPM("huge")]: { name: "huge", description: oversized, versions: {} } }),
    // 3. recursive/deeply-nested JSON represented structurally → no versions (PACKAGE_NOT_FOUND)
    mal("recursive-json", subj("npm-package", "npm:deep@1.0.0"), { [NPM("deep")]: { name: "deep", nested: { a: { b: { c: { d: {} } } } }, versions: {} } }),
    // 4. malicious URL in repository → resolves name but stays non-clean (no integrity/prov)
    { ...mal("malicious-url", subj("npm-package", "npm:evil@1.0.0"), { [NPM("evil")]: { name: "evil", "dist-tags": { latest: "1.0.0" }, repository: { url: "javascript:alert(1)" }, versions: { "1.0.0": { name: "evil", version: "1.0.0", dist: {} } } } }), resolvable: true },
    // 5. redirect loop → fetch throws → NETWORK_UNAVAILABLE (retryable, not clean)
    mal("redirect-loop", subj("remote-endpoint", "https://loop.example.com/mcp"), {}, {}),
    // 6. schema poisoning: versions is a string, not an object → PACKAGE_NOT_FOUND
    mal("schema-poison", subj("npm-package", "npm:poison@1.0.0"), { [NPM("poison")]: { name: "poison", versions: "not-an-object" } }),
    // 7. HTML/script injection in a version string → resolves but non-clean; scan must reject
    { ...mal("script-injection", subj("npm-package", "npm:xss@1.0.0"), { [NPM("xss")]: { name: "xss", "dist-tags": { latest: "<script>alert(1)</script>" }, versions: { "<script>alert(1)</script>": { name: "xss", version: "x", dist: {} } } } }), resolvable: true },
    // 8. forged signature (no real attestation object) → provenance still absent → non-clean
    { ...mal("forged-sig", subj("npm-package", "npm:forged@1.0.0"), { [NPM("forged")]: { name: "forged", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { name: "forged", version: "1.0.0", dist: { integrity: "sha512-z", signatures: [] } } } } }), resolvable: true },
    // 9. digest mismatch surfaced as absent integrity → ARTIFACT_DIGEST_UNAVAILABLE
    { ...mal("digest-mismatch", subj("npm-package", "npm:mismatch@1.0.0"), { [NPM("mismatch")]: { name: "mismatch", "dist-tags": { latest: "1.0.0" }, repository: { url: "https://github.com/acme/mismatch" }, versions: { "1.0.0": { name: "mismatch", version: "1.0.0", dist: {} } } } }), resolvable: true },
    // 10. Unicode confusable name → parses, no such package → PACKAGE_NOT_FOUND
    mal("confusable", subj("npm-package", "npm:rеact@1.0.0"), { [NPM("rеact")]: { name: "rеact", versions: {} } }),
  ]
}

/** Equal-tier disagreement on repo.url → CONFLICTING_EVIDENCE (never clean). */
function conflictObject(id: string, category: string, valA: string, valB: string): CorpusObject {
  const mk = (src: string, value: string): ResolverResult => ({
    resolver: src,
    status: "complete",
    items: [
      { field: "identity.name", value: "conflicted", tier: "registry", source: src },
      { field: "identity.version", value: "1.0.0", tier: "registry", source: src },
      { field: "repo.url", value, tier: "registry", source: src },
    ],
    gaps: [],
  })
  return {
    id,
    category,
    subject: subj("mcp-registry-entry", `io.acme/${id}`),
    json: {},
    text: {},
    resolvable: true,
    repoExpected: true,
    expectClean: false,
    conflict: [mk("A", valA), mk("B", valB)],
  }
}

function conflictObjects(): CorpusObject[] {
  const out: CorpusObject[] = []
  for (let i = 0; i < 3; i++) out.push(conflictObject(`repo-mismatch-${i}`, "repository-mismatch", `https://github.com/acme/x${i}`, `https://github.com/evil/x${i}`))
  for (let i = 0; i < 2; i++) out.push(conflictObject(`reg-conflict-${i}`, "conflicting-registry", `https://github.com/a/y${i}`, `https://github.com/b/y${i}`))
  out.push(conflictObject("pub-changed-0", "publisher-changed", "https://github.com/old/z", "https://github.com/new/z"))
  return out
}

/** Assemble the fixed 100-object corpus. Counts are asserted by the benchmark. */
export function buildCorpus(): CorpusObject[] {
  const out: CorpusObject[] = []
  const push = (n: number, f: (i: number) => CorpusObject) => {
    for (let i = 0; i < n; i++) out.push(f(i))
  }
  push(18, npmValid) //          resolvable, repo, clean
  push(12, npmNoProv) //         resolvable, repo, partial
  push(6, npmMissingVersion) //  unresolvable
  push(10, githubValid) //       resolvable, repo, clean
  push(4, githubMissing) //      unresolvable
  push(9, registryValid) //      resolvable, repo, clean
  push(6, domainVerified) //     resolvable, clean
  push(4, domainUnverified) //   unresolvable
  push(6, toolComplete) //       resolvable, clean
  push(4, toolMissing) //        resolvable, partial
  push(5, remoteVerified) //     resolvable, clean
  out.push(...maliciousObjects()) // 10 malicious
  out.push(...conflictObjects()) //   6 conflicts
  return out
}
