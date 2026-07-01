import type { ConfigSummaryReport, Verdict } from "@calllint/types"

/**
 * Render a config scan as a shields.io *endpoint* JSON badge (ADR 0026).
 *
 * The badge is a new projection of the existing aggregate verdict — like SARIF
 * or Markdown, it adds no ScanReport field and makes no verdict decision of its
 * own. A repo commits `calllint-badge.json`, points a shields.io endpoint badge
 * at it, and CI refreshes it with `calllint scan <config> --badge`.
 *
 * Red line (ADR 0026, architecture §Phase 6 "transparency over false comfort"):
 * ONLY `SAFE` may be green. REVIEW / UNKNOWN / BLOCK each carry a distinct,
 * non-green colour so the badge can never present a passed-off green comfort
 * signal for an unresolved or blocked surface. `BADGE_COLOR` is the single
 * source of truth for that mapping and is asserted by a `no-green-only` test.
 *
 * Output conforms to the shields.io endpoint schema:
 *   https://shields.io/badges/endpoint-badge
 */

/** shields.io colour per verdict. Only SAFE is green — see red line above. */
export const BADGE_COLOR: Record<Verdict, string> = {
  SAFE: "brightgreen",
  REVIEW: "yellow",
  UNKNOWN: "lightgrey",
  BLOCK: "red",
}

/** The set of colours shields.io renders as green. Used by the guard test. */
export const GREEN_BADGE_COLORS: readonly string[] = [
  "brightgreen",
  "green",
  "success",
]

/** Message shown on the badge per verdict (matches the CLI verdict word). */
const BADGE_MESSAGE: Record<Verdict, string> = {
  SAFE: "SAFE",
  REVIEW: "REVIEW",
  UNKNOWN: "UNKNOWN",
  BLOCK: "BLOCK",
}

/** The shields.io endpoint badge schema (the committed artifact's shape). */
export interface BadgeEndpoint {
  schemaVersion: 1
  label: "CallLint"
  message: string
  color: string
  /** shields.io re-fetch interval (seconds); keeps the badge fresh, not stale-green. */
  cacheSeconds: number
}

/**
 * Project a config summary into a shields.io endpoint badge. Deterministic:
 * depends only on `summary.verdict`. The label is always `CallLint`; the
 * message is the verdict word; the colour is `BADGE_COLOR[verdict]`.
 */
export function renderBadge(summary: ConfigSummaryReport): string {
  return JSON.stringify(badgeEndpoint(summary.verdict), null, 2)
}

/** The endpoint object for a verdict (exposed for tests and other renderers). */
export function badgeEndpoint(verdict: Verdict): BadgeEndpoint {
  return {
    schemaVersion: 1,
    label: "CallLint",
    message: BADGE_MESSAGE[verdict],
    color: BADGE_COLOR[verdict],
    cacheSeconds: 3600,
  }
}
