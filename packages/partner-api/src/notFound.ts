/**
 * ADR 0085 D3 — what the static trust plane serves for a subject it has no page for.
 *
 * ADR 0085 §5 measured the surface and found three requests returning **HTTP 200**: a live
 * subject's `.json`, an absent subject's `.json`, and a name that never existed. The last two were
 * **byte-identical on the wire** — both the marketing homepage. `apps/web/public/` had no
 * `404.html`, and with no root `404.html` Cloudflare Pages assumes a single-page application and
 * maps every unmatched path to `/`. So "vanish" was never a chosen option; it was the absence of
 * any option, and the observable result was a 200 with marketing copy.
 *
 * A root `404.html` fixes the status for every shape at once. It cannot fix the CONTENT-TYPE: a
 * machine client asking for `.json` would receive HTML with a 404, and `JSON.parse` throwing is
 * still the only signal it gets. D3.2 is specifically about that — "a machine consumer must be
 * able to tell 'no such subject' from 'malformed response'".
 *
 * WHY THIS IS A PURE FUNCTION AND NOT A BRANCH IN THE PAGES ADAPTER. The adapter can only be
 * observed by deploying it. The rule it applies — which absences answer in JSON, and what that
 * document says — is a product decision with a wrong answer that is invisible until a consumer
 * hits it. Same reason `acknowledgementClears` was lifted out of `gate-s0.ts` in D2: a rule
 * observable only by running the whole platform is a rule whose branches go unmeasured.
 *
 * THE DOCUMENT SHAPE IS NOT RESTATED. `err` builds it, and `err` is what `/v1/public/*` already
 * answers 404 with. Two places that both "return the partner-api error document" is two places for
 * that document to drift, and a machine consumer parsing one and not the other would be right to
 * call that a bug in us.
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY. Nothing here asserts the subject was withdrawn, de-listed,
 * removed, or gone. D3.3 refuses a tombstone and D3.4 rejects `410` outright, on the same ground:
 * `410` means "gone, permanently, and I know it", and ADR 0085 exists because this system was
 * shown to be unable to tell a withdrawal from a version bump. A 404 states OUR absence of a page.
 * It makes no claim about the publisher — which is the only claim we can support.
 */
import type { ApiResponse } from "./types.js"
import { err } from "./http.js"

/**
 * How an absent path should be answered.
 *
 * A discriminated result rather than `ApiResponse | null`, because `null` would have to be read as
 * "serve the HTML page" by convention, and the caller silently doing the wrong thing with it is
 * not a failure any test would catch.
 */
export type AbsentOutcome =
  /** Answer with this JSON document — the caller supplies no body of its own. */
  | { kind: "json"; response: ApiResponse }
  /** Answer with the committed `404.html`, at status 404. */
  | { kind: "html" }

/**
 * The error code every absent-subject JSON answer carries.
 *
 * Deliberately the SAME `not_found` the API's own routes use, rather than a new
 * `subject_absent`/`never_assessed` code. A distinct code would be a claim about WHY the page is
 * missing, and the four causes ADR 0085 D2 separates (`superseded`, `de-listed`, `evicted`,
 * `unknown`) are exactly what the serving plane cannot distinguish — it holds committed bytes and
 * has never consulted the source. Minting a code here would re-commit the original error one layer
 * down: a label asserting a cause nothing measured.
 */
export const ABSENT_CODE = "not_found" as const

/**
 * Cache posture for an absent answer.
 *
 * Shorter than {@link baseHeaders}' `max-age=300, s-maxage=3600`, and the difference is the point.
 * That posture is correct for a baked page — immutable, digest-addressed, slow-moving. A 404 is a
 * statement about what we do NOT have yet, and it is falsified by the next successful bake. An hour
 * of CDN-cached 404 would keep a freshly-baked subject invisible to machine consumers long after it
 * shipped, which is a self-inflicted version of the staleness the freshness axis exists to report.
 * Still cached, not `no-store`: an uncached 404 makes enumeration free.
 */
export const ABSENT_CACHE_CONTROL = "public, max-age=60, s-maxage=60"

/**
 * The human-facing sentence a machine consumer gets in `message`.
 *
 * Phrased as an absence of OUR record, never as an event at the publisher — ADR 0058 §3's
 * absence-wording rule applied to a plane that gate does not currently scan. "No assessment is
 * published at this address" is true whichever of D2's four classes obtains, including the case
 * where the name is simply a typo and no subject was ever involved.
 */
export const ABSENT_MESSAGE =
  "No assessment is published at this address. This does not state that the subject was withdrawn."

/**
 * Decide how an absent path is answered.
 *
 * Keyed on the `.json` suffix ONLY, matching D3.2's wording ("a `.json` request"). Content
 * negotiation on `Accept` is deliberately not implemented: the extensionless URL is the canonical
 * HTML page in the sitemap, and inferring a machine consumer from a header would change what that
 * canonical URL serves based on something no committed byte records. If a consumer needs JSON it
 * asks for `.json`, which is the shape the served tree actually has.
 */
export function absentPathOutcome(path: string): AbsentOutcome {
  if (!path.toLowerCase().endsWith(".json")) return { kind: "html" }
  const response = err(404, ABSENT_CODE, ABSENT_MESSAGE)
  return {
    kind: "json",
    response: {
      ...response,
      headers: { ...response.headers, "cache-control": ABSENT_CACHE_CONTROL },
    },
  }
}
