import { describe, it, expect } from "vitest"
import { resolveSubject } from "../../src/evidence/resolveSubject.js"
import { isCleanlyResolved } from "@calllint/evidence"
import type { EvidenceSubject } from "@calllint/evidence"
import type { EvidenceResolver, ResolverContext } from "../../src/evidence/resolverInterface.js"

const CTX: ResolverContext = {
  fetchJson: async () => { throw new Error("no network in conflict test") },
  fetchText: async () => undefined,
  resolvedAt: "2026-07-20T00:00:00.000Z",
}

const subject: EvidenceSubject = {
  schema: "calllint.evidence-subject.v0",
  subjectType: "npm-package",
  id: "npm:contested@1.0.0",
}

/** Build a stub resolver that always returns one item at a given tier/value. */
function stub(id: string, field: string, value: string, tier: any): EvidenceResolver {
  return {
    id,
    handles: ["npm-package"],
    resolve: async () => ({ resolver: id, status: "complete", items: [{ field, value, tier, source: id }], gaps: [] }),
  }
}

describe("conflict handling via resolveSubject", () => {
  it("equal-tier disagreement on a field → CONFLICTING_EVIDENCE, field dropped, not clean", async () => {
    const a = stub("A", "repo.url", "https://github.com/acme/x", "registry")
    const b = stub("B", "repo.url", "https://github.com/evil/x", "registry")
    const bundle = await resolveSubject(subject, [a, b], CTX)
    expect(bundle.gaps.map((g) => g.code)).toContain("CONFLICTING_EVIDENCE")
    // The contested field is dropped (fail-closed): no repo.url item survives.
    expect(bundle.items.some((i) => i.field === "repo.url")).toBe(false)
    expect(isCleanlyResolved(bundle)).toBe(false)
  })

  it("higher tier wins over lower without raising a conflict", async () => {
    const low = stub("LOW", "repo.url", "https://github.com/acme/low", "inferred")
    const high = stub("HIGH", "repo.url", "https://github.com/acme/high", "artifact-bound")
    const bundle = await resolveSubject(subject, [low, high], CTX)
    expect(bundle.gaps.map((g) => g.code)).not.toContain("CONFLICTING_EVIDENCE")
    const repo = bundle.items.find((i) => i.field === "repo.url")
    expect(repo?.value).toBe("https://github.com/acme/high")
    expect(repo?.tier).toBe("artifact-bound")
  })

  it("same value at equal tier is agreement, not conflict", async () => {
    const a = stub("A", "repo.url", "https://github.com/acme/x", "registry")
    const b = stub("B", "repo.url", "https://github.com/acme/x", "registry")
    const bundle = await resolveSubject(subject, [a, b], CTX)
    expect(bundle.gaps.map((g) => g.code)).not.toContain("CONFLICTING_EVIDENCE")
    expect(bundle.items.find((i) => i.field === "repo.url")?.value).toBe("https://github.com/acme/x")
  })
})
