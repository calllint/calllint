/**
 * ADR 0050 acceptance — evidence refinement threaded through the bake.
 *
 * Load-bearing properties:
 *  (1) NO evidence snapshot ⇒ pages are byte-identical to an unrefined bake (the
 *      reproducibility gate holds; fixtures + registry both unaffected until a
 *      snapshot exists).
 *  (2) A cleanly-resolved remote-endpoint bundle moves that registry page from
 *      UNKNOWN → REVIEW, deterministically, with a stated reason — never SAFE.
 *  (3) The evidence snapshot parser refuses PII and a wrong schema.
 */
import { describe, it, expect } from "vitest"
import type { EvidenceBundle } from "@calllint/evidence"
import {
  emitAllCohorts,
  parseEvidenceSnapshot,
  serializeEvidenceSnapshot,
  type EvidenceSnapshot,
  type RegistrySnapshot,
} from "../src/index.js"

const URL = "https://remote.example.com/mcp"

const snapshot: RegistrySnapshot = {
  schema: "calllint.trust-snapshot.v0",
  source: "official-mcp-registry",
  endpoint: "https://registry.example/v0",
  fetchedAt: "2026-07-20T00:00:00.000Z",
  count: 1,
  entries: [
    {
      name: "example/remote-thing",
      description: "a remote MCP server",
      version: "1.0.0",
      repositoryUrl: null,
      packages: [],
      remotes: [{ type: "sse", url: URL }],
      status: "active",
      publishedAt: "2026-07-01T00:00:00.000Z",
    },
  ],
}

const cleanBundle: EvidenceBundle = {
  schema: "calllint.evidence-bundle.v0",
  subject: { schema: "calllint.evidence-subject.v0", subjectType: "remote-endpoint", id: URL },
  state: "COMPLETE",
  items: [
    { field: "endpoint.url", value: URL, tier: "repository", source: "R6:remote" },
    { field: "endpoint.tls", value: "https", tier: "repository", source: "R6:remote" },
  ],
  gaps: [],
}

const evidenceSnap: EvidenceSnapshot = {
  schema: "calllint.evidence-snapshot.v0",
  resolvedAt: "2026-07-20T00:00:00.000Z",
  count: 1,
  bundles: [cleanBundle],
}

const registrySidecars = (files: { path: string; content: string }[]) =>
  files.filter((f) => f.path.startsWith("mcp-registry/") && f.path.endsWith(".json"))

describe("evidence refinement through the bake (ADR 0050)", () => {
  it("no evidence snapshot ⇒ byte-identical to an unrefined bake", () => {
    const withoutArg = emitAllCohorts(snapshot)
    const withNull = emitAllCohorts(snapshot, undefined, null)
    expect(withNull.files).toEqual(withoutArg.files)
  })

  it("the unrefined registry page is UNKNOWN (baseline)", () => {
    const { files } = emitAllCohorts(snapshot)
    const sidecar = registrySidecars(files)[0]!
    const doc = JSON.parse(sidecar.content)
    expect(doc.verdict).toBe("UNKNOWN")
    expect(JSON.stringify(doc)).toContain("Remote endpoint could not be verified")
  })

  it("a cleanly-resolved bundle moves that page UNKNOWN → REVIEW (never SAFE)", () => {
    const { files } = emitAllCohorts(snapshot, undefined, evidenceSnap)
    const sidecar = registrySidecars(files)[0]!
    const doc = JSON.parse(sidecar.content)
    expect(doc.verdict).toBe("REVIEW")
    expect(doc.verdict).not.toBe("SAFE")
    expect(JSON.stringify(doc)).toContain("tool surface not analyzed")
  })

  it("changes the page digest (evidence is bound into the baked bytes)", () => {
    const bare = JSON.parse(registrySidecars(emitAllCohorts(snapshot).files)[0]!.content)
    const refined = JSON.parse(registrySidecars(emitAllCohorts(snapshot, undefined, evidenceSnap).files)[0]!.content)
    expect(refined.pageDigest).not.toBe(bare.pageDigest)
  })

  it("the real registry case (PARTIAL, endpoint reachable, ownership unproven) lifts to REVIEW", () => {
    const realistic: EvidenceSnapshot = {
      ...evidenceSnap,
      bundles: [
        {
          ...cleanBundle,
          state: "PARTIAL",
          gaps: [
            {
              schema: "calllint.evidence-gap.v0",
              code: "REMOTE_OWNER_UNVERIFIED",
              detail: "serves no .well-known/mcp.json descriptor",
              missingFields: ["endpoint.owner"],
              triedResolvers: ["R6:remote"],
            },
          ],
        },
      ],
    }
    const doc = JSON.parse(registrySidecars(emitAllCohorts(snapshot, undefined, realistic).files)[0]!.content)
    expect(doc.verdict).toBe("REVIEW")
    expect(JSON.stringify(doc)).toContain("ownership not verified")
  })

  it("a RETRYABLE_FAILURE bundle does NOT move the verdict (fail-closed)", () => {
    const failed: EvidenceSnapshot = {
      ...evidenceSnap,
      bundles: [{ ...cleanBundle, state: "RETRYABLE_FAILURE" }],
    }
    const doc = JSON.parse(registrySidecars(emitAllCohorts(snapshot, undefined, failed).files)[0]!.content)
    expect(doc.verdict).toBe("UNKNOWN")
  })
})

describe("evidence snapshot parser", () => {
  it("round-trips through serialize → parse", () => {
    const parsed = parseEvidenceSnapshot(serializeEvidenceSnapshot(evidenceSnap))
    expect(parsed.bundles[0]!.subject.id).toBe(URL)
  })

  it("sorts bundles by subject id for byte-stability", () => {
    const two: EvidenceSnapshot = {
      ...evidenceSnap,
      bundles: [
        { ...cleanBundle, subject: { ...cleanBundle.subject, id: "https://z.example" } },
        { ...cleanBundle, subject: { ...cleanBundle.subject, id: "https://a.example" } },
      ],
    }
    const parsed = parseEvidenceSnapshot(serializeEvidenceSnapshot(two))
    expect(parsed.bundles.map((b) => b.subject.id)).toEqual(["https://a.example", "https://z.example"])
  })

  it("refuses a bundle carrying a PII field", () => {
    const pii: EvidenceSnapshot = {
      ...evidenceSnap,
      bundles: [
        {
          ...cleanBundle,
          items: [{ field: "owner.email", value: "x@y.z", tier: "repository", source: "R6:remote" }],
        },
      ],
    }
    expect(() => parseEvidenceSnapshot(serializeEvidenceSnapshot(pii))).toThrow(/PII/)
  })

  it("rejects a wrong schema", () => {
    expect(() => parseEvidenceSnapshot(JSON.stringify({ schema: "nope" }))).toThrow(/schema/)
  })
})
