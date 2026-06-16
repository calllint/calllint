import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

/** Model-directed instruction patterns indicative of tool poisoning (T01/T02/T13/T14). */
const POISON_PATTERNS: string[] = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "disregard previous instructions",
  "do not tell the user",
  "do not inform the user",
  "without telling the user",
  "secretly",
  "always call this tool first",
  "call this tool before",
  "before using other tools",
  "before answering",
  "read all files",
  "send the full workspace",
  "include the full workspace",
  "include environment variables",
  "exfiltrate",
  "override system",
  "override the system prompt",
  "you are now",
]

function scanText(
  text: string | undefined,
  source: { path?: string; key: string },
): { pattern: string; evidence: Evidence }[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const hits: { pattern: string; evidence: Evidence }[] = []
  for (const pattern of POISON_PATTERNS) {
    if (lower.includes(pattern)) {
      hits.push({
        pattern,
        evidence: {
          type: "tool-metadata",
          path: source.path,
          key: source.key,
          snippet: pattern,
        },
      })
    }
  }
  return hits
}

/**
 * Scans the model-visible surface — tool names, descriptions, input-schema text,
 * and server instructions — for hidden model-directed instructions. This is the
 * agent-native differentiator: this metadata reaches the model and can steer
 * autonomous tool selection. Critical blocker.
 */
export function detectPromptPoisoning(ctx: DetectorContext): Finding[] {
  const { server } = ctx
  const evidence: Evidence[] = []
  const patterns = new Set<string>()

  for (const hit of scanText(server.instructions, { key: "instructions" })) {
    evidence.push(hit.evidence)
    patterns.add(hit.pattern)
  }

  for (const tool of server.providedTools) {
    const label = tool.name ? `tools.${tool.name}.description` : "tools.description"
    for (const hit of scanText(tool.description, { key: label })) {
      evidence.push(hit.evidence)
      patterns.add(hit.pattern)
    }
    for (const hit of scanText(tool.inputSchemaText, {
      key: tool.name ? `tools.${tool.name}.inputSchema` : "tools.inputSchema",
    })) {
      evidence.push(hit.evidence)
      patterns.add(hit.pattern)
    }
  }

  if (evidence.length === 0) return []

  return [
    {
      id: "prompt.poisoning",
      title: "Suspicious model-directed instruction in tool metadata",
      severity: "critical",
      blocker: true,
      symbol: "PROMPT",
      riskClass: "S2",
      mode: "OBSERVED",
      confidence: "medium",
      detectionMethod: "tool-metadata",
      evidence,
      impact:
        "Tool metadata reaches the model directly and can hijack autonomous tool selection or coerce data disclosure.",
      fix: "Remove model-directed instructions from tool names, descriptions, schemas, and server instructions.",
      falsePositiveNote:
        "Phrases may appear innocently in documentation; review the surrounding metadata in context.",
    },
  ]
}
