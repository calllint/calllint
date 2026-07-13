/**
 * importEvidence — parse a third-party scanner report into a normalized
 * EvidenceEnvelope. Enforces the ADR 0034 invariants:
 *   1. no re-score / no rename (provider findings kept verbatim)
 *   3. fail closed (malformed → completeness:"failed", never a pass)
 *   4. never silently ignore (absent/empty → degraded, surfaced)
 *   5. pin version (missing provider version ⇒ "unknown" + degraded)
 * (Invariant 2 "no upgrade" is enforced at the consumer/verdict boundary, not here.)
 */
import { sha256, stableStringify } from "@calllint/fingerprint"
import type {
  Completeness,
  EvidenceEnvelope,
  EvidenceFinding,
  ScanMode,
} from "./types.js"
import { EVIDENCE_SCHEMA_VERSION } from "./types.js"
import { parseSkillSpectorJson, parseSkillSpectorSarif } from "./providers/skillspector.js"

export type EvidenceFormat = "json" | "sarif"

export interface ImportOptions {
  provider?: string
  format?: EvidenceFormat
}

/** Intermediate shape an adapter returns before the envelope is finalized. */
export interface AdapterResult {
  provider: string
  providerVersion?: string
  scanMode?: ScanMode
  coverage?: string[]
  findings: EvidenceFinding[]
  artifactDigest?: `sha256:${string}`
  startedAt?: string
  finishedAt?: string
  /** Reasons the adapter already knows the scan is not fully trustworthy. */
  degradedReasons?: string[]
  /**
   * Explicit completeness when the provider itself reports one (e.g. SkillSpector
   * status:"partial"). Omit to let finalizeEnvelope derive it from degradedReasons.
   * The importer only ever makes completeness STRICTER, never looser than this hint.
   */
  completenessHint?: Completeness
}

const ZERO_DIGEST = `sha256:${"0".repeat(64)}` as const

/** Detect the provider from the parsed report when not explicitly given. */
function detectProvider(raw: unknown, explicit?: string): string {
  if (explicit) return explicit
  const r = raw as Record<string, unknown> | null
  if (!r) return "unknown"

  // SkillSpector JSON carries a top-level "scanner"/"tool.name".
  const topTool = r.tool as Record<string, unknown> | undefined
  const jsonName =
    (typeof r.scanner === "string" && r.scanner) ||
    (topTool && typeof topTool.name === "string" && topTool.name) ||
    ""

  // SARIF carries the tool name at runs[].tool.driver.name.
  let sarifName = ""
  const runs = r.runs
  if (Array.isArray(runs) && runs.length > 0) {
    const run = runs[0] as Record<string, unknown>
    const tool = run?.tool as Record<string, unknown> | undefined
    const driver = tool?.driver as Record<string, unknown> | undefined
    if (driver && typeof driver.name === "string") sarifName = driver.name
  }

  if (/skillspector/i.test(String(jsonName)) || /skillspector/i.test(sarifName)) {
    return "skillspector"
  }
  return "unknown"
}

/**
 * Build a normalized envelope from raw external report text.
 * NEVER throws on bad input: a parse failure yields a fail-closed envelope
 * (completeness "failed") so callers cannot mistake an error for a pass.
 */
export function importEvidence(rawText: string, opts: ImportOptions = {}): EvidenceEnvelope {
  const format: EvidenceFormat = opts.format ?? (looksLikeSarif(rawText) ? "sarif" : "json")

  // rawReportDigest is computed over the raw text as received, before any parse,
  // so provenance is preserved even when parsing later fails.
  const rawReportDigest = sha256(rawText) as `sha256:${string}`

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return failClosed(opts.provider ?? "unknown", rawReportDigest, [
      `report is not valid JSON (format=${format})`,
    ])
  }

  const provider = detectProvider(parsed, opts.provider)

  let result: AdapterResult
  try {
    if (provider === "skillspector") {
      result = format === "sarif" ? parseSkillSpectorSarif(parsed) : parseSkillSpectorJson(parsed)
    } else {
      // Unknown provider: we can still preserve the raw digest and fail closed,
      // rather than silently pretending we understood it.
      return failClosed(provider, rawReportDigest, [
        `no adapter for provider "${provider}"; evidence not interpreted`,
      ])
    }
  } catch (err) {
    return failClosed(provider, rawReportDigest, [
      `adapter error: ${(err as Error).message}`,
    ])
  }

  return finalizeEnvelope(result, rawReportDigest)
}

/** A fail-closed envelope: emitted (never dropped) but never reads as a pass. */
function failClosed(
  provider: string,
  rawReportDigest: `sha256:${string}`,
  reasons: string[]
): EvidenceEnvelope {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    provider: provider || "unknown",
    providerVersion: "unknown",
    artifactDigest: ZERO_DIGEST,
    scanMode: "static",
    coverage: [],
    completeness: "failed",
    findings: [],
    rawReportDigest,
    degradedReasons: reasons,
  }
}

/** Apply the version-pinning + completeness invariants to an adapter result. */
function finalizeEnvelope(
  r: AdapterResult,
  rawReportDigest: `sha256:${string}`
): EvidenceEnvelope {
  const degradedReasons = [...(r.degradedReasons ?? [])]

  // The adapter's own classification is authoritative for what IT saw. Reasons the
  // adapter already reported are explained by its completenessHint, so they must not
  // independently force "degraded". Only gaps discovered HERE in finalize (i.e. an
  // unpinned provider version) can push completeness stricter than the adapter said.
  const rank: Record<Completeness, number> = { complete: 0, partial: 1, degraded: 2, failed: 3 }
  const rankToCompleteness: Completeness[] = ["complete", "partial", "degraded", "failed"]

  // Baseline: the adapter's hint, or (absent a hint) derive from adapter reasons.
  let level = rank[r.completenessHint ?? (degradedReasons.length > 0 ? "degraded" : "complete")]

  let providerVersion = r.providerVersion?.trim() || ""
  if (!providerVersion) {
    providerVersion = "unknown"
    degradedReasons.push("provider version not pinned (no release/commit reported)")
    // An unpinned version makes it at least "degraded" — never looser.
    level = Math.max(level, rank.degraded)
  }

  const completeness: Completeness = rankToCompleteness[level]!

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    provider: r.provider,
    providerVersion,
    artifactDigest: r.artifactDigest ?? ZERO_DIGEST,
    scanMode: r.scanMode ?? "static",
    coverage: r.coverage ?? [],
    completeness,
    findings: r.findings,
    rawReportDigest,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    degradedReasons,
  }
}

/** Cheap heuristic: SARIF documents carry a top-level "$schema"/"version"+"runs". */
function looksLikeSarif(text: string): boolean {
  return /"runs"\s*:/.test(text) && /sarif/i.test(text)
}

/** Re-export the stable-stringify digest helper for callers hashing artifacts. */
export function digestArtifact(value: unknown): `sha256:${string}` {
  return sha256(stableStringify(value)) as `sha256:${string}`
}
