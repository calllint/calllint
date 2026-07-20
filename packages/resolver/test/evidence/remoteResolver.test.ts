import { describe, it, expect } from "vitest"
import { remoteResolver, httpsOrigin } from "../../src/evidence/remoteResolver.js"
import type { EvidenceSubject } from "@calllint/evidence"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import { fakeFetchText, remoteDescriptor } from "./fixtures.js"

const CTX = (fetchText: ResolverContext["fetchText"]): ResolverContext => ({
  fetchJson: async () => { throw new Error("R6 must not use fetchJson") },
  fetchText,
  resolvedAt: "2026-07-20T00:00:00.000Z",
})

const subj = (id: string): EvidenceSubject => ({
  schema: "calllint.evidence-subject.v0",
  subjectType: "remote-endpoint",
  id,
})

describe("httpsOrigin", () => {
  it("extracts origin from an https url", () => {
    expect(httpsOrigin("https://api.acme.com/mcp")?.origin).toBe("https://api.acme.com")
  })
  it("rejects http:// (plaintext) and non-urls", () => {
    expect(httpsOrigin("http://api.acme.com")).toBeUndefined()
    expect(httpsOrigin("not a url")).toBeUndefined()
  })
})

describe("R6 remote endpoint resolver", () => {
  it("records url/tls/auth/owner from the descriptor → COMPLETE", async () => {
    const { fetch } = fakeFetchText(remoteDescriptor())
    const r = await remoteResolver.resolve(subj("https://api.acme.com/mcp"), CTX(fetch))
    expect(r.status).toBe("complete")
    const get = (f: string) => r.items.find((i) => i.field === f)?.value
    expect(get("endpoint.url")).toBe("https://api.acme.com")
    expect(get("endpoint.tls")).toBe("https")
    expect(get("endpoint.authModel")).toBe("oauth2")
    expect(get("endpoint.owner")).toBe("acme")
  })

  it("plaintext http → MALFORMED_METADATA, fail closed (no fetch)", async () => {
    const { fetch, calls } = fakeFetchText(remoteDescriptor())
    const r = await remoteResolver.resolve(subj("http://api.acme.com"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("MALFORMED_METADATA")
    expect(calls).toEqual([])
  })

  it("no descriptor → REMOTE_OWNER_UNVERIFIED, still records url+tls", async () => {
    const { fetch } = fakeFetchText({})
    const r = await remoteResolver.resolve(subj("https://api.acme.com"), CTX(fetch))
    expect(r.status).toBe("partial")
    expect(r.gaps.map((g) => g.code)).toContain("REMOTE_OWNER_UNVERIFIED")
    expect(r.items.find((i) => i.field === "endpoint.tls")?.value).toBe("https")
  })

  it("network failure → NETWORK_UNAVAILABLE, retryable (never throws)", async () => {
    const ctx = CTX(async () => { throw new Error("ECONNREFUSED") })
    const r = await remoteResolver.resolve(subj("https://api.acme.com"), ctx)
    expect(r.status).toBe("retryable-failure")
    expect(r.gaps.map((g) => g.code)).toContain("NETWORK_UNAVAILABLE")
  })
})
