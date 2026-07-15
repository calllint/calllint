import type {
  ConfigSummaryReport,
  GatewayEvidence,
  ScanReport,
  Verdict,
} from "@calllint/types"
import { VERDICT_PUBLIC_LABEL, mostSevereVerdict } from "@calllint/types"
import {
  parseConfigFile,
  parseConfigText,
  type ParsedConfig,
} from "@calllint/config-parser"
import { scanServer } from "./scanServer.js"
import { scanDocumentSurfaces } from "./scanSurfaces.js"
import { enrichEvidencePositions } from "./enrichPositions.js"
import { resolveScanOptions, type ScanOptions } from "./options.js"

function aggregate(
  configPath: string,
  reports: ScanReport[],
  generatedAt: string,
  evidence: GatewayEvidence[],
): ConfigSummaryReport {
  const counts: Record<Verdict, number> = { SAFE: 0, REVIEW: 0, BLOCK: 0, UNKNOWN: 0 }
  for (const r of reports) counts[r.verdict]++

  // No servers examined → nothing was actually checked. Reporting SAFE here would
  // reassure a user who scanned the wrong file, a wrong-schema config, or an empty
  // one. "Insufficient evidence" is the honest verdict, not "no blockers observed"
  // (ADR 0010: SAFE requires a positively recognized, examined source).
  const verdict =
    reports.length === 0 ? "UNKNOWN" : mostSevereVerdict(reports.map((r) => r.verdict))

  return {
    schemaVersion: "calllint.report.v0",
    reportKind: "config-summary",
    configPath,
    verdict,
    publicVerdictLabel: VERDICT_PUBLIC_LABEL[verdict],
    counts,
    reports,
    diagnostics: [],
    generatedAt,
    // Additive projection (ADR 0034). Attached only when the CLI imported evidence
    // via `scan --evidence`; omitted otherwise so default scan output is
    // byte-identical (the offline corpus never attaches evidence). Never re-scored:
    // the `verdict` above is unaffected by these findings.
    ...(evidence.length > 0 ? { evidence } : {}),
  }
}

function scanParsed(parsed: ParsedConfig, opts?: ScanOptions): ConfigSummaryReport {
  const { generatedAt, surfaces, evidence } = resolveScanOptions(opts)
  const reports = parsed.servers.map((server) =>
    scanServer({ server, targetKind: parsed.kind }, opts),
  )
  // Best-effort: annotate evidence with source line/column AFTER verdicts are
  // decided. Pure annotation — never changes a verdict (see enrichPositions).
  enrichEvidencePositions(reports, parsed.positions)

  // Prompt-surface scan of local project documents (ADR 0015). Opt-in: only runs
  // when the CLI supplied surfaces. Appended as a project-level report so it joins
  // the most-severe aggregate naturally, with no schema change. An empty/clean
  // surface adds no report (no spurious UNKNOWN).
  const surfaceReport = scanDocumentSurfaces(surfaces, parsed.configPath, generatedAt)
  if (surfaceReport) reports.push(surfaceReport)

  return aggregate(parsed.configPath, reports, generatedAt, evidence)
}

/** Scan a config file on disk. Throws ConfigParseError on malformed JSON. */
export function scanConfigFile(path: string, opts?: ScanOptions): ConfigSummaryReport {
  return scanParsed(parseConfigFile(path), opts)
}

/** Scan a config from raw text (inline / tests). Throws on malformed JSON. */
export function scanConfigText(
  text: string,
  configPath: string | undefined,
  opts?: ScanOptions,
): ConfigSummaryReport {
  return scanParsed(parseConfigText(text, configPath), opts)
}
