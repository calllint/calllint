/**
 * D6 acceptance tests — publisher-NAMESPACE claim inheritance (ADR 0047 §3, ADR 0053 §3).
 *
 * A single `io.github.owner` claim confers the Verified-Publisher overlay to every
 * current + future child resource under that namespace. The load-bearing properties:
 *
 *   1. The boundary matcher keys off the ORIGINAL reverse-DNS registry name and matches
 *      on EXACT segment equality — NEVER a raw string prefix. So `io.github.calllint`
 *      does NOT confer to a foreign `io.github.calllint-evil/*` (a privilege escalation
 *      a `startsWith` would allow). This is the security crux.
 *   2. It FAILS CLOSED: no cover / ambiguous owners / revoked / no boundary ⇒ undefined.
 *   3. It is a CONSERVATIVE EXTENSION: with no namespace records the resolver is identical
 *      to `verifiedPublisherFor`, so the committed tree bakes byte-for-byte the same.
 *   4. A namespace child surfaces its OWN artifact digest (drift-transparent, no leak).
 *
 * Pure: no I/O, no clock, no network. Mirrors claim.test.ts / bake-claim.test.ts style.
 */
import { describe, it, expect } from "vitest"
import {
  verifiedPublisherFor,
  verifiedPublisherForNamespace,
  registryNamespaceOf,
  namespaceCovers,
  emitAllCohorts,
  type ClaimRecord,
  type ClaimStore,
  type PageClaimCoords,
  type RegistrySnapshot,
} from "../src/index.js"

const DIGEST = "sha256:aaaa" as const
const CHILD_DIGEST = "sha256:cccc" as const
const SCOPE = "sha256:bbbb" as const

// An EXACT-resource record (today's shape — no registryNamespace).
const exact = (over: Partial<ClaimRecord> = {}): ClaimRecord => ({
  schema: "calllint.claim.v0",
  canonicalName: "mcp-registry/io.github.calllint-calllint",
  owner: "calllint",
  installationId: 42,
  artifactDigest: DIGEST,
  scopeDigest: SCOPE,
  verifiedAt: "2026-07-17T00:00:00.000Z",
  status: "active",
  ...over,
})

// A NAMESPACE record — covers every child of the reverse-DNS namespace.
const ns = (registryNamespace: string, over: Partial<ClaimRecord> = {}): ClaimRecord => ({
  schema: "calllint.claim.v0",
  canonicalName: `mcp-registry/${registryNamespace}`,
  owner: "calllint",
  installationId: 42,
  artifactDigest: DIGEST,
  scopeDigest: SCOPE,
  verifiedAt: "2026-07-17T00:00:00.000Z",
  status: "active",
  registryNamespace,
  ...over,
})

const store = (records: ClaimRecord[]): ClaimStore => ({
  schema: "calllint.claim-store.v0",
  records,
})

// A page's coords. `registryName` is the ORIGINAL reverse-DNS name (undefined ⇒ fixture).
const coords = (over: Partial<PageClaimCoords> = {}): PageClaimCoords => ({
  canonicalName: "mcp-registry/io.github.calllint-other",
  registryName: "io.github.calllint/other",
  artifactDigest: CHILD_DIGEST,
  ...over,
})

describe("registryNamespaceOf — segment before the first '/', on the ORIGINAL name", () => {
  it("extracts the reverse-DNS namespace", () => {
    expect(registryNamespaceOf("io.github.calllint/calllint")).toBe("io.github.calllint")
  })
  it("treats an adversarial account as a DISTINCT namespace (not a prefix)", () => {
    expect(registryNamespaceOf("io.github.calllint-evil/tool")).toBe("io.github.calllint-evil")
  })
  it("ignores a hyphen inside the server segment", () => {
    expect(registryNamespaceOf("ai.aarna/atars-mcp")).toBe("ai.aarna")
  })
  it("preserves a hyphen inside the namespace segment", () => {
    expect(registryNamespaceOf("ai.agentic-news/mcp")).toBe("ai.agentic-news")
  })
  it("returns undefined when there is no boundary (fail closed)", () => {
    expect(registryNamespaceOf("nofslash")).toBeUndefined()
    expect(registryNamespaceOf("/leading")).toBeUndefined()
  })
})

