/**
 * Emit the baked fixtures cohort to disk as committed artifacts (ADR 0046 §2/§3).
 *
 * The ingestion plane bakes pages and *commits* them; serving only reads committed
 * files. This module is the "write" half: it bakes every cohort entry and returns
 * the exact set of relative paths + byte contents to write, plus a stable index.
 * The actual filesystem write is done by the bin script (`bake.ts`) and by the
 * regeneration check in CI — keeping this function pure (no I/O) so it is testable
 * and the byte output is diffable.
 *
 * Parse-error fixtures are recorded in the index as `incomplete` (never silently
 * dropped — ADR 0038 completeness) and produce no page.
 */
import { bakeTrustPage, ConfigParseError, type BakeInput, type BakedTrustPage } from "./bakeTrustPage.js"
import { fixtureCohort } from "./cohort.js"
import { registryCohort } from "./registryCohort.js"
import type { RegistrySnapshot } from "./snapshot.js"
import { evidenceMap, type EvidenceSnapshot } from "./evidenceSnapshot.js"
import {
  evaluatePublishEligibility,
  explainUnknown,
  type EvidenceBundle,
} from "@calllint/evidence"
import { renderHtml, renderSidecar } from "./renderPage.js"
import { buildEvidenceManifest } from "./evidenceManifest.js"
import { verifiedPublisherFor, EMPTY_CLAIM_STORE, type ClaimStore } from "./claim.js"

/**
 * A candidate resource proposed for the PUBLIC Trust Index beyond the ADR-locked seed
 * cohorts (fixtures + the committed registry seed). Scale-out (37 → 100+) flows through
 * here: each candidate must clear the §4.7 publish-eligibility gate before it is baked.
 * An ineligible candidate is recorded `incomplete` with its failing criteria — never
 * silently dropped (ADR 0038 §5), and never published unidentifiable (§4.7).
 */
export interface ExpansionCandidate {
  /** The bakeable input (canonical name, config text, source label, observed-at). */
  input: BakeInput
  /** The resolved evidence bundle the §4.7 gate is evaluated over. */
  bundle: EvidenceBundle
  /** Whether a deterministic verdict is bound to this bundle (the caller asserts it). */
  verdictBound: boolean
}

/** One file to write: a repo-relative path and its exact byte content. */
export interface EmittedFile {
  path: string
  content: string
}

/** The result of baking the whole cohort: files to write + an index sidecar. */
export interface EmittedCohort {
  files: EmittedFile[]
  /** Count of pages baked and entries marked incomplete (for the index + logging). */
  baked: number
  incomplete: number
}

/** Index entry per resource — the `{ns}/{name}` → digest map (ADR 0046 §6). */
interface IndexEntry {
  canonicalName: string
  status: "baked" | "incomplete"
  artifactDigest: string | null
  pageDigest: string | null
  verdict: string | null
  observedAt: string
  reason?: string
}

/**
 * The public URL prefix these pages are *served* under (ADR 0046 §5,
 * `calllint.com/trust/…`). This is the serving path, distinct from the on-disk
 * emit layout below — the emit paths are relative to the committed output root, so
 * they carry no redundant prefix.
 */
export const SERVE_PREFIX = "trust"

function pageBase(page: BakedTrustPage): string {
  // Relative to the committed output root, e.g. calllint-fixtures/safe-time
  return page.canonicalName
}

/** One cohort item to bake: a bakeable input, or a pre-known incomplete marker. */
interface CohortItem {
  canonicalName: string
  input: BakeInput | null
  incompleteReason?: string
}

/**
 * Bake a list of cohort items into `files` + `index`, in place. Shared by every
 * cohort so fixtures and registry entries are emitted identically. A null input is
 * an already-known incomplete (nothing to scan); a `ConfigParseError` during bake is
 * a malformed config — both are recorded `incomplete`, never silently dropped (ADR
 * 0038 §5). Returns the baked/incomplete counts to accumulate.
 */
function bakeItems(
  items: CohortItem[],
  files: EmittedFile[],
  index: IndexEntry[],
  claims: ClaimStore,
  evidence: ReadonlyMap<string, EvidenceBundle>,
): {
  baked: number
  incomplete: number
} {
  let baked = 0
  let incomplete = 0
  const markIncomplete = (name: string, observedAt: string, reason: string) => {
    index.push({
      canonicalName: name,
      status: "incomplete",
      artifactDigest: null,
      pageDigest: null,
      verdict: null,
      observedAt,
      reason,
    })
    incomplete++
  }

  for (const item of items) {
    if (item.input === null) {
      markIncomplete(item.canonicalName, "", item.incompleteReason ?? "no bakeable input")
      continue
    }
    try {
      const page = bakeTrustPage({ ...item.input, evidence })
      const base = pageBase(page)
      // Namespace-level claim overlay (fails closed; undefined ⇒ dropped by
      // JSON.stringify ⇒ byte-identical unclaimed page). NOT part of pageDigest.
      const publisher = verifiedPublisherFor(claims, page.canonicalName)
      files.push({ path: `${base}.json`, content: renderSidecar(page, publisher) })
      files.push({ path: `${base}.html`, content: renderHtml(page, publisher) })
      // The Evidence Manifest sibling (PR-D4): a portable, signed-capable projection of
      // this page onto the ADR 0034 discipline. Committed body carries `signature: null`
      // (deterministic ⇒ reproducibility gate holds). `authorityClaimed` mirrors the same
      // (revocable) claim overlay as the sidecar, so it never touches the page digest.
      const manifest = buildEvidenceManifest(page, { authorityClaimed: publisher !== undefined })
      files.push({ path: `${base}.manifest.json`, content: JSON.stringify(manifest, null, 2) + "\n" })
      index.push({
        canonicalName: page.canonicalName,
        status: "baked",
        artifactDigest: page.artifactDigest,
        pageDigest: page.pageDigest,
        verdict: page.verdict,
        observedAt: page.observedAt,
      })
      baked++
    } catch (err) {
      if (err instanceof ConfigParseError) {
        markIncomplete(
          item.canonicalName,
          item.input.observedAt,
          "config did not parse — recorded as incomplete, no page baked",
        )
      } else {
        throw err
      }
    }
  }
  return { baked, incomplete }
}

