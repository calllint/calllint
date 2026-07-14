/**
 * Authority Manifest builder (G3) — assembles object 3, `calllint.authority.v0`.
 *
 * Merges the two capability readings into one uniform, digest-sealed inventory:
 *   • config authority  — from parsed MCP servers (deriveConfigCapabilities)
 *   • instruction authority — from allowlisted doc surfaces (extractInstructionAuthority)
 *
 * PURE & DETERMINISTIC: no clock, no I/O. The CLI edge parses the config into
 * `NormalizedMcpServer[]` and reads the size-capped `DocumentSurface[]`, then hands
 * both here. Same inputs → byte-identical manifest (digest included).
 *
 * The manifest is a capability INVENTORY, never a verdict. It records what the
 * artifact could do and how approvable each capability is; the deterministic policy
 * (G4, `calllint.decision.v0`) decides over it. `subject.artifactDigest` binds the
 * Artifact Identity (object 1); the manifest's own `digest` is what a later
 * Decision/Plan/Receipt binds. See ADR 0035.
 */
import type {
  AuthorityCapability,
  AuthorityLimits,
  AuthorityManifest,
  DocumentSurface,
  NormalizedMcpServer,
} from "@calllint/types"
import { AUTHORITY_SCHEMA_VERSION } from "@calllint/types"
import {
  deriveConfigCapabilities,
  extractInstructionAuthority,
  sortCapabilities,
} from "@calllint/static-analyzer"
import { hashJson } from "@calllint/fingerprint"

export interface BuildAuthorityInput {
  /** Object-1 digest to bind. null when the artifact did not resolve to a digest. */
  artifactDigest: string | null
  /** Parsed MCP servers (0+). Config-side authority. */
  servers?: readonly NormalizedMcpServer[]
  /** Allowlisted, size-capped instruction surfaces (0+). Instruction-side authority. */
  surfaces?: readonly DocumentSurface[]
}

/**
 * Normalized approval label for a capability, or null when it needs none. Kept in
 * one place so the manifest's `approval.required` set is stable and auditable. The
 * label is a coarse *category* the policy reads — it is not itself the verdict.
 */
function approvalLabel(c: AuthorityCapability): string | null {
  if (c.approvalRequirement === "none") return null
  switch (c.pattern) {
    case "privilege-escalation":
      return "privilege-escalation"
    case "auto-exec-bypass":
      return "unattended-execution"
    case "data-exfil":
      return "data-exfiltration"
    case "hidden-override":
      return "instruction-override"
    case "sensitive-file-read":
      return "secret-read"
    case "messaging-financial":
      return c.resource === "financial" ? "financial-action" : "external-messaging"
    default:
      break
  }
  // Config-derived capabilities (no pattern): label by action × resource.
  if (c.action === "connect" && c.resource === "network") return "external-network-access"
  if (c.action === "read" && c.resource === "secret") return "secret-read"
  if (c.action === "execute" && c.resource === "process") return "process-exec"
  return "review"
}

/** T10 Safety-Budget: fold any declared spend ceilings into the manifest. */
function deriveLimits(caps: readonly AuthorityCapability[]): AuthorityLimits {
  let spendPerCall: number | null = null
  for (const c of caps) {
    if (c.action === "spend" && typeof c.monetaryLimit === "number") {
      spendPerCall =
        spendPerCall === null ? c.monetaryLimit : Math.min(spendPerCall, c.monetaryLimit)
    }
  }
  // No total-spend surface exists in the current inputs; leave undeclared (null)
  // rather than inventing one — silence must never read as "unlimited is fine".
  return { spendPerCall, spendTotal: null }
}

/**
 * Build the digest-sealed Authority Manifest. The digest is `sha256:` + hashJson
 * over the whole object minus its own `digest` field, so verifying is: strip
 * `digest`, re-hash, compare.
 */
export function buildAuthorityManifest(input: BuildAuthorityInput): AuthorityManifest {
  const servers = input.servers ?? []
  const surfaces = input.surfaces ?? []

  const configCaps = servers.flatMap((s) => deriveConfigCapabilities(s))
  const instructionCaps = extractInstructionAuthority(surfaces)
  const capabilities = sortCapabilities([...configCaps, ...instructionCaps])

  // Unknowns: gaps that must keep the manifest from reading as complete. A
  // truncated surface may hide authority past the cap; an unpinned artifact means
  // the inventory is over an identity we could not digest. Deterministic order.
  const unknowns: string[] = []
  if (input.artifactDigest === null) {
    unknowns.push(
      "artifact did not resolve to a digest — authority is over an unpinned target",
    )
  }
  for (const s of surfaces) {
    if (s.truncated) {
      unknowns.push(`surface truncated at size cap — authority past the cap is unread: ${s.path}`)
    }
  }
  unknowns.sort()

  const required = [...new Set(capabilities.map(approvalLabel).filter((l): l is string => l !== null))].sort()

  const anyPartial = capabilities.some((c) => c.completeness === "partial")
  const completeness = anyPartial || unknowns.length > 0 ? "partial" : "complete"

  const sealed: Omit<AuthorityManifest, "digest"> = {
    schema: AUTHORITY_SCHEMA_VERSION,
    subject: { artifactDigest: input.artifactDigest },
    capabilities,
    limits: deriveLimits(capabilities),
    approval: { required },
    unknowns,
    completeness,
  }

  // hashJson already returns a `sha256:`-prefixed digest.
  return { ...sealed, digest: hashJson(sealed) as `sha256:${string}` }
}

/**
 * Recompute a manifest's digest from its content and compare. Returns true iff the
 * seal is intact (tamper check for downstream consumers / receipts).
 */
export function verifyAuthorityDigest(manifest: AuthorityManifest): boolean {
  const { digest, ...rest } = manifest
  return digest === hashJson(rest)
}
