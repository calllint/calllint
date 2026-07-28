import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TOOLS, TOOLS_BY_NAME } from "../src/tools.js"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
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
  it("registers exactly the shipped tools (6 Phase-5 + Sentinel + Safe Search + 5 Adoption)", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      [
        "calllint_apply_prepared_install",
        "calllint_get_adoption_contract",
        "calllint_guard_external_tools",
        "calllint_prepare_safe_install",
        "calllint_search_agent_tools",
        "calllint_verify_tool_install",
        "calllint_enable_continuous_guard",
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

describe("Sentinel: calllint_guard_external_tools (ADR 0055 §3)", () => {
  const sentinel = TOOLS_BY_NAME.get("calllint_guard_external_tools")!

  it("is registered", () => {
    expect(sentinel).toBeDefined()
  })

  it("description + output together stay ≤2500 bytes (ceiling, ADR 0055 §3)", () => {
    const out = sentinel.handler({}, OPTS).content[0]!.text
    const bytes = Buffer.byteLength(sentinel.description + out, "utf8")
    expect(bytes).toBeLessThan(2500)
  })

  it("is honest presence, never an injected instruction (no imperative to the host agent)", () => {
    const out = sentinel.handler({}, OPTS).content[0]!.text
    const corpus = (sentinel.description + " " + out).toLowerCase()
    // §七 forbidden: copy that coerces/redirects/impersonates the agent's own turn.
    for (const phrase of ["you must", "ignore previous", "ignore the", "always call", "you should always", "do not proceed until"]) {
      expect(corpus).not.toContain(phrase)
    }
  })

  it("is a pure delegator: presence only, holds no logic, changes no verdict", () => {
    const res = sentinel.handler({}, OPTS)
    expect(res.isError).toBeFalsy()
    const doc = JSON.parse(res.content[0]!.text)
    expect(doc.present).toBe(true)
    expect(doc.unknownIsNeverSafe).toBe(true)
    // Echoes the SHIPPED boundary-safe labels verbatim (single source of truth).
    expect(doc.verdictLabels.SAFE).toBe("No blockers observed")
    expect(doc.verdictLabels.UNKNOWN).toBe("Insufficient evidence")
  })
})

describe("Safe Search: calllint_search_agent_tools (ADR 0055 §4)", () => {
  const search = TOOLS_BY_NAME.get("calllint_search_agent_tools")!
  const run = (args: Record<string, unknown>) => JSON.parse(search.handler(args, OPTS).content[0]!.text)

  it("is registered and never errors on a plain query", () => {
    expect(search).toBeDefined()
    expect(search.handler({ query: "mcp-registry" }, OPTS).isError).toBeFalsy()
  })

  it("blank query returns every committed page, sorted by name", () => {
    const doc = run({ query: "" })
    expect(doc.matchCount).toBeGreaterThan(0)
    expect(doc.results.length).toBe(doc.matchCount)
    const names = doc.results.map((r: { canonicalName: string }) => r.canonicalName)
    expect([...names].sort()).toEqual(names) // already alphabetical
  })

  it("is deterministic: same query → identical results", () => {
    expect(run({ query: "ai.a" })).toEqual(run({ query: "ai.a" }))
  })

  it("matches by exact → prefix → substring and is case-insensitive", () => {
    const lower = run({ query: "mcp-registry" })
    const upper = run({ query: "MCP-REGISTRY" })
    // The match itself is case-insensitive: same matches, same order, same counts.
    // (The doc echoes the raw query verbatim, so the `query` field legitimately differs.)
    expect(upper.results).toEqual(lower.results)
    expect(upper.matchCount).toBe(lower.matchCount)
    // Every result actually contains the needle (substring match, no fuzzy).
    for (const r of lower.results) {
      expect(r.canonicalName.toLowerCase()).toContain("mcp-registry")
    }
  })

  it("surfaces the shipped verdict + boundary-safe label VERBATIM (computes none)", () => {
    const doc = run({ query: "" })
    for (const r of doc.results) {
      // Verdict is one of the four shipped values, label is the shipped public label.
      expect(["SAFE", "REVIEW", "BLOCK", "UNKNOWN"]).toContain(r.verdict)
      expect(r.verdictLabel).toBe(VERDICT_PUBLIC_LABEL[r.verdict as keyof typeof VERDICT_PUBLIC_LABEL])
      expect(r.url).toBe(`/trust/${r.canonicalName}`)
      expect(r.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it("an unmatched query returns nothing (absence is not a verdict)", () => {
    const doc = run({ query: "definitely-no-such-resource-xyz" })
    expect(doc.matchCount).toBe(0)
    expect(doc.results).toEqual([])
  })

  it("honors an integer limit without reordering", () => {
    const all = run({ query: "" })
    const capped = run({ query: "", limit: 3 })
    expect(capped.returned).toBe(3)
    expect(capped.matchCount).toBe(all.matchCount) // total still reported honestly
    expect(capped.results).toEqual(all.results.slice(0, 3))
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
