/**
 * S0-OPEN-8 / ADR 0088 — a regex has no notion of polarity, so the corpus was clearing reds by denying them.
 *
 * `gate-s0.ts` cleared a cohort departure by finding the subject's name on the same line as the word
 * `de-listed`. Co-occurrence, not assertion. So the sentence
 *
 *     - `ai.b77/feedback` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
 *
 * harvested `ai.b77/feedback` as an ACKNOWLEDGED DE-LISTING — the corpus saying "this was not
 * withdrawn" and the gate reading "a human confirmed it was withdrawn". Measured across all 15
 * harvesting lines in `adrs/` on 2026-08-17: **14 names harvested, 13 supported only by a negated
 * line.** A 13/14 false-acknowledgement rate, and every one of those 13 was a live upstream subject
 * (`active` + `isLatest`) that our own alphabetical cap had dropped.
 *
 * This file measures the two mechanisms that replaced it, and it exists as a separate file rather than
 * a block inside `cohort-departure-class.invariants.test.ts` because the subject is different: that
 * file asks *did the classifier separate two causes*, this one asks *did the corpus reader understand
 * what the sentence says*. Both are "a guard that cannot observe its subject", the repo's dominant
 * fault class, but the subjects are a classifier and a parser respectively.
 *
 * THE THREE PROPERTIES UNDER TEST, each with a negative control:
 *
 *   1. A denied de-listing is not harvested. Control: the un-filtered harvest must red.
 *   2. Emphasis stripping catches the forms a raw substring test misses. NOT the corpus's own
 *      `**not de-listed**` — the negative control here falsified that claim on the first run, because
 *      the emphasis brackets the whole phrase and the raw line still contains `not de-listed`.
 *      Measured over all of `adrs/`: 21 denial lines, **0 requiring the stripping**. What it does buy
 *      is `not **de-listed**` and `**not** de-listed`, which is what this file witnesses.
 *   3. The eviction channel clears ONLY `unknown`, never `evicted` or `superseded`, and is never
 *      merged with the de-listing set. This is the channel added because fixing (1) exposed a TRUE red
 *      — the 13 subjects really had left, and no honest sentence in the corpus cleared them.
 *
 * The fixtures are the corpus's real line shapes, quoted from `adrs/` and asserted against the files
 * further down, so a future rephrasing of the ADR cannot leave these tests measuring a shape that no
 * longer occurs anywhere.
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import {
  acknowledgementClears,
  harvestAcknowledgedDelistings,
  harvestAcknowledgedEvictions,
  lineDeniesDelisting,
  type Departure,
} from "../../scripts/cohort-identity.js"

const repoRoot = new URL("../../", import.meta.url)
const adrDir = fileURLToPath(new URL("adrs/", repoRoot))

/** Every ADR body, so the corpus-shape assertions measure the real files rather than a copy. */
function adrCorpus(): { file: string; text: string }[] {
  return readdirSync(adrDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ file: f, text: readFileSync(path.join(adrDir, f), "utf8").replace(/\r\n/g, "\n") }))
}

/**
 * The pre-fix harvest, reproduced verbatim from `main` — the negative control for property 1.
 *
 * Without this, every assertion below could pass against a harvest that simply found nothing. A test
 * that cannot fail on the defect it names is the exact pattern ADR 0086 §4 got wrong.
 */
function harvestWithoutPolarity(text: string): Set<string> {
  const found = new Set<string>()
  const PATTERNS = [
    /`([a-z0-9][a-z0-9._-]*\/[a-z0-9._-]+)`[^\n]*de-listed/gi,
    /de-listed[^\n]*`([a-z0-9][a-z0-9._-]*\/[a-z0-9._-]+)`/gi,
  ]
  for (const line of text.split("\n")) {
    for (const re of PATTERNS) {
      for (const m of line.matchAll(re)) found.add(m[1]!)
    }
  }
  return found
}

/** The corpus's real denial shape (ADR 0086 §4, 13 identical-form lines). */
const DENIAL_LINE =
  "- `ai.b77/feedback` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream."

/** The corpus's real affirmative shape (ADR 0084:132) — the ONE true acknowledgement in the corpus. */
const AFFIRMATIVE_LINE =
  "`agency.goji/goji` is acknowledged here as the first such event: **de-listed upstream between"

