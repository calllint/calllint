import type {
  CapabilityFingerprint,
  Finding,
  FpEffect,
  FpIdentity,
  FpLaunch,
  FpScope,
  FpTransport,
  NormalizedMcpServer,
  RuntimeBinding,
} from "@calllint/types"
import { hashJson } from "@calllint/fingerprint"

// ---------------------------------------------------------------------------
// P1.1 — Capability Fingerprint extraction (new4 L1 — ADR 0019).
//
// Derives the host-agnostic 8-field fingerprint from the existing pipeline
// inputs (RuntimeBinding + NormalizedMcpServer + findings), so the same MCP
// capability expressed in any host yields the same fingerprint hash.
// ---------------------------------------------------------------------------

/** Where the surface lives — supplied by the loader (ADR 0019 Decision 1). */
export type SurfaceOrigin = "workspace" | "user" | "system" | "remote" | "unknown"

export interface BuildFingerprintInput {
  server: NormalizedMcpServer
  binding: RuntimeBinding
  findings: Finding[]
  /** Surface origin for scope derivation. Default unknown — never guess workspace. */
  origin?: SurfaceOrigin
  /** Override kind (e.g. install_snippet, gateway_runtime). Default mcp_server. */
  kind?: CapabilityFingerprint["kind"]
}

/** RuntimeKind → launch token (ADR 0019 table). */
function deriveLaunch(binding: RuntimeBinding): FpLaunch {
  switch (binding.runtimeKind) {
    case "npx":
      return "local:npx"
    case "uvx":
      return "local:uvx"
    case "node":
      return "local:node"
    case "python":
      return "local:python"
    case "docker":
      return "local:docker"
    case "http":
      return "remote:http"
    case "sse":
      return "remote:sse"
    default:
      return "unknown"
  }
}

/** RuntimeBinding transport → fingerprint transport. */
function deriveTransport(binding: RuntimeBinding): FpTransport {
  switch (binding.transport) {
    case "stdio":
      return "stdio"
    case "http":
      return "http"
    case "sse":
      return "sse"
    default:
      return "unknown"
  }
}

/**
 * Canonical origin string (ADR 0019): npm:NAME@SPEC when a package is known,
 * url:HOST/PATH when a remote is known, local:COMMAND for bare local exec,
 * else unknown. Path-independent so cross-host configs match.
 */
function deriveSource(binding: RuntimeBinding): string {
  if (binding.packageName) {
    const spec = binding.packageVersionSpec
      ? `${binding.packageName}@${binding.packageVersionSpec}`
      : binding.packageName
    return `npm:${spec}`
  }
  if (binding.remoteUrl) {
    try {
      const u = new URL(binding.remoteUrl)
      // Drop scheme/query so http vs https and trailing params don't fork identity.
      return `url:${u.host}${u.pathname}`.replace(/\/$/, "")
    } catch {
      return `url:${binding.remoteUrl}`
    }
  }
  if (binding.declaredCommand) {
    return `local:${binding.declaredCommand}`
  }
  return "unknown"
}

/** Scope from surface origin (ADR 0019 Decision 1). Ambiguous → unknown. */
function deriveScope(origin: SurfaceOrigin | undefined, launch: FpLaunch): FpScope {
  if (origin === "workspace") return "workspace"
  if (origin === "user") return "user"
  if (origin === "system") return "system"
  if (origin === "remote") return "external"
  // No explicit origin: a remote launch is inherently external; else unknown.
  if (launch === "remote:http" || launch === "remote:sse") return "external"
  return "unknown"
}

/** RiskSymbol (on findings) → coarse effect vocabulary (ADR 0019 table). */
function deriveEffects(findings: Finding[]): FpEffect[] {
  const effects = new Set<FpEffect>()
  for (const f of findings) {
    switch (f.symbol) {
      case "FILES":
        effects.add("filesystem_broad")
        break
      case "EXEC":
        effects.add("local_execution")
        break
      case "NETWORK":
        effects.add("network_egress")
        break
      case "ACTION":
        effects.add("external_mutation_unknown")
        break
      case "MONEY":
        effects.add("payment")
        break
      case "PROMPT":
        effects.add("prompt_instruction")
        break
      // SECRETS/SUPPLY/RUGPULL are captured via reason codes, not effects.
      default:
        break
    }
  }
  return [...effects].sort()
}

/** Identity: known only when the source is concretely named (ADR 0019). */
function deriveIdentity(binding: RuntimeBinding): FpIdentity {
  return binding.sourceKnown ? "known" : "unknown"
}

/** Build the 8-field capability fingerprint. */
export function buildFingerprint(
  input: BuildFingerprintInput,
): CapabilityFingerprint {
  const { server, binding, findings, origin, kind } = input
  const launch = deriveLaunch(binding)
  return {
    schemaVersion: "calllint.fingerprint.v0",
    kind: kind ?? "mcp_server",
    source: deriveSource(binding),
    launch,
    transport: deriveTransport(binding),
    // Env KEY NAMES only — never values (secret redaction by construction).
    authority: [...new Set(server.envKeys)].sort().map((k) => `env:${k}`),
    scope: deriveScope(origin, launch),
    effects: deriveEffects(findings),
    identity: deriveIdentity(binding),
  }
}

/**
 * Canonical hash of a fingerprint (ADR 0019). Sorts/dedupes the arrays (already
 * done in buildFingerprint, repeated here for direct callers) and excludes
 * schemaVersion so unrelated metadata churn does not change the hash.
 */
export function fingerprintHash(fp: CapabilityFingerprint): string {
  const { schemaVersion: _schemaVersion, ...semantic } = fp
  const normalized = {
    ...semantic,
    authority: [...new Set(fp.authority)].sort(),
    effects: [...new Set(fp.effects)].sort(),
  }
  return hashJson(normalized)
}
