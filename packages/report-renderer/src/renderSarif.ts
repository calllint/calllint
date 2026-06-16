import type {
  ConfigSummaryReport,
  Finding,
  ScanReport,
  Severity,
} from "@calllint/types"

/** SARIF severity levels. */
type SarifLevel = "error" | "warning" | "note"

function levelForSeverity(sev: Severity): SarifLevel {
  if (sev === "critical" || sev === "high") return "error"
  if (sev === "medium") return "warning"
  return "note"
}

interface SarifRule {
  id: string
  name: string
  shortDescription: { text: string }
  fullDescription: { text: string }
  helpUri?: string
  defaultConfiguration: { level: SarifLevel }
  properties: { symbol: string; riskClass: string; tags: string[] }
}

interface SarifResult {
  ruleId: string
  level: SarifLevel
  message: { text: string }
  locations: {
    physicalLocation: {
      artifactLocation: { uri: string }
      region?: { startLine: number }
    }
    logicalLocations?: { name: string; kind: string }[]
  }[]
  partialFingerprints: Record<string, string>
  properties: Record<string, unknown>
}

/** Convert a Windows or POSIX path to a file URI-friendly relative-ish string. */
function toUri(path: string): string {
  if (path === "<stdin>" || path === "<inline>") return path
  return path.replace(/\\/g, "/")
}

function ruleFromFinding(f: Finding): SarifRule {
  return {
    id: f.id,
    name: f.title,
    shortDescription: { text: f.title },
    fullDescription: { text: f.impact },
    defaultConfiguration: { level: levelForSeverity(f.severity) },
    properties: {
      symbol: f.symbol,
      riskClass: f.riskClass,
      tags: ["calllint", f.symbol.toLowerCase(), f.riskClass.toLowerCase()],
    },
  }
}

function resultFromFinding(
  f: Finding,
  report: ScanReport,
  configUri: string,
): SarifResult {
  const ev = f.evidence[0]
  const region = ev?.line ? { startLine: ev.line } : undefined
  const messageParts = [f.impact]
  if (f.fix) messageParts.push(`Fix: ${f.fix}`)
  if (f.falsePositiveNote) messageParts.push(`Note: ${f.falsePositiveNote}`)

  return {
    ruleId: f.id,
    level: levelForSeverity(f.severity),
    message: { text: messageParts.join(" ") },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: ev?.path ? toUri(ev.path) : configUri },
          ...(region ? { region } : {}),
        },
        logicalLocations: [{ name: report.target.name, kind: "namespace" }],
      },
    ],
    partialFingerprints: {
      configHash: report.fingerprints.configHash,
      riskSurfaceHash: report.fingerprints.riskSurfaceHash,
    },
    properties: {
      server: report.target.name,
      verdict: report.verdict,
      symbol: f.symbol,
      riskClass: f.riskClass,
      mode: f.mode,
      confidence: f.confidence,
      blocker: f.blocker,
    },
  }
}

/**
 * Render a config scan as SARIF 2.1.0 for GitHub Code Scanning / CI ingestion.
 * Derived purely from the ScanReport contract: every finding becomes one rule
 * (deduped by id) and one result. Severity maps to SARIF level; verdict and
 * risk metadata travel in `properties`. Emoji-free and deterministic.
 */
export function renderSarif(summary: ConfigSummaryReport): string {
  const configUri = toUri(summary.configPath)
  const rules = new Map<string, SarifRule>()
  const results: SarifResult[] = []

  for (const report of summary.reports) {
    for (const f of report.findings) {
      if (!rules.has(f.id)) rules.set(f.id, ruleFromFinding(f))
      results.push(resultFromFinding(f, report, configUri))
    }
  }

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "CallLint",
            informationUri: "https://github.com/saintl1022/calllint",
            rules: [...rules.values()],
          },
        },
        results,
        properties: {
          aggregateVerdict: summary.verdict,
          counts: summary.counts,
          generatedAt: summary.generatedAt,
        },
      },
    ],
  }

  return JSON.stringify(sarif, null, 2)
}
