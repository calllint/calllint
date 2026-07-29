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
import { registryCohort, registryNameFromSourceLabel } from "./registryCohort.js"
import type { RegistrySnapshot } from "./snapshot.js"
import { evidenceMap, type EvidenceSnapshot } from "./evidenceSnapshot.js"
import {
  evaluatePublishEligibility,
  explainUnknown,
  type EvidenceBundle,
} from "@calllint/evidence"
import { renderHtml, renderSidecar, renderSitemap, LOOKUP_PAGE_PATH } from "./renderPage.js"
import { renderAppCreatedPage } from "./renderAppCreated.js"
import { renderLookupIndex, renderLookupPage, type LookupSourceEntry } from "./renderLookup.js"
import { buildEvidenceManifest } from "./evidenceManifest.js"
import { verifiedPublisherForNamespace, EMPTY_CLAIM_STORE, type ClaimStore } from "./claim.js"
import { emitSafeInstall } from "./emitSafeInstall.js"
import { DEFAULT_PRESENTATION, type ResolvedPresentation } from "./safe-install/resolvePresentation.js"

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
  /** Files under the served TRUST root (`apps/web/public/trust/`). */
  files: EmittedFile[]
  /**
   * Files under the served SITE root (`apps/web/public/`), NOT under `/trust/`: the
   * Safe-install acquisition pages `install/{slug}/**` and the discovery manifest
   * `.well-known/calllint.json` (Phase 2.4 / ADR 0056). Kept as a distinct list because
   * they are rooted differently and are covered by their own reproducibility gate; the
   * bin writes them relative to `apps/web/public/`.
   */
  installFiles: EmittedFile[]
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
      // Publisher claim overlay — honors exact-resource AND namespace-inheritance claims
      // (D6). Keyed off the ORIGINAL reverse-DNS registry name (from sourceLabel), never
      // the lossy canonicalName slug; fixtures/expansion have no registry name → no
      // inheritance. Fails closed; undefined ⇒ dropped by JSON.stringify ⇒ byte-identical
      // unclaimed page. NOT part of pageDigest (a claim never alters a verdict, ADR 0053 §3).
      const publisher = verifiedPublisherForNamespace(claims, {
        canonicalName: page.canonicalName,
        registryName: registryNameFromSourceLabel(item.input.sourceLabel),
        artifactDigest: page.artifactDigest,
      })
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
  // The engine version stamped into the Safe-install contract bytes (INV-2.4-10). A
  // deterministic bake input, passed by the bin from the trust-index package.json. It
  // flows ONLY into `installFiles` (the contract JSON) — the trust tree (pages, index,
  // sitemap, lookup) is version-independent, so a caller that omits it still bakes a
  // byte-identical trust tree; only the install contract's `engineVersion` differs.
  engineVersion = "0.0.0",
  // The RESOLVED presentation copy (PR P-2), read at the bin's edge and handed inward as
  // a parameter (ADR 0058 §2). It flows ONLY into `installFiles`; the trust tree does not
  // consume presentation copy yet, so omitting it — as every pre-P-2 caller does — bakes
  // a byte-identical tree.
  presentation: ResolvedPresentation = DEFAULT_PRESENTATION,
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

  // A sitemap over the baked pages (discovery — Q5). Site chrome under `/trust/`, NOT
  // a resource. It lists only REAL, discoverable resources: pages that were actually
  // baked (status "baked") AND are not in the reserved `calllint-fixtures/` namespace.
  // Fixtures are synthetic reproducibility goldens (ADR 0046 §1) — never a resource a
  // maintainer would claim or that a search engine should surface as "the CallLint page
  // for X" — so advertising them for crawling would be noise. Incomplete entries (no
  // page to crawl) and the `noindex` landing page are likewise never listed. Note this
  // filter is discovery-only: `index.json` above STILL records every baked fixture
  // (completeness is the index's job; discovery is the sitemap's). `lastmod` is each
  // page's pinned observedAt, so it is deterministic and the committed-tree gate covers
  // it with no test edit. It carries no verdict, digest, or claim — emitting it never
  // affects a page digest or the index.
  // The exact set of REAL, discoverable baked resources (the same filter the sitemap and
  // the lookup index share, so the two surfaces can never disagree about what is public).
  const bakedReal = index.filter(
    (e) => e.status === "baked" && !e.canonicalName.startsWith("calllint-fixtures/"),
  )
  const bakedPages = bakedReal.map((e) => ({ canonicalName: e.canonicalName, observedAt: e.observedAt }))

  // Safe-install acquisition surface (Phase 2.4 / ADR 0056). Emitted from the SAME
  // committed inputs, so the exact membership set that produced the served Trust tree
  // drives the served /install/** pages, the discovery manifest, the sitemap install
  // links, and the lookup enrichment below — one decision, every surface (INV-2.4-01).
  // Files under this list are rooted at the SITE root (`/install/**`, `/.well-known/…`),
  // NOT under `/trust/`, so the bin writes them one level up from the trust tree. This
  // re-bakes the registry pages purely (deterministic) to project them; it never moves a
  // verdict or a page digest — the contract seals a digest OVER already-public facts.
  const safeInstall = emitSafeInstall(snapshot, evidence, engineVersion, presentation)
  const installFiles = safeInstall.files
  // canonicalName → its emitted acquisition route (slug + installability). Only resources
  // that actually got an install page appear here, so a lookup/sitemap link can never
  // point at a page that 404s (the acquisition set may be a SUBSET of bakedReal — e.g.
  // an expansion-cohort page has a Trust Page but no install page).
  const routeByName = new Map(safeInstall.resources.map((r) => [r.canonicalName, r]))
  // Sitemap install links: the HUMAN `/install/{slug}/` page for each emitted resource,
  // sorted inside renderSitemap. The machine contract sidecar is deliberately excluded.
  const installSlugs = safeInstall.resources.map((r) => r.canonicalSlug)

  // The sitemap lists every real resource page, the Safe-install pages, PLUS the standing
  // lookup utility page (ADR 0055 §5) as one deterministic chrome <loc>. `LOOKUP_PAGE_PATH`
  // is the single source of truth shared with the lookup page's own canonical link.
  files.push({ path: `sitemap.xml`, content: renderSitemap(bakedPages, [LOOKUP_PAGE_PATH], installSlugs) })

  // The client-facing lookup surface (ADR 0055 §5): a deterministic index + a human search
  // page so a maintainer/operator can FIND a Trust Page by name. Both are site chrome under
  // `/trust/`, NOT resources — deterministic, deliberately ABSENT from `index`, so
  // `index.json` and the completeness count stay byte-identical. `lookup-index.json` is a
  // pure projection of the SAME `bakedReal` set (real baked resources only), so it cannot
  // drift from `index.json`; it carries no score and no free-text (no LLM, no fuzzy). A
  // baked entry always has a non-null verdict + artifactDigest (only `incomplete` entries
  // are null, and those are filtered out above).
  // Each lookup entry is enriched with its Safe-install linkage IFF the resource has an
  // emitted install page (ADR 0056). The URLs are derived from the SAME canonical slug the
  // acquisition emit used (via `routeByName`), so the lookup surface can never advertise an
  // install URL that 404s; a resource with no install page carries the three fields as null.
  const lookupEntries: LookupSourceEntry[] = bakedReal.map((e) => {
    const route = routeByName.get(e.canonicalName)
    return {
      canonicalName: e.canonicalName,
      verdict: e.verdict as LookupSourceEntry["verdict"],
      artifactDigest: e.artifactDigest as string,
      observedAt: e.observedAt,
      installUrl: route ? `/install/${route.canonicalSlug}/` : null,
      contractUrl: route ? `/install/${route.canonicalSlug}/index.json` : null,
      installability: route ? route.installability : null,
    }
  })
  files.push({ path: `lookup-index.json`, content: renderLookupIndex(lookupEntries) })
  files.push({ path: `lookup.html`, content: renderLookupPage() })

  // The post-install claim-funnel landing page (ADR 0047/0048). Site chrome under
  // `/trust/`, NOT a resource: emitted unconditionally, deterministic, and deliberately
  // absent from `index`, so `index.json` and the completeness count stay byte-identical.
  // It is the target of the GitHub App's `redirect_url`; without it the claim funnel
  // dead-ends on a 404.
  files.push({ path: `app-created.html`, content: renderAppCreatedPage() })

  // Sort both file sets by path so each emitted set is order-stable (installFiles is
  // already sorted inside emitSafeInstall; re-sorting is cheap and keeps the contract local).
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  installFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, installFiles, baked, incomplete }
}
