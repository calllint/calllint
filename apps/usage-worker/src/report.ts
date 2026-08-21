/**
 * Private usage report renderer (new18 §26, §27).
 *
 * Static HTML, no client-side framework, no charting library, no dynamic usage
 * API. The 30-day trend is inline SVG with at most two series (new18 §26).
 * Colours and type come from the existing site tokens (new18 §27) — no second
 * design system, no invented palette.
 *
 * Pure string building so the output is testable without a browser or network.
 */

export interface MetricRow {
  label: string
  cumulative: number | null
  last30: number | null
  /** Rendered when a cell is intentionally not applicable. */
  note?: string
}

export interface TrendPoint {
  day: string
  preflights: number
  activeInstallations: number
}

export interface ReportData {
  /** When this report was generated (ISO instant). */
  generatedAt: string
  /** Latest day of npm data available (YYYY-MM-DD). */
  npmDataThrough: string
  /**
   * First day telemetry was successfully ingested, or null when nothing has ever
   * been ingested (new18 §25).
   */
  observedUsageSince: string | null
  cliDownloads: { cumulative: number | null; last30: number | null }
  mcpDownloads: { cumulative: number | null; last30: number | null }
  /**
   * Observed-usage figures are nullable on purpose. When the aggregate source
   * cannot be read, these MUST be null so the cell renders as "not applicable"
   * — never 0. A zero is a claim that nothing happened; an unread source cannot
   * support that claim, and §25 forbids estimating what was not observed.
   */
  recordedPreflights: { cumulative: number | null; last30: number | null }
  needAttention: { cumulative: number | null; last30: number | null }
  activeInstallationsLast30: number | null
  mcpServersObserved: number | null
  trend: TrendPoint[]
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const formatNumber = (value: number): string => value.toLocaleString("en-US")

const cell = (value: number | null): string =>
  value === null ? '<td class="na">—</td>' : `<td>${formatNumber(value)}</td>`

/**
 * Render the 30-day trend as inline SVG (new18 §26: one restrained trend, max
 * two series). Hand-built rather than charted: a charting library would be a
 * client-side framework, which §26 forbids.
 */
function renderTrend(trend: TrendPoint[]): string {
  if (trend.length < 2) {
    return '<p class="empty">Not enough observed days yet to draw a trend.</p>'
  }

  const width = 720
  const height = 180
  const padding = { top: 12, right: 12, bottom: 24, left: 12 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const peak = Math.max(
    1,
    ...trend.map((p) => Math.max(p.preflights, p.activeInstallations)),
  )

  const toPath = (pick: (p: TrendPoint) => number): string =>
    trend
      .map((point, index) => {
        const x = padding.left + (index / (trend.length - 1)) * plotWidth
        const y = padding.top + plotHeight - (pick(point) / peak) * plotHeight
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(" ")

  const firstDay = escapeHtml(trend[0]?.day ?? "")
  const lastDay = escapeHtml(trend[trend.length - 1]?.day ?? "")

  return `<figure class="trend">
        <svg viewBox="0 0 ${width} ${height}" role="img"
             aria-label="Daily preflights and active installations over the last ${trend.length} days.">
          <path class="series-preflights" d="${toPath((p) => p.preflights)}" />
          <path class="series-installations" d="${toPath((p) => p.activeInstallations)}" />
          <text class="axis" x="${padding.left}" y="${height - 6}">${firstDay}</text>
          <text class="axis" x="${width - padding.right}" y="${height - 6}"
                text-anchor="end">${lastDay}</text>
        </svg>
        <figcaption>
          <span class="key key-preflights">Preflights</span>
          <span class="key key-installations">Active installations</span>
          <span class="peak">Peak ${formatNumber(peak)}/day</span>
        </figcaption>
      </figure>`
}

/** Build the complete private report document. */
export function renderReport(data: ReportData): string {
  const rows: MetricRow[] = [
    {
      label: "CLI package downloads",
      cumulative: data.cliDownloads.cumulative,
      last30: data.cliDownloads.last30,
    },
    {
      label: "MCP package downloads",
      cumulative: data.mcpDownloads.cumulative,
      last30: data.mcpDownloads.last30,
    },
    {
      label: "Recorded preflights",
      cumulative: data.recordedPreflights.cumulative,
      last30: data.recordedPreflights.last30,
    },
    {
      label: "Need attention",
      cumulative: data.needAttention.cumulative,
      last30: data.needAttention.last30,
    },
    { label: "Active installations", cumulative: null, last30: data.activeInstallationsLast30 },
    { label: "MCP servers observed", cumulative: data.mcpServersObserved, last30: null },
  ]

  const distributionRows = rows.slice(0, 2)
  const usageRows = rows.slice(2)

  const renderRows = (group: MetricRow[]): string =>
    group
      .map(
        (row) =>
          `<tr><th scope="row">${escapeHtml(row.label)}</th>${cell(row.cumulative)}${cell(row.last30)}</tr>`,
      )
      .join("\n            ")

  const observedSince =
    data.observedUsageSince === null
      ? "no telemetry ingested yet"
      : escapeHtml(data.observedUsageSince)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- Private operator report. Never linked from the public site (new18 §29). -->
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>CallLint Usage — private</title>
    <link rel="stylesheet" href="./usage.css" />
  </head>
  <body>
    <main class="report">
      <header>
        <h1>CallLint Usage</h1>
        <dl class="provenance">
          <div><dt>Updated</dt><dd>${escapeHtml(data.generatedAt)}</dd></div>
          <div><dt>npm data through</dt><dd>${escapeHtml(data.npmDataThrough)}</dd></div>
          <div><dt>Observed usage since</dt><dd>${observedSince}</dd></div>
        </dl>
      </header>

      <!-- tabindex makes the pan region reachable by keyboard: a plain scrollable
           div cannot be scrolled with arrow keys unless it is focusable, which
           would put the 30d column out of reach for a keyboard-only reader. -->
      <div class="metrics-scroll" role="region" tabindex="0"
           aria-label="Metrics, scrollable horizontally">
        <table class="metrics">
          <caption class="sr-only">CallLint distribution and observed usage metrics</caption>
          <thead>
            <tr><td></td><th scope="col">Cumulative</th><th scope="col">30d</th></tr>
          </thead>
          <tbody class="group-distribution">
            ${renderRows(distributionRows)}
          </tbody>
          <tbody class="group-usage">
            ${renderRows(usageRows)}
          </tbody>
        </table>
      </div>

      <p class="caveat">
        Package downloads are distribution signals, not user counts.
      </p>
      <p class="caveat">
        &ldquo;Need attention&rdquo; counts REVIEW, BLOCK and UNKNOWN verdicts — findings a
        human should confirm. It is not a count of attacks stopped.
      </p>
      <p class="caveat">
        Observed usage begins when telemetry started working. Usage before that day is
        unrecoverable and is not estimated.
      </p>

      <h2>Last 30 days</h2>
      ${renderTrend(data.trend)}
    </main>
  </body>
</html>
`
}
