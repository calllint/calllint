/**
 * PR-D5 — two Gate-C page-quality projections (new12.md:1206-1216; ADR 0053 §2).
 *
 * Gate C requires each published page to carry nine fields. Seven were already on the
 * baked page (verdict/digest, observable authority, absent evidence via completeness +
 * evidence level, receipt=manifest, limitations, correction, version-in-config). These
 * two close the gap:
 *   • reproductionCommand — HOW a reader replays the exact verdict, and
 *   • scanHistory         — WHEN this artifact was observed.
 *
 * Both are PURE, DETERMINISTIC PROJECTIONS over an already-baked page — the same
 * discipline as `evidenceLevel(page)`: they read shipped fields and map them to a
 * display shape, introducing NO new score, verdict, or authority model, and moving no
 * verdict. No clock, no network, no RNG (the bake injects the pinned timestamp).
 */
import type { BakedTrustPage } from "./bakeTrustPage.js"

/**
 * A published page's reproduction instruction. The honest reproduction of a verdict is
 * "scan the exact input we scanned, at this digest" — so the command names the same
 * source the page was baked from and pins the artifact digest the verdict was observed
 * at. The note frames it as reproducing the OBSERVED VERDICT at a point-in-time digest,
 * never as proving safety (ADR 0038 §2 boundary).
 */
export interface Reproduction {
  /** The shipped `calllint scan` invocation, version-agnostic (single-sourced form). */
  command: string
  /** The artifact digest the verdict was observed at — the reproduction anchor. */
  artifactDigest: string
  /** Boundary-safe explanation of what re-running reproduces (a verdict, not a guarantee). */
  note: string
}

/** One recorded observation of an artifact (scan-history entry). */
export interface ScanHistoryEntry {
  /** ISO-8601 UTC the observation was made (the page's pinned observedAt). */
  observedAt: string
  /** The page digest at that observation (changes iff the page content changed). */
  pageDigest: string
  /** The artifact digest observed. */
  artifactDigest: string
}

/**
 * The canonical shipped scan verb. Version-agnostic on purpose: pinning a version here
 * would drift on every release and would break the page's own reproducibility framing.
 * Mirrors `project-facts.json.install.scan` ("npx calllint scan …"); the public-copy
 * guard forbids a hardcoded-version command elsewhere, so we keep this bare.
 */
const SCAN_VERB = "npx calllint scan"

/**
 * Project the reproduction command for a page. Deterministic: derived only from the
 * page's own `preparation.artifact.source` (the exact locator we scanned) and its
 * pinned `artifactDigest`. Boundary-safe and PII-free (the source label is the
 * PII-free registry name / fixture label, never publisher contact info).
 */
export function reproductionCommand(page: BakedTrustPage): Reproduction {
  const source = page.preparation.artifact.source
  return {
    command: `${SCAN_VERB} ${source}`,
    artifactDigest: page.artifactDigest,
    note:
      "Re-running this scan reproduces the verdict observed at the pinned artifact " +
      "digest. It is a point-in-time observation, not a guarantee of future behavior.",
  }
}

/**
 * Project the scan history for a page. The retained snapshot model keeps only the
 * CURRENT observation, so this is an HONEST single-entry list — it states exactly what
 * is known (one observation at `observedAt`) and never fabricates prior scans. It is a
 * list so a future retained-observations store can append entries without a shape
 * change; today it has length 1 by construction.
 */
export function scanHistory(page: BakedTrustPage): ScanHistoryEntry[] {
  return [
    {
      observedAt: page.observedAt,
      pageDigest: page.pageDigest,
      artifactDigest: page.artifactDigest,
    },
  ]
}
