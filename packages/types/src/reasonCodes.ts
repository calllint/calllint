// ---------------------------------------------------------------------------
// Reason-code vocabulary v0 (new4 L2 public API — ADR 0020)
//
// A stable, host-agnostic vocabulary of 13 codes (12 frozen for v0 at indices 0–11;
// #13 TOXIC_FLOW_COMPOSITION appended last by ADR 0044, order 0–11 unchanged). These
// replace detector-internal finding ids (which split/merge as detectors evolve)
// as the public language consumed by agents, CI gates, badges, and the website.
//
// Reason codes are a PROJECTION of findings; they never decide the verdict.
// The verdict still comes from the risk engine (mostSevereVerdict). See ADR 0020.
// ---------------------------------------------------------------------------

/** The 12 frozen reason codes (order is stable; do not reorder). */
export const REASON_CODES = [
  "UNPINNED_PACKAGE",
  "UNKNOWN_REMOTE",
  "SECRET_IN_WORKSPACE_CONFIG",
  "BROAD_FILESYSTEM_ACCESS",
  "SHELL_OR_DOCKER_EXECUTION",
  "EXTERNAL_MUTATION_UNKNOWN",
  "MONEY_OR_PAYMENT_CAPABILITY",
  "MESSAGING_OR_EMAIL_SEND",
  "PROMPT_METADATA_INSTRUCTION",
  "OAUTH_SCOPE_UNKNOWN_OR_EXPANDED",
  "TOOL_DESCRIPTOR_CHANGED",
  "LONG_RUNNING_GATEWAY_RUNTIME",
  // #13 — appended last (ADR 0044) so the frozen order 0–11 is unchanged. Backed by
  // the flow object (calllint.flow.v0), not a static detector; see REASON_CODE_META.
  "TOXIC_FLOW_COMPOSITION",
] as const

export type ReasonCode = (typeof REASON_CODES)[number]

/** Whether a code is wired to a backing detector in v0, or pending a Phase-2 ADR. */
export type ReasonCodeStatus = "wired" | "pending"

export interface ReasonCodeMeta {
  /** Backing detector finding ids. Empty for pending codes. */
  backedBy: string[]
  status: ReasonCodeStatus
  /** Short, stable human label for renderers. */
  label: string
}

/**
 * The single source of truth mapping reason codes to the detectors that back
 * them (ADR 0020). All 12 codes are now wired: 11 to static/extractor-fed
 * detectors, plus TOOL_DESCRIPTOR_CHANGED to the drift / toolMetadataHash signal.
 * Codes #8/#10/#12 were wired in Phase 2 (ADR 0021/0022/0023).
 */
export const REASON_CODE_META: Record<ReasonCode, ReasonCodeMeta> = {
  UNPINNED_PACKAGE: {
    backedBy: ["supply.unpinned-package"],
    status: "wired",
    label: "Unpinned package",
  },
  UNKNOWN_REMOTE: {
    backedBy: ["supply.unknown-remote"],
    status: "wired",
    label: "Unknown remote endpoint",
  },
  SECRET_IN_WORKSPACE_CONFIG: {
    backedBy: ["secrets.env-key"],
    status: "wired",
    label: "Secret in workspace config",
  },
  BROAD_FILESYSTEM_ACCESS: {
    backedBy: ["files.broad-path"],
    status: "wired",
    label: "Broad filesystem access",
  },
  SHELL_OR_DOCKER_EXECUTION: {
    backedBy: ["exec.dangerous-command", "exec.unverified-local-source"],
    status: "wired",
    label: "Shell or Docker execution",
  },
  EXTERNAL_MUTATION_UNKNOWN: {
    backedBy: ["action.external-mutation"],
    status: "wired",
    label: "Unknown external mutation",
  },
  MONEY_OR_PAYMENT_CAPABILITY: {
    backedBy: ["action.financial", "action.financial-observed"],
    status: "wired",
    label: "Money or payment capability",
  },
  MESSAGING_OR_EMAIL_SEND: {
    backedBy: ["action.messaging-send"],
    status: "wired",
    label: "Messaging or email send",
  },
  PROMPT_METADATA_INSTRUCTION: {
    backedBy: ["prompt.hidden-instructions", "prompt.poisoning"],
    status: "wired",
    label: "Prompt-metadata instruction",
  },
  OAUTH_SCOPE_UNKNOWN_OR_EXPANDED: {
    backedBy: ["auth.oauth-scope"],
    status: "wired",
    label: "OAuth scope unknown or expanded",
  },
  TOOL_DESCRIPTOR_CHANGED: {
    // Backed by the drift signal (toolMetadataHash change), not a static detector.
    // Wired via the verify/drift path in P1/P4, not findingsToReasonCodes.
    backedBy: ["drift:toolMetadataHash"],
    status: "wired",
    label: "Tool descriptor changed",
  },
  LONG_RUNNING_GATEWAY_RUNTIME: {
    backedBy: ["runtime.gateway"],
    status: "wired",
    label: "Long-running gateway runtime",
  },
  TOXIC_FLOW_COMPOSITION: {
    // Backed by the flow object (calllint.flow.v0 / @calllint/flow-analyzer), NOT a
    // static detector Finding. The synthetic backing id keeps every wired code naming
    // its backing without inventing a new status value. No detector emits this id, so
    // findingsToReasonCodes never fabricates the code — it is produced only by the
    // explicit flow-fold step. See ADR 0044 / 0040.
    backedBy: ["flow:toxic-composition"],
    status: "wired",
    label: "Cross-tool toxic-flow composition",
  },
}

/** Map a backing finding id to its reason code, or undefined if unmapped. */
export function reasonCodeForFinding(findingId: string): ReasonCode | undefined {
  for (const code of REASON_CODES) {
    if (REASON_CODE_META[code].backedBy.includes(findingId)) return code
  }
  return undefined
}
