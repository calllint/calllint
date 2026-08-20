#!/usr/bin/env node
/**
 * Private usage report generator (new18 §24, §25, §28).
 *
 * Assembles the private operator report from three sources and writes it as a
 * BUILD ARTIFACT — never into apps/web/public/, and never committed. §28 is
 * explicit: the repository holds the generator, template, tests and workflow;
 * daily values stay artifacts. §29 adds the fail-closed rule that forces this
 * shape — until Cloudflare Access is verified on the private host, the HTML is
 * a workflow artifact only.
 *
 *   1. npm downloads    — public API, chunked per §24 (no key needed)
 *   2. D1 aggregates    — via `wrangler d1 execute --json`, optional
 *   3. Registry coverage — counted from the on-disk registry, no network
 *
 * Sources 2 and 3 degrade independently. Without D1 credentials the usage rows
 * render as "no telemetry ingested yet" rather than as zeros, because a zero is
 * a claim about the world and an absent source cannot support one (§25). That
 * degradation is reported on stderr and in the run summary, never silently.
 *
 * Usage:
 *   node scripts/generate-usage-report.mjs --out dist/usage
 *   node scripts/generate-usage-report.mjs --out dist/usage --offline
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** The two published packages whose downloads are distribution signals (§23). */
const PACKAGES = ["calllint", "calllint-mcp"]

/**
 * First day either package could have been downloaded. Earlier days are not
 * requested: npm answers with zeros for pre-publication days, which would
 * silently pad the series and make "cumulative" span a period that did not
 * exist.
 */
const FIRST_PUBLISH_DAY = "2026-06-17"

const D1_DATABASE = "calllint-usage"
const TREND_DAYS = 30

// ── argv ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback
}
const OUT_DIR = path.resolve(repoRoot, flag("--out", "apps/usage-worker/dist/usage"))
const OFFLINE = argv.includes("--offline")

// ── pure helpers, imported from the Worker package ──────────────────────────
// These are the same functions the ingress and its tests use. Re-implementing
// the chunk arithmetic here would create a second, untested copy of the exact
// logic §24 warns about.

const { planRanges, mergeDaily, sumDownloads, sumTrailing, latestDay } = await import(
  new URL("../apps/usage-worker/src/npm-history.ts", import.meta.url).href
).catch(() => ({}))

const { renderReport } = await import(
  new URL("../apps/usage-worker/src/report.ts", import.meta.url).href
).catch(() => ({}))

const { describeWranglerFailure } = await import(
  new URL("../apps/usage-worker/src/wrangler-failure.ts", import.meta.url).href
).catch(() => ({}))

if (
  typeof planRanges !== "function" ||
  typeof renderReport !== "function" ||
  typeof describeWranglerFailure !== "function"
) {
  console.error(
    "generate-usage-report: could not load the Worker's pure modules.\n" +
      "Run through tsx so the .ts imports resolve:\n" +
      "  pnpm usage:report",
  )
  process.exit(1)
}

const today = () => new Date().toISOString().slice(0, 10)
const dayOffset = (day, delta) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)

// ── 1. npm downloads ────────────────────────────────────────────────────────

/**
 * Fetch one package's full daily download series, chunked per §24.
 *
 * npm's range endpoint returns `{ downloads: [{ day, downloads }] }`. Chunks are
 * planned by planRanges (contiguous, non-overlapping) and merged by mergeDaily,
 * which throws if any day arrives twice — the double-count §24 names.
 */
async function fetchDownloads(pkg, throughDay) {
  const ranges = planRanges(FIRST_PUBLISH_DAY, throughDay)
  const chunks = []
  for (const range of ranges) {
    const url = `https://api.npmjs.org/downloads/range/${range.start}:${range.end}/${pkg}`
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "calllint-usage-report" },
    })
    if (!response.ok) {
      throw new Error(`npm ${pkg} ${range.start}..${range.end}: HTTP ${response.status}`)
    }
    const body = await response.json()
    const days = Array.isArray(body?.downloads) ? body.downloads : []
    chunks.push(
      days
        // npm pads the range with zero-download days beyond what exists; keep
        // them (they are real zeros inside the observed window) but drop any
        // malformed entry rather than coercing it to 0.
        .filter((d) => typeof d?.day === "string" && Number.isFinite(d?.downloads))
        .map((d) => ({ day: d.day, downloads: d.downloads })),
    )
  }
  return mergeDaily(chunks)
}

// ── 2. D1 aggregates ────────────────────────────────────────────────────────

/**
 * Run one read-only query against the remote D1 database via wrangler.
 *
 * Returns null — not an empty array — when the query cannot run, so the caller
 * can tell "no credentials" apart from "ran, found nothing". Conflating the two
 * would print zeros for a database nobody asked.
 */
