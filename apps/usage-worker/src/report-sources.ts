import type { ReportData } from "./report.js"

type Row = Record<string, unknown>
type Query = (sql: string) => Row[] | null
type Usage = Pick<ReportData,
  "observedUsageSince" | "recordedPreflights" | "needAttention" |
  "activeInstallationsLast30" | "trend">

/** One SQL statement must yield an explicit successful result, including an empty table. */
export function parseD1Result(stdout: string): Row[] {
  const parsed = JSON.parse(stdout)
  if (Array.isArray(parsed) && parsed.length !== 1) throw new Error("Expected one D1 query result")
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  if (first?.success !== true || !Array.isArray(first.results) ||
      (Array.isArray(first.errors) && first.errors.length > 0) ||
      !first.results.every((row: unknown) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("D1 returned no successful result set")
  }
  return first.results
}

const isCount = (value: unknown): boolean =>
  (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) &&
  Number.isSafeInteger(Number(value)) && Number(value) >= 0
const isDay = (value: unknown): boolean => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** All four reads are required to describe observed usage; null means unavailable. */
export function readUsage(throughDay: string, query: Query): Usage | null {
  const since = new Date(Date.parse(`${throughDay}T00:00:00Z`) - 29 * 86_400_000)
    .toISOString().slice(0, 10)
  const counts = query(
    "SELECT day, event_name, SUM(count) AS n FROM usage_daily_counts GROUP BY day, event_name",
  )
  if (counts === null || !counts.every((r) => isDay(r.day) && typeof r.event_name === "string" && isCount(r.n))) return null
  const installations = query(
    `SELECT COUNT(DISTINCT installation_hash) AS n FROM usage_daily_installations WHERE day >= '${since}'`,
  )
  if (installations === null || installations.length !== 1 || !isCount(installations[0]?.n)) return null
  const firstDay = query("SELECT MIN(day) AS d FROM usage_daily_counts")
  if (firstDay === null || firstDay.length !== 1 ||
      (firstDay[0]?.d !== null && !isDay(firstDay[0]?.d))) return null
  const sum = (predicate: (row: Row) => boolean, from: string | null = null) => counts
    .filter((r) => predicate(r) && (from === null || String(r.day) >= from))
    .reduce((total, r) => total + Number(r.n ?? 0), 0)
  const isPreflight = (r: Row) => String(r.event_name) === "preflight_completed"
  const isAttention = (r: Row) => ["scan_verdict_review", "scan_verdict_block", "scan_verdict_unknown"]
    .includes(String(r.event_name))
  const byDay = new Map<string, { preflights: number; activeInstallations: number }>()
  for (const row of counts) {
    const day = String(row.day)
    if (day < since) continue
    const bucket = byDay.get(day) ?? { preflights: 0, activeInstallations: 0 }
    if (isPreflight(row)) bucket.preflights += Number(row.n ?? 0)
    byDay.set(day, bucket)
  }
  const perDay = query(
    `SELECT day, COUNT(DISTINCT installation_hash) AS n FROM usage_daily_installations WHERE day >= '${since}' GROUP BY day`,
  )
  if (perDay === null || !perDay.every((r) => isDay(r.day) && isCount(r.n))) return null
  for (const row of perDay) {
    const day = String(row.day)
    const bucket = byDay.get(day) ?? { preflights: 0, activeInstallations: 0 }
    bucket.activeInstallations = Number(row.n ?? 0)
    byDay.set(day, bucket)
  }
  return {
    observedUsageSince: firstDay?.[0]?.d ? String(firstDay[0].d) : null,
    recordedPreflights: { cumulative: sum(isPreflight), last30: sum(isPreflight, since) },
    needAttention: { cumulative: sum(isAttention), last30: sum(isAttention, since) },
    activeInstallationsLast30: Number(installations?.[0]?.n ?? 0),
    trend: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, values]) => ({ day, ...values })),
  }
}

export type SourceStatus = "available" | "unavailable" | "skipped"
export interface SourceStatuses {
  cli: SourceStatus
  mcp: SourceStatus
  d1: SourceStatus
  registry: SourceStatus
}

/** Fixed labels/statuses only: never copy provider errors or credentials into annotations. */
export function sourceSummary(sources: SourceStatuses): { complete: boolean; markdown: string; warning: string } {
  const rows: [string, SourceStatus][] = [
    ["npm calllint", sources.cli], ["npm calllint-mcp", sources.mcp],
    ["D1 aggregates", sources.d1], ["Registry coverage", sources.registry],
  ]
  const missing = rows.filter(([, status]) => status !== "available")
  const complete = missing.length === 0
  return {
    complete,
    markdown: [
      "### Usage report data sources", "",
      `**${complete ? "COMPLETE" : "DEGRADED — figures incomplete"}**`, "",
      "| Source | Status |", "| --- | --- |",
      ...rows.map(([name, status]) => `| ${name} | ${status} |`), "",
      "Unavailable data is unobserved, never zero. Deployment success does not imply complete data.", "",
    ].join("\n"),
    warning: complete ? "" : `Usage report incomplete: ${missing.map(([name, status]) => `${name} ${status}`).join("; ")}. Missing figures remain unobserved.`,
  }
}
