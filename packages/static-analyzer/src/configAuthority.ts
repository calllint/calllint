import type { AuthorityCapability, NormalizedMcpServer } from "@calllint/types"
import { sortCapabilities } from "./instructionAuthority.js"

/**
 * Config Authority Normalization (G3) — the config side of the Authority Manifest.
 *
 * Turns a `NormalizedMcpServer` (parsed from mcp.json / .cursor / .claude) into the
 * capabilities it would exercise if run, in the SAME fixed vocabulary as the
 * instruction extractor, so the policy decides over one uniform inventory. This is
 * a capability *reading* of the config — it reuses the signal shapes the shipped
 * detectors already recognize (secret env keys, broad paths, network URL, an exec
 * command) but emits capabilities, not findings, and sets no verdict.
 *
 * PURE & DETERMINISTIC: no clock, no I/O. Every capability cites its config key.
 */

/** Env key fragments that indicate a credential (mirrors secretEnvKeys.ts). */
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

/** Host of a URL string, or the raw string if it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * Derive capabilities from one normalized server config. Deterministic ordering.
 * The manifest builder seals these + instruction capabilities into the object.
 */
export function deriveConfigCapabilities(server: NormalizedMcpServer): AuthorityCapability[] {
  const caps: AuthorityCapability[] = []

  // A local exec command is process-execution authority. High confidence: the
  // config literally names the binary the agent would spawn.
  if (server.command) {
    caps.push({
      action: "execute",
      resource: "process",
      scope: server.command,
      destination: null,
      mutability: "mutating",
      reversibility: "irreversible",
      monetaryLimit: null,
      // Running a local process is expected for a stdio server; the policy, not
      // the manifest, decides whether that warrants review. Mark it review-worthy
      // only where the command itself is unknown — here just record it as routine.
      approvalRequirement: "none",
      evidenceSource: "server.command",
      confidence: "high",
      completeness: "complete",
    })
  }

  // A URL / remote transport is outbound network authority. Destination = host.
  if (server.url) {
    caps.push({
      action: "connect",
      resource: "network",
      scope: hostOf(server.url),
      destination: hostOf(server.url),
      mutability: "mutating",
      reversibility: "irreversible",
      monetaryLimit: null,
      approvalRequirement: "review",
      evidenceSource: "server.url",
      confidence: "high",
      completeness: "complete",
    })
  }

  // Credential-shaped env keys are secret-read authority (report the KEY, never a
  // value). One capability per secret-bearing key, cited to that key.
  for (const key of server.envKeys) {
    if (!looksSecret(key)) continue
    caps.push({
      action: "read",
      resource: "secret",
      scope: key,
      destination: null,
      mutability: "read-only",
      reversibility: "n/a",
      monetaryLimit: null,
      approvalRequirement: "review",
      evidenceSource: `server.env.${key}`,
      confidence: "medium",
      completeness: "complete",
    })
  }

  return sortCapabilities(caps)
}
