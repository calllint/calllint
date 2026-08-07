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
import { fixtureCohort, FIXTURE_OBSERVED_AT } from "./cohort.js"
import { registryCohort, registryNameFromSourceLabel } from "./registryCohort.js"
import type { RegistrySnapshot } from "./snapshot.js"
import { evidenceMap, type EvidenceSnapshot } from "./evidenceSnapshot.js"
import { adoptionMap, type AdoptionIndexSnapshot } from "./adoptionIndexSnapshot.js"
import { computeFreshness, AGING_MULTIPLE, CADENCE_DAYS, type Freshness } from "./freshness.js"
import { computeResolution, RESOLUTION_AXES, UNMEASURED_AXES, type Resolution } from "./resolution.js"
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

/**
 * The identity block on an index entry — where the canonical adoption graph reaches a served
 * surface, and the ONLY place it does (ADR 0061 §7.1: every served surface is a projection of the
 * graph).
 *
 * EVERY FIELD IS ADDRESSING. There is no verdict here and there cannot be one: the projection's own
 * reader (`parseAdoptionIndex`) refuses a document carrying a decision field, so a verdict could not
 * reach this block even if something tried to put it here. ADR 0061 §4: the graph "has no opinion
 * about whether that subject is safe"; `computeVerdict` is the only verdict engine, every time.
 *
 * IT IS DELIBERATELY OUTSIDE `pageDigest`. That digest seals the PAGE
 * (`hashJson({canonicalName, verdict, preparation, scan, observedAt})`) and identity is not page
 * CONTENT; putting identity inside it would move all 19 digests plus 19 `.json`, 19 `.html` and 19
 * manifests, re-binding "is the wiring right" to "should the pages change" — the exact tangle R-7
 * split apart. The same reasoning the claim overlay already carries above (a claim never alters a
 * verdict, ADR 0053 §3). So identity lands on the index entry only.
 */
interface IndexEntryIdentity {
  /** The canonical subject's stable id — the identity layer's primary key. */
  subjectId: string
  /** R-3's `subjectIdentityDigest`: what the identity layer concluded. Copied, never recomputed. */
  identityDigest: string
  /** `PROVISIONAL` / `VERIFIED` / … — the identity layer's own status, never a safety verdict. */
  identityStatus: string
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
  /**
   * The canonical subject this served page addresses, when the adoption graph knows it.
   *
   * Present exactly when the committed adoption index carries this entry's `canonicalName`.
   * Absent — the KEY absent, not a key holding `undefined` — otherwise, so that with no committed
   * adoption index (or with a subject it does not know) the emitted bytes of every existing file
   * are byte-identical to today's — which is what makes an absent adoption index inert and keeps
   * this landable without re-baking the whole tree. `markIncomplete` never sets it, and no fixture
   * matches: local goldens were never registry subjects and have no canonical identity.
   */
  identity?: IndexEntryIdentity
  /**
   * How old this observation is, projected onto the display axis (S-2, gaps §1.4).
   *
   * OUTSIDE `pageDigest`, and that placement is forced rather than chosen: `observedAt` is sealed
   * INSIDE the digest, so a freshness field in the page body would make all 39 digests a function
   * of the wall clock and red the reproducibility gate on any day the bake re-ran. Same reasoning
   * as `identity` above and as the claim overlay below.
   *
   * Present exactly when a `now` was injected AND the entry is `baked`. `markIncomplete` never sets
   * it — an incomplete entry has no page, no digest and no verdict, so it has no observation to age,
   * and the null-input path passes an EMPTY `observedAt` that the calculator would (correctly) refuse.
   * Absent — the KEY absent, not a key holding `undefined` — with no `now`, so every existing caller
   * emits byte-identically.
   */
  freshness?: Freshness

  /**
   * The multi-axis §P4 resolution block (R-10). Same placement and the same forced reason as
   * `freshness` above — it is a function of the injected clock, so it cannot live in a page body
   * without making all 39 `pageDigest`s clock-dependent.
   *
   * Distinct from `freshness`, not a wider version of it. `freshness.state` ages ONE axis (this
   * page's own `observedAt`) and the browser recomputes exactly that; `resolution.status` is decided
   * by the OLDEST of every axis that can stale independently, so the two can legitimately disagree
   * — and when they do, `resolution` is the stricter one. Neither is ever a verdict input.
   */
  resolution?: Resolution

