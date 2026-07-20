import { describe, it, expect } from "vitest"
import { toolResolver, normalizeAuthority } from "../../src/evidence/toolResolver.js"
import type { EvidenceSubject } from "@calllint/evidence"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import { fakeFetchJson, failingFetch, toolManifest } from "./fixtures.js"

const CTX = (fetch: ResolverContext["fetchJson"]): ResolverContext => ({
  fetchJson: fetch,
  fetchText: async () => undefined,
  resolvedAt: "2026-07-20T00:00:00.000Z",
})

const subj = (id: string): EvidenceSubject => ({
  schema: "calllint.evidence-subject.v0",
  subjectType: "tool",
  id,
})

describe("normalizeAuthority", () => {
  it("destructive hint dominates and reports complete when all four present", () => {
    expect(
      normalizeAuthority({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }),
    ).toEqual({ scope: "destructive", complete: true })
  })
  it("read-only when flagged; incomplete when hints missing", () => {
    expect(normalizeAuthority({ readOnlyHint: true })).toEqual({ scope: "read-only", complete: false })
  })
  it("defaults to read-write when no positive hint", () => {
    expect(normalizeAuthority({}).scope).toBe("read-write")
  })
})

describe("R5 tool metadata resolver", () => {
  it("reads declared tools + folds authority; sparse tool → PARTIAL with degrading gaps", async () => {
    const { fetch } = fakeFetchJson(toolManifest())
    const r = await toolResolver.resolve(subj("https://example.com/tools.json"), CTX(fetch))
    expect(r.status).toBe("partial")
    const get = (f: string) => r.items.find((i) => i.field === f)?.value
    expect(get("tool.count")).toBe("2")
    expect(get("tool.0.name")).toBe("read_file")
    expect(get("tool.0.authority")).toBe("read-only")
    expect(get("tool.1.authority")).toBe("destructive")
    const codes = r.gaps.map((g) => g.code)
    expect(codes).toContain("AUTHORITY_SCOPE_INCOMPLETE")
    expect(codes).toContain("TOOL_METADATA_UNAVAILABLE")
  })

  it("network failure → NETWORK_UNAVAILABLE, retryable (never throws)", async () => {
    const r = await toolResolver.resolve(subj("https://example.com/tools.json"), CTX(failingFetch))
    expect(r.status).toBe("retryable-failure")
    expect(r.gaps.map((g) => g.code)).toContain("NETWORK_UNAVAILABLE")
  })

  it("empty tools array → TOOL_METADATA_UNAVAILABLE", async () => {
    const { fetch } = fakeFetchJson({ "https://x/t.json": { tools: [] } })
    const r = await toolResolver.resolve(subj("https://x/t.json"), CTX(fetch))
    expect(r.status).toBe("unresolvable")
    expect(r.gaps.map((g) => g.code)).toContain("TOOL_METADATA_UNAVAILABLE")
  })
})
