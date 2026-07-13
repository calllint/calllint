/**
 * SkillSpector adapter — maps SkillSpector JSON and SARIF reports into the neutral
 * AdapterResult shape. Keeps provider findings VERBATIM (providerRuleId /
 * providerSeverity are never remapped to CallLint's scale). Records LLM use and
 * partial/degraded scans so the envelope cannot read as a clean pass.
 *
 * SkillSpector has no formal GitHub Release, so its version is pinned to a commit
 * ("git:<commit>") when the report provides one; otherwise it is left unset and the
 * importer marks the envelope degraded (ADR 0034 invariant 5).
 */
import type { AdapterResult } from "../importEvidence.js"
import type { Completeness, EvidenceFinding, ScanMode } from "../types.js"

/** Extract a pinned version string from a SkillSpector report, if present. */
function pinnedVersion(raw: Record<string, unknown>): string | undefined {
  const tool = raw.tool as Record<string, unknown> | undefined
  const commit =
    (typeof raw.commit === "string" && raw.commit) ||
    (tool && typeof tool.commit === "string" && tool.commit) ||
    ""
  if (commit) return `git:${commit}`
  const version =
    (typeof raw.version === "string" && raw.version) ||
    (tool && typeof tool.version === "string" && tool.version) ||
    ""
  return version || undefined
}

/** SkillSpector JSON → AdapterResult. */
export function parseSkillSpectorJson(parsed: unknown): AdapterResult {
  const raw = asObject(parsed, "SkillSpector JSON root")
  const degradedReasons: string[] = []

  const usedLlm = raw.llm_used === true || raw.llmUsed === true
  const scanMode: ScanMode = usedLlm ? "llm" : "static"

  // Findings may live under "findings" or "results".
  const rawFindings = arrayOf(raw.findings) ?? arrayOf(raw.results) ?? []
  const findings: EvidenceFinding[] = rawFindings.map((f) => {
    const o = asObject(f, "SkillSpector finding")
    return {
      providerRuleId: String(o.rule_id ?? o.ruleId ?? o.id ?? "unknown"),
      providerSeverity: String(o.severity ?? o.level ?? "unknown"),
      message: typeof o.message === "string" ? o.message : undefined,
      locations: extractLocations(o),
    }
  })

  // Honor an explicit completeness signal from the report. A provider-declared
  // "partial" is genuinely partial (exit-10 / REVIEW-class); a hard error/failure
  // is degraded (exit-20 / fail-closed).
  let completenessHint: Completeness | undefined
  const status = String(raw.status ?? raw.scan_status ?? "").toLowerCase()
  if (status && status !== "complete" && status !== "completed" && status !== "success") {
    degradedReasons.push(`SkillSpector reported status "${status}"`)
    completenessHint = status === "partial" ? "partial" : "degraded"
  }
  if (raw.partial === true) {
    degradedReasons.push("SkillSpector reported a partial scan")
    completenessHint = completenessHint ?? "partial"
  }
  if (raw.degraded === true) {
    degradedReasons.push("SkillSpector reported a degraded scan")
    completenessHint = "degraded"
  }

  const coverage = (arrayOf(raw.categories) ?? arrayOf(raw.coverage) ?? [])
    .map((c) => String(c))

  return {
    provider: "skillspector",
    providerVersion: pinnedVersion(raw),
    scanMode,
    coverage,
    findings,
    degradedReasons,
    completenessHint,
  }
}

/** SkillSpector SARIF 2.1.0 → AdapterResult. Net-new parse (no SARIF parser in repo). */
export function parseSkillSpectorSarif(parsed: unknown): AdapterResult {
  const raw = asObject(parsed, "SARIF root")
  const runs = arrayOf(raw.runs) ?? []
  if (runs.length === 0) {
    return {
      provider: "skillspector",
      findings: [],
      degradedReasons: ["SARIF had no runs"],
    }
  }

  const degradedReasons: string[] = []
  const findings: EvidenceFinding[] = []
  let providerVersion: string | undefined
  const coverage: string[] = []

  for (const runUnknown of runs) {
    const run = asObject(runUnknown, "SARIF run")
    const tool = asObject(run.tool ?? {}, "SARIF tool")
    const driver = asObject(tool.driver ?? {}, "SARIF tool.driver")
    if (!providerVersion) {
      const v =
        (typeof driver.semanticVersion === "string" && driver.semanticVersion) ||
        (typeof driver.version === "string" && driver.version) ||
        ""
      if (v) providerVersion = v
    }
    const results = arrayOf(run.results) ?? []
    for (const resUnknown of results) {
      const res = asObject(resUnknown, "SARIF result")
      findings.push({
        providerRuleId: String(res.ruleId ?? "unknown"),
        providerSeverity: String(res.level ?? "warning"),
        message: extractSarifMessage(res),
        locations: extractSarifLocations(res),
      })
    }
  }

  // SARIF is known to drop detail vs SkillSpector's JSON form — flag it so the
  // envelope is never mistaken for a fully-detailed scan.
  degradedReasons.push("SARIF import: provider-specific fields may be lost vs JSON form")

  return {
    provider: "skillspector",
    providerVersion,
    scanMode: "static",
    coverage,
    findings,
    degradedReasons,
  }
}

// --- small, defensive helpers (never throw on shape; caller fail-closes) ---

function asObject(v: unknown, what: string): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  throw new Error(`expected object for ${what}`)
}

function arrayOf(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined
}

function extractLocations(o: Record<string, unknown>): string[] | undefined {
  const loc = o.location ?? o.locations ?? o.path
  if (typeof loc === "string") return [loc]
  if (Array.isArray(loc)) return loc.map((x) => String(x))
  return undefined
}

function extractSarifMessage(res: Record<string, unknown>): string | undefined {
  const msg = res.message as Record<string, unknown> | undefined
  if (msg && typeof msg.text === "string") return msg.text
  return undefined
}

function extractSarifLocations(res: Record<string, unknown>): string[] | undefined {
  const locs = arrayOf(res.locations)
  if (!locs) return undefined
  const out: string[] = []
  for (const l of locs) {
    const lo = l as Record<string, unknown>
    const phys = lo?.physicalLocation as Record<string, unknown> | undefined
    const art = phys?.artifactLocation as Record<string, unknown> | undefined
    const uri = art && typeof art.uri === "string" ? art.uri : undefined
    const region = phys?.region as Record<string, unknown> | undefined
    const line = region && typeof region.startLine === "number" ? region.startLine : undefined
    if (uri) out.push(line ? `${uri}:${line}` : uri)
  }
  return out.length > 0 ? out : undefined
}
