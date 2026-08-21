/**
 * Private report renderer tests (new18 §26, §27, §29).
 *
 * Three things here are security assertions rather than presentation checks:
 * the noindex directive (§29 — the host is private), the absence of any
 * off-host reference (a private page must not beacon to a third party), and
 * HTML escaping of every interpolated value. The rest guard the arithmetic
 * being *displayed* honestly — a null cell must render as "not applicable",
 * never as a zero, because a zero is a claim and an em dash is not.
 */
import { describe, expect, it } from "vitest"
import { renderReport, type ReportData, type TrendPoint } from "../src/report.js"

const trendOf = (days: number): TrendPoint[] =>
  Array.from({ length: days }, (_, i) => ({
    day: `2026-08-${String(i + 1).padStart(2, "0")}`,
    preflights: 10 + i,
    activeInstallations: 5 + i,
  }))

const baseData = (overrides: Partial<ReportData> = {}): ReportData => ({
  generatedAt: "2026-08-20T06:30:00Z",
  npmDataThrough: "2026-08-19",
  observedUsageSince: "2026-07-01",
  cliDownloads: { cumulative: 12_481, last30: 8_214 },
  mcpDownloads: { cumulative: 4_182, last30: 3_107 },
  recordedPreflights: { cumulative: 1_842, last30: 1_731 },
  needAttention: { cumulative: 317, last30: 296 },
  activeInstallationsLast30: 184,
  mcpServersObserved: 500,
  trend: trendOf(30),
  ...overrides,
})

