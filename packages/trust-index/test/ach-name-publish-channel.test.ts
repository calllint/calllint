import { describe, expect, it } from "vitest"
import type { EvidenceBundle } from "@calllint/evidence"
import { bakeTrustPage } from "../src/bakeTrustPage.js"
import { registryCohort } from "../src/registryCohort.js"
import { publishChannel } from "../src/publishChannel.js"
import type { RegistrySnapshot } from "../src/snapshot.js"

const endpoint = "https://mom.achromat.ai/mcp"
// Recorded registry metadata, not an invocation of the server or a claim about
// its runtime safety. Evidence is injected to exercise the scheduled bake path.
const snapshot: RegistrySnapshot = {
  schema: "calllint.trust-snapshot.v0", source: "official-mcp-registry",
  endpoint: "https://registry.modelcontextprotocol.io/v0/servers",
  fetchedAt: "2026-11-01T13:23:33.000Z", count: 1,
  entries: [{
    name: "ai.achromat/mcp-server", description: "Recall tool-call arguments before execution.",
    version: "0.1.4", repositoryUrl: "https://github.com/achromat-ai/achromat-mcp-server",
    packages: [{ registryType: "npm", identifier: "@achromat-ai/mcp-server", version: "0.1.3", transport: "stdio" }],
    remotes: [{ type: "streamable-http", url: endpoint }], status: "active", publishedAt: null,
  }],
}
const bundle: EvidenceBundle = {
  schema: "calllint.evidence-bundle.v0",
  subject: { schema: "calllint.evidence-subject.v0", subjectType: "remote-endpoint", id: endpoint },
  state: "PARTIAL",
  items: [
    { field: "endpoint.url", value: endpoint, tier: "repository", source: "R6:remote" },
    { field: "endpoint.tls", value: "https", tier: "repository", source: "R6:remote" },
  ],
  gaps: [{ schema: "calllint.evidence-gap.v0", code: "REMOTE_OWNER_UNVERIFIED",
    detail: "injected ownership gap", missingFields: ["endpoint.owner"], triedResolvers: ["R6:remote"] }],
}

describe("Achromat registry ingestion preserves the publication boundary", () => {
  it("refined metadata does not turn unrelated letters into a party-negative financial claim", () => {
    const input = registryCohort(snapshot)[0]!.input!
    const bare = bakeTrustPage(input)
    expect(bare.verdict).toBe("UNKNOWN")
    const page = bakeTrustPage({ ...input, evidence: new Map([[endpoint, bundle]]) })
    expect(page.verdict).toBe("REVIEW")
    expect(page.scan.reports.flatMap((r) => r.findings).some((f) => f.id === "action.financial")).toBe(false)
    expect(publishChannel(page)).toBe("AUTO_PUBLISH")
  })

  it("a genuine ACH package remains a negative claim held for human review", () => {
    const financial = structuredClone(snapshot)
    financial.entries[0]!.packages[0]!.identifier = "@example/ach-client"
    const page = bakeTrustPage({ ...registryCohort(financial)[0]!.input!, evidence: new Map([[endpoint, bundle]]) })
    expect(page.verdict).toBe("REVIEW")
    expect(page.scan.reports.flatMap((r) => r.findings).some((f) => f.id === "action.financial")).toBe(true)
    expect(publishChannel(page)).toBe("REVIEW_HOLD")
  })
})