describe("namespaceCovers — exact segment equality, never a prefix", () => {
  const record = ns("io.github.calllint")
  it("covers a child of the same namespace", () => {
    expect(namespaceCovers(record, "io.github.calllint/other")).toBe(true)
  })
  it("does NOT cover the adversarial sibling-collision account", () => {
    expect(namespaceCovers(record, "io.github.calllint-evil/tool")).toBe(false)
  })
  it("does NOT cover an unrelated namespace", () => {
    expect(namespaceCovers(record, "ai.aarna/atars-mcp")).toBe(false)
  })
  it("a non-namespace (exact) record covers nothing", () => {
    expect(namespaceCovers(exact(), "io.github.calllint/calllint")).toBe(false)
  })
  it("fails closed for a page with no boundary (fixture / expansion)", () => {
    expect(namespaceCovers(record, undefined)).toBe(false)
  })
})

describe("verifiedPublisherForNamespace — positive coverage", () => {
  it("a namespace claim covers a child, surfacing the CHILD's own digest", () => {
    const vp = verifiedPublisherForNamespace(store([ns("io.github.calllint")]), coords())
    expect(vp).toEqual({
      owner: "calllint",
      verifiedAt: "2026-07-17T00:00:00.000Z",
      observedArtifactDigest: CHILD_DIGEST,
    })
  })

  it("the same claim covers a FUTURE child not present at claim time", () => {
    const vp = verifiedPublisherForNamespace(
      store([ns("io.github.calllint")]),
      coords({ canonicalName: "mcp-registry/io.github.calllint-brand-new", registryName: "io.github.calllint/brand-new" }),
    )
    expect(vp?.owner).toBe("calllint")
  })

  it("an exact record still wins and surfaces the RECORD's pinned digest (today's behavior)", () => {
    const vp = verifiedPublisherForNamespace(
      store([exact()]),
      coords({ canonicalName: "mcp-registry/io.github.calllint-calllint", registryName: "io.github.calllint/calllint" }),
    )
    expect(vp).toEqual({
      owner: "calllint",
      verifiedAt: "2026-07-17T00:00:00.000Z",
      observedArtifactDigest: DIGEST,
    })
  })

  it("exact + namespace of the SAME owner resolves (single owner), exact digest wins", () => {
    const s = store([exact(), ns("io.github.calllint")])
    const vp = verifiedPublisherForNamespace(
      s,
      coords({ canonicalName: "mcp-registry/io.github.calllint-calllint", registryName: "io.github.calllint/calllint" }),
    )
    expect(vp?.owner).toBe("calllint")
    expect(vp?.observedArtifactDigest).toBe(DIGEST) // exact record's pinned digest, no self-regression
  })
})

