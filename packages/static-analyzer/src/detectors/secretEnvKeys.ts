import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

/** Env key fragments that indicate a credential / secret. */
const SECRET_HINTS = [
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "API_KEY",
  "APIKEY",
  "ACCESS_KEY",
  "PRIVATE_KEY",
  "CREDENTIAL",
  "AUTH",
  "SESSION",
]

function looksSecret(key: string): boolean {
  const upper = key.toUpperCase()
  return SECRET_HINTS.some((h) => upper.includes(h))
}

/**
 * Flags secret-bearing env keys (T03). This is a sensitive-read signal, not a
 * blocker by itself — many legitimate servers need a token. It contributes the
 * SECRETS symbol and raises the risk class so the server needs review.
 */
export function detectSecretEnvKeys(ctx: DetectorContext): Finding[] {
  const { server } = ctx
  const evidence: Evidence[] = []

  for (const key of server.envKeys) {
    if (looksSecret(key)) {
      evidence.push({
        type: "config",
        path: server.sourceConfigPath,
        key: "env",
        // Report the key name, never the value.
        value: key,
      })
    }
  }

  if (evidence.length === 0) return []

  return [
    {
      id: "secrets.env-key",
      title: "Server is configured with credentials",
      severity: "medium",
      blocker: false,
      symbol: "SECRETS",
      riskClass: "S2",
      mode: "OBSERVED",
      confidence: "medium",
      detectionMethod: "env-analysis",
      evidence,
      impact:
        "The server receives credentials. If the agent invokes it autonomously, those credentials act on the agent's behalf.",
      fix: "Confirm the credential scope is minimal and that autonomous use is intended; prefer least-privilege tokens.",
      falsePositiveNote:
        "Most API-backed servers legitimately require a token; this flags the data-sensitivity surface, not a vulnerability.",
    },
  ]
}
