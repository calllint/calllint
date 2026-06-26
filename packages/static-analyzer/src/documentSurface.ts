import type { DocumentSurface, Evidence, Finding } from "@calllint/types"
import {
  findHiddenContent,
  findPoisonPhrases,
  hiddenEvidence,
  poisonEvidence,
} from "./promptScan.js"

/**
 * Scans local document surfaces (README.md / SKILL.md / AGENTS.md / package.json
 * description) for model-directed instruction patterns and hidden/obfuscated
 * content — the R4 prompt-surface extension beyond config tool metadata (ADR 0015).
 *
 * These documents ship alongside an MCP server and are read by humans and agents,
 * yet never appear in the scanned config. A prompt-surface payload hidden in a
 * README reaches an agent that reads project docs. This reuses the SAME scanners
 * as `prompt.poisoning` / `prompt.hidden-instructions` (one source of truth).
 *
 * REVIEW, non-blocker: a project doc is advisory prompt surface, not tool metadata
 * the model is guaranteed to consume, so its presence warrants human eyes but must
 * not hard-stop. Every finding carries the surface path (the file) and a
 * false-positive note; evidence reports the phrase/category, never raw bytes.
 *
 * The core never reads files — the CLI reads the allowlisted surfaces (bounded,
 * offline) and hands their text here, keeping this analysis pure and deterministic.
 */
export function analyzeDocumentSurfaces(surfaces: readonly DocumentSurface[]): Finding[] {
  const evidence: Evidence[] = []

  for (const surface of surfaces) {
    for (const pattern of findPoisonPhrases(surface.text)) {
      evidence.push(
        poisonEvidence(pattern, { type: "source", path: surface.path, key: surface.kind }),
      )
    }
    for (const category of findHiddenContent(surface.text)) {
      evidence.push(
        hiddenEvidence(category, { type: "source", path: surface.path, key: surface.kind }),
      )
    }
  }

  if (evidence.length === 0) return []

  return [
    {
      id: "prompt.surface-instructions",
      title: "Model-directed or hidden content in a project document",
      severity: "medium",
      blocker: false,
      symbol: "PROMPT",
      riskClass: "S2",
      mode: "OBSERVED",
      confidence: "medium",
      detectionMethod: "source-text",
      evidence,
      impact:
        "A project document (README / SKILL.md / AGENTS.md / package description) contains model-directed instructions or hidden/obfuscated content. An agent that reads project docs alongside the tool could be steered by text a human reviewer skims past.",
      fix: "Remove model-directed instructions and hidden/obfuscated characters from project documents; keep their visible text equal to their intent.",
      falsePositiveNote:
        "Documentation legitimately discusses prompts, tool ordering, or includes HTML comments and non-Latin scripts. This flags prompt-surface shape in project docs, not a proven injection; review the cited file in context.",
    },
  ]
}