describe("verifiedPublisherForNamespace — fails closed (ADR 0047 §4)", () => {
  it("the adversarial sibling-collision gets NOTHING (the security-crux assertion)", () => {
    const evil = coords({
      canonicalName: "mcp-registry/io.github.calllint-evil-tool",
      registryName: "io.github.calllint-evil/tool",
    })
    // A naive raw prefix check WOULD have matched — prove it, then prove we don't.
    expect("io.github.calllint-evil".startsWith("io.github.calllint")).toBe(true)
    expect(verifiedPublisherForNamespace(store([ns("io.github.calllint")]), evil)).toBeUndefined()
  })

  it("two namespace records with DIFFERENT owners → undefined (ambiguous, never guess)", () => {
    const s = store([ns("io.github.calllint", { owner: "calllint" }), ns("io.github.calllint", { owner: "impostor", installationId: 99 })])
    expect(verifiedPublisherForNamespace(s, coords())).toBeUndefined()
  })

  it("exact + namespace of DIFFERENT owners covering one page → undefined", () => {
    const child = coords({ canonicalName: "mcp-registry/io.github.calllint-calllint", registryName: "io.github.calllint/calllint" })
    const s = store([exact({ owner: "a" }), ns("io.github.calllint", { owner: "b", installationId: 99 })])
    expect(verifiedPublisherForNamespace(s, child)).toBeUndefined()
  })

  it("a revoked namespace record is inert", () => {
    expect(verifiedPublisherForNamespace(store([ns("io.github.calllint", { status: "revoked" })]), coords())).toBeUndefined()
  })

  it("does not leak across namespaces", () => {
    const other = coords({ canonicalName: "mcp-registry/ai.aarna-atars-mcp", registryName: "ai.aarna/atars-mcp" })
    expect(verifiedPublisherForNamespace(store([ns("io.github.calllint")]), other)).toBeUndefined()
  })

  it("a fixture (no registryName) never inherits from a namespace record, but its exact record still resolves", () => {
    const fixture = coords({ canonicalName: "calllint-fixtures/safe-time", registryName: undefined })
    // Namespace record present but the fixture has no boundary → no inheritance.
    expect(verifiedPublisherForNamespace(store([ns("io.github.calllint")]), fixture)).toBeUndefined()
    // An exact record for the fixture still resolves as today.
    const exactFixture = exact({ canonicalName: "calllint-fixtures/safe-time" })
    expect(verifiedPublisherForNamespace(store([exactFixture]), fixture)?.owner).toBe("calllint")
  })
})

describe("verifiedPublisherForNamespace — conservative extension (the zero-diff lemma)", () => {
  // For ANY store with no namespace records, the new resolver must equal the old one for
  // both a hit and a miss — the executable form of the committed-tree zero-diff argument.
  const noNsStore = store([exact()])
  const hit = coords({ canonicalName: "mcp-registry/io.github.calllint-calllint", registryName: "io.github.calllint/calllint" })
  const miss = coords({ canonicalName: "mcp-registry/ai.aarna-atars-mcp", registryName: "ai.aarna/atars-mcp" })

  it("equals verifiedPublisherFor on a hit when no namespace records exist", () => {
    expect(verifiedPublisherForNamespace(noNsStore, hit)).toEqual(verifiedPublisherFor(noNsStore, hit.canonicalName))
  })
  it("equals verifiedPublisherFor on a miss when no namespace records exist", () => {
    expect(verifiedPublisherForNamespace(noNsStore, miss)).toEqual(verifiedPublisherFor(noNsStore, miss.canonicalName))
    expect(verifiedPublisherForNamespace(noNsStore, miss)).toBeUndefined()
  })
  it("the committed exact record deep-equals today's verifiedPublisher shape", () => {
    // Mirror of the one committed record — same owner/verifiedAt/pinned digest.
    const committed = exact({ verifiedAt: "2026-07-22T02:24:28.289Z", artifactDigest: "sha256:2332" })
    const vp = verifiedPublisherForNamespace(store([committed]), hit)
    expect(vp).toEqual({ owner: "calllint", verifiedAt: "2026-07-22T02:24:28.289Z", observedArtifactDigest: "sha256:2332" })
  })
  it("is deterministic — record order does not change the result", () => {
    const a = store([ns("io.github.calllint", { installationId: 1 }), ns("io.github.calllint", { installationId: 2 })])
    const b = store([...a.records].reverse())
    // (same-owner, different installationId → single owner → resolves, order-independent)
    expect(verifiedPublisherForNamespace(a, coords())).toEqual(verifiedPublisherForNamespace(b, coords()))
  })
})

