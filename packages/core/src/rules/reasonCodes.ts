import type { Finding, ReasonCode } from "@calllint/types"
import { REASON_CODES, reasonCodeForFinding } from "@calllint/types"

// ---------------------------------------------------------------------------
// P1.2 — finding → reason-code mapping (new4 L2 backing — ADR 0020).
//
// Projects detector findings onto the stable public reason-code vocabulary.
// This adds no risk logic: it relabels findings whose ids are already mapped in
// REASON_CODE_META. Unmapped findings are ignored here (they still appear in the
// Evidence layer). Output is deduped and returned in the frozen REASON_CODES order.
// ---------------------------------------------------------------------------

export function findingsToReasonCodes(findings: Finding[]): ReasonCode[] {
  const present = new Set<ReasonCode>()
  for (const f of findings) {
    const code = reasonCodeForFinding(f.id)
    if (code) present.add(code)
  }
  // Stable order: follow the frozen REASON_CODES declaration order.
  return REASON_CODES.filter((c) => present.has(c))
}
