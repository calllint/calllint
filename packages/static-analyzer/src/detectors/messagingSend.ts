import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

// ---------------------------------------------------------------------------
// ADR 0021 — MESSAGING_OR_EMAIL_SEND (#8). A tool that can send messages on the
// user's behalf (email/SMS/chat/push) is a distinct, nameable capability. This
// is a more specific sibling of external-mutation, not a replacement. Config-only,
// offline: reads package name + provided tool descriptors. Never fetches/executes.
// ---------------------------------------------------------------------------

/** Known messaging package name fragments. */
const MESSAGING_PACKAGE_HINTS = [
  "slack",
  "discord",
  "telegram",
  "sendgrid",
  "twilio",
  "mailgun",
  "postmark",
  "gmail",
  "smtp",
  "nodemailer",
  "mailchimp",
  "ses-email",
  "whatsapp",
  "messagebird",
  "vonage",
  "nexmo",
]

/** Send-verb + messaging-noun patterns in tool names/descriptions. */
const SEND_PATTERNS = [
  /\bsend[_-]?(e?mail|message|sms|text|dm|notification|push)\b/i,
  /\bpost[_-]?message\b/i,
  /\bsend[_-]?mail\b/i,
  /\b(e?mail|sms|message)[_-]?send\b/i,
  /\bdeliver[_-]?(message|email)\b/i,
]

function packageHint(name: string | undefined): string | undefined {
  if (!name) return undefined
  const lower = name.toLowerCase()
  return MESSAGING_PACKAGE_HINTS.find((h) => lower.includes(h))
}

function textMatchesSend(text: string | undefined): boolean {
  if (!text) return false
  return SEND_PATTERNS.some((re) => re.test(text))
}

export function detectMessagingSend(ctx: DetectorContext): Finding[] {
  const { server, binding } = ctx
  const evidence: Evidence[] = []
  let observed = false

  // OBSERVED: a provided tool descriptor names a send capability.
  for (const tool of server.providedTools) {
    if (textMatchesSend(tool.name) || textMatchesSend(tool.description)) {
      observed = true
      evidence.push({ type: "tool-metadata", key: "tool", value: tool.name ?? "(unnamed)" })
    }
  }

  // INFERRED: a known messaging package, even without tool descriptors.
  const pkgHint = packageHint(binding.packageName)
  if (pkgHint) {
    evidence.push({ type: "runtime-binding", key: "package", value: binding.packageName })
  }

  if (evidence.length === 0) return []

  return [
    {
      id: "action.messaging-send",
      title: "May send messages or email on your behalf",
      severity: "medium",
      blocker: false,
      symbol: "ACTION",
      riskClass: "S2",
      mode: observed ? "OBSERVED" : "INFERRED",
      confidence: observed ? "high" : "low",
      detectionMethod: observed ? "tool-metadata" : "package-metadata",
      evidence,
      impact:
        "The server appears able to send messages (email, SMS, chat, or push) as you. A compromised or confused agent could send unwanted or harmful messages.",
      fix: "Confirm which send tools are exposed, require approval before sending, and scope credentials to the minimum needed.",
      falsePositiveNote: observed
        ? undefined
        : "Name-based inference; a read-only integration with the same provider would not actually send.",
    },
  ]
}
