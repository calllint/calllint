import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TOOLS, TOOLS_BY_NAME } from "../src/tools.js"
import type { ScanOptions } from "@calllint/core"

const OPTS: ScanOptions = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
}

const BLOCK_JSON = JSON.stringify({
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/"] },
  },
})
const SAFE_JSON = JSON.stringify({
  mcpServers: { time: { command: "npx", args: ["-y", "@modelcontextprotocol/server-time@1.0.0"] } },
})

function call(name: string, args: Record<string, unknown>) {
  const tool = TOOLS_BY_NAME.get(name)
  if (!tool) throw new Error(`no tool ${name}`)
  return tool.handler(args, OPTS)
}

describe("tool registry", () => {
  it("registers exactly the six Phase-5 tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      [
        "explain_finding",
        "generate_agent_rule",
        "generate_ci_gate_snippet",
        "scan_mcp_config_json",
        "scan_mcp_config_path",
        "verify_baseline",
      ].sort(),
    )
  })

  it("every tool has a description and an object input schema", () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.inputSchema.type).toBe("object")
    }
  })
})

describe("scan_mcp_config_json", () => {
  it("returns compact decisions; BLOCK config → BLOCK (positive)", () => {
    const res = call("scan_mcp_config_json", { json: BLOCK_JSON })
    expect(res.isError).toBeFalsy()
    const decisions = JSON.parse(res.content[0]!.text)
    expect(decisions[0].verdict).toBe("BLOCK")
    expect(decisions[0].schemaVersion).toBe("calllint.decision.v0")
  })

  it("SAFE config → SAFE (negative)", () => {
    const decisions = JSON.parse(call("scan_mcp_config_json", { json: SAFE_JSON }).content[0]!.text)
    expect(decisions[0].verdict).toBe("SAFE")
  })

  it("missing json → isError, never throws", () => {
    const res = call("scan_mcp_config_json", {})
    expect(res.isError).toBe(true)
  })

  it("malformed JSON → isError parse message", () => {
    const res = call("scan_mcp_config_json", { json: "{not json" })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/parse error/i)
  })
})

describe("scan_mcp_config_path", () => {
  it("scans a file on disk and returns a ScanReport summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-tool-"))
    try {
      const p = join(dir, "mcp.json")
      writeFileSync(p, BLOCK_JSON)
      const res = call("scan_mcp_config_path", { path: p })
      expect(res.isError).toBeFalsy()
      const report = JSON.parse(res.content[0]!.text)
      expect(report.reports[0].verdict).toBe("BLOCK")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("missing path → isError", () => {
    expect(call("scan_mcp_config_path", {}).isError).toBe(true)
  })
})

describe("verify_baseline", () => {
  it("with no baseline, returns a baseline to approve", () => {
    const res = call("verify_baseline", { json: SAFE_JSON })
    const baseline = JSON.parse(res.content[0]!.text)
    expect(baseline.schemaVersion).toBe("calllint.baseline.v0")
  })

  it("detects drift when the package version changes (rug-pull)", () => {
    const baselineText = call("verify_baseline", { json: SAFE_JSON }).content[0]!.text
    const mutated = SAFE_JSON.replace("server-time@1.0.0", "server-time@2.0.0")
    const res = call("verify_baseline", { json: mutated, baseline: baselineText })
    const drift = JSON.parse(res.content[0]!.text)
    expect(drift.schemaVersion).toBe("calllint.drift.v0")
    expect(drift.drifted).toBe(true)
  })

  it("invalid baseline JSON → isError", () => {
    expect(call("verify_baseline", { json: SAFE_JSON, baseline: "{bad" }).isError).toBe(true)
  })
})

describe("explain_finding", () => {
  it("returns an evidence report for all servers", () => {
    const res = call("explain_finding", { json: BLOCK_JSON })
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toMatch(/label:|class:/)
  })

  it("unknown server name → isError listing available", () => {
    const res = call("explain_finding", { json: BLOCK_JSON, server: "nope" })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/not found/i)
  })
})

describe("generate_agent_rule", () => {
  it("renders a host rule", () => {
    const res = call("generate_agent_rule", { host: "claude" })
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toMatch(/calllint/i)
  })

  it("unknown host → isError", () => {
    expect(call("generate_agent_rule", { host: "frobnicate" }).isError).toBe(true)
  })

  it("missing host → isError", () => {
    expect(call("generate_agent_rule", {}).isError).toBe(true)
  })
})

describe("generate_ci_gate_snippet", () => {
  it("default → drift gate workflow", () => {
    const res = call("generate_ci_gate_snippet", {})
    expect(res.content[0]!.text).toContain("verify --approved --ci")
  })

  it("mode=scan-all → report-only", () => {
    const res = call("generate_ci_gate_snippet", { mode: "scan-all" })
    expect(res.content[0]!.text).toContain("scan-all")
    expect(res.content[0]!.text).not.toContain("verify --approved")
  })

  it("unknown mode → isError", () => {
    expect(call("generate_ci_gate_snippet", { mode: "nuke" }).isError).toBe(true)
  })
})
