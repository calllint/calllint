/**
 * Gate A / PR-D1 — Coverage & Precision Audit (new12 §6 spine; ADR 0053).
 *
 * This is a PROJECTION over the shipped 100-object benchmark (corpus.ts +
 * benchmark.test.ts), NOT a new harness. It runs the SAME corpus through the SAME
 * real P1_RESOLVERS with recorded fetch maps (no network) and rolls the outcome up
 * into a structured, deterministic audit report:
 *   - per-object measures (identity / repo / completeness / false-SAFE / UNKNOWN cause)
 *   - per-category + per-subject-type rollups
 *   - the aggregate §P1 rates over the resolvable, non-conflict, non-malicious sample
 *   - an HONEST coverage matrix: which subject types the resolvers cover, and which
 *     registry/transport classes (PyPI / OCI / MCPB / direct-stdio) are NOT yet
 *     covered — stated, never faked (this IS the "UNKNOWN honesty" the spec asks for).
 *
 * It computes NOTHING new: verdicts, cleanliness, and UNKNOWN causes come verbatim
 * from @calllint/evidence. The benchmark gate consumes `runCoverageAudit()` too, so
 * the gate and the report can never diverge (one source of truth). Output is an
 * audit report — never a public Trust Page (ADR 0053 §6: offline, no scale-up).
 */
import {
  isCleanlyResolved,
  explainUnknown,
  mergeResults,
  type EvidenceBundle,
  type UnknownCause,
} from "@calllint/evidence"
import { P1_RESOLVERS } from "../../src/evidence/index.js"
import type { ResolverContext } from "../../src/evidence/resolverInterface.js"
import { buildCorpus, type CorpusObject } from "./corpus.js"

/** The §P1 acceptance thresholds — mirrored from benchmark.test.ts, never weakened. */
export const AUDIT_THRESHOLDS = {
  identity: 0.9,
  repo: 0.8,
  completeness: 0.7,
  falseSafe: 0,
} as const

/** The subject-type identity anchors (same set the benchmark asserts). */
const ANCHORS = ["identity.name", "repo.url", "domain.owner", "endpoint.url", "tool.count"]

/** Pinned resolvedAt so the audit is byte-reproducible across runs and hosts. */
const RESOLVED_AT = "2026-07-20T00:00:00.000Z"

/** Build a ResolverContext from an object's recorded fetch maps (no network). */
function ctxFor(obj: CorpusObject): ResolverContext {
  return {
    fetchJson: async (url: string) => {
      if (url in obj.json) return obj.json[url]
      throw new Error(`no recorded json for ${url}`)
    },
    fetchText: async (url: string) => (url in obj.text ? obj.text[url] : undefined),
    resolvedAt: RESOLVED_AT,
  }
}

/** Resolve one corpus object; conflict objects go straight through mergeResults. */
async function resolveObj(obj: CorpusObject): Promise<EvidenceBundle> {
  if (obj.conflict) return mergeResults(obj.subject, obj.conflict)
  const { resolveSubject } = await import("../../src/evidence/resolveSubject.js")
  return resolveSubject(obj.subject, P1_RESOLVERS, ctxFor(obj))
}

/** One object's measured outcome — every field is read verbatim from evidence. */
export interface ObjectMeasure {
  id: string
  category: string
  subjectType: string
  resolvable: boolean
  malicious: boolean
  conflict: boolean
  /** identity anchor resolved for this subject type. */
  identityResolved: boolean
  /** a repo.url was resolved (only meaningful when repoExpected). */
  repoExpected: boolean
  repoResolved: boolean
  /** cleanly resolved = COMPLETE evidence (publishable). */
  clean: boolean
  /** false-SAFE: resolved clean when it should NOT have (must be 0 across the set). */
  falseSafe: boolean
  /** the honest cause when not clean (never "clean" unless clean). */
  unknownCause: UnknownCause
}

/** A per-group rollup (used for both category and subject-type groupings). */
export interface GroupRollup {
  key: string
  total: number
  clean: number
  resolvable: number
  malicious: number
  conflict: number
}

/** Aggregate §P1 rates over the resolvable, non-conflict, non-malicious sample. */
export interface AuditRates {
  sampleSize: number
  identityRate: number
  repoRate: number
  repoDenominator: number
  completenessRate: number
  falseSafeCount: number
}

/** One row of the honest coverage matrix. */
export interface CoverageRow {
  /** e.g. "npm-package", "domain", or an uncovered class like "pypi-package". */
  klass: string
  /** does a shipped P1 resolver cover this class end-to-end? */
  covered: boolean
  /** how many corpus objects exercise it (0 for stated-but-uncovered classes). */
  objectCount: number
  /** honest one-line note (why covered / why not yet). */
  note: string
}

/** The full audit report — deterministic, byte-reproducible, offline. */
export interface CoverageAuditReport {
  schema: "calllint.coverage-audit.v1"
  /** total objects in the benchmark corpus (100). */
  objectCount: number
  rates: AuditRates
  thresholds: typeof AUDIT_THRESHOLDS
  /** every threshold met on this pass (the Gate-A pass condition). */
  pass: boolean
  bySubjectType: GroupRollup[]
  byCategory: GroupRollup[]
  coverageMatrix: CoverageRow[]
  /** stated-but-not-yet-covered classes, extracted from the matrix for emphasis. */
  uncoveredClasses: string[]
  /** determinism: a second identical pass produced byte-identical measures. */
  deterministic: boolean
}