describe("the corpus still contains the shapes these tests are written about (premise, not behaviour)", () => {
  const corpus = adrCorpus()

  it("holds denial lines that the pre-fix harvest WOULD have mis-acknowledged", () => {
    // The premise that actually matters: not that the lines are bolded, but that they carry a subject
    // name AND deny the de-listing AND would have been harvested by the old co-occurrence rule. Lose
    // any of the three and the defect has no live subject in the corpus, so the controls below stop
    // measuring anything — and this fails HERE naming which property went missing.
    const denials = corpus.flatMap(({ file, text }) =>
      text
        .split("\n")
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter((l) => lineDeniesDelisting(l.text) && harvestWithoutPolarity(l.text).size > 0),
    )
    expect(
      denials.length,
      "no denial line in adrs/ would be mis-harvested by the pre-fix rule — the S0-OPEN-8 controls measure nothing",
    ).toBeGreaterThanOrEqual(13)
    // And the fixed harvest takes none of them, across the whole corpus rather than one fixture line.
    for (const l of denials) {
      expect(
        [...harvestAcknowledgedDelistings(l.text)],
        `${l.file}:${l.line} denies a de-listing but was harvested as one`,
      ).toEqual([])
    }
  })

  it("holds at least one genuine affirmative acknowledgement, so the filter is not just deleting everything", () => {
    const harvested = new Set<string>()
    for (const { text } of corpus) for (const n of harvestAcknowledgedDelistings(text)) harvested.add(n)
    expect(harvested.size, "the filter harvests nothing at all — it would clear no real de-listing either").toBeGreaterThan(0)
    // Measured 2026-08-17: exactly `agency.goji/goji`, via ADR 0084:132.
    expect(harvested).toContain("agency.goji/goji")
  })

  it("holds the 13 cap-eviction acknowledgements the second channel reads", () => {
    const evicted = new Set<string>()
    for (const { text } of corpus) for (const n of harvestAcknowledgedEvictions(text)) evicted.add(n)
    expect(evicted.size, "no eviction acknowledgements — the 13 ai.b77/* departures have no honest clearer").toBeGreaterThanOrEqual(13)
    expect(evicted).toContain("ai.b77/feedback")
    expect(evicted).toContain("ai.b77/web-analytics")
  })
})

