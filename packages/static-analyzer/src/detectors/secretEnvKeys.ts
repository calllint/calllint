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
 * Extract env-var KEYS a docker `run` invocation passes inline via `-e KEY`,
 * `-e KEY=value`, `--env KEY`, or `--env=KEY=value` (ADR 0016). Only the KEY is
 * returned — never a value. `--env-file` is intentionally ignored (CallLint does
 * not read files here). This is the secrets-detector analogue of ADR 0012's
 * docker bind-mount host-path extraction: a credential-named var passed inline
 * with `-e` and no `env` block was previously invisible to this detector.
 */
function extractDockerEnvKeys(args: readonly string[]): string[] {
  const keys: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    let spec: string | undefined
    if (arg === "-e" || arg === "--env") {
      spec = args[i + 1]
      i += 1
    } else if (arg.startsWith("-e=")) {
      spec = arg.slice("-e=".length)
    } else if (arg.startsWith("--env=")) {
      spec = arg.slice("--env=".length)
    }
    if (spec === undefined) continue
    // The key is everything before the first `=` (bare `-e KEY` passes the host
    // value through, `-e KEY=value` sets it inline — either way we key on KEY).
    const eq = spec.indexOf("=")
    keys.push(eq === -1 ? spec : spec.slice(0, eq))
  }
  return keys
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

  // Docker passes secrets inline via `-e KEY[=value]`, which never lands in the
  // `env` block (ADR 0016). Extract those keys and apply the same shape check.
  // Dedupe against the env block so a key declared in both is reported once.
  if ((server.command ?? "").toLowerCase() === "docker") {
    const already = new Set(server.envKeys)
    for (const key of extractDockerEnvKeys(server.args)) {
      if (already.has(key)) continue
      already.add(key)
      if (looksSecret(key)) {
        evidence.push({
          type: "config",
          path: server.sourceConfigPath,
          key: "args",
          value: key,
        })
      }
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
