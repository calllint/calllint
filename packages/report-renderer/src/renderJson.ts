import type { ConfigSummaryReport } from "@calllint/types"

/**
 * JSON renderer. The JSON is the stable, emoji-free contract: it is exactly the
 * ScanReport schema, pretty-printed. No symbols, no color, no derived prose.
 */
export function renderJson(summary: ConfigSummaryReport): string {
  return JSON.stringify(summary, null, 2)
}
