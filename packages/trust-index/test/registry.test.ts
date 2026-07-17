/**
 * I1b acceptance tests — the Official MCP Registry cohort (ADR 0038 §1/§5, §3).
 *
 * The load-bearing properties: the entry→config synthesis is deterministic and
 * byte-stable, unmappable entries are recorded `incomplete` (never dropped), the
 * fetch edge keeps only active/isLatest and stays PII-free, and the observation
 * time flows from the snapshot so a re-bake is reproducible.
 */
import { describe, it, expect } from "vitest"
import {
  synthesizeConfigText,
  registryCanonicalName,
  parseSnapshot,
  registryCohort,
  type RegistrySnapshot,
  type SnapshotEntry,
} from "../src/index.js"
import { fetchRegistrySnapshot } from "../src/fetchRegistry.js"

const entry = (over: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  name: "io.example/thing",
  description: "d",
  version: "1.0.0",
  repositoryUrl: null,
  packages: [],
  remotes: [],
  status: "active",
  publishedAt: null,
  ...over,
})

describe("registryCanonicalName", () => {
  it("slugs reverse-DNS names into one safe segment under mcp-registry/", () => {
    expect(registryCanonicalName("ac.inference.sh/mcp")).toBe("mcp-registry/ac.inference.sh-mcp")
    expect(registryCanonicalName("io.github.Owner/Repo Name")).toBe("mcp-registry/io.github.owner-repo-name")
  })
})

describe("synthesizeConfigText", () => {
  it("maps a remote to a url server (transport preserved)", () => {
    const t = synthesizeConfigText(entry({ remotes: [{ type: "streamable-http", url: "https://x.dev/mcp" }] }))
    expect(t).not.toBeNull()
    const cfg = JSON.parse(t!)
    expect(cfg.mcpServers.remote).toEqual({ type: "streamable-http", url: "https://x.dev/mcp" })
  })

  it("maps npm→npx and pypi→uvx package runners", () => {
    const npm = JSON.parse(synthesizeConfigText(entry({ packages: [{ registryType: "npm", identifier: "p", version: "2.0.0", transport: null }] }))!)
    expect(npm.mcpServers.package).toEqual({ command: "npx", args: ["-y", "p@2.0.0"] })
    const py = JSON.parse(synthesizeConfigText(entry({ packages: [{ registryType: "pypi", identifier: "q", version: null, transport: null }] }))!)
    expect(py.mcpServers.package).toEqual({ command: "uvx", args: ["q"] })
  })

  it("returns null when there is nothing to scan", () => {
    expect(synthesizeConfigText(entry())).toBeNull()
  })

  it("is byte-stable regardless of input order (sorted keys)", () => {
    const a = synthesizeConfigText(entry({ remotes: [{ type: "sse", url: "u1" }, { type: "http", url: "u2" }] }))
    const b = synthesizeConfigText(entry({ remotes: [{ type: "sse", url: "u1" }, { type: "http", url: "u2" }] }))
    expect(a).toBe(b)
  })
})

describe("registryCohort", () => {
  const snap: RegistrySnapshot = {
    schema: "calllint.trust-snapshot.v0",
    source: "official-mcp-registry",
    endpoint: "e",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    count: 3,
    entries: [
      entry({ name: "io.b/x", remotes: [{ type: "http", url: "https://b.dev" }] }),
      entry({ name: "io.a/x", packages: [{ registryType: "npm", identifier: "a", version: "1.0.0", transport: null }] }),
      entry({ name: "io.c/x" }), // nothing to scan → incomplete
    ],
  }

  it("sorts by canonical name and injects snapshot.fetchedAt as observedAt", () => {
    const plans = registryCohort(snap)
    expect(plans.map((p) => p.canonicalName)).toEqual([...plans.map((p) => p.canonicalName)].sort())
    const bakeable = plans.filter((p) => p.input)
    expect(bakeable.every((p) => p.input!.observedAt === "2026-01-01T00:00:00.000Z")).toBe(true)
  })

  it("records an unmappable entry as incomplete, never drops it", () => {
    const plans = registryCohort(snap)
    expect(plans.length).toBe(3)
    const incomplete = plans.filter((p) => p.input === null)
    expect(incomplete).toHaveLength(1)
    expect(incomplete[0]!.incompleteReason).toMatch(/nothing to scan/)
  })
})

describe("parseSnapshot", () => {
  it("throws on a wrong schema or non-array entries", () => {
    expect(() => parseSnapshot(JSON.stringify({ schema: "nope", entries: [], fetchedAt: "t" }))).toThrow(/schema/)
    expect(() => parseSnapshot(JSON.stringify({ schema: "calllint.trust-snapshot.v0", entries: {}, fetchedAt: "t" }))).toThrow(/array/)
  })
})

describe("fetchRegistrySnapshot (stubbed network)", () => {
  const body = {
    servers: [
      { server: { name: "io.z/keep", remotes: [{ type: "http", url: "https://z.dev" }] }, _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true, publishedAt: "p" } } },
      { server: { name: "io.a/keep" }, _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true } } },
      { server: { name: "io.old/drop" }, _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: false } } },
      { server: { name: "io.dead/drop" }, _meta: { "io.modelcontextprotocol.registry/official": { status: "deleted", isLatest: true } } },
    ],
  }
  const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch

  it("keeps only active+isLatest, sorts by name, and injects fetchedAt", async () => {
    const snap = await fetchRegistrySnapshot({ now: "2026-02-02T00:00:00.000Z", fetchImpl, maxEntries: 10 })
    expect(snap.entries.map((e) => e.name)).toEqual(["io.a/keep", "io.z/keep"])
    expect(snap.fetchedAt).toBe("2026-02-02T00:00:00.000Z")
    expect(snap.count).toBe(2)
  })

  it("caps the cohort at maxEntries (ADR 0038 §6, not a crawl)", async () => {
    const snap = await fetchRegistrySnapshot({ now: "t", fetchImpl, maxEntries: 1 })
    expect(snap.entries).toHaveLength(1)
    expect(snap.entries[0]!.name).toBe("io.a/keep")
  })
})
