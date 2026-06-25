import type {
  ConfigSummaryReport,
  DiagnosticEntry,
  DiagnosticsReport,
  Finding,
  ScanReport,
  VerdictContribution,
} from "@calllint/types"

/**
 * How a finding contributed to its server's verdict. A critical blocker forces
 * BLOCK; otherwise an OBSERVED finding is a REVIEW-grade direct observation and
 * an INFERRED finding is a heuristic inference.
 */
function verdictContributionFor(f: Finding): VerdictContribution {
  if (f.blocker) return "blocker"
  return f.mode === "INFERRED" ? "inferred" : "review"
}

/**
 * Build the config key-path from a finding's first evidence item: evidence.path
 * locates the file, evidence.key the property within it (e.g. "args"). We keep
 * the key as the path component — a config pointer, not a source byte offset.
 * Returns null when no key is present.
 */
function keyPathFor(f: Finding): string | null {
  const ev = f.evidence[0]
  if (!ev) return null
  return ev.key ?? null
}

function observedFor(f: Finding): string | null {
  const ev = f.evidence[0]
  if (!ev) return null
  return ev.value ?? ev.snippet ?? null
}

function entryFromFinding(
  f: Finding,
  report: ScanReport,
  configFile: string,
): DiagnosticEntry {
  const ev = f.evidence[0]
  return {
    ruleId: f.id,
    title: f.title,
    severity: f.severity,
    server: report.target.name,
    file: ev?.path ?? configFile,
    keyPath: keyPathFor(f),
    // Populated by the post-hoc position enrichment (config-parser position
    // index → core), when the evidence's config key maps to a source location;
    // null for evidence with no locatable source key (e.g. binding-derived).
    line: ev?.line ?? null,
    column: ev?.column ?? null,
    observed: observedFor(f),
    remediation: f.fix,
    mode: f.mode,
    confidence: f.confidence,
    verdictContribution: verdictContributionFor(f),
  }
}

/**
 * Render a config scan as the diagnostics protocol (calllint.diagnostics.v0) for
 * editors and agent hosts. A pure projection of the ScanReport — no new analysis,
 * no verdict change (see ADR 0013). Findings from every server are flattened into
 * one diagnostics list, each tagged with its server. Deterministic and emoji-free.
 */
export function renderDiagnostics(summary: ConfigSummaryReport): string {
  const diagnostics: DiagnosticEntry[] = []
  for (const report of summary.reports) {
    for (const f of report.findings) {
      diagnostics.push(entryFromFinding(f, report, summary.configPath))
    }
  }

  const out: DiagnosticsReport = {
    schemaVersion: "calllint.diagnostics.v0",
    verdict: summary.verdict,
    publicVerdictLabel: summary.publicVerdictLabel,
    file: summary.configPath,
    diagnostics,
    generatedAt: summary.generatedAt,
  }

  return JSON.stringify(out, null, 2)
}
