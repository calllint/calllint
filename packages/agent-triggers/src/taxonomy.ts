/**
 * Agent Trigger Taxonomy (new11 P2, PR-10).
 *
 * A *trigger* is an authority-expanding operation an agent (or a plugin hook, a
 * CI gate, an IDE action) is about to perform, at which CallLint should surface
 * a preflight recommendation. This module is the canonical, deterministic
 * catalog of those trigger points.
 *
 * BINDING RULE (ADR 0049 §2 EXTEND-not-fork; ADR 0041 map-onto-shipped-vocab):
 * a trigger does NOT introduce a new risk vocabulary. Every trigger maps onto
 * the already-shipped `RiskSymbol` set in `@calllint/types` (SECRETS, FILES,
 * NETWORK, PROMPT, EXEC, ACTION, MONEY, SUPPLY, RUGPULL). The taxonomy names
 * *when* to preflight; the symbols name *what* surface is at stake. If a future
 * trigger needs a symbol that does not exist, the symbol is added in
 * `@calllint/types` first (with an ADR), never invented here.
 *
 * This module is pure data + pure predicates. It performs no I/O, no scan, and
 * no verdict computation — consistent with ADR 0051 (the preflight surface is a
 * renderer of an existing verdict, never a judge).
 */
import type { RiskSymbol } from "@calllint/types"

/**
 * The ten authority-expanding action classes new11 §5 requires a preflight
 * before. Stable string ids — external overlays and receipts key off these, so
 * they are part of the contract and must not be renamed without an ADR.
 */
export const TRIGGER_IDS = [
  "install-agent-tool", // adding/editing an MCP server or agent skill config
  "grant-filesystem", // a tool gains filesystem read/write scope
  "grant-shell-exec", // a tool gains shell / process execution
  "grant-network", // a tool gains outbound network destination(s)
  "expose-secrets", // a config references secret/credential material
  "grant-oauth-scope", // an OAuth / delegated-auth scope is requested
  "external-action", // send/mutate an external system (email, message, issue)
  "financial-action", // a spend / payment / irreversible money action
  "cross-tool-flow", // a source→sink flow spanning tools (toxic-flow surface)
  "supply-chain-change", // a package/version/source-of-truth change
] as const

export type TriggerId = (typeof TRIGGER_IDS)[number]

/**
 * A trigger definition: what it is, which shipped RiskSymbol surface(s) it
 * touches, and the config-shape hint that indicates it may be in play. The
 * `symbols` field is the ONLY link to risk vocabulary — deliberately reusing
 * `@calllint/types` RiskSymbol so there is exactly one taxonomy in the product.
 */
export interface TriggerDefinition {
  readonly id: TriggerId
  /** One-line, human-facing description of the action class. */
  readonly title: string
  /** The shipped RiskSymbol surface(s) this trigger implicates. */
  readonly symbols: readonly RiskSymbol[]
  /**
   * Whether this trigger is a *config-time* event (something is being installed
   * or edited) or a *runtime* event (a tool is about to act). Config-time
   * triggers are handled by `calllint integrate` / scan; runtime triggers are
   * the plugin PreToolUse hook's domain. Both stay recommend-only (ADR 0051).
   */
  readonly phase: "config-time" | "runtime"
}

/**
 * The canonical trigger catalog. Deterministically ordered by `TRIGGER_IDS`.
 * Each entry maps onto shipped RiskSymbols — no symbol here is new.
 */
export const TRIGGERS: Record<TriggerId, TriggerDefinition> = {
  "install-agent-tool": {
    id: "install-agent-tool",
    title: "Install or edit an MCP server or agent skill",
    symbols: ["SUPPLY"],
    phase: "config-time",
  },
  "grant-filesystem": {
    id: "grant-filesystem",
    title: "Grant a tool filesystem read/write access",
    symbols: ["FILES"],
    phase: "config-time",
  },
  "grant-shell-exec": {
    id: "grant-shell-exec",
    title: "Grant a tool shell or process execution",
    symbols: ["EXEC"],
    phase: "config-time",
  },
  "grant-network": {
    id: "grant-network",
    title: "Grant a tool outbound network access",
    symbols: ["NETWORK"],
    phase: "config-time",
  },
  "expose-secrets": {
    id: "expose-secrets",
    title: "Reference secret or credential material",
    symbols: ["SECRETS"],
    phase: "config-time",
  },
  "grant-oauth-scope": {
    id: "grant-oauth-scope",
    title: "Request an OAuth or delegated-auth scope",
    symbols: ["SECRETS", "ACTION"],
    phase: "config-time",
  },
  "external-action": {
    id: "external-action",
    title: "Send to or mutate an external system",
    symbols: ["ACTION"],
    phase: "runtime",
  },
  "financial-action": {
    id: "financial-action",
    title: "Perform a spend, payment, or irreversible money action",
    symbols: ["MONEY"],
    phase: "runtime",
  },
  "cross-tool-flow": {
    id: "cross-tool-flow",
    title: "Move data across tools (source-to-sink flow)",
    symbols: ["PROMPT", "ACTION"],
    phase: "runtime",
  },
  "supply-chain-change": {
    id: "supply-chain-change",
    title: "Change a package, version, or source of truth",
    symbols: ["SUPPLY", "RUGPULL"],
    phase: "config-time",
  },
}

/** All trigger definitions in canonical order. */
export function allTriggers(): TriggerDefinition[] {
  return TRIGGER_IDS.map((id) => TRIGGERS[id])
}

/** Look up a trigger by id; null when unknown (never throws). */
export function triggerById(id: string): TriggerDefinition | null {
  return (TRIGGERS as Record<string, TriggerDefinition>)[id] ?? null
}

/**
 * The triggers whose surface a given set of observed RiskSymbols would activate.
 * Pure set intersection — used to map a scan's symbols onto the action classes
 * that should preflight. Deterministically ordered by `TRIGGER_IDS`.
 */
export function triggersForSymbols(symbols: readonly RiskSymbol[]): TriggerDefinition[] {
  const present = new Set(symbols)
  return allTriggers().filter((t) => t.symbols.some((s) => present.has(s)))
}
