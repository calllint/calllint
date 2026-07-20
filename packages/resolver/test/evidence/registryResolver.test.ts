import { describe, it, expect } from "vitest"
import { registryResolver } from "../../src/evidence/registryResolver.js"
import type { EvidenceSubject } from "@calllint/evidence"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import { fakeFetchJson, failingFetch, registryBody } from "./fixtures.js"

const CTX = (fetch: ResolverContext["fetchJson"]): ResolverContext => ({
  fetchJson: fetch,
  fetchText: async () => undefined,
  resolvedAt: "2026-07-20T00:00:00.000Z",
})

const subj = (id: string): EvidenceSubject => ({
  schema: "calllint.evidence-subject.v0",
  subjectType: "mcp-registry-entry",
  id,
})

describe("R3 MCP registry resolver", () => {
  it("resolves a listed server to COMPLETE with registry-tier identity", async () => {
    const { fetch } = fakeFetchJson(registryBody())
    const r = await registryResolver.resolve(subj("io.acme/good-server"), CTX(fetch))
    expect(r.status).toBe("complete")
    const get = (f: string) => r.items.find((i) => i.field === f)
    expect(get("identity.name")?.value).toBe("io.acme/good-server")
    expect(get("identity.version")?.value).toBe("1.2.3")
    expect(get("repo.url")?.tier).toBe("registry")
  })

  it("entry not listed → REGISTRY_ENTRY_MISSING, unresolvable", async () => {
    const { fetch } = fakeFetchJson(registryBody())
    const r = await registryResolver.resolve(subj("io.acme/ghost"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("REGISTRY_ENTRY_MISSING")
  })

  it("network failure → NETWORK_UNAVAILABLE, retryable (never throws)", async () => {
    const r = await registryResolver.resolve(subj("io.acme/good-server"), CTX(failingFetch))
    expect(r.status).toBe("retryable-failure")
    expect(r.gaps.map((g) => g.code)).toContain("NETWORK_UNAVAILABLE")
  })

  it("body without servers array → MALFORMED_METADATA", async () => {
    const ctx = CTX(async () => ({ nope: true }))
    const r = await registryResolver.resolve(subj("io.acme/good-server"), ctx)
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("MALFORMED_METADATA")
  })

  it("entry without repository → REPOSITORY_UNRESOLVED (degrading), still PARTIAL", async () => {
    const body = registryBody()
    const server = (body["https://registry.modelcontextprotocol.io/v0/servers"] as any).servers[0].server
    delete server.repository
    const { fetch } = fakeFetchJson(body)
    const r = await registryResolver.resolve(subj("io.acme/good-server"), CTX(fetch))
    expect(r.status).toBe("partial")
    expect(r.gaps.map((g) => g.code)).toContain("REPOSITORY_UNRESOLVED")
  })
})