// End-to-end through emitAllCohorts — the strongest integration proof (mirrors bake-claim).
// A synthetic snapshot with two siblings under one namespace + an adversarial sibling.
const snap = (): RegistrySnapshot => ({
  schema: "calllint.trust-snapshot.v0",
  source: "official-mcp-registry",
  endpoint: "https://example.test/registry",
  fetchedAt: "2026-07-20T00:00:00.000Z",
  count: 3,
  entries: [
    { name: "io.github.acme/one", description: "one", version: "1.0.0", repositoryUrl: null, packages: [{ registryType: "npm", identifier: "acme-one", version: "1.0.0", transport: null }], remotes: [], status: null, publishedAt: null },
    { name: "io.github.acme/two", description: "two", version: "1.0.0", repositoryUrl: null, packages: [{ registryType: "npm", identifier: "acme-two", version: "1.0.0", transport: null }], remotes: [], status: null, publishedAt: null },
    { name: "io.github.acme-evil/x", description: "evil", version: "1.0.0", repositoryUrl: null, packages: [{ registryType: "npm", identifier: "acme-evil-x", version: "1.0.0", transport: null }], remotes: [], status: null, publishedAt: null },
  ],
})

const acmeNsStore = (): ClaimStore =>
  store([ns("io.github.acme", { owner: "acme", installationId: 7, artifactDigest: "sha256:unused" })])

const sidecarOf = (files: { path: string; content: string }[], name: string) =>
  JSON.parse(files.find((f) => f.path === `${name}.json`)!.content)

describe("emitAllCohorts — namespace inheritance end-to-end", () => {
  it("a namespace claim gives BOTH siblings the overlay, each with its OWN digest; the evil sibling gets none", () => {
    const { files } = emitAllCohorts(snap(), acmeNsStore())
    const one = sidecarOf(files, "mcp-registry/io.github.acme-one")
    const two = sidecarOf(files, "mcp-registry/io.github.acme-two")
    const evil = sidecarOf(files, "mcp-registry/io.github.acme-evil-x")

    expect(one.verifiedPublisher?.owner).toBe("acme")
    expect(two.verifiedPublisher?.owner).toBe("acme")
    // Each child surfaces ITS OWN artifact digest — never the record's, never a sibling's.
    expect(one.verifiedPublisher.observedArtifactDigest).toBe(one.artifactDigest)
    expect(two.verifiedPublisher.observedArtifactDigest).toBe(two.artifactDigest)
    expect(one.artifactDigest).not.toBe(two.artifactDigest)
    // The adversarial sibling-collision account inherits NOTHING.
    expect(evil.verifiedPublisher).toBeUndefined()
  })

  it("inheritance never touches the page digest or the index (a claim never alters a verdict)", () => {
    const plain = emitAllCohorts(snap())
    const claimed = emitAllCohorts(snap(), acmeNsStore())
    const pd = (fs: { path: string; content: string }[], n: string) => sidecarOf(fs, n).pageDigest
    expect(pd(claimed.files, "mcp-registry/io.github.acme-one")).toBe(pd(plain.files, "mcp-registry/io.github.acme-one"))
    const idx = (fs: { path: string; content: string }[]) => fs.find((f) => f.path === "index.json")!.content
    expect(idx(claimed.files)).toBe(idx(plain.files))
  })

  it("the claimed child's HTML shows the Verified Publisher block (control, not safety)", () => {
    const { files } = emitAllCohorts(snap(), acmeNsStore())
    const html = files.find((f) => f.path === "mcp-registry/io.github.acme-one.html")!.content
    expect(html).toContain("Verified Publisher")
    expect(html).toContain("github.com/acme")
    expect(html).toContain("it is not a safety claim")
    // The evil sibling stays unclaimed.
    const evilHtml = files.find((f) => f.path === "mcp-registry/io.github.acme-evil-x.html")!.content
    expect(evilHtml).not.toContain("Verified Publisher")
  })
})
