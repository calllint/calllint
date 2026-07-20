import { describe, it, expect } from "vitest"
import { resolveSubject, memoize } from "../../src/evidence/resolveSubject.js"
import { npmResolver } from "../../src/evidence/npmResolver.js"
import { githubResolver } from "../../src/evidence/githubResolver.js"
import { P1_RESOLVERS } from "../../src/evidence/index.js"
import { isCleanlyResolved } from "@calllint/evidence"
import type { EvidenceSubject } from "@calllint/evidence"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import { fakeFetchJson, npmValidProvenance, githubRepo, npmNoProvenance } from "./fixtures.js"

const CTX = (fetch: ResolverContext["fetchJson"]): ResolverContext => ({
  fetchJson: fetch,
  fetchText: async () => undefined,
  resolvedAt: "2026-07-20T00:00:00.000Z",
})

const npmSubj = (id: string): EvidenceSubject => ({
  schema: "calllint.evidence-subject.v0",
  subjectType: "npm-package",
  id,
})

describe("resolveSubject dispatch", () => {
  it("routes an npm subject to R1 and produces a clean bundle", async () => {
    const { fetch } = fakeFetchJson(npmValidProvenance())
    const bundle = await resolveSubject(npmSubj("good-pkg@1.2.3"), P1_RESOLVERS, CTX(fetch))
    expect(bundle.state).toBe("COMPLETE")
    expect(isCleanlyResolved(bundle)).toBe(true)
  })

  it("routes a github subject to R2", async () => {
    const { fetch } = fakeFetchJson(githubRepo())
    const bundle = await resolveSubject(
      { schema: "calllint.evidence-subject.v0", subjectType: "github-repo", id: "acme/good-pkg" },
      P1_RESOLVERS,
      CTX(fetch),
    )
    expect(bundle.items.find((i) => i.field === "repo.url")?.value).toContain("acme/good-pkg")
  })

  it("degrading gap keeps the bundle NOT clean (fail-closed)", async () => {
    const { fetch } = fakeFetchJson(npmNoProvenance())
    const bundle = await resolveSubject(npmSubj("bare-pkg@0.1.0"), P1_RESOLVERS, CTX(fetch))
    expect(isCleanlyResolved(bundle)).toBe(false)
  })
})

describe("resolveSubject — unsupported + determinism", () => {
  it("no matching resolver → UNSUPPORTED_SUBJECT_TYPE, not clean", async () => {
    const { fetch } = fakeFetchJson({})
    const bundle = await resolveSubject(
      { schema: "calllint.evidence-subject.v0", subjectType: "domain", id: "example.com" },
      P1_RESOLVERS,
      CTX(fetch),
    )
    expect(bundle.gaps.map((g) => g.code)).toContain("UNSUPPORTED_SUBJECT_TYPE")
    expect(isCleanlyResolved(bundle)).toBe(false)
  })

  it("is deterministic: same subject + responses → identical bundle", async () => {
    const a = await resolveSubject(npmSubj("good-pkg@1.2.3"), P1_RESOLVERS, CTX(fakeFetchJson(npmValidProvenance()).fetch))
    const b = await resolveSubject(npmSubj("good-pkg@1.2.3"), P1_RESOLVERS, CTX(fakeFetchJson(npmValidProvenance()).fetch))
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })
})

describe("memoize", () => {
  it("resolves a subject id only once, reusing the cached result", async () => {
    const { fetch, calls } = fakeFetchJson(npmValidProvenance())
    const cached = memoize(npmResolver)
    const ctx = CTX(fetch)
    const s = npmSubj("good-pkg@1.2.3")
    const r1 = await cached.resolve(s, ctx)
    const r2 = await cached.resolve(s, ctx)
    expect(r2).toBe(r1) // same object reference
    expect(calls.length).toBe(1) // fetched only once
  })

  it("preserves the underlying resolver's id and handles", () => {
    const cached = memoize(githubResolver)
    expect(cached.id).toBe(githubResolver.id)
    expect(cached.handles).toEqual(githubResolver.handles)
  })
})
