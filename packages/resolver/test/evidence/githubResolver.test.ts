import { describe, it, expect } from "vitest"
import { githubResolver } from "../../src/evidence/githubResolver.js"
import type { EvidenceSubject } from "@calllint/evidence"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import { fakeFetchJson, githubRepo, githubNotFound } from "./fixtures.js"

const CTX = (fetch: ResolverContext["fetchJson"]): ResolverContext => ({
  fetchJson: fetch,
  fetchText: async () => undefined,
  resolvedAt: "2026-07-20T00:00:00.000Z",
})

const subj = (id: string): EvidenceSubject => ({
  schema: "calllint.evidence-subject.v0",
  subjectType: "github-repo",
  id,
})

describe("R2 github resolver", () => {
  it("resolves a public repo to COMPLETE with canonical identity", async () => {
    const { fetch } = fakeFetchJson(githubRepo())
    const r = await githubResolver.resolve(subj("github.com/acme/good-pkg"), CTX(fetch))
    expect(r.status).toBe("complete")
    expect(r.gaps).toEqual([])
    const get = (f: string) => r.items.find((i) => i.field === f)?.value
    expect(get("repo.url")).toBe("https://github.com/acme/good-pkg")
    expect(get("repo.defaultBranch")).toBe("main")
    expect(get("repo.owner")).toBe("acme")
    expect(get("repo.visibility")).toBe("public")
  })

  it.each([
    "github.com/acme/good-pkg",
    "https://github.com/acme/good-pkg",
    "acme/good-pkg",
    "github.com/acme/good-pkg.git",
    "github.com/acme/good-pkg#readme",
  ])("parses id form %s to the same repo", async (id) => {
    const { fetch } = fakeFetchJson(githubRepo())
    const r = await githubResolver.resolve(subj(id), CTX(fetch))
    expect(r.items.find((i) => i.field === "repo.url")?.value).toBe(
      "https://github.com/acme/good-pkg",
    )
  })
})

describe("R2 github resolver — fail-closed", () => {
  it("not-found body → REPOSITORY_UNRESOLVED, unresolvable (never throws)", async () => {
    const { fetch } = fakeFetchJson(githubNotFound())
    const r = await githubResolver.resolve(subj("github.com/acme/missing"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("REPOSITORY_UNRESOLVED")
  })

  it("rate-limit error → RATE_LIMITED, retryable-failure (never throws)", async () => {
    const ctx = CTX(async () => { throw new Error("429 rate limit exceeded") })
    const r = await githubResolver.resolve(subj("github.com/acme/repo"), ctx)
    expect(r.status).toBe("retryable-failure")
    expect(r.gaps.map((g) => g.code)).toContain("RATE_LIMITED")
  })

  it("generic network error → NETWORK_UNAVAILABLE, retryable-failure", async () => {
    const ctx = CTX(async () => { throw new Error("ENOTFOUND api.github.com") })
    const r = await githubResolver.resolve(subj("github.com/acme/repo"), ctx)
    expect(r.status).toBe("retryable-failure")
    expect(r.gaps.map((g) => g.code)).toContain("NETWORK_UNAVAILABLE")
  })

  it("non-object api body → MALFORMED_METADATA", async () => {
    const ctx = CTX(async () => "not an object")
    const r = await githubResolver.resolve(subj("github.com/acme/repo"), ctx)
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("MALFORMED_METADATA")
  })

  it("unparseable id → MALFORMED_METADATA", async () => {
    const { fetch } = fakeFetchJson({})
    const r = await githubResolver.resolve(subj("not-a-repo"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("MALFORMED_METADATA")
  })

  it("only reaches network through injected fetcher", async () => {
    const { fetch, calls } = fakeFetchJson(githubRepo())
    await githubResolver.resolve(subj("acme/good-pkg"), CTX(fetch))
    expect(calls).toEqual(["https://api.github.com/repos/acme/good-pkg"])
  })
})