  /**
   * Days between the UPSTREAM release and the injected clock, when the registry declared a release
   * instant. Display only — explicitly NOT a resolution axis; see `RegistryEntryPlan.publishedAt`
   * for the measurement that rules it out. Registry cohort only.
   */
  upstreamAgeDays?: number
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
 * Assemble one entry's §P4 resolution from the axes available at this call site.
 *
 * The fixture anchor is passed as a FAILED axis (`at: null`) rather than as an observation. That is
 * the honest reading: `FIXTURE_OBSERVED_AT` is the epoch, a pinned reproducibility constant and not
 * a moment anyone observed anything. Subtracting it reports ~20 700 days (a false statement about
 * 20 of 39 entries), and excusing it as FRESH would be worse — so it lands in `blockingUnknowns`
 * and the status is `UNKNOWN`, which is exactly what product principle 2 requires of an
 * unverifiable observation. `computeFreshness` answers the same input with `TIMELESS`; the two
 * labels differ because the questions do.
 */
function resolutionFor(observedAt: string, evidenceResolvedAt: string | null, now: string): Resolution {
  return computeResolution({
    axes: [
      { axis: "source-observation", at: observedAt === FIXTURE_OBSERVED_AT ? null : observedAt },
      // Omitted, not nulled, when the cohort has no evidence pass: a cohort the pass never covered
      // has no such axis, whereas `at: null` would claim the axis exists and failed.
      ...(evidenceResolvedAt === null ? [] : [{ axis: "evidence-resolution" as const, at: evidenceResolvedAt }]),
    ],
    now,
  })
}

/** Whole days from an upstream release to the injected clock, floored at zero. Display only. */
function upstreamAge(publishedAt: string, now: string): number {
  const published = Date.parse(publishedAt)
  const nowMs = Date.parse(now)
  if (!Number.isFinite(published) || !Number.isFinite(nowMs)) {
    throw new Error(`emitCohort: unparseable publishedAt/now pair ${JSON.stringify([publishedAt, now])}`)
  }
  return Math.max(0, Math.floor((nowMs - published) / 86_400_000))
}

/** One cohort item to bake: a bakeable input, or a pre-known incomplete marker. */
interface CohortItem {
  canonicalName: string
  input: BakeInput | null
  incompleteReason?: string
  /**
   * Upstream release instant (R-10), supplied by `registryCohort` and by nothing else — a fixture
   * has no upstream and an expansion candidate's release date is not in the snapshot. Optional, so
   * both of those cohorts pass no such key and emit byte-identically.
   */
  publishedAt?: string | null
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
  /**
   * `canonicalSlug` → canonical identity, from the committed adoption index. Empty by default so
   * every existing caller (and the fixtures cohort, which is passed nothing) emits byte-identically.
   *
   * KEYED ON THE SLUG, NOT THE RAW REGISTRY NAME, and that was measured rather than assumed: the
   * store's `canonical_name` holds the reverse-DNS name (`ac.inference.sh/mcp`) while a served
   * index entry's `canonicalName` holds the ADDRESS (`mcp-registry/ac.inference.sh-mcp`). Against the
   * committed files: raw name matched 0/19, slug matched 19/19. `adoptionMap` builds the map on that
   * key.
   */
  adoption: ReadonlyMap<string, { subjectId: string; identityDigest: string; identityStatus: string }> = new Map(),
  /**
   * The INJECTED wall clock for the freshness projection (S-2). `null` ⇒ no `freshness` key on any
   * entry, so every pre-S-2 caller emits byte-identically.
   *
   * Passed to EVERY cohort, unlike `adoption` above which the registry cohort alone receives. That
   * asymmetry is deliberate on both sides: identity is a property only a registry subject can have,
   * while every observation has an age — including a fixture's, whose age is `TIMELESS` rather than
   * absent. Reporting the epoch anchor as ~20 700 days stale would be a false statement about 20 of
   * the 39 entries, which is the whole reason `computeFreshness` carries that state.
   */
  now: string | null = null,
  /**
   * When the committed evidence snapshot last resolved (R-10's second axis), or `null` for a cohort
   * the evidence pass does not cover.
   *
   * Registry cohort only, and structurally so — fixtures and expansion are already passed an empty
   * evidence map a few lines below, so handing them this timestamp would assert a resolution that
   * demonstrably did not happen for them. `null` here means the axis is ABSENT for the cohort, not
   * that it failed: a failed axis is `{ axis, at: null }` inside `computeResolution`, which is the
   * INV-R11 path that lands in `blockingUnknowns`.
   */
  evidenceResolvedAt: string | null = null,
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
      // Canonical identity for this resource, when the adoption graph resolved one. Spread-or-
      // nothing, so an unmatched entry carries no `identity` KEY at all rather than one holding
      // `undefined` — `JSON.stringify` drops both, but `Object.keys` reports the second, and the
      // wiring test reads keys as well as bytes.
      const identity = adoption.get(page.canonicalName)
      index.push({
        canonicalName: page.canonicalName,
        status: "baked",
        artifactDigest: page.artifactDigest,
        pageDigest: page.pageDigest,
        verdict: page.verdict,
        observedAt: page.observedAt,
        ...(identity === undefined
          ? {}
          : {
              identity: {
                subjectId: identity.subjectId,
                identityDigest: identity.identityDigest,
                identityStatus: identity.identityStatus,
              },
            }),
        // Freshness, same spread-or-nothing discipline. Computed from the page's OWN sealed
        // `observedAt` against the injected `now`, so it is a projection of committed bytes and a
        // clock — never a re-derivation of anything, and never a verdict input (ADR 0053 §5).
        ...(now === null ? {} : { freshness: computeFreshness({ observedAt: page.observedAt, now }) }),
        // The §P4 multi-axis block (R-10), same spread-or-nothing discipline again.
        //
        // `bakedAt` IS NOT AN AXIS, and that omission is the batch's load-bearing decision: the bake
        // re-runs on every push, so counting it would make every entry permanently FRESH and the
        // field would measure CI cadence instead of knowledge (§P4: 页面重新生成不能让旧 evidence
        // 变新 — INV-R11's first half).
        ...(now === null
          ? {}
          : { resolution: resolutionFor(page.observedAt, evidenceResolvedAt, now) }),
        // Upstream release age — display only, never a status axis (see `RegistryEntryPlan`).
        ...(now === null || item.publishedAt === undefined || item.publishedAt === null
          ? {}
          : { upstreamAgeDays: upstreamAge(item.publishedAt, now) }),
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
  // The committed IDENTITY projection of the canonical adoption graph (ADR 0061 §7.1, R-8), read at
  // the bin's edge by `loadAdoptionIndexIfPresent` and handed inward — never queried here, because
  // "nothing served ever queries the compiler" (ADR 0061 §5) and this function must stay pure for
  // the reproducibility gate to re-run it.
  //
  // UNLIKE PARAMETERS 5 AND 6 ABOVE, THIS ONE IS MEANT TO MOVE BYTES. Both of those flow only into
  // `installFiles` and their own test asserts they leave the trust tree byte-identical; this adds an
  // `identity` block to each matching `index.json` entry, so `null` vs. supplied is a REAL
  // difference — and a positive control asserts exactly that, since a 7th parameter that changed
  // nothing would be wiring in name only. What it must NOT move is any verdict, any `pageDigest`, or
  // any other file; that is the opposing half of the same test.
  adoption: AdoptionIndexSnapshot | null = null,
  // The INJECTED wall clock for the freshness projection (S-2, gaps §1.4). `null` ⇒ no `freshness`
  // key anywhere, so every pre-S-2 caller bakes a byte-identical tree — the same fail-inert shape
  // parameter 7 uses.
  //
  // LIKE PARAMETER 7, THIS IS MEANT TO MOVE BYTES, and only in `index.json`. It must not move a
  // `pageDigest`, a verdict, or any other file: `observedAt` is sealed inside the digest, so a
  // freshness field in the page body would make the served tree a function of the day it was baked.
  // Both halves are asserted — a positive control that the bytes DO move, and a zero-movement
  // assertion over every page, digest and verdict.
  now: string | null = null,
): EmittedCohort {
  const files: EmittedFile[] = []
  const index: IndexEntry[] = []
  // `canonicalSlug` → identity, built once for the whole emit. `adoptionMap(null)` is an empty map,
  // so an absent committed document leaves every byte exactly as it is today (fail-inert).
  const adoptionBySlug = adoptionMap(adoption)

  // Fixtures never carry remote evidence (they are local goldens) — pass the empty
  // map so the fixtures cohort is byte-identical regardless of any evidence snapshot.
  const fixtures = bakeItems(
    fixtureCohort().map((e) => ({ canonicalName: e.input.canonicalName, input: e.input })),
    files,
    index,
    claims,
    new Map(),
    // Fixtures carry no identity by construction (see below), but they DO carry an age — `TIMELESS`.
    new Map(),
    now,
  )
  // The registry cohort is the only one refined by evidence (ADR 0050), and the only one that can
  // carry canonical identity: a fixture is a local golden that was never a registry subject, so
  // passing the map here and NOWHERE ELSE makes that structural rather than a lookup that happens to
  // miss. "Fixtures carry no identity" is then a property of the call graph, not of a failed match.
  const evidenceBundles = evidenceMap(evidence)
  // The evidence-resolution axis reaches the registry cohort ALONE, for the same structural reason
  // `adoptionBySlug` does: the other two cohorts are handed an empty evidence map, so claiming a
  // resolution instant for them would assert a pass that never ran over them (R-10).
  const evidenceResolvedAt = evidence === null ? null : evidence.resolvedAt
  const registry = snapshot
    ? bakeItems(registryCohort(snapshot), files, index, claims, evidenceBundles, adoptionBySlug, now, evidenceResolvedAt)
    : { baked: 0, incomplete: 0 }

  // Expansion cohort (scale-out): each candidate must clear the §4.7 gate. Empty by
  // default, so with no candidates the emitted set is byte-identical to the seed —
  // preserving the reproducibility gate (ADR 0046 §4). Each candidate carries its own
  // evidence bundle, so refinement is per-item (not the shared registry map).
  const expanded = expansion.length
    ? bakeItems(expansionItems(expansion), files, index, claims, new Map(), new Map(), now)
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
    // The clock the per-entry `freshness` blocks below were computed against, RECORDED IN THE
    // OUTPUT so the bake stays a pure function of committed bytes (ADR 0046 §4).
    //
    // THIS FIELD IS WHAT MAKES THE REPRODUCIBILITY GATE STILL WORK. Freshness is f(observedAt, now),
    // so a bake that read the clock and did not record it would emit different bytes every day and
    // `committed-tree.test.ts` — which re-runs this very function and byte-compares 119 files on three
    // OSes — could never reproduce it. By recording `now` here, the gate reads this value back out of
    // the committed document and passes it in, exactly as it already reads `fetchedAt` out of the
    // committed snapshot. Same shape as `official-mcp-registry.json`'s `fetchedAt` and
    // `adoption-index.json`'s `projectedAt`: the timestamp is an input, and the artifact carries it.
    //
    // Omitted (the KEY absent) when no `now` was injected, so a pre-S-2 caller's bytes are unchanged.
    ...(now === null ? {} : { bakedAt: now }),
    // What the per-entry `resolution` blocks above could and could NOT measure (R-10, §P4).
    //
    // Document level, once, because these are properties of the CALCULATOR and identical for every
    // subject — 39 per-entry copies would be 39 restatements of one fact. A per-entry
    // `blockingUnknowns` carries only what is unknown about that entry (its own failed axes).
    //
    // Published rather than implied: a consumer that sees `status: "FRESH"` is entitled to know the
    // status was decided over two axes and not nine, and shipping the coverage limit beside the
    // value is what keeps "no blockers observed" from reading as "nothing can be wrong".
    ...(now === null
      ? {}
      : {
          resolutionPolicy: {
            cadenceDays: CADENCE_DAYS,
            agingMultiple: AGING_MULTIPLE,
            measuredAxes: [...RESOLUTION_AXES],
            unmeasuredAxes: UNMEASURED_AXES.map((u) => ({ fact: u.fact, reason: u.reason })),
          },
        }),
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
