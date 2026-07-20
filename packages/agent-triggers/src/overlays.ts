/**
 * Platform overlays (new11 P2, PR-10).
 *
 * The trigger taxonomy (`taxonomy.ts`) and recommend-policy (`recommend.ts`) are
 * host-agnostic. An *overlay* binds them to a concrete host: which config files
 * that host reads (so a config-time trigger can be recognized), and how the host
 * surfaces a preflight recommendation to the user (its display channel).
 *
 * Overlays are pure data — no I/O. `@calllint/discovery` owns actual file
 * discovery; this module only records the host's surface so PR-11 (`integrate`)
 * and PR-12 (Claude plugin/hook) render consistently instead of hand-writing
 * per-host strings that drift (new11 §5.6 "copy from a unified template").
 *
 * The host ids reuse `@calllint/discovery` `AgentType` verbatim — one host
 * vocabulary in the product, no fork (ADR 0049 §2).
 */
import type { AgentType } from "@calllint/discovery"

/**
 * The hosts new11 P2 targets for agent-native distribution — the five Tier-A
 * install hosts ("5 个 Tier-A host 有真实自动化 fixture"). This is a NARROWED
 * subset of discovery's `AgentType` (which spans 11 P0–P3 agents): P2 overlays
 * deliberately do not claim to cover P2/P3 agents like codex or amp yet, so the
 * overlay map is keyed by this subset rather than all of `AgentType`. Each
 * member is verified assignable to `AgentType` below — one host vocabulary, no
 * fork (ADR 0049 §2).
 */
export type TierAHost = "claude-code" | "cursor" | "windsurf" | "claude-desktop" | "vscode"

// Compile-time guard: every TierAHost must be a real discovery AgentType.
// If discovery renames/removes one of these, this line fails to typecheck.
const _tierAHostsAreAgentTypes: readonly AgentType[] = [
  "claude-code",
  "cursor",
  "windsurf",
  "claude-desktop",
  "vscode",
] satisfies TierAHost[]
void _tierAHostsAreAgentTypes

/** How a host surfaces a preflight recommendation to the user. */
export type PreflightChannel =
  | "plugin-hook" // an in-loop PreToolUse hook (Claude Code plugin)
  | "cli-recommend" // a CLI line printed by `calllint integrate` / scan
  | "ide-diagnostic" // an editor diagnostic (VS Code / IDE)

export interface PlatformOverlay {
  /** A Tier-A host — a narrowed subset of discovery's AgentType, no new vocab. */
  readonly host: TierAHost
  /** Human-facing host name for copy templates. */
  readonly displayName: string
  /** The channels this host can surface a preflight recommendation through. */
  readonly channels: readonly PreflightChannel[]
  /**
   * Whether this host supports the in-loop plugin hook (PR-12's PreToolUse).
   * Only Claude Code does today; the others recommend at config-time via the
   * CLI or an IDE diagnostic. Recorded so PR-12 does not assume a hook exists
   * everywhere.
   */
  readonly supportsRuntimeHook: boolean
}

/**
 * Overlays for the five Tier-A hosts new11 P2's acceptance gate targets
 * ("5 个 Tier-A host 有真实自动化 fixture"). Deterministically ordered.
 *
 * NOTE: this records the *surface*, not a claim that each is wired yet — PR-11
 * and PR-12 do the wiring, and the P2 acceptance fixtures verify it per host.
 */
export const PLATFORM_OVERLAYS: Record<TierAHost, PlatformOverlay> = {
  "claude-code": {
    host: "claude-code",
    displayName: "Claude Code",
    channels: ["plugin-hook", "cli-recommend"],
    supportsRuntimeHook: true,
  },
  cursor: {
    host: "cursor",
    displayName: "Cursor",
    channels: ["cli-recommend", "ide-diagnostic"],
    supportsRuntimeHook: false,
  },
  windsurf: {
    host: "windsurf",
    displayName: "Windsurf",
    channels: ["cli-recommend", "ide-diagnostic"],
    supportsRuntimeHook: false,
  },
  "claude-desktop": {
    host: "claude-desktop",
    displayName: "Claude Desktop",
    channels: ["cli-recommend"],
    supportsRuntimeHook: false,
  },
  vscode: {
    host: "vscode",
    displayName: "VS Code",
    channels: ["cli-recommend", "ide-diagnostic"],
    supportsRuntimeHook: false,
  },
}

/** All overlays in a deterministic order (by host id). */
export function allOverlays(): PlatformOverlay[] {
  return (Object.keys(PLATFORM_OVERLAYS) as TierAHost[]).sort().map((h) => PLATFORM_OVERLAYS[h])
}

/** Look up an overlay by host; null when the host is unknown (never throws). */
export function overlayForHost(host: string): PlatformOverlay | null {
  return (PLATFORM_OVERLAYS as Record<string, PlatformOverlay>)[host] ?? null
}
