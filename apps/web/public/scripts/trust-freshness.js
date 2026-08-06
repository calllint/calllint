/**
 * Trust-page freshness refresh (S-2, gaps §1.4).
 *
 * WHY THIS FILE EXISTS. The bake computes freshness once, against the clock recorded as
 * `bakedAt` in `/trust/index.json`. That value is correct for agents, the partner API and
 * SEO — all of which read committed bytes — but a human reading the page a week later sees
 * an age that is a week understated. This script recomputes the age from the `datetime`
 * attribute the page already prints, so the number a person reads is current.
 *
 * ITS LICENCE IS NARROWER THAN `install-copy.js`, AND DELIBERATELY SO. That file states it
 * "must never decide installability, fetch, navigate, or rewrite the page. It only copies
 * text the page already printed." This one DOES rewrite text, which is precisely why the
 * permitted rewrite is enumerated rather than left to judgement:
 *
 *   PERMITTED: replacing the textContent of an element carrying `data-freshness` with an age
 *              derived from its own `datetime` attribute.
 *   FORBIDDEN: fetching, navigating, reading or writing storage/cookies, touching any
 *              element without that attribute, and — above all — displaying, deriving or
 *              altering a VERDICT. Freshness is a display axis; ADR 0053 §5 forbids
 *              combining the independent dimensions into a score, and `computeVerdict` is
 *              the only verdict engine (ADR 0061 §4). A stale page is not a less-safe page.
 *
 * THE THRESHOLDS ARE MIRRORED FROM `packages/trust-index/src/freshness.ts`, and a test
 * asserts these two literals equal the TypeScript constants. Two planes computing the same
 * label must not be able to disagree — a page showing "AGING" in the JSON and "STALE" in the
 * body would be a defect with no single source of truth to appeal to.
 *
 * Degrades silently: with JS off, the baked text stands. It is never the only source of the
 * age, only the fresher one.
 */
;(() => {
  const CADENCE_DAYS = 7
  const AGING_MULTIPLE = 3
  const MS_PER_DAY = 86400000
  /** The fixture anchor. Matched EXACTLY, never by magnitude — see the TS module's rationale. */
  const FIXTURE_ANCHOR = "1970-01-01T00:00:00.000Z"

  function stateFor(ageDays) {
    if (ageDays <= CADENCE_DAYS) return "FRESH"
    if (ageDays <= CADENCE_DAYS * AGING_MULTIPLE) return "AGING"
    return "STALE"
  }

  function label(ageDays, state) {
    const days = ageDays === 1 ? "1 day" : ageDays + " days"
    return days + " ago (" + state.toLowerCase() + ")"
  }

  function refresh(el) {
    const observedAt = el.getAttribute("datetime")
    if (!observedAt) return
    // A timeless anchor has no age to report. Saying "20 700 days ago" about a fixture would
    // be false, so the baked text is left exactly as it is.
    if (observedAt === FIXTURE_ANCHOR) return
    const observedMs = Date.parse(observedAt)
    if (isNaN(observedMs)) return
    const ageDays = Math.max(0, Math.floor((Date.now() - observedMs) / MS_PER_DAY))
    const state = stateFor(ageDays)
    // The instant stays machine-readable and unchanged; only the human-facing suffix moves.
    // `title` keeps the exact timestamp reachable on hover, so nothing is hidden by rewriting.
    el.setAttribute("title", observedAt)
    el.textContent = observedAt + " — " + label(ageDays, state)
    el.setAttribute("data-freshness-state", state)
  }

  function run() {
    const nodes = document.querySelectorAll("time[data-freshness][datetime]")
    for (let i = 0; i < nodes.length; i++) refresh(nodes[i])
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true })
  } else {
    run()
  }
})()
