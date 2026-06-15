import { describe, it, expect } from "vitest"
import {
  fetchNpmFacts,
  findingsFromNpmFacts,
  fetchGithubConfig,
  type FetchJson,
  type FetchText,
} from "../src/index.js"

/** A fake registry document for one package. */
function registryDoc(opts: {
  latest: string
  versions: Record<string, { scripts?: Record<string, string>; deprecated?: string }>
}) {
  return {
    "dist-tags": { latest: opts.latest },
    versions: opts.versions,
  }
}

function fakeFetchJson(map: Record<string, unknown>): FetchJson {
  return async (url) => {
    if (url in map) return map[url]
    throw new Error(`404 ${url}`)
  }
}

const URL_WEATHER = "https://registry.npmjs.org/mcp-weather"

describe("fetchNpmFacts", () => {
  it("resolves a pinned version and reports install scripts", async () => {
    const fetchJson = fakeFetchJson({
      [URL_WEATHER]: registryDoc({
        latest: "2.0.0",
        versions: {
          "1.0.0": { scripts: { postinstall: "node build.js" } },
          "2.0.0": {},
        },
      }),
    })
    const facts = await fetchNpmFacts("mcp-weather@1.0.0", fetchJson)
    expect(facts.versionExists).toBe(true)
    expect(facts.installScripts).toEqual(["postinstall"])
    expect(facts.latestVersion).toBe("2.0.0")
  })

  it("resolves floating specs against dist-tag latest", async () => {
    const fetchJson = fakeFetchJson({
      [URL_WEATHER]: registryDoc({ latest: "2.0.0", versions: { "2.0.0": {} } }),
    })
    const facts = await fetchNpmFacts("mcp-weather@latest", fetchJson)
    expect(facts.resolvedVersion).toBe("2.0.0")
    expect(facts.versionExists).toBe(true)
  })

  it("reports versionExists=false for a missing version", async () => {
    const fetchJson = fakeFetchJson({
      [URL_WEATHER]: registryDoc({ latest: "2.0.0", versions: { "2.0.0": {} } }),
    })
    const facts = await fetchNpmFacts("mcp-weather@9.9.9", fetchJson)
    expect(facts.versionExists).toBe(false)
  })

  it("degrades gracefully on network error", async () => {
    const fetchJson: FetchJson = async () => {
      throw new Error("offline")
    }
    const facts = await fetchNpmFacts("whatever@1.0.0", fetchJson)
    expect(facts.versionExists).toBe(false)
    expect(facts.installScripts).toEqual([])
  })
})

describe("findingsFromNpmFacts", () => {
  it("emits an EXEC finding for install scripts, stamped online + fetchedAt", () => {
    const findings = findingsFromNpmFacts({
      name: "x",
      versionExists: true,
      installScripts: ["postinstall"],
      resolvedVersion: "1.0.0",
    }, "2026-06-01T00:00:00.000Z")
    const f = findings.find((x) => x.id === "supply.install-scripts")!
    expect(f.symbol).toBe("EXEC")
    expect(f.mode).toBe("OBSERVED")
    expect(f.confidence).toBe("high")
    // provenance: online findings must be auditable as network-derived
    expect(f.source).toBe("online")
    expect(f.fetchedAt).toBe("2026-06-01T00:00:00.000Z")
  })

  it("emits a SUPPLY finding for a deprecated version", () => {
    const findings = findingsFromNpmFacts({
      name: "x",
      versionExists: true,
      installScripts: [],
      deprecated: "use y instead",
      resolvedVersion: "1.0.0",
    }, "2026-06-01T00:00:00.000Z")
    expect(findings.some((f) => f.id === "supply.deprecated")).toBe(true)
  })

  it("emits version-not-found and nothing else when the version is missing", () => {
    const findings = findingsFromNpmFacts({
      name: "x",
      versionExists: false,
      installScripts: [],
    }, "2026-06-01T00:00:00.000Z")
    expect(findings).toHaveLength(1)
    expect(findings[0]!.id).toBe("supply.version-not-found")
  })

  it("stamps every online finding with source and fetchedAt", () => {
    const findings = findingsFromNpmFacts({
      name: "x",
      versionExists: false,
      installScripts: [],
    }, "2026-06-01T00:00:00.000Z")
    for (const f of findings) {
      expect(f.source).toBe("online")
      expect(f.fetchedAt).toBe("2026-06-01T00:00:00.000Z")
    }
  })
})

describe("fetchGithubConfig", () => {
  it("returns the first candidate config found", async () => {
    const fetchText: FetchText = async (url) => {
      if (url.endsWith("/.mcp.json")) return '{"mcpServers":{}}'
      return undefined
    }
    const result = await fetchGithubConfig("owner/repo", fetchText, "main")
    expect(result.foundPath).toBe(".mcp.json")
    expect(result.ref).toBe("main")
    expect(result.text).toContain("mcpServers")
  })

  it("returns no text when nothing is found", async () => {
    const fetchText: FetchText = async () => undefined
    const result = await fetchGithubConfig("owner/repo", fetchText)
    expect(result.text).toBeUndefined()
  })
})
