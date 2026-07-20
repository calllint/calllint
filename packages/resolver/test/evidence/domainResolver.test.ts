import { describe, it, expect } from "vitest"
import { domainResolver, normalizeHost } from "../../src/evidence/domainResolver.js"
import type { EvidenceSubject } from "@calllint/evidence"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import { fakeFetchText, wellKnownFiles } from "./fixtures.js"

const CTX = (fetchText: ResolverContext["fetchText"]): ResolverContext => ({
  fetchJson: async () => { throw new Error("R4 must not use fetchJson") },
  fetchText,
  resolvedAt: "2026-07-20T00:00:00.000Z",
})

const subj = (id: string): EvidenceSubject => ({
  schema: "calllint.evidence-subject.v0",
  subjectType: "domain",
  id,
})

describe("normalizeHost", () => {
  it.each([
    ["example.com", "example.com"],
    ["https://Example.com/path?q=1", "example.com"],
    ["http://acme.com:8443/x", "acme.com"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeHost(input)).toBe(expected)
  })
  it.each(["", "localhost", "no dots", "bad host.com"])("rejects invalid host %s", (bad) => {
    expect(normalizeHost(bad)).toBeUndefined()
  })
})

describe("R4 domain resolver", () => {
  it("verified well-known file → COMPLETE with owner + https(publisher-signed)", async () => {
    const { fetch } = fakeFetchText(wellKnownFiles("acme"))
    const r = await domainResolver.resolve(subj("acme.com"), CTX(fetch))
    expect(r.status).toBe("complete")
    const get = (f: string) => r.items.find((i) => i.field === f)
    expect(get("domain.owner")?.value).toBe("acme")
    expect(get("domain.owner")?.tier).toBe("publisher-signed")
    expect(get("domain.https")?.value).toBe("valid")
  })

  it("no well-known file (404) → REMOTE_OWNER_UNVERIFIED, still records https valid", async () => {
    const { fetch } = fakeFetchText({})
    const r = await domainResolver.resolve(subj("acme.com"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("REMOTE_OWNER_UNVERIFIED")
    expect(r.items.find((i) => i.field === "domain.https")?.value).toBe("valid")
  })
})

describe("R4 domain resolver — fail-closed + privacy", () => {
  it("network failure → NETWORK_UNAVAILABLE, retryable (never throws)", async () => {
    const ctx = CTX(async () => { throw new Error("ETIMEDOUT") })
    const r = await domainResolver.resolve(subj("acme.com"), ctx)
    expect(r.status).toBe("retryable-failure")
    expect(r.gaps.map((g) => g.code)).toContain("NETWORK_UNAVAILABLE")
  })

  it("unparseable well-known file → MALFORMED_METADATA", async () => {
    const { fetch } = fakeFetchText({
      "https://acme.com/.well-known/mcp-publisher.json": "{ not json",
    })
    const r = await domainResolver.resolve(subj("acme.com"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("MALFORMED_METADATA")
  })

  it("well-known file missing publisher field → REMOTE_OWNER_UNVERIFIED", async () => {
    const { fetch } = fakeFetchText({
      "https://acme.com/.well-known/mcp-publisher.json": JSON.stringify({ note: "hi" }),
    })
    const r = await domainResolver.resolve(subj("acme.com"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("REMOTE_OWNER_UNVERIFIED")
  })

  it("invalid host → MALFORMED_METADATA, never reaches the network", async () => {
    const { fetch, calls } = fakeFetchText(wellKnownFiles())
    const r = await domainResolver.resolve(subj("not-a-host"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("MALFORMED_METADATA")
    expect(calls).toEqual([]) // no fetch for a bad host
  })

  it("only fetches the well-known path (no WHOIS/other endpoints)", async () => {
    const { fetch, calls } = fakeFetchText(wellKnownFiles())
    await domainResolver.resolve(subj("acme.com"), CTX(fetch))
    expect(calls).toEqual(["https://acme.com/.well-known/mcp-publisher.json"])
  })
})