/**
 * Bake every cohort into the exact set of files to commit. Pure: given the same
 * cohorts + engine, it returns byte-identical output every time — which is what
 * makes the committed tree a reproducibility gate. The fixtures cohort is always
 * baked; the Official MCP Registry cohort is baked when a committed snapshot is
 * supplied (null ⇒ fixtures only, e.g. before any snapshot exists).
 *
 * `claims` is the committed maintainer-claim store (ADR 0048 §2). It defaults to the
 * EMPTY store, so a caller that passes nothing (or the committed empty store) bakes
 * byte-identical pages — the flag only ever appears once a real, verified record is
 * committed. The claim overlay never affects the index or a page digest.
 */
/**
 * Turn expansion candidates into cohort items, applying the §4.7 publish-eligibility
 * gate. Eligible ⇒ a bakeable item (its evidence bundle is attached so R3 refinement
 * applies). Ineligible ⇒ a pre-marked incomplete whose reason names the failing
 * criteria plus the human-readable UNKNOWN cause, so a maintainer sees exactly why the
 * page was withheld. Pure; no I/O.
 */
function expansionItems(candidates: readonly ExpansionCandidate[]): CohortItem[] {
  return candidates.map((c): CohortItem => {
    const report = evaluatePublishEligibility(c.bundle, { verdictBound: c.verdictBound })
    if (report.eligible) {
      return {
        canonicalName: c.input.canonicalName,
        input: { ...c.input, evidence: new Map([[c.bundle.subject.id, c.bundle]]) },
      }
    }
    const cause = explainUnknown(c.bundle)
    return {
      canonicalName: c.input.canonicalName,
      input: null,
      incompleteReason: `not publish-eligible (§4.7): unmet ${report.blockers.join(", ")} — ${cause.summary}`,
    }
  })
}

export function emitAllCohorts(
  snapshot: RegistrySnapshot | null = null,
  claims: ClaimStore = EMPTY_CLAIM_STORE,
  evidence: EvidenceSnapshot | null = null,
  expansion: readonly ExpansionCandidate[] = [],
): EmittedCohort {
  const files: EmittedFile[] = []
  const index: IndexEntry[] = []

  // Fixtures never carry remote evidence (they are local goldens) — pass the empty
  // map so the fixtures cohort is byte-identical regardless of any evidence snapshot.
  const fixtures = bakeItems(
    fixtureCohort().map((e) => ({ canonicalName: e.input.canonicalName, input: e.input })),
    files,
    index,
    claims,
    new Map(),
  )
  // The registry cohort is the only one refined by evidence (ADR 0050).
  const evidenceBundles = evidenceMap(evidence)
  const registry = snapshot
    ? bakeItems(registryCohort(snapshot), files, index, claims, evidenceBundles)
    : { baked: 0, incomplete: 0 }

  // Expansion cohort (scale-out): each candidate must clear the §4.7 gate. Empty by
  // default, so with no candidates the emitted set is byte-identical to the seed —
  // preserving the reproducibility gate (ADR 0046 §4). Each candidate carries its own
  // evidence bundle, so refinement is per-item (not the shared registry map).
  const expanded = expansion.length
    ? bakeItems(expansionItems(expansion), files, index, claims, new Map())
    : { baked: 0, incomplete: 0 }

  const baked = fixtures.baked + registry.baked + expanded.baked
  const incomplete = fixtures.incomplete + registry.incomplete + expanded.incomplete

  // Deterministic index: sort by canonicalName so it is stable regardless of the
  // order the cohorts were baked in.
  index.sort((a, b) => (a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0))
  // Cohort labels. The seed order is preserved exactly (so a no-expansion emit is
  // byte-identical); "expansion" is appended only when candidates were supplied.
  const cohorts = [
    "fixtures",
    ...(snapshot ? ["mcp-registry"] : []),
    ...(expansion.length ? ["expansion"] : []),
  ]
  const indexDoc = {
    schema: "calllint.trust-index.v0",
    cohorts,
    baked,
    incomplete,
    entries: index,
  }
  files.push({ path: `index.json`, content: JSON.stringify(indexDoc, null, 2) + "\n" })

  // Sort files by path so the emitted set is order-stable.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, baked, incomplete }
}
