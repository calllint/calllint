/**
 * The I1a ingestion cohort — fixtures only (ADR 0046 §1; design §2.2).
 *
 * The first cohort is deliberately NOT a crawl (ADR 0038 §6). It is the frozen,
 * ADR-locked `GOLDEN_CASES` set from `@calllint/fixtures` — resources we own, whose
 * expected verdicts are the project's safety floor. They are the perfect
 * reproducibility anchors: small, fixed, and covering every verdict + a parse error.
 *
 * This module turns each golden case into a `BakeInput` with a STABLE, host-
 * independent `sourceLabel` (the fixture file name, never an absolute path) so the
 * bake is byte-identical on any machine.
 */
import { GOLDEN_CASES, readGolden, type GoldenCase } from "@calllint/fixtures"
import type { BakeInput } from "./bakeTrustPage.js"

/**
 * The single pinned observation timestamp for the fixtures cohort. Fixtures are
 * timeless anchors, so "observed at" is a fixed epoch marker, not a wall-clock
 * read — this is the injected value that makes the whole cohort reproducible. A
 * real (Registry/opt-in) source in I1b will inject its own real snapshot time.
 */
export const FIXTURE_OBSERVED_AT = "1970-01-01T00:00:00.000Z"

/**
 * Canonical `{namespace}/{name}` for a fixture. Fixtures live under the reserved
 * `calllint-fixtures/` namespace so a fixture page can never collide with, or be
 * mistaken for, a real published resource.
 */
export function fixtureCanonicalName(file: string): string {
  const stem = file.replace(/\.json$/i, "")
  return `calllint-fixtures/${stem}`
}

/** One cohort entry: the golden case plus everything the bake needs. */
export interface CohortEntry {
  case: GoldenCase
  input: BakeInput
}

/**
 * Build the deterministic cohort. Sorted by file name so the ingestion order (and
 * therefore any index we emit) is stable across runs and platforms.
 */
export function fixtureCohort(): CohortEntry[] {
  return [...GOLDEN_CASES]
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((c) => ({
      case: c,
      input: {
        canonicalName: fixtureCanonicalName(c.file),
        configText: readGolden(c.file),
        sourceLabel: c.file,
        observedAt: FIXTURE_OBSERVED_AT,
      },
    }))
}