describe("a line that DENIES a de-listing does not acknowledge one (S0-OPEN-8)", () => {
  it("skips the corpus's real denial line, and the un-filtered harvest proves the line is harvestable", () => {
    // THE LOAD-BEARING PAIR OF THIS FILE. The second expectation is the negative control: it shows the
    // line DOES match the co-occurrence patterns, so the first expectation's empty result comes from
    // the polarity filter and not from a line the regexes were never going to see.
    expect([...harvestAcknowledgedDelistings(DENIAL_LINE)]).toEqual([])
    expect(
      [...harvestWithoutPolarity(DENIAL_LINE)],
      "the pre-fix harvest must still find this name, or this fixture cannot witness the defect",
    ).toEqual(["ai.b77/feedback"])
  })

  it("keeps a genuine affirmative acknowledgement", () => {
    expect([...harvestAcknowledgedDelistings(AFFIRMATIVE_LINE)]).toEqual(["agency.goji/goji"])
  })

  it("is decided PER LINE, so one subject can carry both an affirmative and a later denial", () => {
    // goji is the reason this is line-level and not document-level: ADR 0084:132 records the event and
    // ADR 0084:26 corrects the stated cause ("was **never de-listed**"). A document-level rule would
    // have to choose between dropping a real acknowledgement and honouring a denial.
    const both = [
      "> `agency.goji/goji` was **never de-listed**: it is `active` and `isLatest` upstream today, and it",
      AFFIRMATIVE_LINE,
    ].join("\n")
    expect([...harvestAcknowledgedDelistings(both)]).toEqual(["agency.goji/goji"])
    // And the denial line ALONE harvests nothing, so the pass above comes from the affirmative line.
    expect([...harvestAcknowledgedDelistings(both.split("\n")[0]!)]).toEqual([])
  })

  it("strips markdown emphasis, which buys the emphasis-INSIDE-the-phrase forms the corpus has not used yet", () => {
    // WHAT THIS TEST CORRECTS. The first draft asserted that the corpus's own `**not de-listed**` needs
    // the stripping. It does not, and the negative control said so: the emphasis brackets the WHOLE
    // phrase, so the raw line still contains `not de-listed`. Measured over all of `adrs/`: 21 denial
    // lines, 0 of which require stripping. The claim was false and is recorded as such in
    // `lineDeniesDelisting`'s docblock.
    const naive = (line: string) =>
      ["not de-listed", "never de-listed"].some((c) => line.toLowerCase().includes(c))

    // The corpus's actual form — both filters agree, so it witnesses nothing about stripping.
    expect(lineDeniesDelisting(DENIAL_LINE)).toBe(true)
    expect(naive(DENIAL_LINE), "the corpus form does NOT depend on stripping — measured 0 of 21").toBe(true)

    // The forms that DO depend on it: emphasis inside the phrase. Ordinary markdown a human would write
    // without thinking, and the reason the normalisation stays.
    for (const line of [
      "`x.example/y` — evicted by the cap, not **de-listed**",
      "`x.example/y` — **not** de-listed: `active` upstream",
      "`x.example/y` — evicted by the cap, not `de-listed`",
      "`x.example/y` — evicted by the cap, not\tde-listed", // whitespace collapse, same normalisation
    ]) {
      expect(lineDeniesDelisting(line), `stripping must catch: ${line}`).toBe(true)
      expect(naive(line), `a raw substring test must MISS: ${line}`).toBe(false)
    }
  })

  it("recognises the negations the corpus actually uses, and does not fire on a bare affirmative", () => {
    for (const line of [
      "`x/y` was **never de-listed**",
      "`x/y` is not de-listed",
      "`x/y` — evicted, **not a de-listing**",
      "this was a version bump rather than de-listed",
    ]) {
      expect(lineDeniesDelisting(line), `should deny: ${line}`).toBe(true)
    }
    expect(lineDeniesDelisting("`x/y` was de-listed upstream on 2026-08-01")).toBe(false)
  })

  it("fails toward refusal: an unrecognised denial phrasing leaves the name unharvested is NOT claimed", () => {
    // Honest about the limit. This is a cue list, not a parser, and it CANNOT be right in general. The
    // documented posture is that an unrecognised denial harvests the name — the gate then clears a red
    // it should have kept — so the mitigation is `acknowledgementClears` refusing `evicted` and
    // `superseded` outright. This test pins that mitigation rather than pretending the cue list is total.
    const exotic = "`x.example/y` — in no sense whatsoever de-listed"
    expect(lineDeniesDelisting(exotic), "documenting the known gap, not asserting it is safe").toBe(false)
    expect([...harvestAcknowledgedDelistings(exotic)]).toEqual(["x.example/y"])
    // …and the mis-harvested name still cannot clear the two classes that would publish a false claim.
    const ack = new Set(["x.example/y"])
    for (const cls of ["evicted", "superseded"] as const) {
      expect(
        acknowledgementClears({ name: "x.example/y", class: cls, why: "x" }, ack),
        `a mis-harvested name must not clear ${cls}`,
      ).toBe(false)
    }
  })
})

