import type {
  ConfigSummaryReport,
  Finding,
  ScanReport,
  Verdict,
} from "@calllint/types"
import { RISK_CLASS_LABEL, RISK_SYMBOL_LABEL } from "@calllint/types"
import { LOGO_REPORT_BASE64 } from "./logoBase64.js"

/**
 * Escape text for safe interpolation into HTML. Every dynamic value — server
 * names, tool metadata, evidence snippets — flows through this. Tool metadata
 * is attacker-controlled (the whole point of CallLint), so a poisoned tool
 * name like `<script>` must never reach the output un-escaped.
 */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const VERDICT_COLOR: Record<Verdict, string> = {
  SAFE: "#1a7f37",
  REVIEW: "#9a6700",
  BLOCK: "#cf222e",
  UNKNOWN: "#6e7781",
}

function badge(verdict: Verdict): string {
  return `<span class="badge" style="background:${VERDICT_COLOR[verdict]}">${esc(verdict)}</span>`
}

function findingRow(f: Finding): string {
  const ev = f.evidence
    .map((e) => {
      const loc = e.path ? ` (${esc(e.path)}${e.line ? `:${e.line}` : ""})` : ""
      const detail = e.value ?? e.snippet ?? ""
      return `<li><code>${esc(e.type)}</code> ${esc(e.key ?? "")}${detail ? ` = ${esc(detail)}` : ""}${loc}</li>`
    })
    .join("")
  return `
    <tr class="sev-${esc(f.severity)}">
      <td>${f.blocker ? "⛔ " : ""}${esc(f.title)}</td>
      <td><code>${esc(f.id)}</code></td>
      <td>${esc(RISK_SYMBOL_LABEL[f.symbol])} <small>(${esc(f.symbol)})</small></td>
      <td>${esc(f.riskClass)}</td>
      <td>${esc(f.severity)}</td>
      <td>${esc(f.mode)}</td>
      <td>
        <div class="impact">${esc(f.impact)}</div>
        <div class="fix"><strong>Fix:</strong> ${esc(f.fix)}</div>
        ${f.evidence.length ? `<ul class="evidence">${ev}</ul>` : ""}
        ${f.falsePositiveNote ? `<div class="fp"><em>${esc(f.falsePositiveNote)}</em></div>` : ""}
      </td>
    </tr>`
}

function serverCard(r: ScanReport): string {
  const symbols = r.symbols.map((s) => `<span class="sym">${esc(RISK_SYMBOL_LABEL[s])}</span>`).join(" ")
  const findings = r.findings.length
    ? `<table class="findings">
        <thead><tr><th>Finding</th><th>Rule</th><th>Symbol</th><th>Class</th><th>Severity</th><th>Mode</th><th>Detail</th></tr></thead>
        <tbody>${r.findings.map(findingRow).join("")}</tbody>
      </table>`
    : `<p class="none">No findings.</p>`

  return `
    <section class="server">
      <h2>${badge(r.verdict)} ${esc(r.target.name)}</h2>
      <p class="meta">
        Class <strong>${esc(r.riskClass)}</strong> ${esc(RISK_CLASS_LABEL[r.riskClass])}
        · confidence ${esc(r.confidence)}
        · reproducibility ${esc(r.reproducibility.level)}
      </p>
      <p class="symbols">${symbols || "<span class=\"sym none\">no risk symbols</span>"}</p>
      <p class="summary">${esc(r.summary)}</p>
      ${findings}
      <p class="policy">autonomous use: <strong>${esc(r.policy.autonomousUse)}</strong>
        · manual approval: <strong>${esc(r.policy.manualApproval)}</strong>
        · sandbox: <strong>${esc(r.policy.sandbox)}</strong></p>
    </section>`
}

const LOGO_SRC = `data:image/png;base64,${LOGO_REPORT_BASE64}`

const STYLE = `
  :root { font-family: -apple-system, Segoe UI, Roboto, sans-serif; --brand: #c41e3a; --brand-glow: rgba(196, 30, 58, 0.35); }
  body { margin: 0; background: #f6f8fa; color: #1f2328; }
  header { background: #24292f; color: #fff; padding: 24px 32px; }
  .header-row { display: flex; align-items: center; gap: 14px; }
  .brand-mark { width: 40px; height: 40px; flex: 0 0 auto; animation: mark-enter 0.6s cubic-bezier(0.22, 1, 0.36, 1) both, mark-glow 4s ease-in-out 0.6s infinite; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header .sub { color: #b1b8c0; font-size: 13px; }
  @keyframes mark-enter { from { opacity: 0; transform: scale(0.88); } to { opacity: 1; transform: scale(1); } }
  @keyframes mark-glow { 0%, 100% { filter: drop-shadow(0 0 0 transparent); } 50% { filter: drop-shadow(0 0 8px var(--brand-glow)); } }
  @media (prefers-reduced-motion: reduce) { .brand-mark { animation: none; } }
  .counts { padding: 16px 32px; background: #fff; border-bottom: 1px solid #d0d7de; }
  .counts span { margin-right: 16px; font-size: 14px; }
  main { padding: 24px 32px; max-width: 1100px; }
  .server { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 20px 24px; margin-bottom: 20px; }
  .server h2 { margin: 0 0 8px; font-size: 17px; }
  .badge { color: #fff; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; vertical-align: middle; }
  .meta, .symbols, .summary, .policy { font-size: 13px; color: #57606a; margin: 6px 0; }
  .sym { background: #eaeef2; border-radius: 4px; padding: 2px 8px; font-size: 12px; }
  .sym.none { background: transparent; color: #8c959f; }
  table.findings { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  table.findings th, table.findings td { border: 1px solid #d0d7de; padding: 6px 8px; text-align: left; vertical-align: top; }
  table.findings th { background: #f6f8fa; }
  tr.sev-critical td:first-child, tr.sev-high td:first-child { border-left: 3px solid #cf222e; }
  .evidence { margin: 6px 0; padding-left: 18px; }
  .fix { color: #1a7f37; margin-top: 4px; }
  .fp { color: #8c959f; margin-top: 4px; }
  .none { color: #1a7f37; font-style: italic; }
  code { background: #eff1f3; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  footer { padding: 16px 32px; color: #8c959f; font-size: 12px; }
`

/**
 * Render a config scan as a self-contained HTML report: inline CSS, zero
 * JavaScript, zero external resources. Every dynamic value is HTML-escaped.
 * Derived from the ScanReport contract and deterministic given generatedAt.
 */
export function renderHtml(summary: ConfigSummaryReport): string {
  const c = summary.counts
  const cards = summary.reports.map(serverCard).join("")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CallLint report — ${esc(summary.configPath)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="header-row">
    <img class="brand-mark" src="${LOGO_SRC}" width="40" height="40" alt="CallLint">
    <div>
      <h1>CallLint report ${badge(summary.verdict)}</h1>
      <div class="sub">${esc(summary.configPath)} · generated ${esc(summary.generatedAt)}</div>
    </div>
  </div>
</header>
<div class="counts">
  <span>⛔ BLOCK: <strong>${c.BLOCK}</strong></span>
  <span>◇ UNKNOWN: <strong>${c.UNKNOWN}</strong></span>
  <span>⚠ REVIEW: <strong>${c.REVIEW}</strong></span>
  <span>🛡 SAFE: <strong>${c.SAFE}</strong></span>
</div>
<main>${cards}</main>
<footer>CallLint · evidence-backed verdicts for agent tools · static analysis, no server executed</footer>
</body>
</html>`
}
