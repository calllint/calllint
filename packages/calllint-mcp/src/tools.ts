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
  prepareSafeInstall,
  type ScanOptions,
} from "@calllint/core"
import { adoptionBasisPolicy } from "@calllint/policy"
import { renderExplain, NO_EMOJI_STYLE } from "@calllint/report-renderer"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import type { Baseline, TrustPreparation } from "@calllint/types"
import { matchLexical } from "@calllint/trust-index/matchLexical"
import { existsSync, readFileSync } from "node:fs"
import { COMMITTED_LOOKUP_ENTRIES } from "./committedLookup.js"
import { findCommittedContract, type AdoptionContract } from "./committedContracts.js"

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

/**
 * Map the read-only TrustPreparation to the safe-install outcome enum — the SAME
 * projection the CLI orchestrator uses (mirrored here because `apps/cli` result.ts
 * is not an importable package; ADR 0056 §10.4 forbids reimplementing the gateway
 * glue, which lives in the shared core prepareSafeInstall — this is only the terminal
 * label). Fail-closed: anything not confidently prepared → LOCAL_PREFLIGHT_REQUIRED.
 */
function outcomeForPreparation(prep: TrustPreparation): string {
  const verdict = prep.decision?.verdict
  switch (prep.state) {
    case "TARGET_MISMATCH":
      return "ABORTED_ON_MISMATCH"
    case "PLAN_READY":
    case "DECIDED":
      if (verdict === "BLOCK") return "BLOCKED"
      if (verdict === "UNKNOWN") return "LOCAL_PREFLIGHT_REQUIRED"
      return "PREPARED"
    default:
      return "LOCAL_PREFLIGHT_REQUIRED"
  }
}

/** The honest public-route floor from the committed contract's recommendedNextAction.
 *  Returns a terminal outcome when the route is not locally preparable, else null. */
