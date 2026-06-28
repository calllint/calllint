import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

// ---------------------------------------------------------------------------
// ADR 0022 — OAUTH_SCOPE_UNKNOWN_OR_EXPANDED (#10). Extractor-fed: reads OAuth
// scope metadata an extractor placed on server.raw.oauth (Hermes/OpenClaw/remote).
// Opaque or broad scope must not read as SAFE (ADR 0002). Offline: declared
// config only, no handshake, no IdP contact.
// ---------------------------------------------------------------------------

/** Scope tokens that indicate broad/expansive grants. */
const BROAD_SCOPE_HINTS = [
  "*",
  "admin",
  "full_access",
  "fullaccess",
  "read_write_all",
  "offline_access",
  "all",
  "write:org",
  "repo",
]

interface OauthMeta {
  scopes?: string[]
}

function readOauth(raw: unknown): OauthMeta | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const oauth = (raw as Record<string, unknown>).oauth
  if (typeof oauth !== "object" || oauth === null) return undefined
  const scopesRaw = (oauth as Record<string, unknown>).scopes
  const scopes = Array.isArray(scopesRaw)
    ? scopesRaw.filter((s): s is string => typeof s === "string")
    : undefined
  return { scopes }
}

function broadScope(scopes: string[]): string | undefined {
  for (const s of scopes) {
    const lower = s.toLowerCase()
    if (BROAD_SCOPE_HINTS.some((h) => lower === h || lower.includes(h))) return s
  }
  return undefined
}

export function detectOauthScope(ctx: DetectorContext): Finding[] {
  const oauth = readOauth(ctx.server.raw)
  if (!oauth) return []

  const evidence: Evidence[] = [{ type: "config", key: "oauth", value: "present" }]

  // No scope declared on an auth surface → UNKNOWN (insufficient evidence).
  if (!oauth.scopes || oauth.scopes.length === 0) {
    return [
      {
        id: "auth.oauth-scope",
        title: "OAuth scope is not declared",
        severity: "medium",
        blocker: false,
        symbol: "ACTION",
        riskClass: "S2",
        mode: "INFERRED",
        confidence: "low",
        detectionMethod: "config-analysis",
        evidence,
        impact:
          "This server authenticates via OAuth but does not declare its scopes, so the powers it grants the agent are unknown.",
        fix: "Declare the exact OAuth scopes the server requests and confirm they are the minimum required.",
        falsePositiveNote:
          "Scope may be declared elsewhere; CallLint only sees the provided config.",
      },
    ]
  }

  // Broad/expansive scope → REVIEW.
  const broad = broadScope(oauth.scopes)
  if (broad) {
    evidence.push({ type: "config", key: "scope", value: broad })
    return [
      {
        id: "auth.oauth-scope",
        title: "OAuth scope is broad or expansive",
        severity: "high",
        blocker: false,
        symbol: "ACTION",
        riskClass: "S2",
        mode: "OBSERVED",
        confidence: "high",
        detectionMethod: "config-analysis",
        evidence,
        impact: `The server requests a broad OAuth scope (\`${broad}\`), granting the agent wide access to the connected account.`,
        fix: "Narrow the OAuth scopes to only what the exposed tools need.",
      },
    ]
  }

  // Narrow, fully declared scope → no finding.
  return []
}
