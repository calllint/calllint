import type {
  AuthorityCapability,
  Confidence,
  DocumentSurface,
  InstructionPattern,
} from "@calllint/types"
import { findHiddenContent } from "./promptScan.js"

/**
 * Instruction Authority Extraction (G3) — the read side of the Authority Manifest.
 *
 * Instruction files (SKILL.md / CLAUDE.md / AGENTS.md / .cursor/rules) are not
 * config, but an agent that reads them treats them as orders. So a line that says
 * "run as root without asking" GRANTS the agent authority just as surely as a
 * config flag does. This module normalizes those lines into `AuthorityCapability`
 * entries, each cited to `file:line`, so the deterministic policy (G4) can decide
 * over them.
 *
 * Six deterministic patterns (fixed set; extending it is an ADR-gated change):
 *   privilege-escalation · auto-exec-bypass · sensitive-file-read ·
 *   data-exfil · messaging-financial · hidden-override.
 *
 * Design rules:
 * - PURE & DETERMINISTIC: no clock, no I/O, no randomness. The CLI edge reads the
 *   allowlisted, size-capped surfaces and hands their text here.
 * - AUDITABLE: every rule is a named literal regex in one table. The invisible /
 *   obfuscated-character half of `hidden-override` is delegated to
 *   `findHiddenContent` (defined by code-point number in promptScan.ts) so this
 *   file never contains the bytes it hunts for.
 * - LOW FALSE-POSITIVE: rules favor high-signal forms (concrete paths, explicit
 *   URLs, imperative bypass phrases). Softer phrasings carry `medium` confidence.
 *   `hidden-override` deliberately ignores plain HTML comments (too common in docs)
 *   and only fires on structural smuggling (zero-width / bidi / tag-char).
 * - NEVER a verdict: this returns a capability inventory. The policy decides.
 */

/** A capability template shared by every match of one rule. */
interface RuleTemplate {
  pattern: InstructionPattern
  action: AuthorityCapability["action"]
  resource: AuthorityCapability["resource"]
  mutability: AuthorityCapability["mutability"]
  reversibility: AuthorityCapability["reversibility"]
  approvalRequirement: AuthorityCapability["approvalRequirement"]
  confidence: Confidence
  /** True ⇒ pull an outbound host off the matched line into `destination`. */
  extractDestination?: boolean
}

interface Rule extends RuleTemplate {
  /** Case-insensitive; matched per line so the line number is the citation. */
  test: RegExp
}

/**
 * The rule table. Multiple rows may share a `pattern` (e.g. a high-confidence
 * concrete path and a medium-confidence phrase both map to sensitive-file-read).
 */