function publicFloor(kind: string): { outcome: string; note: string } | null {
  switch (kind) {
    case "EXPLAIN_ONLY":
      return { outcome: "UNSUPPORTED", note: "no supported install plan for this target — view manual setup" }
    case "INSPECT_BLOCKERS":
      return { outcome: "BLOCKED", note: "public verdict blocked by policy; inspect blockers before any install" }
    case "LOCAL_PREFLIGHT_REQUIRED":
      return { outcome: "LOCAL_PREFLIGHT_REQUIRED", note: "insufficient evidence / no exact target; run local pre-flight" }
    case "PREPARE_LOCALLY":
      return null
    default:
      return { outcome: "LOCAL_PREFLIGHT_REQUIRED", note: `unrecognized contract action "${kind}" — run local pre-flight` }
  }
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/
const PLAN_HOSTS = new Set(["claude-code", "cursor", "windsurf"])
const SAFE_INSTALL_RESULT_SCHEMA = "calllint.safe-install-result.v1"

/** Assert the caller's stated exact target against the contract's own fields (offline;
 *  a substituted contract can only STOP). Returns the mismatch reasons (empty ⇒ match). */
function targetMismatches(
  contract: AdoptionContract,
  expect: { version?: string; artifact?: string; contract?: string },
): string[] {
  const m: string[] = []
  const subj = contract.subject
  if (expect.artifact && subj.artifactDigest && expect.artifact !== subj.artifactDigest) {
    m.push(`expected artifact digest ${expect.artifact} does not match the contract's ${subj.artifactDigest}`)
  }
  if (expect.contract && contract.contract.contractDigest && expect.contract !== contract.contract.contractDigest) {
    m.push(`expected contract digest ${expect.contract} does not match the contract's ${contract.contract.contractDigest}`)
  }
  if (expect.version && subj.version && expect.version !== subj.version) {
    m.push(`expected version ${expect.version} does not match the contract's ${subj.version}`)
  }
  return m
}

/** A stable server key from the canonical slug — the SAME derivation the CLI uses. */
function serverKeyForSlug(slug: string): string {
  const base = slug.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  return base.replace(/^-+|-+$/g, "") || "tool"
}

/** Emit the safe-install result envelope (schema-aligned with the CLI's v1 shape). */
function emitResult(fields: {
  outcome: string
  canonicalName: string
  host?: string | null
  version: string | null
  artifactDigest: string | null
  contractDigest: string | null
  planDigest?: string | null
  notes: string[]
}): ToolResult {
  return json({
    tool: "calllint_prepare_safe_install",
    schema: SAFE_INSTALL_RESULT_SCHEMA,
    mode: "ONE_TIME_PROTECTED_SETUP",
    host: fields.host ?? null,
    ...fields,
    // Stable schema: planDigest is always present, null when no writable plan exists.
    planDigest: fields.planDigest ?? null,
    note: "Local static prepare only — nothing was executed and no config was written. A PREPARED plan authorizes nothing; applying it is a separate, explicitly human-approved step.",
  })
}

function prepareSafeInstallHandler(args: Record<string, unknown>, opts: ScanOptions): ToolResult {
  const slug = str(args, "canonicalName")
  if (!slug) return err("canonicalName is required")
  const expectVersion = str(args, "expectedVersion")
  const expectArtifact = str(args, "expectedArtifactDigest")
  const expectContract = str(args, "expectedContractDigest")
  for (const [name, v] of [
    ["expectedArtifactDigest", expectArtifact],
    ["expectedContractDigest", expectContract],
  ] as const) {
    if (v !== undefined && !SHA256_RE.test(v)) return err(`${name} must be a sha256:<64-hex> digest`)
  }

  // Look up by canonical slug ONLY — an expectedVersion is an exact-target ASSERTION
  // (a mismatch must STOP with ABORTED_ON_MISMATCH, not read as "not found").
  const contract = findCommittedContract(slug)
  if (!contract) {
    return emitResult({
      outcome: "UNSUPPORTED",
      canonicalName: slug,
      version: null,
      artifactDigest: null,
      contractDigest: null,
      notes: [
        `No committed CallLint adoption contract for "${slug}". Absence is not a verdict — cannot prepare a target with no published contract.`,
      ],
    })
  }
  const subj = contract.subject
  const base = {
    canonicalName: subj.canonicalName,
    version: subj.version,
    artifactDigest: subj.artifactDigest ?? null,
    contractDigest: contract.contract.contractDigest ?? null,
  }

  // 1) Exact-target identity gate (offline; a substituted contract can only STOP).
  const mismatches = targetMismatches(contract, {
    version: expectVersion,
    artifact: expectArtifact,
    contract: expectContract,
  })
  if (mismatches.length > 0) {
    return emitResult({
      ...base,
      outcome: "ABORTED_ON_MISMATCH",
      notes: ["exact-target identity assertion failed — no writable plan was produced", ...mismatches],
    })
  }

  // 2) Public-verdict floor (fail-closed). A non-actionable public route short-circuits
  // BEFORE any local re-decode, so a public BLOCK/UNKNOWN/unsupported is never laundered.
  const floor = publicFloor(contract.recommendedNextAction.kind)
  if (floor) return emitResult({ ...base, outcome: floor.outcome, notes: [floor.note] })

  // 3) npm gate — only a pinned npm subject is auto-preparable (mirrors the CLI Batch 5).
  if (subj.packageType !== "npm" || !subj.packageName || !subj.version) {
    return emitResult({
      ...base,
      outcome: "LOCAL_PREFLIGHT_REQUIRED",
      notes: [
        `only a pinned npm subject is auto-preparable in this version (got ${subj.packageType ?? "no"} type)`,
        "run local pre-flight (`calllint trust prepare`) for this target",
      ],
    })
  }

  // 4) Actionable — synthesize the exact pinned launch and delegate to the shared,
  // writer-free core sequence (the SAME one the CLI runs). Host-gated: a plan is built
  // only when a supported host is named; otherwise the local decision is returned alone.
  return runPrepare(args, opts, contract, base)
}

function runPrepare(
  args: Record<string, unknown>,
  opts: ScanOptions,
  contract: AdoptionContract,
  base: { canonicalName: string; version: string | null; artifactDigest: string | null; contractDigest: string | null },
): ToolResult {
  const subj = contract.subject
  const key = serverKeyForSlug(subj.canonicalSlug)
  const synth = { mcpServers: { [key]: { command: "npx", args: ["-y", `${subj.packageName}@${subj.version}`] } } }
  const configText = JSON.stringify(synth, null, 2) + "\n"

  const host = str(args, "host")
  if (host !== undefined && !PLAN_HOSTS.has(host)) {
    return err(`unsupported host "${host}" — expected one of: ${[...PLAN_HOSTS].join(", ")}`)
  }

  // Read the named host config once (read-only; the ONLY disk touch). Absent path ⇒ plan
  // against a fresh/empty config. Contract digest rides as recorded PROVENANCE, never a gate.
  let hostPlan
  if (host) {
    const hostConfigPath = str(args, "hostConfigPath")
    const hostConfigText =
      hostConfigPath && existsSync(hostConfigPath) ? readFileSync(hostConfigPath, "utf8") : null
    const generatedAt = opts.generatedAt ?? new Date(opts.now ?? 0).toISOString()
    const ms = Date.parse(generatedAt)
    hostPlan = {
      host,
      configPath: hostConfigPath ?? `<${host}-config>`,
      hostConfigText,
      expiresAt: Number.isNaN(ms) ? generatedAt : new Date(ms + 60 * 60 * 1000).toISOString(),
    }
  }

  const prep = prepareSafeInstall({
    configText,
    configPath: `npm:${subj.packageName}@${subj.version}`,
    policy: adoptionBasisPolicy(),
    hostPlan,
    expect: base.contractDigest ? { contractDigest: base.contractDigest as `sha256:${string}` } : undefined,
    preparedAt: opts.generatedAt ?? new Date(opts.now ?? 0).toISOString(),
  })

  const outcome = outcomeForPreparation(prep)
  const planDigest = (prep.plan?.planDigest as string | undefined) ?? null
  const notes: string[] = []
  if (!host) {
    notes.push("no host named — returning the local decision only; pass host to compute an install plan")
  }
  if (outcome === "PREPARED" && planDigest) {
    notes.push(`plan ${planDigest.slice(0, 23)}… computed for host "${host}" — NOT applied (apply is a separate human-approved step)`)
  } else if (outcome === "PREPARED" && !planDigest) {
    notes.push(`local verdict ${prep.decision?.verdict ?? "?"} — preparable; name a host to compute the applyable plan`)
  }
  return emitResult({ ...base, host: host ?? null, outcome, planDigest, notes })
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
      "Search already-published CallLint Trust Pages for MCP servers and agent tools by name, and get each match's existing verdict. Deterministic name match only (exact, then prefix, then substring; alphabetical within a tier) over a committed index — no LLM, no fuzzy or semantic ranking, and no new score. Each result carries the page's shipped verdict verbatim — SAFE (no blockers observed), REVIEW (human judgment required), BLOCK (a dangerous surface), or UNKNOWN (could not verify statically; UNKNOWN is never SAFE) — plus its boundary-safe label, artifact digest, observed-at time, and Trust Page URL. When the resource also has a CallLint acquisition page, the result includes installUrl (the human Install page), contractUrl (the machine Agent Adoption Contract), and installability (the route: PREPARE_AVAILABLE, REVIEW_REQUIRED, BLOCKED, LOCAL_PREFLIGHT_REQUIRED, or UNSUPPORTED); these link existing pages and authorize nothing — installing always re-decides locally. A match reports an existing observation at a specific digest and time; it is not a certification, an endorsement, or a guarantee of safety, and this tool never executes a server and changes no verdict. A resource with no CallLint Trust Page simply does not appear; absence is not a verdict. To scan a config that has no page yet, use scan_mcp_config_json.",
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
          // Safe-install linkage (ADR 0056), carried through verbatim. Non-null only when a
          // baked acquisition page exists; these route to the human Install page + machine
          // Agent Adoption Contract, and never authorize a write — prepare re-decides locally.
          installUrl: e.installUrl,
          contractUrl: e.contractUrl,
          installability: e.installability,
        })),
        note: "Each result is an existing CallLint observation at a specific artifact digest and time — not a certification or a guarantee of safety. installUrl/contractUrl (when present) link the human Install page and the machine Agent Adoption Contract; they authorize nothing — a local prepare always re-decides. A resource with no Trust Page does not appear; absence is not a verdict.",
      })
    }),
  },
  {
    // Serve a committed Agent-Adoption-Contract verbatim from the bundle (ADR 0056 §7/§8).
    // Never fetches, never executes, never decides — it hands back the exact baked sidecar
    // an agent needs to STATE its exact target before a local prepare. A slug with no baked
    // contract simply is not served (absence is not a verdict).
    name: "calllint_get_adoption_contract",
    description:
      "Fetch the committed CallLint Agent Adoption Contract for a published MCP server / agent tool, by its canonical name (the same canonicalName/slug calllint_search_agent_tools returns). Returns the exact machine contract CallLint already published: the pinned subject (package, version, artifact digest), the public observation (verdict + boundary-safe label), the authority delta, and the recommendedNextAction telling you how to proceed (usually calllint_prepare_safe_install with the exact version/artifact/contract digests to assert). The contract is served verbatim from a committed bundle — no network, no execution, no new verdict. Optionally pass version to require an exact pinned version (a mismatch returns not-found rather than a different version). A resource with no committed contract is not served; absence is not a verdict. Use this to obtain the exact target to assert, then calllint_prepare_safe_install to re-decide locally before any install.",
    inputSchema: {
      type: "object",
      properties: {
        canonicalName: {
          type: "string",
          description: "The resource's canonical name / slug, e.g. mcp-registry/io.github.example (as returned by calllint_search_agent_tools).",
        },
        version: {
          type: "string",
          description: "Optional exact version to require; a mismatch returns not-found (never a different version).",
        },
      },
      required: ["canonicalName"],
    },
    handler: safe((args) => {
      const slug = str(args, "canonicalName")
      if (!slug) return err("canonicalName is required")
      const version = str(args, "version")
      const contract = findCommittedContract(slug, version)
      if (!contract) {
        return json({
          tool: "calllint_get_adoption_contract",
          canonicalName: slug,
          found: false,
          note: version
            ? `No committed CallLint adoption contract for "${slug}" at version ${version}. Absence is not a verdict — the resource may have no acquisition page, or a different pinned version.`
            : `No committed CallLint adoption contract for "${slug}". Absence is not a verdict — the resource may have a Trust Page but no acquisition page yet.`,
        })
      }
      // Serve the baked contract verbatim (never re-serialize a subset — the digest is over
      // the exact baked bytes). The tool authorizes nothing; installing re-decides locally.
      return json({
        tool: "calllint_get_adoption_contract",
        canonicalName: contract.subject.canonicalName,
        found: true,
        contract,
        note: "This is an existing published contract at a specific artifact digest — not a certification or a guarantee of safety. It authorizes no install; run calllint_prepare_safe_install to re-decide locally before any write.",
      })
    }),
  },
  {
    // Local, read-only safe-install PREPARE (ADR 0056 §10). Delegates the whole gateway
    // sequence to the shared core prepareSafeInstall — the SAME writer-free function the
    // CLI `safe-install` runs — so the two surfaces cannot disagree. Never executes the
    // target, never writes a config: it returns the local verdict + (host-gated) inert
    // plan an agent must review before any apply. A public BLOCK/UNKNOWN/unsupported route
    // short-circuits BEFORE the local re-decode (INV-2.4-02, "UNKNOWN is not SAFE").
    name: "calllint_prepare_safe_install",
    description:
      "Locally and statically PREPARE a safe install of a published MCP server, re-deciding its trust verdict on THIS machine before anything is written. Give the canonical name (and ideally the exact version/artifact/contract digests from calllint_get_adoption_contract to assert you got the target you meant). This never executes the server and never writes any config — it synthesizes the exact pinned launch, re-runs the full CallLint gateway locally (resolve → authority manifest → toxic-flow fold → policy decision), and, when you name a host, computes the inert install plan you would later apply. The local decision can only be STRICTER than the public one: a public BLOCK/UNKNOWN/unsupported target is refused before the local re-decode, an exact-target mismatch aborts with no plan, and only a pinned npm subject is auto-preparable in this version (anything else returns LOCAL_PREFLIGHT_REQUIRED — run `calllint trust prepare`). Outcomes: PREPARED (a plan is ready for a separate, explicitly-approved apply — never auto-applied), BLOCKED, LOCAL_PREFLIGHT_REQUIRED, ABORTED_ON_MISMATCH, or UNSUPPORTED. The returned plan authorizes nothing on its own; applying it is a separate human-gated step.",
    inputSchema: {
      type: "object",
      properties: {
        canonicalName: { type: "string", description: "The resource's canonical name / slug (as returned by calllint_search_agent_tools / calllint_get_adoption_contract)." },
        host: { type: "string", description: "Target host for the install plan: claude-code, cursor, or windsurf. Omit to get the local decision only (no plan)." },
        hostConfigPath: { type: "string", description: "Optional path to the host's MCP config to plan against (read-only). Omit to plan against an absent (fresh) config." },
        expectedVersion: { type: "string", description: "Optional exact version to assert; a mismatch aborts with no plan." },
        expectedArtifactDigest: { type: "string", description: "Optional sha256:<64-hex> artifact digest to assert against the contract; a mismatch aborts." },
        expectedContractDigest: { type: "string", description: "Optional sha256:<64-hex> contract digest to assert + record as plan provenance; a mismatch aborts." },
      },
      required: ["canonicalName"],
    },
    handler: safe((args, opts) => prepareSafeInstallHandler(args, opts)),
  },
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))
