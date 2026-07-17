/**
 * I2c-4 pure reconciliation (ADR 0048 §4). Proves the record lifecycle and the
 * control-proof matching without any GitHub call — the impure bin is a thin wrapper.
 */
import { describe, it, expect } from "vitest"
import {
  reconcileClaims,
  parseGitHubRepo,
  registryRepoIndex,
  type InstallationView,
} from "../src/reconcileClaims.js"
import { EMPTY_CLAIM_STORE, verifiedPublisherFor, type ClaimStore } from "../src/claim.js"
import type { RegistrySnapshot } from "../src/snapshot.js"

const NOW = "2026-07-17T10:00:00.000Z"
const D = (h: string) => `sha256:${h.repeat(64).slice(0, 64)}` as `sha256:${string}`

const snapshot: RegistrySnapshot = {
  schema: "calllint.trust-snapshot.v0",
  source: "official-mcp-registry",
  endpoint: "https://example/registry",
  fetchedAt: NOW,
  count: 2,
  entries: [
    { name: "ai.acme/tool", description: "", version: null, repositoryUrl: "https://github.com/acme/tool", packages: [], remotes: [], status: "active", publishedAt: null },
    { name: "no.repo/x", description: "", version: null, repositoryUrl: null, packages: [], remotes: [], status: "active", publishedAt: null },
  ],
}
const CANON = "mcp-registry/ai.acme-tool"
const repoIndex = registryRepoIndex(snapshot)
const bakedDigests = new Map<string, `sha256:${string}`>([[CANON, D("a")]])
const install = (over: Partial<InstallationView> = {}): InstallationView => ({
  installationId: 111,
  account: "acme",
  repos: [{ owner: "acme", name: "tool" }],
  ...over,
})

describe("parseGitHubRepo", () => {
  it("parses github URLs (with .git, trailing slash, http)", () => {
    expect(parseGitHubRepo("https://github.com/acme/tool")).toEqual({ owner: "acme", name: "tool" })
    expect(parseGitHubRepo("http://github.com/acme/tool.git/")).toEqual({ owner: "acme", name: "tool" })
    expect(parseGitHubRepo("https://gitlab.com/acme/tool")).toBeNull()
    expect(parseGitHubRepo(null)).toBeNull()
  })
})

describe("registryRepoIndex", () => {
  it("indexes only entries with a parseable github repo", () => {
    expect(repoIndex.get("acme/tool")).toBe(CANON)
    expect(repoIndex.size).toBe(1) // the null-repo entry is not indexable
  })
})

describe("reconcileClaims — lifecycle", () => {
  it("records a NEW active claim when an install covers a baked registry repo", () => {
    const store = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install()], repoIndex, bakedDigests, now: NOW })
    expect(store.records).toHaveLength(1)
    expect(store.records[0]).toMatchObject({ canonicalName: CANON, owner: "acme", installationId: 111, status: "active", verifiedAt: NOW, artifactDigest: D("a") })
    // And it verifies through the bake resolver.
    expect(verifiedPublisherFor(store, CANON)?.owner).toBe("acme")
  })

  it("preserves an unchanged prior active record VERBATIM (stable diff, no re-stamp)", () => {
    const first = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install()], repoIndex, bakedDigests, now: NOW })
    // Re-run at a LATER time with a DRIFTED baked digest — the pinned record must not move.
    const again = reconcileClaims({ previous: first, installations: [install()], repoIndex, bakedDigests: new Map([[CANON, D("b")]]), now: "2026-08-01T00:00:00.000Z" })
    expect(again.records).toEqual(first.records)
  })

  it("flips a prior active claim to revoked when the install is gone (fails closed)", () => {
    const first = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install()], repoIndex, bakedDigests, now: NOW })
    const gone = reconcileClaims({ previous: first, installations: [], repoIndex, bakedDigests, now: "2026-08-01T00:00:00.000Z" })
    expect(gone.records[0]).toMatchObject({ canonicalName: CANON, status: "revoked", verifiedAt: "2026-08-01T00:00:00.000Z" })
    expect(verifiedPublisherFor(gone, CANON)).toBeUndefined()
  })

  it("does NOT claim a repo that is not in the registry", () => {
    const store = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install({ repos: [{ owner: "acme", name: "other" }] })], repoIndex, bakedDigests, now: NOW })
    expect(store.records).toHaveLength(0)
  })

  it("does NOT claim when the installing account is not the declared repo owner", () => {
    const store = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install({ account: "impostor" })], repoIndex, bakedDigests, now: NOW })
    expect(store.records).toHaveLength(0)
  })

  it("does NOT claim a registry repo whose page is not baked yet", () => {
    const store = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install()], repoIndex, bakedDigests: new Map(), now: NOW })
    expect(store.records).toHaveLength(0)
  })

  it("two installs on one namespace ⇒ two active records ⇒ bake fails closed (ambiguous)", () => {
    const store = reconcileClaims({
      previous: EMPTY_CLAIM_STORE,
      installations: [install({ installationId: 1 }), install({ installationId: 2 })],
      repoIndex, bakedDigests, now: NOW,
    })
    expect(store.records.filter((r) => r.status === "active")).toHaveLength(2)
    expect(verifiedPublisherFor(store, CANON)).toBeUndefined()
  })

  it("re-observing a revoked namespace creates a fresh active record; keeps the revoked one", () => {
    const first = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install()], repoIndex, bakedDigests, now: NOW })
    const revoked = reconcileClaims({ previous: first, installations: [], repoIndex, bakedDigests, now: "2026-08-01T00:00:00.000Z" })
    const reclaimed = reconcileClaims({ previous: revoked, installations: [install()], repoIndex, bakedDigests, now: "2026-09-01T00:00:00.000Z" })
    expect(reclaimed.records.filter((r) => r.status === "active")).toHaveLength(1)
    expect(reclaimed.records.filter((r) => r.status === "revoked")).toHaveLength(1)
    expect(verifiedPublisherFor(reclaimed, CANON)?.verifiedAt).toBe("2026-09-01T00:00:00.000Z")
  })

  it("output is deterministically sorted regardless of installation input order", () => {
    const a = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install({ installationId: 2 }), install({ installationId: 1 })], repoIndex, bakedDigests, now: NOW })
    const b = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [install({ installationId: 1 }), install({ installationId: 2 })], repoIndex, bakedDigests, now: NOW })
    expect(a).toEqual(b)
  })

  it("an empty installation set over an empty store stays byte-empty (zero-diff default)", () => {
    const store = reconcileClaims({ previous: EMPTY_CLAIM_STORE, installations: [], repoIndex, bakedDigests, now: NOW })
    expect(store).toEqual(EMPTY_CLAIM_STORE satisfies ClaimStore)
  })
})