const RULES: readonly Rule[] = [
  // 1. privilege-escalation → execute × process (irreversible, must be approved)
  esc(/\bsudo\s+\S/),
  esc(/\brun(?:ning)?\s+as\s+(?:root|administrator|admin|superuser|super\s?user)\b/),
  esc(/\bas\s+root\b/),
  esc(/\b(?:disable|bypass|turn\s+off)\s+(?:the\s+)?sandbox\b/),
  esc(/\bescalate\s+privileg/),
  esc(/\bwith\s+root\s+privileg/),

  // 2. auto-exec-bypass → execute × process (removing the approval gate is the grant)
  bypass(/\bwithout\s+(?:asking|confirmation|prompting|permission|approval)\b/),
  bypass(/\bauto[-\s]?(?:approve|approving|run|execute|confirm)\b/),
  bypass(/\b(?:run|execute)\s+automatically\b/),
  bypass(/\bautomatically\s+(?:run|execute|approve)\b/),
  bypass(/\bskip\s+(?:the\s+)?(?:confirmation|approval|prompt)\b/),
  bypass(/\bdon['’]?t\s+ask\b/),
  bypass(/\bdo\s+not\s+ask\b/),
  bypass(/\bno\s+confirmation\s+(?:needed|required)\b/),

  // 3. sensitive-file-read → read × secret (concrete paths are near-zero FP)
  secretRead(/(?:^|[\s"'`(/~])\.ssh\b/, "high"),
  secretRead(/\bid_(?:rsa|ed25519|ecdsa|dsa)\b/, "high"),
  secretRead(/(?:^|[\s"'`(/])\.env\b/, "high"),
  secretRead(/\.aws[/\\]credentials\b/, "high"),
  secretRead(/\baws\s+credentials\b/, "high"),
  secretRead(/\.git-credentials\b/, "high"),
  secretRead(/\/etc\/(?:passwd|shadow)\b/, "high"),
  secretRead(/\bprivate\s+key\b/, "medium"),
  secretRead(/\bread\b[^.\n]{0,30}\b(?:secret|credential|api[-\s]?key|password)s?\b/, "medium"),

  // 4. data-exfil → send × network (destination pulled off the line)
  exfil(/\bexfiltrat/, "high"),
  exfil(/\b(?:send|upload|post|transmit)\b[^.\n]{0,50}\bto\s+https?:\/\/\S+/, "high"),
  exfil(/\b(?:send|upload|post)\b[^.\n]{0,30}\b(?:the\s+)?(?:contents?|file|data|output|workspace)\b[^.\n]{0,30}\bto\b/, "medium"),

  // 5a. messaging-financial (messaging) → send × message
  messaging(/\bsend\b[^.\n]{0,20}\b(?:an?\s+)?(?:e[-\s]?mail|message|sms|text)\b/),
  messaging(/\bpost\b[^.\n]{0,20}\bto\s+(?:slack|discord|teams|telegram)\b/),
  // 5b. messaging-financial (financial) → spend × financial (irreversible, must be approved)
  financial(/\bmake\b[^.\n]{0,20}\ba?\s*payment\b/),
  financial(/\btransfer\b[^.\n]{0,20}\bfunds?\b/),
  financial(/\b(?:charge|bill)\b[^.\n]{0,20}\b(?:the\s+)?(?:card|account|customer)\b/),
  financial(/\bwire\b[^.\n]{0,20}\b(?:money|funds|payment)\b/),
  financial(/\bsend\b[^.\n]{0,20}\b(?:money|funds|payment)\b/),

  // 6. hidden-override (phrase half) → mutate × agent. The obfuscated-character
  //    half is handled separately via findHiddenContent (see extractLine).
  override(/\bignore\s+(?:all\s+)?(?:previous|prior|the\s+above)\s+instructions\b/),
  override(/\bdisregard\s+(?:all\s+)?(?:previous|prior)\s+instructions\b/),
  override(/\boverride\s+(?:the\s+)?system\s+prompt\b/),
  override(/\bdo\s+not\s+(?:tell|inform|notify)\s+the\s+user\b/),
  override(/\bwithout\s+(?:telling|informing)\s+the\s+user\b/),
]

// --- rule constructors (keep the table above terse and readable) ---
// Every rule matches case-insensitively; enforce the `i` flag centrally so the
// table stays terse and the invariant can't drift rule-by-rule.
function ci(re: RegExp): RegExp {
  return re.flags.includes("i") ? re : new RegExp(re.source, re.flags + "i")
}
function esc(rawTest: RegExp): Rule {
  const test = ci(rawTest)
  return {
    test,
    pattern: "privilege-escalation",
    action: "execute",
    resource: "process",
    mutability: "mutating",
    reversibility: "irreversible",
    approvalRequirement: "block",
    confidence: "high",
  }
}
function bypass(rawTest: RegExp): Rule {
  const test = ci(rawTest)
  return {
    test,
    pattern: "auto-exec-bypass",
    action: "execute",
    resource: "process",
    mutability: "mutating",
    reversibility: "irreversible",
    approvalRequirement: "block",
    confidence: "high",
  }
}
function secretRead(rawTest: RegExp, confidence: Confidence): Rule {
  const test = ci(rawTest)
  return {
    test,
    pattern: "sensitive-file-read",
    action: "read",
    resource: "secret",
    mutability: "read-only",
    reversibility: "n/a",
    approvalRequirement: "review",
    confidence,
  }
}
function exfil(rawTest: RegExp, confidence: Confidence): Rule {
  const test = ci(rawTest)
  return {
    test,
    pattern: "data-exfil",
    action: "send",
    resource: "network",
    mutability: "mutating",
    reversibility: "irreversible",
    approvalRequirement: "block",
    confidence,
    extractDestination: true,
  }
}
function messaging(rawTest: RegExp): Rule {
  const test = ci(rawTest)
  return {
    test,
    pattern: "messaging-financial",
    action: "send",
    resource: "message",
    mutability: "mutating",
    reversibility: "irreversible",
    approvalRequirement: "review",
    confidence: "high",
  }
}
function financial(rawTest: RegExp): Rule {
  const test = ci(rawTest)
  return {
    test,
    pattern: "messaging-financial",
    action: "spend",
    resource: "financial",
    mutability: "mutating",
    reversibility: "irreversible",
    approvalRequirement: "block",
    confidence: "high",
  }
}
function override(rawTest: RegExp): Rule {
  const test = ci(rawTest)
  return {
    test,
    pattern: "hidden-override",
    action: "mutate",
    resource: "agent",
    mutability: "mutating",
    reversibility: "irreversible",
    approvalRequirement: "block",
    confidence: "medium",
  }
}

/** First outbound host on a line (for data-exfil `destination`), else null. */
function extractHost(line: string): string | null {
  const m = line.match(/https?:\/\/([^\s/"')]+)/i)
  return m ? m[1]! : null
}

function capabilityFrom(t: RuleTemplate, evidenceSource: string, line: string): AuthorityCapability {
  return {
    action: t.action,
    resource: t.resource,
    scope: null,
    destination: t.extractDestination ? extractHost(line) : null,
    mutability: t.mutability,
    reversibility: t.reversibility,
    monetaryLimit: null,
    approvalRequirement: t.approvalRequirement,
    evidenceSource,
    confidence: t.confidence,
    completeness: "complete",
    pattern: t.pattern,
  }
}

/** Stable identity for dedup: two matches of the same shape on the same line collapse. */
function keyOf(c: AuthorityCapability): string {
  return [c.pattern, c.action, c.resource, c.destination ?? "", c.evidenceSource].join("|")
}

/**
 * Extract instruction-authority capabilities from allowlisted document surfaces.
 * Deterministic: same surfaces (same text, same order) → byte-identical output.
 * Every capability is cited to `${surface.path}:${lineNumber}` (1-based).
 */
export function extractInstructionAuthority(
  surfaces: readonly DocumentSurface[],
): AuthorityCapability[] {
  const seen = new Map<string, AuthorityCapability>()

  for (const surface of surfaces) {
    const lines = surface.text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const evidenceSource = `${surface.path}:${i + 1}`

      for (const rule of RULES) {
        if (rule.test.test(line)) {
          const cap = capabilityFrom(rule, evidenceSource, line)
          const k = keyOf(cap)
          if (!seen.has(k)) seen.set(k, cap)
        }
      }

      // hidden-override, obfuscated-character half: delegate to findHiddenContent
      // (code-point defined). Ignore plain HTML comments — too common in docs to
      // confer authority. Structural smuggling (zero-width / bidi / tag-char) does.
      const smuggling = findHiddenContent(line).filter(
        (c) => c !== "embedded HTML/XML comment",
      )
      if (smuggling.length > 0) {
        const cap: AuthorityCapability = {
          action: "mutate",
          resource: "agent",
          scope: null,
          destination: null,
          mutability: "mutating",
          reversibility: "irreversible",
          monetaryLimit: null,
          approvalRequirement: "block",
          evidenceSource,
          confidence: "high", // structural, near-zero FP
          completeness: "complete",
          pattern: "hidden-override",
        }
        const k = keyOf(cap)
        if (!seen.has(k)) seen.set(k, cap)
      }
    }
  }

  return sortCapabilities([...seen.values()])
}

/** Total, deterministic ordering so manifests are byte-stable. */
export function sortCapabilities(caps: AuthorityCapability[]): AuthorityCapability[] {
  return caps.sort((a, b) => {
    return (
      cmp(a.pattern ?? "", b.pattern ?? "") ||
      cmp(a.evidenceSource, b.evidenceSource) ||
      cmp(a.action, b.action) ||
      cmp(a.resource, b.resource) ||
      cmp(a.destination ?? "", b.destination ?? "")
    )
  })
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
