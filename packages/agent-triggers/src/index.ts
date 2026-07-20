/**
 * @calllint/agent-triggers — the agent trigger taxonomy + core recommend-policy
 * + platform overlays for new11 P2 (agent-native distribution), PR-10.
 *
 * This package is a pure contract layer consumed by PR-11 (`calllint integrate`)
 * and PR-12 (the Claude plugin / PreToolUse hook). It performs no I/O, no scan,
 * and no verdict computation. It is bound by ADR 0051: every surface built on it
 * is preflight recommend / display-only and non-blocking; it reuses the shipped
 * RiskSymbol vocabulary and discovery host vocabulary rather than forking either
 * (ADR 0049 §2, ADR 0041).
 */
export {
  TRIGGER_IDS,
  type TriggerId,
  type TriggerDefinition,
  TRIGGERS,
  allTriggers,
  triggerById,
  triggersForSymbols,
} from "./taxonomy.js"

export {
  RECOMMENDATIONS,
  type Recommendation,
  type PreflightRecommendation,
  recommendFromVerdict,
} from "./recommend.js"

export {
  type TierAHost,
  type PreflightChannel,
  type PlatformOverlay,
  PLATFORM_OVERLAYS,
  allOverlays,
  overlayForHost,
} from "./overlays.js"