describe("renderReport — privacy and self-containment", () => {
  it("declares noindex, nofollow, noarchive", () => {
    // §29: the entire host is private. Even behind Access, a crawler that ever
    // reaches it must be told not to index or archive.
    expect(renderReport(baseData())).toContain(
      '<meta name="robots" content="noindex, nofollow, noarchive" />',
    )
  })

  it("references no off-host resource", () => {
    const html = renderReport(baseData())
    // Any absolute URL would be an outbound request from a private page: a
    // third party would learn when the operator opened the report.
    expect(html).not.toMatch(/(?:src|href)\s*=\s*"(?:https?:)?\/\//)
    expect(html).not.toContain("googleapis")
    expect(html).not.toContain("cdn")
  })

  it("loads exactly one local stylesheet and no script", () => {
    const html = renderReport(baseData())
    expect(html).toContain('<link rel="stylesheet" href="./usage.css" />')
    // §26 forbids a client-side framework or charting library; the strongest
    // form of that assertion is that no script element exists at all.
    expect(html).not.toMatch(/<script/i)
  })

  it("carries no inline event handler", () => {
    expect(renderReport(baseData())).not.toMatch(/\son[a-z]+\s*=/i)
  })
})

describe("renderReport — escaping", () => {
  it("escapes an injected value in a provenance field", () => {
    const html = renderReport(
      baseData({ npmDataThrough: '<script>alert("x")</script>' }),
    )
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
  })

  it("escapes ampersands before angle brackets", () => {
    // Order matters: escaping < first and & second would produce "&amp;lt;".
    const html = renderReport(baseData({ observedUsageSince: "a&<b" }))
    expect(html).toContain("a&amp;&lt;b")
    expect(html).not.toContain("&amp;lt;")
  })

  it("escapes a value interpolated into the trend axis label", () => {
    const trend = trendOf(3)
    const first = trend[0]
    if (first) first.day = '"><b>'
    const html = renderReport(baseData({ trend }))
    expect(html).not.toContain('"><b>')
    expect(html).toContain("&quot;&gt;&lt;b&gt;")
  })
})

describe("renderReport — honest cells", () => {
  it("renders an inapplicable cell as an em dash, not a zero", () => {
    const html = renderReport(baseData())
    // Active installations has no cumulative figure and MCP servers observed has
    // no 30d figure (new18 §26 shows both as blank).
    expect(html).toContain('<td class="na">—</td>')
    expect(html.match(/<td class="na">—<\/td>/g)).toHaveLength(2)
  })

  it("distinguishes a real zero from an inapplicable cell", () => {
    const html = renderReport(
      baseData({ needAttention: { cumulative: 0, last30: 0 } }),
    )
    expect(html).toContain("<td>0</td>")
  })

  it("renders an unavailable source as not-applicable, never as zero", () => {
    // §25: a zero asserts that nothing happened. When the aggregate source
    // could not be read, the generator passes null and the report must decline
    // to make that assertion — otherwise an unread database looks like a quiet
    // product, which is the single most misleading thing this page could say.
    const html = renderReport(
      baseData({
        observedUsageSince: null,
        recordedPreflights: { cumulative: null, last30: null },
        needAttention: { cumulative: null, last30: null },
        activeInstallationsLast30: null,
        trend: [],
      }),
    )
    expect(html).not.toContain("<td>0</td>")
    expect(html).toContain("no telemetry ingested yet")
    // Four usage cells plus the two structurally-inapplicable ones.
    expect(html.match(/<td class="na">—<\/td>/g)).toHaveLength(7)
  })

  it("renders an unavailable npm source as not-applicable too", () => {
    const html = renderReport(
      baseData({
        cliDownloads: { cumulative: null, last30: null },
        mcpDownloads: { cumulative: null, last30: null },
      }),
    )
    // The download rows must not read as "zero downloads" when npm was
    // unreachable — that would understate distribution, not merely omit it.
    const distribution = html.slice(
      html.indexOf('class="group-distribution"'),
      html.indexOf('class="group-usage"'),
    )
    expect(distribution).not.toContain("<td>0</td>")
    expect(distribution.match(/<td class="na">—<\/td>/g)).toHaveLength(4)
  })

  it("keeps the horizontal pan region reachable by keyboard", () => {
    // The table is wider than a narrow phone, so it lives in an overflow-x
    // container. A scrollable div is not keyboard-scrollable unless it is
    // focusable — without tabindex the 30d column is unreachable for a reader
    // who cannot swipe, which is WCAG 2.1.1, not a nicety.
    const html = renderReport(baseData())
    const region = html.match(/<div class="metrics-scroll"[^>]*>/)?.[0] ?? ""
    expect(region).toContain('tabindex="0"')
    expect(region).toContain('role="region"')
    expect(region).toMatch(/aria-label="[^"]+"/)
  })

  it("groups distribution and usage into separate table bodies", () => {
    const html = renderReport(baseData())
    expect(html).toContain('<tbody class="group-distribution">')
    expect(html).toContain('<tbody class="group-usage">')
    // Downloads must not sit in the usage group: §26's caveat that downloads are
    // not user counts depends on the two being visually separated.
    const usage = html.slice(html.indexOf('class="group-usage"'))
    expect(usage).not.toContain("CLI package downloads")
  })

  it("formats large numbers with thousands separators", () => {
    expect(renderReport(baseData())).toContain("12,481")
  })

  it("states that downloads are not user counts", () => {
    expect(renderReport(baseData())).toContain(
      "distribution signals, not user counts",
    )
  })

  it("states that need-attention is not a count of attacks stopped", () => {
    // The claim CallLint must never make. §26 requires the disclaimer inline.
    expect(renderReport(baseData())).toContain("not a count of attacks stopped")
  })

  it("says so plainly when nothing has been ingested yet", () => {
    // §25: usage before observation began is unrecoverable and must not be
    // estimated. Rendering a date here would invent one.
    const html = renderReport(baseData({ observedUsageSince: null }))
    expect(html).toContain("no telemetry ingested yet")
  })
})

describe("renderReport — trend", () => {
  it("draws exactly two series", () => {
    const html = renderReport(baseData())
    expect(html.match(/<path /g)).toHaveLength(2)
    expect(html).toContain('class="series-preflights"')
    expect(html).toContain('class="series-installations"')
  })

  it("plots one point per day", () => {
    const html = renderReport(baseData({ trend: trendOf(7) }))
    const firstPath = html.match(/class="series-preflights" d="([^"]+)"/)?.[1] ?? ""
    // One M plus six L commands.
    expect(firstPath.match(/[ML]/g)).toHaveLength(7)
    expect(firstPath.startsWith("M")).toBe(true)
  })

  it("labels the first and last observed day", () => {
    const html = renderReport(baseData({ trend: trendOf(30) }))
    expect(html).toContain("2026-08-01")
    expect(html).toContain("2026-08-30")
  })

  it("keeps every plotted point inside the viewBox", () => {
    const html = renderReport(baseData({ trend: trendOf(30) }))
    const d = html.match(/class="series-preflights" d="([^"]+)"/)?.[1] ?? ""
    const points = [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)]
    expect(points.length).toBe(30)
    for (const [, x, y] of points) {
      expect(Number(x)).toBeGreaterThanOrEqual(0)
      expect(Number(x)).toBeLessThanOrEqual(720)
      expect(Number(y)).toBeGreaterThanOrEqual(0)
      expect(Number(y)).toBeLessThanOrEqual(180)
    }
  })

  it("does not divide by zero when every value is zero", () => {
    // peak is floored at 1 precisely so an all-zero series is a flat line
    // rather than a path full of NaN.
    const html = renderReport(
      baseData({
        trend: [
          { day: "2026-08-01", preflights: 0, activeInstallations: 0 },
          { day: "2026-08-02", preflights: 0, activeInstallations: 0 },
        ],
      }),
    )
    expect(html).not.toContain("NaN")
  })

  it("explains itself rather than drawing a line from one point", () => {
    for (const trend of [trendOf(0), trendOf(1)]) {
      const html = renderReport(baseData({ trend }))
      expect(html).toContain("Not enough observed days yet")
      expect(html).not.toContain("<svg")
    }
  })

  it("gives the SVG an accessible label naming both series", () => {
    const html = renderReport(baseData({ trend: trendOf(30) }))
    expect(html).toMatch(/role="img"/)
    expect(html).toContain("Daily preflights and active installations")
  })
})

describe("renderReport — document shape", () => {
  it("is a complete, single-root HTML document", () => {
    const html = renderReport(baseData())
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html.trimEnd().endsWith("</html>")).toBe(true)
    expect(html.match(/<html/g)).toHaveLength(1)
    expect(html.match(/<\/body>/g)).toHaveLength(1)
  })

  it("has balanced tbody tags", () => {
    const html = renderReport(baseData())
    expect(html.match(/<tbody/g)?.length).toBe(html.match(/<\/tbody>/g)?.length)
  })

  it("declares a viewport and a language", () => {
    const html = renderReport(baseData())
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('name="viewport"')
  })

  it("is deterministic for identical input", () => {
    // The workflow diffs nothing, but a nondeterministic renderer would make
    // any future artifact comparison useless.
    expect(renderReport(baseData())).toBe(renderReport(baseData()))
  })
})