describe("the eviction channel clears our cap's departures without calling them withdrawals (ADR 0088)", () => {
  const NAME = "ai.b77/feedback"
  const EVICTIONS = new Set([NAME])
  const NO_DELISTINGS = new Set<string>()

  it("harvests the name from the corpus's real eviction sentence", () => {
    expect([...harvestAcknowledgedEvictions(DENIAL_LINE)]).toEqual([NAME])
  })

  it("clears an UNKNOWN departure — the network-free case the acknowledgement is written for", () => {
    // THE TEST THE CHANNEL EXISTS FOR. Before it, these 13 departures were cleared by their own denial
    // lines; after the polarity fix they were unclearable; now they are cleared by the sentence that
    // states the true cause. Same green, honest reason.
    const d: Departure = { name: NAME, class: "unknown", why: "the source was not consulted" }
    expect(acknowledgementClears(d, NO_DELISTINGS, EVICTIONS)).toBe(true)
    // The control: without the third argument — i.e. before this change — the same departure is red.
    expect(
      acknowledgementClears(d, NO_DELISTINGS),
      "the un-taught gate must NOT clear this, or the channel is doing nothing",
    ).toBe(false)
  })

  it("REFUSES to clear an EVICTED departure, which is measured and needs no prose", () => {
    // `evicted` requires a source view proving the subject live upstream. When we have that, the cause
    // is established by measurement; letting prose clear it would let a sentence outrank an observation.
    const d: Departure = { name: NAME, class: "evicted", why: "still `active` upstream, outside the ceiling" }
    expect(acknowledgementClears(d, NO_DELISTINGS, EVICTIONS)).toBe(false)
  })

  it("REFUSES to clear a SUPERSEDED departure — our defect is not our cap", () => {
    // The two classes an operator would act on most differently: `superseded` says fix the projection.
    // An eviction acknowledgement claiming that departure would silence a D1 regression permanently.
    const d: Departure = { name: NAME, class: "superseded", why: "live upstream, inside the window" }
    expect(acknowledgementClears(d, NO_DELISTINGS, EVICTIONS)).toBe(false)
  })

  it("clears nothing when the corpus names a different subject", () => {
    const d: Departure = { name: NAME, class: "unknown", why: "x" }
    expect(acknowledgementClears(d, NO_DELISTINGS, new Set(["other.example/thing"]))).toBe(false)
  })

  it("enumerates EVERY class against EACH channel in isolation, so neither hides behind the other", () => {
    // THE TEST A SURVIVING MUTANT DEMANDED. The refusals above were originally answered by a shared
    // early return (`if superseded || evicted return false`) that ran BEFORE either channel, so widening
    // the eviction channel to clear any class left 42 of 42 tests green — the two REFUSES tests were
    // measuring the early return, not the channel. `acknowledgementClears` now gives each channel its
    // own allowlist, and this table is what observes them separately: one channel supplied at a time,
    // every class, both directions. Mutate either allowlist and a row here flips.
    const ALL: readonly Departure["class"][] = ["de-listed", "unknown", "superseded", "evicted"]
    const only = new Set([NAME])
    const none = new Set<string>()

    // Channel A alone — a WITHDRAWAL acknowledgement.
    const viaDelisting: Record<string, boolean> = {}
    for (const cls of ALL) viaDelisting[cls] = acknowledgementClears({ name: NAME, class: cls, why: "x" }, only, none)
    expect(viaDelisting).toEqual({ "de-listed": true, unknown: true, superseded: false, evicted: false })

    // Channel B alone — an OUR-CAP acknowledgement. Note `de-listed` is false: a sentence about our
    // window is not evidence the publisher withdrew anything, so it cannot clear that class either.
    const viaEviction: Record<string, boolean> = {}
    for (const cls of ALL) viaEviction[cls] = acknowledgementClears({ name: NAME, class: cls, why: "x" }, none, only)
    expect(viaEviction).toEqual({ "de-listed": false, unknown: true, superseded: false, evicted: false })

    // Neither channel — the base case, so no green above can come from the function ignoring its sets.
    for (const cls of ALL) {
      expect(acknowledgementClears({ name: NAME, class: cls, why: "x" }, none, none), cls).toBe(false)
    }
  })

  it("is a SEPARATE set from the de-listing acknowledgements, in both directions", () => {
    // The two channels say different things about a third party, so neither may substitute for the
    // other. A de-listing set must not clear via the eviction branch, and the eviction set must not be
    // readable as a withdrawal — which is what keeps the gate from printing 13 cap-evictions as 13
    // publisher withdrawals.
    const delistingOnly = harvestAcknowledgedDelistings(AFFIRMATIVE_LINE)
    expect([...harvestAcknowledgedEvictions(AFFIRMATIVE_LINE)], "an affirmative de-listing is not an eviction record").toEqual([])
    expect([...delistingOnly]).toEqual(["agency.goji/goji"])

    const evictionOnly = harvestAcknowledgedEvictions(DENIAL_LINE)
    expect([...harvestAcknowledgedDelistings(DENIAL_LINE)], "an eviction record is not a withdrawal").toEqual([])
    expect([...evictionOnly]).toEqual([NAME])
  })

  it("requires the cue to name ADR 0074's cap, so a loose 'evicted' cannot acknowledge a departure", () => {
    // The cue list is deliberately narrow. `evicted` appears in this repo about caches, containers and
    // rows; none of those is a statement about a cohort subject leaving the served window.
    expect([...harvestAcknowledgedEvictions("`x.example/y` was evicted from the LRU cache")]).toEqual([])
    expect([...harvestAcknowledgedEvictions("`x.example/y` — evicted by ADR 0074")]).toEqual(["x.example/y"])
  })

  it("reads names from the RAW line, never the emphasis-stripped one", () => {
    // Stripping backticks before harvesting names would turn every bare `word/word` into a subject —
    // including paths like `adrs/0086`, prose like `and/or`, and every file reference in the corpus.
    const line = "- `ai.b77/time` — evicted by the cap, see adrs/0086 and packages/trust-index for the measurement."
    expect([...harvestAcknowledgedEvictions(line)]).toEqual(["ai.b77/time"])
  })
})
