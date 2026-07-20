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

export const CONFIG_PATTERNS: RegExp[]
export function isConfigSurface(filePath: unknown): boolean
export function targetPathOf(toolInput: unknown): string | null
export function recommendation(filePath: string): PreflightRecommendation
export function preflightFor(event: PreToolUseEvent | null | undefined): PreflightRecommendation | null