/**
 * Locate wrangler's JS entry so it can be run on `node` directly.
 *
 * Not via `npx`: on Windows the shim is `npx.cmd`, and Node 20 refuses to
 * execFileSync a `.cmd` without a shell (the CVE-2024-27980 mitigation), which
 * surfaces as EINVAL. Running through a shell instead would put an interpolated
 * SQL string on a command line. Resolving the entry script keeps the argv array
 * intact — no shell, no quoting question — and returns null when wrangler simply
 * is not installed, which is a different fact from "the query failed".
 */
function resolveWranglerBin() {
  const candidates = [
    path.join(repoRoot, "node_modules/wrangler/bin/wrangler.js"),
    path.join(repoRoot, "apps/usage-worker/node_modules/wrangler/bin/wrangler.js"),
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

function queryD1(sql) {
  const wrangler = resolveWranglerBin()
  if (wrangler === null) {
    // wrangler is a declared devDependency of apps/usage-worker, so absence here
    // means the workspace was never installed — not that anything needs adding.
    console.error("  ! D1 unavailable: wrangler is not installed (run pnpm install)")
    return null
  }
  try {
    const stdout = execFileSync(
      process.execPath,
      [
        wrangler,
        "d1",
        "execute",
        D1_DATABASE,
        "--remote",
        "--json",
        "--command",
        sql,
      ],
      {
        cwd: path.join(repoRoot, "apps/usage-worker"),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      },
    )
    const parsed = JSON.parse(stdout)
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    return first?.results ?? []
  } catch (error) {
    // Report the cause from stderr, not execFileSync's "Command failed" wrapper,
    // and never the argv (it carries the interpolated SQL). Token-shaped runs are
    // masked in describeWranglerFailure since this line lands in a CI log.
    console.error(`  ! D1 unavailable: ${describeWranglerFailure(error)}`)
    return null
  }
}

const ATTENTION_EVENTS = ["scan_verdict_review", "scan_verdict_block", "scan_verdict_unknown"]

/** Read every figure the report needs from the aggregate tables (§21). */
function readUsage(throughDay) {
  const since = dayOffset(throughDay, -(TREND_DAYS - 1))
  const inList = ATTENTION_EVENTS.map((n) => `'${n}'`).join(", ")

  const counts = queryD1(
    "SELECT day, event_name, SUM(count) AS n FROM usage_daily_counts GROUP BY day, event_name",
  )
  if (counts === null) return null

  const installations = queryD1(
    `SELECT COUNT(DISTINCT installation_hash) AS n FROM usage_daily_installations WHERE day >= '${since}'`,
  )
  const firstDay = queryD1("SELECT MIN(day) AS d FROM usage_daily_counts")

  const sum = (predicate, from = null) =>
    counts
      .filter((r) => predicate(r) && (from === null || String(r.day) >= from))
      .reduce((total, r) => total + Number(r.n ?? 0), 0)

  const isPreflight = (r) => String(r.event_name) === "preflight_completed"
  const isAttention = (r) => ATTENTION_EVENTS.includes(String(r.event_name))

  const byDay = new Map()
  for (const row of counts) {
    const day = String(row.day)
    if (day < since) continue
    const bucket = byDay.get(day) ?? { preflights: 0, activeInstallations: 0 }
    if (isPreflight(row)) bucket.preflights += Number(row.n ?? 0)
    byDay.set(day, bucket)
  }

  // Active installations are per-day distinct hashes, which cannot be derived
  // from the counts table — query the installation table for the trend.
  const perDay = queryD1(
    `SELECT day, COUNT(DISTINCT installation_hash) AS n FROM usage_daily_installations WHERE day >= '${since}' GROUP BY day`,
  )
  for (const row of perDay ?? []) {
    const day = String(row.day)
    const bucket = byDay.get(day) ?? { preflights: 0, activeInstallations: 0 }
    bucket.activeInstallations = Number(row.n ?? 0)
    byDay.set(day, bucket)
  }

  const trend = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => ({ day, ...v }))

  return {
    observedUsageSince: firstDay?.[0]?.d ? String(firstDay[0].d) : null,
    recordedPreflights: {
      cumulative: sum(isPreflight),
      last30: sum(isPreflight, since),
    },
    needAttention: {
      cumulative: sum(isAttention),
      last30: sum(isAttention, since),
    },
    activeInstallationsLast30: Number(installations?.[0]?.n ?? 0),
    trend,
    _attentionEventsQueried: inList,
  }
}

// ── 3. Registry coverage ────────────────────────────────────────────────────

/**
 * Count audited MCP servers from the on-disk registry.
 *
 * Counted, not written as a literal: a hardcoded number drifts the moment a
 * server is added, and would keep reporting a figure nobody re-derived.
 */
function countRegistryServers() {
  const dir = path.join(repoRoot, "apps/web/public/install/mcp-registry")
  if (!fs.existsSync(dir)) return 0
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "index.json")))
    .length
}

