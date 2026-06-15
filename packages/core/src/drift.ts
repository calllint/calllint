import type {
  Baseline,
  BaselineEntry,
  ConfigSummaryReport,
  DriftEntry,
  DriftReport,
  ScanReport,
} from "@mcpguard/types"

function entryFromReport(report: ScanReport): BaselineEntry {
  return {
    server: report.target.name,
    verdict: report.verdict,
    symbols: [...report.symbols],
    findingIds: report.findings.map((f) => f.id).sort(),
    fingerprints: report.fingerprints,
  }
}

/**
 * Snapshot the approved risk surface of every server in a scan. The `createdAt`
 * is informational; everything used for comparison is deterministic.
 */
export function buildBaseline(
  summary: ConfigSummaryReport,
  createdAt: string,
): Baseline {
  return {
    schemaVersion: "mcpguard.baseline.v0",
    configPath: summary.configPath,
    entries: summary.reports.map(entryFromReport),
    createdAt,
  }
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((v, i) => v === sortedB[i])
}

function diffEntry(base: BaselineEntry, cur: BaselineEntry): DriftEntry {
  const reasons: string[] = []
  let rugPull = false

  const fpBase = base.fingerprints
  const fpCur = cur.fingerprints

  // Package-level change is the strongest rug-pull signal: the executable code
  // identity moved even though it was approved before.
  if (fpBase.packageSpecHash !== fpCur.packageSpecHash) {
    reasons.push("package spec changed (rug-pull signal)")
    rugPull = true
  }
  if (fpBase.sourceHash !== fpCur.sourceHash) {
    reasons.push("source text changed")
    rugPull = true
  }
  if (fpBase.toolMetadataHash !== fpCur.toolMetadataHash) {
    reasons.push("tool metadata changed")
    rugPull = true
  }
  if (fpBase.riskSurfaceHash !== fpCur.riskSurfaceHash) {
    reasons.push("risk surface changed")
  }
  if (fpBase.configHash !== fpCur.configHash) {
    reasons.push("config changed")
  }
  if (base.verdict !== cur.verdict) {
    reasons.push(`verdict ${base.verdict} -> ${cur.verdict}`)
  }
  if (!sameStringSet(base.findingIds, cur.findingIds)) {
    reasons.push("finding set changed")
  }

  // Pick the most specific status.
  let status: DriftEntry["status"] = "unchanged"
  if (rugPull) status = "package-changed"
  else if (base.verdict !== cur.verdict) status = "verdict-changed"
  else if (fpBase.riskSurfaceHash !== fpCur.riskSurfaceHash) status = "risk-surface-changed"
  else if (fpBase.configHash !== fpCur.configHash) status = "config-changed"

  return {
    server: base.server,
    status,
    reasons,
    baselineVerdict: base.verdict,
    currentVerdict: cur.verdict,
    rugPull,
  }
}

/**
 * Compare a fresh scan against a baseline. Pure and deterministic. Servers
 * present only in the baseline are "removed"; servers only in the new scan are
 * "added" (and, if their package is unpinned/unknown, that is surfaced by the
 * normal scan, not here). `generatedAt` is injected for reproducibility.
 */
export function computeDrift(
  baseline: Baseline,
  summary: ConfigSummaryReport,
  generatedAt: string,
): DriftReport {
  const current = new Map<string, BaselineEntry>()
  for (const r of summary.reports) current.set(r.target.name, entryFromReport(r))

  const baseByName = new Map<string, BaselineEntry>()
  for (const e of baseline.entries) baseByName.set(e.server, e)

  const entries: DriftEntry[] = []

  for (const base of baseline.entries) {
    const cur = current.get(base.server)
    if (!cur) {
      entries.push({
        server: base.server,
        status: "removed",
        reasons: ["server removed from config"],
        baselineVerdict: base.verdict,
        rugPull: false,
      })
      continue
    }
    entries.push(diffEntry(base, cur))
  }

  for (const [name, cur] of current) {
    if (!baseByName.has(name)) {
      entries.push({
        server: name,
        status: "added",
        reasons: ["new server not in baseline"],
        currentVerdict: cur.verdict,
        rugPull: false,
      })
    }
  }

  const drifted = entries.some((e) => e.status !== "unchanged")
  const rugPullDetected = entries.some((e) => e.rugPull)

  return {
    schemaVersion: "mcpguard.drift.v0",
    configPath: summary.configPath,
    drifted,
    rugPullDetected,
    entries,
    generatedAt,
  }
}
