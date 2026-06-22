import type {
  ConfigSummaryReport,
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
import { resolveScanOptions, type ScanOptions } from "./options.js"

function aggregate(
  configPath: string,
  reports: ScanReport[],
  generatedAt: string,
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
  }
}

function scanParsed(parsed: ParsedConfig, opts?: ScanOptions): ConfigSummaryReport {
  const { generatedAt } = resolveScanOptions(opts)
  const reports = parsed.servers.map((server) =>
    scanServer({ server, targetKind: parsed.kind }, opts),
  )
  return aggregate(parsed.configPath, reports, generatedAt)
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
