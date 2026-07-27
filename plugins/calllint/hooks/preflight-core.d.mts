/**
 * Type declarations for the pure preflight hook core (JS module shipped as .mjs
 * so the plugin needs no build step). Keeps `tsc` happy when the invariant test
 * imports the core, without pulling a bundler into the plugin.
 */

export interface PreflightRecommendation {
  systemMessage: string
  hookSpecificOutput: {
    hookEventName: "PreToolUse"
    additionalContext: string
  }
}

export interface PreToolUseEvent {
  tool_name?: string
  tool_input?: unknown
  hook_event_name?: string
}

/**
 * The captured install action routed to the shipped human-in-the-loop
 * Trust-Gateway (ADR 0055 §4). Pure data — the hook never runs any of it.
 */
export interface InstallCapture {
  /** Non-blocking recommendation; UNKNOWN-equivalent (`gather-evidence`), never SAFE. */
  recommendation: string
  /** The verbatim shipped route: [prepare (read-only), apply (only writer)]. */
  reAdjudicate: [string, string]
  /** The decision receipt schema `trust apply --receipt` emits. */
  receiptSchema: "calllint.receipt.v1"
  /** Structural ADR 0051 guarantee — always false. */
  blocking: false
}

export const CONFIG_PATTERNS: RegExp[]
/** Mirror of `@calllint/agent-triggers` RECOMMENDATIONS; no "deny"/"block" member. */
export const RECOMMENDATIONS: readonly string[]
export function isConfigSurface(filePath: unknown): boolean
export function targetPathOf(toolInput: unknown): string | null
export function installCapture(filePath: string): InstallCapture
export function recommendation(filePath: string): PreflightRecommendation
export function preflightFor(event: PreToolUseEvent | null | undefined): PreflightRecommendation | null
