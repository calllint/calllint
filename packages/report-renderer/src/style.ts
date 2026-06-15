import type { RiskSymbol, Verdict } from "@mcpguard/types"
import {
  RISK_SYMBOL_EMOJI,
  RISK_SYMBOL_LABEL,
  VERDICT_CLI_SYMBOL,
  VERDICT_TEXT_SYMBOL,
} from "@mcpguard/types"

export interface RenderStyle {
  /** When false, use plain-text symbols (for --no-emoji / CI). */
  emoji: boolean
}

export const DEFAULT_STYLE: RenderStyle = { emoji: true }
export const NO_EMOJI_STYLE: RenderStyle = { emoji: false }

export function verdictTag(verdict: Verdict, style: RenderStyle): string {
  return style.emoji ? VERDICT_CLI_SYMBOL[verdict] : VERDICT_TEXT_SYMBOL[verdict]
}

export function symbolTag(symbol: RiskSymbol, style: RenderStyle): string {
  return style.emoji
    ? `${RISK_SYMBOL_EMOJI[symbol]} ${symbol}`
    : symbol
}

export function symbolList(symbols: RiskSymbol[], style: RenderStyle): string {
  if (symbols.length === 0) return "—"
  return symbols.map((s) => symbolTag(s, style)).join("  ")
}

export function symbolLabels(symbols: RiskSymbol[]): string {
  if (symbols.length === 0) return "none"
  return symbols.map((s) => RISK_SYMBOL_LABEL[s]).join(", ")
}