/** Measure one object against its resolved bundle — verbatim, no re-judging. */
function measure(obj: CorpusObject, b: EvidenceBundle): ObjectMeasure {
  const clean = isCleanlyResolved(b)
  return {
    id: obj.id,
    category: obj.category,
    subjectType: obj.subject.subjectType,
    resolvable: obj.resolvable,
    malicious: obj.malicious ?? false,
    conflict: obj.conflict !== undefined,
    identityResolved: b.items.some((i) => ANCHORS.includes(i.field)),
    repoExpected: obj.repoExpected,
    repoResolved: b.items.some((i) => i.field === "repo.url"),
    clean,
    falseSafe: clean && !obj.expectClean,
    unknownCause: explainUnknown(b).cause,
  }
}

/** Group measures by a key selector into sorted, deterministic rollups. */
function rollup(measures: ObjectMeasure[], keyOf: (m: ObjectMeasure) => string): GroupRollup[] {
  const groups = new Map<string, GroupRollup>()
  for (const m of measures) {
    const key = keyOf(m)
    const g =
      groups.get(key) ??
      { key, total: 0, clean: 0, resolvable: 0, malicious: 0, conflict: 0 }
    g.total++
    if (m.clean) g.clean++
    if (m.resolvable) g.resolvable++
    if (m.malicious) g.malicious++
    if (m.conflict) g.conflict++
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The honest coverage matrix. Six subject types are covered by shipped resolvers;
 * PyPI / OCI / MCPB / direct-stdio are stated as NOT-YET-COVERED rather than faked.
 * `objectCount` is filled from the live measures so a covered row can never claim
 * coverage the corpus does not actually exercise.
 */
function coverageMatrix(bySubjectType: GroupRollup[]): CoverageRow[] {
  const count = (k: string) => bySubjectType.find((g) => g.key === k)?.total ?? 0
  const covered: CoverageRow[] = [
    { klass: "npm-package", covered: true, objectCount: count("npm-package"), note: "npmResolver: registry doc → identity/version/provenance/repo." },
    { klass: "github-repo", covered: true, objectCount: count("github-repo"), note: "githubResolver: repo metadata → repo.url anchor." },
    { klass: "mcp-registry-entry", covered: true, objectCount: count("mcp-registry-entry"), note: "registryResolver: Official Registry entry → identity + repo." },
    { klass: "domain", covered: true, objectCount: count("domain"), note: "domainResolver: .well-known/mcp-publisher.json → owner." },
    { klass: "remote-endpoint", covered: true, objectCount: count("remote-endpoint"), note: "remoteResolver: .well-known/mcp.json → endpoint owner/auth." },
    { klass: "tool", covered: true, objectCount: count("tool"), note: "toolResolver: static tool manifest → declared surface (no exec)." },
  ]
  const uncovered: CoverageRow[] = [
    { klass: "pypi-package", covered: false, objectCount: 0, note: "NOT YET COVERED — no PyPI resolver; such subjects resolve UNKNOWN (honest), never SAFE." },
    { klass: "oci-image", covered: false, objectCount: 0, note: "NOT YET COVERED — no OCI/registry-digest resolver; UNKNOWN until built." },
    { klass: "mcpb-bundle", covered: false, objectCount: 0, note: "NOT YET COVERED — no MCPB bundle resolver; UNKNOWN until built." },
    { klass: "direct-stdio", covered: false, objectCount: 0, note: "NOT YET COVERED as a distinct identity — stdio launch is scanned via config authority, not identity-resolved here." },
  ]
  return [...covered, ...uncovered]
}

/** Compute the aggregate §P1 rates over the resolvable, non-conflict, non-malicious sample. */
function computeRates(measures: ObjectMeasure[]): AuditRates {
  const sample = measures.filter((m) => m.resolvable && !m.conflict && !m.malicious)
  const idOk = sample.filter((m) => m.identityResolved)
  const repoRows = sample.filter((m) => m.repoExpected)
  const repoOk = repoRows.filter((m) => m.repoResolved)
  const complete = sample.filter((m) => m.clean)
  return {
    sampleSize: sample.length,
    identityRate: idOk.length / sample.length,
    repoRate: repoOk.length / repoRows.length,
    repoDenominator: repoRows.length,
    completenessRate: complete.length / sample.length,
    // false-SAFE is counted across the WHOLE set, not just the sample.
    falseSafeCount: measures.filter((m) => m.falseSafe).length,
  }
}

/**
 * Run the coverage & precision audit. Resolves the fixed corpus twice (once for the
 * report, once to prove determinism) and returns the structured report. PURE w.r.t.
 * the network — every fetch is served from recorded maps. Deterministic given the
 * fixed corpus + pinned RESOLVED_AT.
 */
export async function runCoverageAudit(): Promise<CoverageAuditReport> {
  const corpus = buildCorpus()
  const bundlesA = await Promise.all(corpus.map(resolveObj))
  const bundlesB = await Promise.all(corpus.map(resolveObj))
  const deterministic = JSON.stringify(bundlesA) === JSON.stringify(bundlesB)

  const measures = corpus.map((o, i) => measure(o, bundlesA[i]!))
  const rates = computeRates(measures)
  const bySubjectType = rollup(measures, (m) => m.subjectType)
  const byCategory = rollup(measures, (m) => m.category)
  const matrix = coverageMatrix(bySubjectType)

  const pass =
    rates.identityRate >= AUDIT_THRESHOLDS.identity &&
    rates.repoRate >= AUDIT_THRESHOLDS.repo &&
    rates.completenessRate >= AUDIT_THRESHOLDS.completeness &&
    rates.falseSafeCount === AUDIT_THRESHOLDS.falseSafe &&
    deterministic

  return {
    schema: "calllint.coverage-audit.v1",
    objectCount: corpus.length,
    rates,
    thresholds: AUDIT_THRESHOLDS,
    pass,
    bySubjectType,
    byCategory,
    coverageMatrix: matrix,
    uncoveredClasses: matrix.filter((r) => !r.covered).map((r) => r.klass),
    deterministic,
  }
}