// ── main ────────────────────────────────────────────────────────────────────

console.log("Private usage report generator (new18 §28)")
const degradations = []

const npmThrough = dayOffset(today(), -1) // npm lags a day; today is always partial.
let cliSeries = []
let mcpSeries = []

if (OFFLINE) {
  degradations.push("npm downloads skipped (--offline)")
  console.log("  · npm fetch skipped (--offline)")
} else {
  for (const pkg of PACKAGES) {
    try {
      const series = await fetchDownloads(pkg, npmThrough)
      if (pkg === "calllint") cliSeries = series
      else mcpSeries = series
      console.log(`  ✓ npm ${pkg}: ${series.length} days, ${sumDownloads(series)} downloads`)
    } catch (error) {
      degradations.push(`npm ${pkg} unavailable: ${String(error?.message ?? error).split("\n")[0]}`)
      console.error(`  ! npm ${pkg}: ${String(error?.message ?? error).split("\n")[0]}`)
    }
  }
}

const npmDataThrough = latestDay(cliSeries) ?? latestDay(mcpSeries) ?? "no npm data"

const usage = OFFLINE ? null : readUsage(npmThrough)
if (usage === null) {
  degradations.push(
    "D1 aggregates unavailable — usage rows render as not-yet-observed, not as zero",
  )
} else {
  console.log(
    `  ✓ D1: ${usage.recordedPreflights.cumulative} preflights, ` +
      `${usage.activeInstallationsLast30} active installations (30d)`,
  )
}

const mcpServersObserved = countRegistryServers()
console.log(`  ✓ registry: ${mcpServersObserved} audited servers`)

// A missing source yields null, not 0 (§25). The renderer prints an em dash for
// null, so an unread aggregate table reads as "not applicable" instead of
// asserting that zero preflights happened.
const data = {
  generatedAt: new Date().toISOString(),
  npmDataThrough,
  observedUsageSince: usage?.observedUsageSince ?? null,
  cliDownloads: {
    cumulative: cliSeries.length > 0 ? sumDownloads(cliSeries) : null,
    last30: cliSeries.length > 0 ? sumTrailing(cliSeries, npmThrough, 30) : null,
  },
  mcpDownloads: {
    cumulative: mcpSeries.length > 0 ? sumDownloads(mcpSeries) : null,
    last30: mcpSeries.length > 0 ? sumTrailing(mcpSeries, npmThrough, 30) : null,
  },
  recordedPreflights: usage?.recordedPreflights ?? { cumulative: null, last30: null },
  needAttention: usage?.needAttention ?? { cumulative: null, last30: null },
  activeInstallationsLast30: usage?.activeInstallationsLast30 ?? null,
  mcpServersObserved,
  trend: usage?.trend ?? [],
}

const html = renderReport(data)

// ── validate before writing (§28: generate → validate → deploy) ─────────────

const failures = []
if (!html.includes('content="noindex, nofollow, noarchive"')) {
  failures.push("missing robots noindex directive (§29)")
}
if (/<script/i.test(html)) failures.push("report contains a <script> element (§26)")
if (/(?:src|href)\s*=\s*"(?:https?:)?\/\//.test(html)) {
  failures.push("report references an off-host resource")
}
if (!html.startsWith("<!doctype html>")) failures.push("not a complete HTML document")
if (html.includes("NaN") || html.includes("undefined")) {
  failures.push("report contains NaN or undefined")
}
if (failures.length > 0) {
  console.error("\nValidation FAILED — nothing written:")
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log("  ✓ validated: noindex present, no script, no off-host reference")

// ── write ───────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, "index.html"), html)
fs.copyFileSync(
  path.join(repoRoot, "apps/usage-worker/src/usage.css"),
  path.join(OUT_DIR, "usage.css"),
)

// A private host must not be crawled even if Access is ever misconfigured.
fs.writeFileSync(
  path.join(OUT_DIR, "robots.txt"),
  "# Private operator report (new18 §29). Never public.\nUser-agent: *\nDisallow: /\n",
)

const relOut = path.relative(repoRoot, OUT_DIR)
console.log(`\n  → ${relOut}/index.html`)
console.log(`  → ${relOut}/usage.css`)
console.log(`  → ${relOut}/robots.txt`)

if (degradations.length > 0) {
  console.log("\nDegraded sources (report written, figures incomplete):")
  for (const d of degradations) console.log(`  · ${d}`)
}
console.log("\nPrivate usage report: GENERATED")
