// ---------------------------------------------------------------------------
// calllint-mcp — tool registry (ADR 0025). Pure delegators: each tool validates
// its input, calls @calllint/core, and returns an MCP tool result. NO scoring,
// NO verdict logic here — that all lives in core. Each function is total: bad
// input returns an isError result; it never throws across the JSON-RPC boundary.
// ---------------------------------------------------------------------------

import {
  scanConfigFile,
  scanConfigText,
  checkParsed,
  loadSurfaceText,
  inferOrigin,
  buildBaseline,
  computeDrift,
  renderHostRule,
  renderCiGate,
  RULE_HOSTS,
  CI_GATE_MODES,
  ConfigParseError,
  type ScanOptions,
} from "@calllint/core"
import { renderExplain, NO_EMOJI_STYLE } from "@calllint/report-renderer"
import type { Baseline } from "@calllint/types"

/** MCP tool result shape (text content only — CallLint emits JSON/text). */
export interface ToolResult {
  content: { type: "text"; text: string }[]
  isError?: boolean
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, opts: ScanOptions) => ToolResult
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] }
}
function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true }
}
function json(value: unknown): ToolResult {
  return ok(JSON.stringify(value, null, 2))
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === "string" ? v : undefined
}

/** Wrap a handler so any throw becomes an isError result, never a transport crash. */
function safe(
  fn: (args: Record<string, unknown>, opts: ScanOptions) => ToolResult,
): ToolDef["handler"] {
  return (args, opts) => {
    try {
      return fn(args, opts)
    } catch (e) {
      if (e instanceof ConfigParseError) return err(`Parse error: ${e.message}`)
      return err(e instanceof Error ? e.message : String(e))
    }
  }
}

export const TOOLS: ToolDef[] = [
  {
    name: "scan_mcp_config_path",
    description:
      "Scan an MCP config file on disk and return the full ScanReport (verdict + evidence). Static; never executes the server.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the MCP config file." } },
      required: ["path"],
    },
    handler: safe((args, opts) => {
      const path = str(args, "path")
      if (!path) return err("`path` (string) is required.")
      return json(scanConfigFile(path, opts))
    }),
  },
  {
    name: "scan_mcp_config_json",
    description:
      "Scan MCP config JSON text and return compact decisions (one per server: verdict, fingerprint hash, reason codes). Static; never executes the server.",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "string", description: "Raw MCP config JSON." },
        surface: { type: "string", description: "Optional surface label (e.g. .cursor/mcp.json)." },
      },
      required: ["json"],
    },
    handler: safe((args, opts) => {
      const text = str(args, "json")
      if (!text) return err("`json` (string) is required.")
      const surface = str(args, "surface") ?? "inline:json"
      const loaded = loadSurfaceText(text, surface)
      const results = checkParsed(loaded.parsed, surface, inferOrigin(surface), opts)
      return json(results.map((r) => r.decision))
    }),
  },
  {
    name: "verify_baseline",
    description:
      "Compare a fresh scan of MCP config JSON against a recorded baseline and report drift / rug-pull signals. Static; never executes the server.",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "string", description: "Current MCP config JSON to verify." },
        baseline: {
          type: "string",
          description:
            "Optional baseline JSON (calllint.baseline.v0). If omitted, a baseline is built from `json` and returned for first-time approval.",
        },
        surface: { type: "string", description: "Optional surface label." },
      },
      required: ["json"],
    },
    handler: safe((args, opts) => {
      const text = str(args, "json")
      if (!text) return err("`json` (string) is required.")
      const surface = str(args, "surface")
      const summary = scanConfigText(text, surface, opts)
      const baselineText = str(args, "baseline")
      const generatedAt = opts?.generatedAt ?? new Date().toISOString()
      if (!baselineText) {
        // First-time: emit a baseline to approve and commit.
        return json(buildBaseline(summary, generatedAt))
      }
      let baseline: Baseline
      try {
        baseline = JSON.parse(baselineText) as Baseline
      } catch {
        return err("`baseline` is not valid JSON.")
      }
      return json(computeDrift(baseline, summary, generatedAt))
    }),
  },
  {
    name: "explain_finding",
    description:
      "Return the full evidence-backed explanation for the servers in an MCP config JSON (why each verdict was reached).",
    inputSchema: {
      type: "object",
      properties: {
        json: { type: "string", description: "MCP config JSON." },
        server: { type: "string", description: "Optional server name to explain (default: all)." },
        surface: { type: "string", description: "Optional surface label." },
      },
      required: ["json"],
    },
    handler: safe((args, opts) => {
      const text = str(args, "json")
      if (!text) return err("`json` (string) is required.")
      const surface = str(args, "surface") ?? "inline:json"
      const wanted = str(args, "server")
      const loaded = loadSurfaceText(text, surface)
      const results = checkParsed(loaded.parsed, surface, inferOrigin(surface), opts)
      const picked = wanted
        ? results.filter((r) => r.report.target.name === wanted)
        : results
      if (picked.length === 0) {
        const names = results.map((r) => r.report.target.name).join(", ")
        return err(`Server "${wanted}" not found. Available: ${names || "(none)"}`)
      }
      const text_ = picked.map((r) => renderExplain(r.report, NO_EMOJI_STYLE)).join("\n\n")
      return ok(text_)
    }),
  },
  {
    name: "generate_agent_rule",
    description:
      "Generate the CallLint agent-safety rule text for a host (e.g. claude, cursor, copilot, agents). Paste into the host's rules file.",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: `Target host. One of: ${RULE_HOSTS.join(", ")}.`,
          enum: [...RULE_HOSTS],
        },
      },
      required: ["host"],
    },
    handler: safe((args) => {
      const host = str(args, "host")
      if (!host) return err("`host` (string) is required.")
      if (!(RULE_HOSTS as readonly string[]).includes(host)) {
        return err(`Unknown host "${host}". One of: ${RULE_HOSTS.join(", ")}.`)
      }
      return ok(renderHostRule(host as (typeof RULE_HOSTS)[number]))
    }),
  },
  {
    name: "generate_ci_gate_snippet",
    description:
      "Generate a GitHub Actions workflow (.github/workflows/calllint.yml) that gates a repo on its agent-tool surface. mode=drift fails on approved-state drift; mode=scan-all is report-only.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: `CI gate mode. One of: ${CI_GATE_MODES.join(", ")}. Default: drift.`,
          enum: [...CI_GATE_MODES],
        },
      },
    },
    handler: safe((args) => {
      const mode = str(args, "mode")
      if (mode && !(CI_GATE_MODES as readonly string[]).includes(mode)) {
        return err(`Unknown mode "${mode}". One of: ${CI_GATE_MODES.join(", ")}.`)
      }
      return ok(renderCiGate(mode ? { mode: mode as (typeof CI_GATE_MODES)[number] } : {}))
    }),
  },
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))
