import type { ScanReport } from "@calllint/types"
import type { PositionIndex } from "@calllint/config-parser"

/**
 * Post-hoc, best-effort enrichment: fill `evidence.line`/`evidence.column` from a
 * source-position index AFTER the verdict is decided. This is pure annotation —
 * it never changes a finding, a verdict, or the set of evidence; it only adds a
 * source location when the evidence's config key can be located in the source.
 *
 * Evidence whose `key` does not correspond to a literal config key for that
 * server (e.g. `package`, which comes from the resolved runtime binding, not a
 * config field) is left untouched — line/column stay undefined and render null.
 */
export function enrichEvidencePositions(
  reports: ScanReport[],
  positions: PositionIndex,
): void {
  if (Object.keys(positions).length === 0) return

  // A config key for server <name> can live under mcpServers.<name>.<key>,
  // servers.<name>.<key>, or a bare top-level map <name>.<key>. Try each.
  const prefixes = ["mcpServers", "servers", ""]

  for (const report of reports) {
    const server = report.target.name
    for (const finding of report.findings) {
      for (const ev of finding.evidence) {
        if (ev.line !== undefined) continue // already located
        if (!ev.key) continue
        for (const prefix of prefixes) {
          const path = prefix
            ? `${prefix}.${server}.${ev.key}`
            : `${server}.${ev.key}`
          const pos = positions[path]
          if (pos) {
            ev.line = pos.line
            ev.column = pos.column
            break
          }
        }
      }
    }
  }
}
