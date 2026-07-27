/**
 * The Trust lookup surface (ADR 0055 §5): schema-compatibility + anti-drift.
 *
 * Convention B (like `telemetry-event` / `trust-event`): this schema owns its test here
 * and stays OUT of the consolidated `tests/schema/schema-compatibility.test.ts` gate. The
 * cases below validate the EMITTED `lookup-index.json` (built by the shipping
 * `renderLookupIndex` / `emitAllCohorts`, never hand-authored) against the committed
 * schema, so code and schema cannot drift.
 *
 * The load-bearing invariant (§5 "no LLM, no fuzzy"; ADR 0053 §3 immutable observation):
 * the lookup index is a pure projection of the SAME baked `index.json` entries — every
 * lookup entry corresponds to a baked index entry with a MATCHING verdict + digest, and
 * the lookup surface adds NO index entry and moves NO page digest.
 *
 * Pure: no I/O beyond reading the committed schema, no clock, no network.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, it, expect } from "vitest"
import { emitAllCohorts, renderLookupIndex, type RegistrySnapshot } from "../src/index.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const schema = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "schemas/calllint.trust-lookup-index.v1.schema.json"), "utf8"),
)
// strict:false matches the project convention (format:"date-time" is documentation, not
// a validated constraint) — see packages/evidence/test/model-schema.test.ts.
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

// A minimal real-resource cohort: two mappable Official-MCP-Registry entries (mirrors
// discovery.test.ts) so the lookup index has real baked resources to project.
const registrySnapshot: RegistrySnapshot = {
  schema: "calllint.trust-snapshot.v0",
  source: "official-mcp-registry",
  endpoint: "e",
  fetchedAt: "2026-02-02T00:00:00.000Z",
  count: 2,
  entries: [
    { name: "io.a/thing", description: "d", version: "1.0.0", repositoryUrl: null, packages: [{ registryType: "npm", identifier: "a", version: "1.0.0", transport: null }], remotes: [], status: "active", publishedAt: null },
    { name: "io.b/thing", description: "d", version: "1.0.0", repositoryUrl: null, packages: [], remotes: [{ type: "http", url: "https://b.dev" }], status: "active", publishedAt: null },
  ],
}

const lookupOf = (files: { path: string; content: string }[]) =>
  JSON.parse(files.find((f) => f.path === "lookup-index.json")!.content)
const indexOf = (files: { path: string; content: string }[]) =>
  JSON.parse(files.find((f) => f.path === "index.json")!.content)

describe("calllint.trust-lookup-index.v1 — schema compatibility", () => {
  it("the EMITTED lookup-index.json validates against the committed schema", () => {
    const { files } = emitAllCohorts(registrySnapshot)
    const ok = validate(lookupOf(files))
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it("wire tag == the schema const (identity cannot drift)", () => {
    const { files } = emitAllCohorts(registrySnapshot)
    expect(lookupOf(files).schema).toBe(schema.properties.schema.const)
    expect(lookupOf(files).schema).toBe("calllint.trust-lookup-index.v1")
  })

  it("rejects a malformed instance (fail-closed) and an unknown property", () => {
    expect(validate({ schema: "calllint.trust-lookup-index.v1", entries: [{ canonicalName: "x" }] })).toBe(false)
    expect(validate({ schema: "wrong.tag", entries: [] })).toBe(false)
    // A per-entry verdict outside the enum is rejected.
    expect(
      validate({
        schema: "calllint.trust-lookup-index.v1",
        entries: [{ canonicalName: "x", url: "/trust/x", verdict: "MAYBE", verdictLabel: "l", artifactDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z" }],
      }),
    ).toBe(false)
    // additionalProperties:false — an unknown top-level key is rejected.
    expect(validate({ schema: "calllint.trust-lookup-index.v1", entries: [], __unexpected__: 1 })).toBe(false)
  })

  it("is deterministic and sorted by canonicalName (byte-stable projection)", () => {
    const forward = renderLookupIndex([
      { canonicalName: "b", verdict: "SAFE", artifactDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-02T00:00:00.000Z" },
      { canonicalName: "a", verdict: "REVIEW", artifactDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z" },
    ])
    const reversed = renderLookupIndex([
      { canonicalName: "a", verdict: "REVIEW", artifactDigest: `sha256:${"a".repeat(64)}`, observedAt: "2026-01-01T00:00:00.000Z" },
      { canonicalName: "b", verdict: "SAFE", artifactDigest: `sha256:${"b".repeat(64)}`, observedAt: "2026-01-02T00:00:00.000Z" },
    ])
    expect(reversed).toBe(forward)
    const names = JSON.parse(forward).entries.map((e: { canonicalName: string }) => e.canonicalName)
    expect(names).toEqual(["a", "b"])
  })
})

describe("lookup index ⊆ trust index — anti-drift (ADR 0053 §3 immutable observation)", () => {
  it("every lookup entry corresponds to a baked index entry with matching verdict + digest", () => {
    const { files } = emitAllCohorts(registrySnapshot)
    const lookup = lookupOf(files)
    const index = indexOf(files)
    const byName = new Map(
      (index.entries as { canonicalName: string; status: string; verdict: string | null; artifactDigest: string | null }[]).map(
        (e) => [e.canonicalName, e],
      ),
    )
    expect(lookup.entries.length).toBeGreaterThan(0)
    for (const le of lookup.entries as { canonicalName: string; verdict: string; artifactDigest: string; url: string }[]) {
      const ie = byName.get(le.canonicalName)
      expect(ie, `lookup entry ${le.canonicalName} must exist in index.json`).toBeTruthy()
      expect(ie!.status).toBe("baked")
      expect(le.verdict).toBe(ie!.verdict)
      expect(le.artifactDigest).toBe(ie!.artifactDigest)
      expect(le.url).toBe(`/trust/${le.canonicalName}`)
    }
  })

  it("lists real baked resources only — never a fixture or an incomplete entry", () => {
    const { files } = emitAllCohorts(registrySnapshot)
    const lookup = lookupOf(files)
    const names = (lookup.entries as { canonicalName: string }[]).map((e) => e.canonicalName)
    for (const n of names) expect(n.startsWith("calllint-fixtures/")).toBe(false)
    // The real registry resources ARE present.
    expect(names).toContain("mcp-registry/io.a-thing")
    expect(names).toContain("mcp-registry/io.b-thing")
  })

  it("a fixtures-only bake emits a valid, empty lookup index (fixtures excluded)", () => {
    const { files } = emitAllCohorts(null)
    const lookup = lookupOf(files)
    expect(validate(lookup)).toBe(true)
    expect(lookup.entries).toEqual([])
  })
})
