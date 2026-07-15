/**
 * calllint.authority.v0 — Authority Manifest.
 *
 * Normalizes WHAT AUTHORITY an artifact would exercise if run: the closed set of
 * capabilities (action × resource) it can perform, each pinned to the evidence
 * that granted it (`server.url`, `SKILL.md:42`). It is a capability *inventory*,
 * not a verdict — it says what the thing CAN do and how reversible/approvable each
 * capability is, so the deterministic policy (G4, `calllint.decision.v0`) can decide
 * over it. Authority ≠ Decision: the manifest never sets a verdict.
 *
 * Object 3 of the six. `subject.artifactDigest` binds the Artifact Identity
 * (object 1); a later Decision/Plan/Receipt binds this manifest's own `digest`.
 * Fully deterministic — no clock, no I/O; digest = `hashJson` over the object minus
 * its own `digest` field (see @calllint/fingerprint).
 *
 * See ADR 0035 (Automated Trust Gateway & Authority Manifest) and
 * schemas/authority-manifest.schema.json.
 */
import type { Confidence } from "./finding.js"

/**
 * Fixed, small action vocabulary (what the capability DOES). Kept closed so the
 * policy layer can decide exhaustively and manifests stay comparable across
 * artifacts. Extending it is an ADR-gated change.
 */
export const AUTHORITY_ACTIONS = [
  "read",
  "write",
  "execute",
  "connect",
  "send",
  "mutate",
  "spend",
  "delegate",
  "persist",
] as const
export type AuthorityAction = (typeof AUTHORITY_ACTIONS)[number]

/**
 * Fixed, small resource vocabulary (what the capability acts ON). Closed set for
 * the same reason as actions. Extending it is an ADR-gated change.
 */
export const AUTHORITY_RESOURCES = [
  "filesystem",
  "secret",
  "process",
  "network",
  "database",
  "message",
  "financial",
  "identity",
  "agent",
  "configuration",
] as const
export type AuthorityResource = (typeof AUTHORITY_RESOURCES)[number]

/** Whether exercising the capability changes state. */
export type AuthorityMutability = "read-only" | "mutating"

/** How recoverable a mutation is. `n/a` for read-only capabilities. */
export type AuthorityReversibility = "reversible" | "irreversible" | "n/a"

/**
 * How much human/agent sign-off the capability warrants. This is a normalized
 * *requirement* the policy reads — it is NOT itself the verdict.
 * - none   → routine, no approval needed
 * - review → a human should confirm before the agent exercises it
 * - block  → must not run without explicit, digest-bound approval (fail-closed)
 */
export type ApprovalRequirement = "none" | "review" | "block"

/** Whether we fully understood a capability, or only partially pinned it. */
export type AuthorityCompleteness = "complete" | "partial"

/**
 * The six deterministic instruction-authority patterns (G3). An instruction file
 * (SKILL.md / CLAUDE.md / AGENTS.md / .cursor/rules) that matches one of these
 * confers a real capability on the agent, cited to `file:line`.
 */
export const INSTRUCTION_PATTERNS = [
  "privilege-escalation", // "run as root", "sudo", "disable the sandbox"
  "auto-exec-bypass", // "without asking", "auto-approve", "run automatically without confirmation"
  "sensitive-file-read", // "read ~/.ssh/id_rsa", ".env", ".aws/credentials"
  "data-exfil", // "send the contents to https://…", "upload to", "exfiltrate"
  "messaging-financial", // "send an email", "make a payment", "transfer funds"
  "hidden-override", // hidden/invisible chars, "ignore previous instructions", "you are now"
] as const
export type InstructionPattern = (typeof INSTRUCTION_PATTERNS)[number]

/**
 * Closed trust classification of the DATA at the head of a capability — "did this
 * authority come from the user, from local project files, from a signed component,
 * or from untrusted public content / tool output / another agent?" (ADR 0041).
 *
 * Trust attaches to data *provenance*, not to a tool forever: a tool that reads a
 * public issue this call is `untrusted.public_content` for that data regardless of
 * the tool's own trust. Feeds Toxic-Flow analysis (ADR 0040) — it distinguishes
 * `untrusted.public_content → send` (a blocker) from `trusted.user_explicit → send`
 * (routine). Optional & additive: absent or `unknown` MUST read as *not trusted*
 * (I-04) — it never silently enables ALLOW/SAFE. Extending it is ADR-gated.
 */
export const TRUST_SOURCES = [
  "trusted.policy",
  "trusted.user_explicit",
  "trusted.local_project",
  "trusted.signed_component",
  "unverified.component",
  "untrusted.public_content",
  "untrusted.tool_output",
  "untrusted.peer_agent",
  "untrusted.memory",
  "sensitive.secret",
  "sensitive.private_data",
  "unknown",
] as const
export type TrustSource = (typeof TRUST_SOURCES)[number]

/**
 * One normalized capability. `evidenceSource` is mandatory — every capability is
 * traceable to the byte that granted it (Product Principle 3: evidence is
 * mandatory). `pattern` is set only for instruction-derived capabilities.
 */
export interface AuthorityCapability {
  action: AuthorityAction
  resource: AuthorityResource
  /** Where the authority applies: "project", a host, a path, a scope string; null when unbounded/unknown. */
  scope: string | null
  /** For send/connect: the outbound destination (host/URL); null otherwise. */
  destination: string | null
  mutability: AuthorityMutability
  reversibility: AuthorityReversibility
  /** For spend: the per-call/total ceiling if one is declared; null otherwise. */
  monetaryLimit: number | null
  approvalRequirement: ApprovalRequirement
  /** Provenance: "server.url", "server.args[2]", "SKILL.md:42". Never empty. */
  evidenceSource: string
  confidence: Confidence
  completeness: AuthorityCompleteness
  /** Which of the six instruction patterns produced this (instruction-derived only). */
  pattern?: InstructionPattern
  /**
   * Trust class of the data at the head of this capability (ADR 0041). Optional &
   * additive: omitted or `unknown` reads as *not trusted* (I-04). Derived
   * deterministically from `(action, resource, scope, evidenceSource, pattern)`;
   * anything not establishable from the shipped signals is left `unknown` (fail-safe).
   */
  trustSource?: TrustSource
}

/** T10 Safety-Budget limits, folded into authority (replaces orphan billing infra). */
export interface AuthorityLimits {
  /** Max spend a single call may incur, if declared; null = undeclared. */
  spendPerCall: number | null
  /** Max total spend across a session, if declared; null = undeclared. */
  spendTotal: number | null
}

export interface AuthorityManifest {
  schema: "calllint.authority.v0"
  /** Binds the Artifact Identity (object 1). null only if built over an unresolved artifact. */
  subject: { artifactDigest: string | null }
  /** Deterministically ordered capability inventory. */
  capabilities: AuthorityCapability[]
  limits: AuthorityLimits
  /** Normalized approval labels required across all capabilities (sorted, deduped). */
  approval: { required: string[] }
  /** Gaps: sources we could not fully normalize (so the policy never over-trusts silence). */
  unknowns: string[]
  /** Derived: "partial" if any capability is partial or `unknowns` is non-empty. */
  completeness: AuthorityCompleteness
  /** sha256 over this object minus `digest` (hashJson). */
  digest: `sha256:${string}`
}

export const AUTHORITY_SCHEMA_VERSION = "calllint.authority.v0" as const
