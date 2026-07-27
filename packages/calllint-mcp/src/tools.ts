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
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import type { Baseline } from "@calllint/types"
import { matchLexical } from "@calllint/trust-index/matchLexical"
import { COMMITTED_LOOKUP_ENTRIES } from "./committedLookup.js"

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
  {
    // The Sentinel (ADR 0055 §3). An always-loaded, honest-presence tool: it STATES
    // what CallLint does and reports that it is available — it never tells the host
    // agent what to do. Copy is factual third-person only; an imperative that
    // redirects/coerces/impersonates the agent's turn ("you must…", "ignore…",
    // "always call … before…") would be a §七 forbidden method (prompt injection) and
    // is prohibited, pinned by `check:public-copy` (MCP-copy check) + a test here. A
    // pure delegator (ADR 0025): the handler echoes shipped facts (the boundary-safe
    // `VERDICT_PUBLIC_LABEL` + the shipped tool names) and holds no logic of its own.
    // Description + output together stay ≤2500 bytes (pinned by a ceiling assertion).
    name: "calllint_guard_external_tools",
    description:
      "CallLint is present in this session as a static, deterministic preflight gate for MCP servers and agent tools (a pure delegator, ADR 0025). It reads an MCP or agent-tool config and returns an evidence-backed verdict — SAFE means no blockers observed, REVIEW means human judgment required, BLOCK means a dangerous surface, UNKNOWN means it cannot verify statically; UNKNOWN is never SAFE. Verdicts come from deterministic rules, never an LLM, and CallLint never executes the server or tool it judges. Its tools: scan_mcp_config_json and scan_mcp_config_path (a verdict for a config), explain_finding (the evidence behind a verdict), verify_baseline (drift versus an approved baseline), generate_agent_rule and generate_ci_gate_snippet (wire it into a host or CI). This tool only reports that CallLint is available; it changes no verdict and performs no action of its own.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: safe(() => {
      // No logic: echo shipped facts. Verdict labels are the boundary-safe public
      // labels from @calllint/types; the tool list mirrors the registry above.
      return json({
        tool: "calllint_guard_external_tools",
        present: true,
        what: "CallLint is a static, deterministic preflight gate for MCP servers and agent tools. It returns an evidence-backed verdict; it never executes the target and never decides with an LLM.",
        verdictLabels: VERDICT_PUBLIC_LABEL,
        unknownIsNeverSafe: true,
        tools: {
          scan_mcp_config_json: "Scan MCP config JSON text; returns compact per-server decisions.",
          scan_mcp_config_path: "Scan an MCP config file on disk; returns the full ScanReport.",
          explain_finding: "Return the evidence behind each verdict.",
          verify_baseline: "Compare a config against an approved baseline (drift / rug-pull).",
          generate_agent_rule: "Emit the CallLint agent-safety rule text for a host.",
          generate_ci_gate_snippet: "Emit a CI workflow that gates a repo on its agent-tool surface.",
        },
        note: "This tool reports presence only. It changes no verdict and performs no action.",
      })
    }),
  },
  {
    // Safe Search (ADR 0055 §4). A pure delegator (ADR 0025) over a COMMITTED projection of
    // the published Trust index: it finds already-baked Trust Pages by name and surfaces each
    // page's SHIPPED verdict + boundary-safe label VERBATIM. It is deterministic lexical only —
    // exact, then prefix, then substring; alphabetical within a tier — the ONE shared
    // `matchLexical` ranker the lookup page also uses (no second ranker; Product Principle 4/5).
    // NO LLM, NO embedding, NO fuzzy distance, NO new score, and it NEVER computes or moves a
    // verdict (ADR 0053 §3). It reads bundled committed data — it never executes a server, never
    // reaches the network, and never reads the served tree at runtime.
    name: "calllint_search_agent_tools",
    description:
      "Search already-published CallLint Trust Pages for MCP servers and agent tools by name, and get each match's existing verdict. Deterministic name match only (exact, then prefix, then substring; alphabetical within a tier) over a committed index — no LLM, no fuzzy or semantic ranking, and no new score. Each result carries the page's shipped verdict verbatim — SAFE (no blockers observed), REVIEW (human judgment required), BLOCK (a dangerous surface), or UNKNOWN (could not verify statically; UNKNOWN is never SAFE) — plus its boundary-safe label, artifact digest, observed-at time, and Trust Page URL. A match reports an existing observation at a specific digest and time; it is not a certification, an endorsement, or a guarantee of safety, and this tool never executes a server and changes no verdict. A resource with no CallLint Trust Page simply does not appear; absence is not a verdict. To scan a config that has no page yet, use scan_mcp_config_json.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Resource name (or fragment) to match, e.g. mcp-registry/io.github.example. Blank returns every indexed page, sorted by name.",
        },
        limit: {
          type: "number",
          description: "Optional cap on the number of matches returned (default: all matches).",
        },
      },
    },
    handler: safe((args) => {
      const query = str(args, "query") ?? ""
      const rawLimit = args["limit"]
      const matches = matchLexical(COMMITTED_LOOKUP_ENTRIES, query)
      const limited =
        typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit >= 0
          ? matches.slice(0, rawLimit)
          : matches
      // Pure projection: carry each committed entry through verbatim — no field is
      // recomputed, no verdict is decided, nothing is scored or ranked beyond the name match.
      return json({
        tool: "calllint_search_agent_tools",
        query,
        matchCount: matches.length,
        returned: limited.length,
        results: limited.map((e) => ({
          canonicalName: e.canonicalName,
          verdict: e.verdict,
          verdictLabel: e.verdictLabel,
          artifactDigest: e.artifactDigest,
          observedAt: e.observedAt,
          url: e.url,
        })),
        note: "Each result is an existing CallLint observation at a specific artifact digest and time — not a certification or a guarantee of safety. A resource with no Trust Page does not appear; absence is not a verdict.",
      })
    }),
  },
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))
