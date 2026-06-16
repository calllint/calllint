import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

/** Name fragments suggesting external side-effecting actions (T07). */
const MUTATION_HINTS = [
  "github",
  "gitlab",
  "slack",
  "email",
  "mail",
  "calendar",
  "jira",
  "linear",
  "notion",
  "stripe",
  "twilio",
  "sendgrid",
]

function collectHints(text: string | undefined): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  return MUTATION_HINTS.filter((h) => lower.includes(h))
}

/**
 * Infers external-mutation capability from the package or tool names. This is an
 * INFERRED finding: name-based heuristics suggest the server can act on external
 * systems (open PRs, send messages), which matters for autonomous use.
 */
export function detectExternalMutation(ctx: DetectorContext): Finding[] {
  const { server, binding } = ctx
  const hints = new Set<string>()
  const evidence: Evidence[] = []

  for (const h of collectHints(binding.packageName)) {
    hints.add(h)
    evidence.push({
      type: "runtime-binding",
      key: "package",
      value: binding.packageName,
    })
  }
  for (const tool of server.providedTools) {
    for (const h of collectHints(tool.name)) {
      hints.add(h)
      evidence.push({ type: "tool-metadata", key: "tool", value: tool.name })
    }
  }

  if (hints.size === 0) return []

  return [
    {
      id: "action.external-mutation",
      title: "May perform external side effects",
      severity: "medium",
      blocker: false,
      symbol: "ACTION",
      riskClass: "S3",
      mode: "INFERRED",
      confidence: "low",
      detectionMethod: "package-metadata",
      evidence,
      impact:
        "The server appears to integrate with an external system and may take actions (e.g. open PRs, send messages) on the agent's behalf.",
      fix: "Confirm which mutating tools are exposed and require manual approval for autonomous use.",
      falsePositiveNote:
        "Name-based inference; a read-only integration would not actually mutate anything.",
    },
  ]
}
