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
import { bakeTrustPage, ConfigParseError, type BakedTrustPage } from "./bakeTrustPage.js"
import { fixtureCohort } from "./cohort.js"
import { renderHtml, renderSidecar } from "./renderPage.js"

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

/**
 * Bake the whole fixtures cohort into the exact set of files to commit. Pure: given
 * the same fixtures + engine, it returns byte-identical output every time — which is
 * what makes the committed tree a reproducibility gate.
 */
export function emitFixtureCohort(): EmittedCohort {
  const files: EmittedFile[] = []
  const index: IndexEntry[] = []
  let baked = 0
  let incomplete = 0

  for (const entry of fixtureCohort()) {
    try {
      const page = bakeTrustPage(entry.input)
      const base = pageBase(page)
      files.push({ path: `${base}.json`, content: renderSidecar(page) })
      files.push({ path: `${base}.html`, content: renderHtml(page) })
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
        // Completeness (ADR 0038): a malformed entry is recorded as incomplete,
        // never silently dropped and never baked into a page that reads as SAFE.
        index.push({
          canonicalName: entry.input.canonicalName,
          status: "incomplete",
          artifactDigest: null,
          pageDigest: null,
          verdict: null,
          observedAt: entry.input.observedAt,
          reason: "config did not parse — recorded as incomplete, no page baked",
        })
        incomplete++
      } else {
        throw err
      }
    }
  }

  // Deterministic index: entries already come from the sorted cohort, but sort
  // again by canonicalName so the index is stable regardless of cohort ordering.
  index.sort((a, b) => (a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0))
  const indexDoc = {
    schema: "calllint.trust-index.v0",
    cohort: "fixtures",
    baked,
    incomplete,
    entries: index,
  }
  files.push({ path: `index.json`, content: JSON.stringify(indexDoc, null, 2) + "\n" })

  // Sort files by path so the emitted set is order-stable.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, baked, incomplete }
}
