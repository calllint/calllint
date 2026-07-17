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
import { renderHtml, renderSidecar } from "./renderPage.js"
import { verifiedPublisherFor, EMPTY_CLAIM_STORE, type ClaimStore } from "./claim.js"

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
      const page = bakeTrustPage(item.input)
      const base = pageBase(page)
      // Namespace-level claim overlay (fails closed; undefined ⇒ dropped by
      // JSON.stringify ⇒ byte-identical unclaimed page). NOT part of pageDigest.
      const publisher = verifiedPublisherFor(claims, page.canonicalName)
      files.push({ path: `${base}.json`, content: renderSidecar(page, publisher) })
      files.push({ path: `${base}.html`, content: renderHtml(page, publisher) })
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
export function emitAllCohorts(
  snapshot: RegistrySnapshot | null = null,
  claims: ClaimStore = EMPTY_CLAIM_STORE,
): EmittedCohort {
  const files: EmittedFile[] = []
  const index: IndexEntry[] = []

  const fixtures = bakeItems(
    fixtureCohort().map((e) => ({ canonicalName: e.input.canonicalName, input: e.input })),
    files,
    index,
    claims,
  )
  const registry = snapshot
    ? bakeItems(registryCohort(snapshot), files, index, claims)
    : { baked: 0, incomplete: 0 }

  const baked = fixtures.baked + registry.baked
  const incomplete = fixtures.incomplete + registry.incomplete

  // Deterministic index: sort by canonicalName so it is stable regardless of the
  // order the cohorts were baked in.
  index.sort((a, b) => (a.canonicalName < b.canonicalName ? -1 : a.canonicalName > b.canonicalName ? 1 : 0))
  const indexDoc = {
    schema: "calllint.trust-index.v0",
    cohorts: snapshot ? ["fixtures", "mcp-registry"] : ["fixtures"],
    baked,
    incomplete,
    entries: index,
  }
  files.push({ path: `index.json`, content: JSON.stringify(indexDoc, null, 2) + "\n" })

  // Sort files by path so the emitted set is order-stable.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, baked, incomplete }
}
