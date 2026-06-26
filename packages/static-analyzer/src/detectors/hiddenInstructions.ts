import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"
import { findHiddenContent, hiddenEvidence } from "../promptScan.js"

function scanHidden(
  text: string | undefined,
  key: string,
  path?: string,
): Evidence[] {
  const out: Evidence[] = []
  for (const category of findHiddenContent(text)) {
    // Report the category only — never reproduce the hidden bytes.
    out.push(hiddenEvidence(category, { type: "tool-metadata", path, key }))
  }
  return out
}

/**
 * Flags hidden or obfuscated content in the model-visible surface — server
 * instructions and provided tool names/descriptions/schema text. This is the
 * R4 prompt-surface signal (ADR 0014): it complements `prompt.poisoning` (literal
 * model-directed phrases, a blocker) by catching the obvious *evasion* of a phrase
 * matcher — zero-width splits, bidi overrides, tag-char smuggling, HTML comments.
 *
 * REVIEW, non-blocker: hidden content is suspicious and worth human eyes, but its
 * mere presence is not proof of an attack. Static shape detection only — it does
 * not claim to detect prompt injection or infer intent. Every finding carries the
 * exact surface path and a false-positive note.
 */
export function detectHiddenInstructions(ctx: DetectorContext): Finding[] {
  const { server } = ctx
  const evidence: Evidence[] = []

  evidence.push(...scanHidden(server.instructions, "instructions", server.sourceConfigPath))

  for (const tool of server.providedTools) {
    const base = tool.name ? `tools.${tool.name}` : "tools"
    evidence.push(...scanHidden(tool.name, `${base}.name`, server.sourceConfigPath))
    evidence.push(
      ...scanHidden(tool.description, `${base}.description`, server.sourceConfigPath),
    )
    evidence.push(
      ...scanHidden(tool.inputSchemaText, `${base}.inputSchema`, server.sourceConfigPath),
    )
  }

  if (evidence.length === 0) return []

  return [
    {
      id: "prompt.hidden-instructions",
      title: "Hidden or obfuscated content in model-visible metadata",
      severity: "medium",
      blocker: false,
      symbol: "PROMPT",
      riskClass: "S2",
      mode: "OBSERVED",
      confidence: "medium",
      detectionMethod: "tool-metadata",
      evidence,
      impact:
        "Invisible or obfuscated characters in tool metadata reach the model but not a human reader, so a model-directed instruction can hide from review while still steering autonomous tool use.",
      fix: "Remove zero-width/bidirectional/tag characters and HTML comments from tool names, descriptions, schemas, and server instructions; keep model-visible text identical to what a human reviewer sees.",
      falsePositiveNote:
        "Some hidden characters are benign (e.g. a BOM, or a bidi control in a legitimate right-to-left language sample, or an HTML comment in documentation). This flags that the model-visible text differs from the rendered text; review the surface in context.",
    },
  ]
}
