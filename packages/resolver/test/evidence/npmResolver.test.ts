import { describe, it, expect } from "vitest"
import { npmResolver } from "../../src/evidence/npmResolver.js"
import type { EvidenceSubject } from "@calllint/evidence"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import {
  fakeFetchJson,
  failingFetch,
  npmValidProvenance,
  npmNoProvenance,
  npmMissingVersion,
  npmNotFound,
} from "./fixtures.js"

const CTX = (fetch: ResolverContext["fetchJson"]): ResolverContext => ({
  fetchJson: fetch,
  fetchText: async () => undefined,
  resolvedAt: "2026-07-20T00:00:00.000Z",
})

const subj = (id: string): EvidenceSubject => ({
  schema: "calllint.evidence-subject.v0",
  subjectType: "npm-package",
  id,
})

function item(items: { field: string; value: string }[], field: string) {
  return items.find((i) => i.field === field)?.value
}

describe("R1 npm resolver", () => {
  it("resolves a pinned package with provenance to COMPLETE", async () => {
    const { fetch } = fakeFetchJson(npmValidProvenance())
    const r = await npmResolver.resolve(subj("npm:good-pkg@1.2.3"), CTX(fetch))
    expect(r.status).toBe("complete")
    expect(r.gaps).toEqual([])
    expect(item(r.items, "identity.name")).toBe("good-pkg")
    expect(item(r.items, "identity.version")).toBe("1.2.3")
    expect(item(r.items, "repo.url")).toContain("github.com/acme/good-pkg")
    expect(item(r.items, "provenance.present")).toBe("true")
    // integrity is artifact-bound (strongest tier).
    expect(r.items.find((i) => i.field === "identity.integrity")?.tier).toBe("artifact-bound")
  })

  it("flags PROVENANCE_UNAVAILABLE (degrading) as PARTIAL, keeping identity", async () => {
    const { fetch } = fakeFetchJson(npmNoProvenance())
    const r = await npmResolver.resolve(subj("bare-pkg@0.1.0"), CTX(fetch))
    expect(r.status).toBe("partial")
    expect(r.gaps.map((g) => g.code)).toContain("PROVENANCE_UNAVAILABLE")
    expect(item(r.items, "identity.version")).toBe("0.1.0")
  })
})

describe("R1 npm resolver — fail-closed", () => {
  it("missing requested version → ARTIFACT_VERSION_UNRESOLVED, unresolvable", async () => {
    const { fetch } = fakeFetchJson(npmMissingVersion())
    const r = await npmResolver.resolve(subj("partial-pkg@9.9.9"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("ARTIFACT_VERSION_UNRESOLVED")
    // name still surfaces even when the version doesn't resolve.
    expect(r.items.some((i) => i.field === "identity.name")).toBe(true)
  })

  it("package absent from registry → PACKAGE_NOT_FOUND", async () => {
    const { fetch } = fakeFetchJson(npmNotFound())
    const r = await npmResolver.resolve(subj("ghost-pkg@1.0.0"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("PACKAGE_NOT_FOUND")
  })

  it("network failure → NETWORK_UNAVAILABLE, retryable-failure (never throws)", async () => {
    const r = await npmResolver.resolve(subj("anything@1.0.0"), CTX(failingFetch))
    expect(r.status).toBe("retryable-failure")
    expect(r.gaps.map((g) => g.code)).toContain("NETWORK_UNAVAILABLE")
  })

  it("non-object registry doc → MALFORMED_METADATA", async () => {
    const ctx = CTX(async () => "not-json")
    const r = await npmResolver.resolve(subj("weird@1.0.0"), ctx)
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("MALFORMED_METADATA")
  })

  it("floating spec resolves against dist-tags.latest", async () => {
    const { fetch } = fakeFetchJson(npmValidProvenance())
    const r = await npmResolver.resolve(subj("good-pkg"), CTX(fetch))
    expect(r.status).toBe("complete")
    expect(r.items.find((i) => i.field === "identity.version")?.value).toBe("1.2.3")
  })

  it("only ever reaches the network through the injected fetcher", async () => {
    const { fetch, calls } = fakeFetchJson(npmValidProvenance())
    await npmResolver.resolve(subj("good-pkg@1.2.3"), CTX(fetch))
    expect(calls).toEqual(["https://registry.npmjs.org/good-pkg"])
  })
})
