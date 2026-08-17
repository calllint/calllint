/**
 * ADR 0084 — a count cannot witness a substitution.
 *
 * `gate:s0:regression`'s ratchet is a COUNT (`censusRegistry < S0_REGRESSION_FLOOR`). One record
 * lost against 76 gained nets +75, so the predicate is false and the gate is green while a subject
 * silently leaves the cohort. That is what happened to `agency.goji/goji` between the 2026-08-10 and
 * 2026-08-15 snapshots: de-listed upstream, six served files removed, `--regression` EXIT 0.
 *
 * This module is the IDENTITY witness that sits alongside the count. It compares the committed
 * snapshot's name SET against the name set in the PREVIOUS REVISION OF THAT SAME FILE and reports
 * every name present then and absent now.
 *
 * Three properties, each a decision from the ADR rather than an implementation detail:
 *
 *   D2 — THE RECORD IS GIT HISTORY, NOT A NEW STATE FILE. The snapshot is committed, so every
 *        cohort we ever served is already in one file's history. Reading `git show <rev>:<path>`
 *        means there is no `previous-cohort.json` to hand-edit when a red is inconvenient. A second
 *        copy of a fact the repository already stores is a second thing that can be doctored.
 *
 *   D3 — WHERE HISTORY IS UNREACHABLE THIS REFUSES, IT DOES NOT PASS. A depth-1 clone has no
 *        previous revision, and a run that COULD NOT MEASURE must not print what a run that measured
 *        and found nothing prints (ADR 0082's `{kind}` shape, reused here rather than reinvented —
 *        [[a-boolean-standing-in-for-a-reason]]).
 *
 *   D4 — A DE-LISTING IS REPORTABLE, NOT AUTOMATICALLY WRONGDOING. A publisher pulling their server
 *        is legitimate and will recur. What is illegitimate is it happening UNOBSERVED. So the
 *        result names the lost subjects and lets the caller decide the exit code.
 *
 * ADR 0085 D2 — A DEPARTURE IS CLASSIFIED BEFORE IT IS REPORTED AS A LOSS. The above shipped, and
 * then reported the wrong event: `agency.goji/goji` was `active` + `isLatest` upstream and had shipped
 * 1.0.1 two days before the snapshot that "lost" it. The witness saw a version bump and printed a
 * de-listing, because `LOST: <name>` asserted a cause the check had never established. So each
 * departure now carries one of four classes — `superseded` / `de-listed` / `evicted` / `unknown` — and
 * `superseded` is stated as a BUG IN THIS SYSTEM rather than an act by the publisher. The exit code
 * remains the caller's (0084 D4 is unchanged); what changed is that the verdict says WHICH event
 * occurred, since the four have opposite meanings and an operator cannot act on the undifferentiated
 * fact.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// IMPORTED, NOT COPIED. `beyondCeiling` below has to know which names are admitted without competing
// for a slot, and a second literal list would be a second thing to forget to update — the cap and its
// witness would then disagree silently, which is the fault class this whole module exists to catch.
// Same relative-path form `gate-s0.ts` already uses for `fixtureCohort`.
import { RESERVED_COHORT_NAMES } from "../packages/trust-index/src/fetchRegistry.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** The one file whose history IS the record of every cohort we ever committed (D2). */
export const SNAPSHOT_PATH = "packages/trust-index/snapshots/official-mcp-registry.json"

function git(...args: readonly string[]): string {
  return execFileSync("git", args as string[], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

/**
 * Why a name left the cohort (ADR 0085 D2).
 *
 * ADR 0084 D4 said a de-listing is "reportable, not automatically wrongdoing", and then ADR 0085
 * measured the witness reporting the wrong event: `agency.goji/goji` was `active` + `isLatest`
 * upstream and had shipped 1.0.1 two days before the snapshot that "lost" it. The witness saw a
 * version bump and printed a de-listing. So a departure is CLASSIFIED before it is reported, because
 * "a name left the cohort" has four causes with opposite meanings and an operator cannot act on the
 * undifferentiated fact.
 *
 * - `superseded` — still `active` upstream with a newer version. NOT a withdrawal. This is the class
 *   D1 fixes, so after D1 it should not occur; if it does, the witness names it a **bug in this
 *   system**, never an act by the publisher.
 * - `de-listed` — absent from the source, or present and not `active`. The only class that describes
 *   a publisher actually pulling their server.
 * - `evicted` — still live upstream but outside ADR 0074's alphabetical ceiling.
 * - `unknown` — the source could not be consulted. Per ADR 0082 this is **not** a flavour of the
 *   other three and must never be printed as one.
 */
export type DepartureClass = "superseded" | "de-listed" | "evicted" | "unknown"

/**
 * One departure and the reason it was classified that way.
 *
 * `why` is not decoration. `unknown` and `de-listed` are both "we are not serving this name", and the
 * only thing that separates a refusal from a finding is the sentence saying which one it is
 * ([[a-boolean-standing-in-for-a-reason]]).
 */
export interface Departure {
  readonly name: string
  readonly class: DepartureClass
  readonly why: string
}

/** What the source says about one subject. The three fields D2's classes actually turn on. */
export interface SourceObservation {
  readonly status?: string
  readonly isLatest?: boolean
  readonly version?: string
}

/**
 * The source's view of the world, keyed by name — or `null` when it could not be consulted.
 *
 * INJECTED, never fetched here. This module is called by `gate:s0` on CI legs with no network
 * guarantee, and a classifier that reached for the registry would turn a cohort check into a
 * flaky one. `null` is a first-class input rather than an error: it yields `unknown`, which is
 * the honest answer and the one ADR 0082 requires be distinguishable from a measured pass.
 */
export type SourceView = ReadonlyMap<string, SourceObservation> | null

/**
 * The outcome shape, deliberately three-valued.
 *
 * `refused` is not a flavour of pass. It carries the reason so a log reader can tell "there was no
 * previous revision to compare against" from "there was one and nothing was lost" — the distinction
 * ADR 0082 exists to preserve, and the one a boolean would destroy.
 */
export type IdentityOutcome =
  | {
      readonly kind: "checked"
      /** Names in the previous revision and absent from the current one. Empty is the good case. */
      readonly lost: readonly string[]
      /**
       * Every name in `lost`, with the event that explains it (ADR 0085 D2).
       *
       * Parallel to `lost` rather than replacing it: the exit code is the caller's decision (0084 D4)
       * and `gate-s0.ts` already filters `lost` against the acknowledged set. A classifier that
       * changed that shape would move a product judgement into a refactor.
       */
      readonly departures: readonly Departure[]
      /** Names absent from the previous revision and present now. Growth; never a fault. */
      readonly gained: readonly string[]
      readonly previousRevision: string
      readonly previousCount: number
      readonly currentCount: number
    }
  | { readonly kind: "refused"; readonly reason: string }

interface SnapshotShape {
  readonly count?: number
  readonly entries?: readonly { readonly name?: unknown }[]
}

/**
 * Registry names from snapshot BYTES.
 *
 * Throws rather than returning `[]` on a shape it does not recognise, and that choice is the point:
 * an empty name set silently makes every comparison vacuous — every name "lost", or with the
 * operands the other way round, nothing ever lost. A census that cannot find its key must fail
 * loudly, not count zero ([[a-census-inherits-its-key-form-blind-spots]]).
 */
export function namesFromSnapshotBytes(raw: string, origin: string): string[] {
  let parsed: SnapshotShape
  try {
    parsed = JSON.parse(raw) as SnapshotShape
  } catch (err) {
    throw new Error(`${origin}: not parseable as JSON — ${(err as Error).message}`)
  }
  const entries = parsed.entries
  if (!Array.isArray(entries)) {
    throw new Error(`${origin}: no \`entries\` array — found keys [${Object.keys(parsed ?? {}).join(", ")}]`)
  }
  const names = entries.map((e) => e?.name).filter((n): n is string => typeof n === "string" && n.length > 0)
  // The abort this repo learned to add the hard way: a wrong field name yields a short list and a
  // confident, WRONG answer. Length equality is what makes the key form falsifiable.
  if (names.length !== entries.length) {
    throw new Error(
      `${origin}: ${entries.length} entries but only ${names.length} usable \`name\` values — ` +
        `the key form is wrong, and a partial name set would make this comparison vacuous`,
    )
  }
  return names
}

/** Is there a previous revision of the snapshot to compare against, and can we read it? */
function previousRevisionOf(snapshotPath: string): { rev: string; raw: string } | { reason: string } {
  try {
    git("rev-parse", "--git-dir")
  } catch {
    return { reason: "not a git repository — no history to compare the cohort against" }
  }

  let shallow = false
  try {
    shallow = git("rev-parse", "--is-shallow-repository").trim() === "true"
  } catch {
    /* older git without the flag; fall through to the log probe, which fails honestly */
  }

  // `-2` because revision 1 is the commit under test. Its parent is the cohort we are comparing to.
  let revs: string[]
  try {
    revs = git("log", "-2", "--format=%H", "--", snapshotPath)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  } catch (err) {
    return { reason: `\`git log\` over ${snapshotPath} failed — ${(err as Error).message}` }
  }

  if (revs.length < 2) {
    return {
      reason: shallow
        ? `SHALLOW CLONE: only ${revs.length} revision(s) of ${snapshotPath} are reachable, so the ` +
          `previous cohort cannot be read. This is a REFUSAL, not a pass — run this check on a ` +
          `job with \`fetch-depth: 0\` (ADR 0084 D3).`
        : `only ${revs.length} revision(s) of ${snapshotPath} exist — there is no previous cohort ` +
          `to compare against yet. Nothing is asserted.`,
    }
  }

  const rev = revs[1]!
  try {
    return { rev, raw: git("show", `${rev}:${snapshotPath}`) }
  } catch (err) {
    return { reason: `\`git show ${rev.slice(0, 8)}:${snapshotPath}\` failed — ${(err as Error).message}` }
  }
}

/**
 * Classify one departure (ADR 0085 D2). PURE — every input is an argument.
 *
 * THE ORDER OF THESE BRANCHES IS THE DECISION. `unknown` is tested FIRST, because a missing source
 * view means nothing below it can be evaluated, and the cheapest way to reintroduce ADR 0085's defect
 * would be to let a structural fact ("outside the ceiling") stand in for a fact about the source
 * ("still live upstream"). ADR 0074's cap is a *ceiling on what we serve*; `evicted` additionally
 * claims the subject IS live upstream, and that half cannot be read from committed bytes. So an
 * uncheckable departure that merely LOOKS capped is reported `unknown` with the ceiling named in
 * `why` — a lead for the operator, never a verdict ([[a-refusal-must-not-be-mistakable-for-a-pass]]).
 *
 * `currentNames` is passed whole because `evicted` is not a property of the lost name alone: it means
 * "sorts outside the served window", which only the retained set can answer. Reserved names (ADR
 * 0075) take a slot rather than an extra one, so the window's upper edge is the largest served name,
 * whatever its prefix.
 */
export function classifyDeparture(
  name: string,
  currentNames: readonly string[],
  source: SourceView,
): Departure {
  // The structural half of `evicted`, computed either way because it is the useful part of an
  // `unknown` message. A name sorting inside the served window was NOT squeezed out by the ceiling,
  // so the cap cannot be what removed it — that much IS readable from committed bytes.
  //
  // THE CEILING IS THE LARGEST *NON-RESERVED* NAME, not the largest served name. A reserved name
  // (ADR 0075) takes a slot rather than an extra one, but it is admitted REGARDLESS of where it
  // sorts: `selectCohortEntries` takes the reserved set first and then fills `max - reserved.length`
  // from the sorted rest (`fetchRegistry.ts:89-99`). So the competitive edge — the last name the cap
  // actually let through — is the largest name that had to compete for its slot.
  //
  // Measured on the 2026-08-17 cohort: `io.github.calllint/calllint` is reserved and sorts LAST of
  // all 100, so `sort().at(-1)` reported a ceiling of `io.*` and `beyondCeiling` was false for every
  // name from `a*` to `i*`. The true edge was `ai.b77/chess-results` at `at(-2)`. All 13 departing
  // `ai.b77/*` subjects sort past it and were squeezed out by 13 alphabetically-earlier arrivals —
  // an ordinary capped eviction. The old form reported them as sorting INSIDE the window, and with a
  // source view would have classified them `superseded`, whose own `why` says the recurrence "is a
  // BUG IN THIS SYSTEM, not an act by the publisher". Every one is `active` + `isLatest` upstream
  // (consulted 2026-08-17). A guard that cannot see the cap must not be the thing that decides the
  // cap is innocent.
  const competing = currentNames.filter((n) => !RESERVED_COHORT_NAMES.includes(n))
  const maxServed = competing.length > 0 ? [...competing].sort().at(-1)! : null
  const beyondCeiling = maxServed !== null && name > maxServed

  if (source === null) {
    return {
      name,
      class: "unknown",
      why: beyondCeiling
        ? `the source was not consulted, so this cannot be classified. It sorts after the last ` +
          `served name (\`${maxServed}\`), which is CONSISTENT with ADR 0074's cap but does not ` +
          `establish it: \`evicted\` also claims the subject is still live upstream, and that is a ` +
          `fact about the source, not about our bytes`
        : `the source was not consulted, so this cannot be classified. It sorts INSIDE the served ` +
          `window, so the cap does not explain it — consult the registry`,
    }
  }

  const observed = source.get(name)
  if (observed === undefined) {
    return { name, class: "de-listed", why: "absent from the source entirely" }
  }
  if (observed.status !== "active") {
    return {
      name,
      class: "de-listed",
      why: `present in the source with status \`${observed.status ?? "<missing>"}\`, not \`active\``,
    }
  }

  // Live upstream from here on, so the remaining question is whether WE dropped it or the ceiling did.
  if (beyondCeiling) {
    return {
      name,
      class: "evicted",
      why:
        `still \`active\` upstream, and sorts after the last name that COMPETED for a slot ` +
        `(\`${maxServed}\` — reserved names are admitted regardless of where they sort, ADR 0075) — ` +
        `outside the cohort ceiling (ADR 0074/0075), not withdrawn`,
    }
  }

  // Live upstream, inside the window, and gone anyway: nothing outside this system explains it.
  return {
    name,
    class: "superseded",
    why:
      `still \`active\` upstream${observed.version != null ? ` at version \`${observed.version}\`` : ""}` +
      `${observed.isLatest === true ? " and marked `isLatest`" : ""}, and sorts inside the served ` +
      `window — so neither a withdrawal nor the cap explains it. ADR 0085 D1 fixed the mechanism ` +
      `that caused this class (a content hash chose the subject's current version); its recurrence ` +
      `is a BUG IN THIS SYSTEM, not an act by the publisher`,
  }
}

/**
 * Can an ADR acknowledgement of a WITHDRAWAL clear this departure? (ADR 0084 D4 + ADR 0085 D2.)
 *
 * D2 leaves the exit code to the caller and this does not take it back — `gate-s0.ts` still decides.
 * The question here is narrower: which CLASS of departure an acknowledgement is capable of answering
 * for. Before D2 the answer was "any departure of a named subject", because a name was all the
 * witness reported, and that was live on `main`: goji's ADR 0084 acknowledgement cleared a departure
 * this witness classifies `unknown`, so `--identity` printed "UNCLASSIFIED, not cleared" and exited 0
 * having cleared it.
 *
 * WHAT THE ACKNOWLEDGEMENT ASSERTS. `gate-s0.ts` finds it by grepping the ADR corpus for a subject
 * named next to the word `de-listed`, satisfying D4's "record WHICH subject and WHY". So it answers
 * *did a human see this subject leave and write it down* — NOT *do we know the cause*. Two different
 * questions, and the classes split on which is being asked:
 *
 *   - `de-listed` — cleared. Acknowledgement and class agree on the cause.
 *   - `unknown` — cleared, with the cause still printed as unestablished. The human engagement D4
 *     demands has happened; what is missing is a source view, a different remedy from a missing ADR.
 *     Refusing here would also be wrong concretely: `checkCohortIdentity` defaults `source` to
 *     `null`, so on a network-free CI leg EVERY departure is `unknown` and the gate would have no
 *     reachable green while printing a remedy that cannot work. ADR 0082 requires a refusal be
 *     VISIBLE, not inconsolable — and it is visible, twice: in `formatIdentityOutcome`'s UNCLASSIFIED
 *     block and in the gate's `NOT ESTABLISHED` line.
 *   - `superseded` — NEVER cleared. Our defect, which D2 requires be named a bug in this system
 *     rather than an act by the publisher. A sentence about a publisher pulling their server is not a
 *     statement about this event, so honouring it would let a real 2026-08 acknowledgement
 *     permanently silence a D1 regression. The remedy is to fix the projection, not to write prose.
 *   - `evicted` — NEVER cleared. ADR 0074/0075's cap is designed behaviour, not a withdrawal, and an
 *     acknowledgement calling it one records a false claim about a third party in the corpus.
 *
 * Keyed on the CLASS, never on the name, so the rule cannot rot as subjects come and go. Lives here
 * rather than in `gate-s0.ts` so it is importable by a test: the gate is a script with top-level
 * effects, and a rule that can only be observed by running the whole gate is a rule whose branches
 * go unmeasured.
 */
const DELISTING_CLEARS: readonly Departure["class"][] = ["de-listed", "unknown"]

const EVICTION_CLEARS: readonly Departure["class"][] = ["unknown"]

/**
 * EACH CHANNEL CARRIES ITS OWN ALLOWLIST, and that shape was forced by a surviving mutant.
 *
 * The first version of the eviction channel read:
 *
 *     if (d.class === "superseded" || d.class === "evicted") return false   // shared early return
 *     if (acknowledged.has(d.name)) return true
 *     return d.class === "unknown" && acknowledgedEvictions.has(d.name)
 *
 * Measured: replacing that last line with a bare `acknowledgedEvictions.has(d.name)` — i.e. letting a
 * cap-eviction sentence clear ANY class, including `superseded` — left **42 of 42 tests green**. The
 * shared early return answered first, so the channel's own restriction was unobservable, and the two
 * tests written to witness it were in fact witnessing the early return. A guard that cannot observe
 * its subject, in the tests for a guard that could not observe its subject.
 *
 * So the early return is gone and each channel states which classes it can answer for. The refusals
 * are now properties of the channel rather than of the order the branches happen to run in, and a
 * mutation to either allowlist reds a test that names that channel.
 */
export function acknowledgementClears(
  d: Departure,
  acknowledged: ReadonlySet<string>,
  acknowledgedEvictions: ReadonlySet<string> = new Set(),
): boolean {
  // "A human saw this subject leave and wrote down that the PUBLISHER withdrew it." Clears the class
  // that agrees with it, plus `unknown` — where the human engagement D4 demands has happened and only
  // a source view is missing. Never `superseded` (our defect, and honouring it would let a real 2026-08
  // sentence permanently silence a D1 regression) and never `evicted` (our cap, and calling it a
  // withdrawal records a false claim about a third party).
  if (acknowledged.has(d.name) && DELISTING_CLEARS.includes(d.class)) return true
  // "A human recorded that OUR CAP moved past this subject" — a fact about our window, not about the
  // publisher. Clears only `unknown`: the network-free case where the cause cannot be confirmed from
  // bytes. Never `evicted`, even though that is the class the sentence describes — an `evicted`
  // classification required a source view proving the subject live upstream, so it is established by
  // measurement, and prose must not outrank an observation.
  if (acknowledgedEvictions.has(d.name) && EVICTION_CLEARS.includes(d.class)) return true
  return false
}

/**
 * A NAME NEXT TO `de-listed` IS NOT AN ACKNOWLEDGEMENT THAT IT WAS DE-LISTED (S0-OPEN-8).
 *
 * The harvest is co-occurrence on one line: subject in backticks, the word `de-listed` somewhere on
 * the same line. A regex has no notion of polarity, so the sentence *"`x` was **never de-listed**"*
 * harvested `x` as an acknowledged de-listing — the corpus asserting the opposite of what the gate
 * then believed.
 *
 * MEASURED BEFORE THE FIX (2026-08-17, all 15 harvesting lines in `adrs/`): **14 names harvested, 13
 * of them supported ONLY by a negated line** — every `ai.b77/*` entry of ADR 0086 §4, each reading
 * "evicted by the cap, **not de-listed**". The single name with a genuine affirmative line was
 * `agency.goji/goji` (ADR 0084:132, "de-listed upstream between …"), which also carries a negated
 * correction line (0084:26, "was **never de-listed**"). So the false-acknowledgement rate was 13/14,
 * and the one true acknowledgement in the corpus is one a line-level filter keeps.
 *
 * WHY LINE-LEVEL AND NOT DOCUMENT-LEVEL. goji is the proof: one subject legitimately has both an
 * affirmative line (the event) and a negated line (a later correction about the stated cause). A
 * document-level rule would have to choose between dropping a real acknowledgement and honouring a
 * denial; a line-level rule needs no such choice, because each line is a claim in its own right.
 *
 * WHY A CUE LIST AND NOT PARSING. This is deliberately a blunt instrument with a narrow job: decide
 * whether one line ASSERTS or DENIES a de-listing. It cannot be right in general — natural language
 * is not a regex — so it is built to fail toward NOT acknowledging:
 *
 *   - an unrecognised denial → the name is not harvested → the gate stays RED and asks a human. The
 *     cost is a red that needs prose rewritten.
 *   - the opposite direction, harvesting a denial, is the S0-OPEN-8 defect itself: a red silently
 *     cleared by a sentence that denies the event. The cost is a departure nobody looks at.
 *
 * Those costs are not symmetric, so the tie is broken toward refusal. `acknowledgementClears` above
 * is the second half of the same posture: it refuses `evicted` and `superseded` outright, so even a
 * mis-harvested name cannot clear those two classes.
 */
const DENIAL_CUES = [
  "not de-listed",
  "never de-listed",
  "no de-listing",
  "not a de-listing",
  "never a de-listing",
  "not been de-listed",
  "was not de-listed",
  "wasn't de-listed",
  "isn't de-listed",
  "is not de-listed",
  "not de-listing",
  "rather than de-listed",
  "instead of de-listed",
] as const

/**
 * Does this line DENY a de-listing rather than assert one?
 *
 * Matches on the normalised line: markdown emphasis stripped and whitespace collapsed.
 *
 * THE STRIPPING IS DEFENSIVE, NOT LOAD-BEARING ON TODAY'S CORPUS, and an earlier version of this
 * docblock claimed the opposite. Measured 2026-08-17 over all of `adrs/`: **21 denial lines, of which
 * 0 require the stripping** — the corpus writes `**not de-listed**`, where the emphasis brackets the
 * whole phrase, so the raw line still contains the substring `not de-listed`. The claim that "without
 * the stripping this would match none of them" was false, and it mattered: it would have told a future
 * reader that a control had a witness when it did not.
 *
 * What the stripping DOES buy is the emphasis-INSIDE-the-phrase forms — `not **de-listed**`,
 * `**not** de-listed` — which a raw substring test misses and which are ordinary markdown a human
 * would write without thinking. Cheap insurance against a phrasing the corpus has not used yet;
 * `acknowledgement-polarity.invariants.test.ts` witnesses it with exactly that shape.
 */
export function lineDeniesDelisting(line: string): boolean {
  const normalised = line
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
  return DENIAL_CUES.some((cue) => normalised.includes(cue))
}

/**
 * Harvest acknowledged de-listings from one ADR's text, line by line, skipping denials.
 *
 * Split out from `gate-s0.ts`'s filesystem walk for the reason given on `acknowledgementClears`: the
 * gate is a script with top-level effects, so a rule that can only be observed by running the whole
 * gate is a rule whose branches go unmeasured. This takes text and returns names — a test can feed it
 * a sentence.
 */
export function harvestAcknowledgedDelistings(text: string): Set<string> {
  const found = new Set<string>()
  const PATTERNS = [
    /`([a-z0-9][a-z0-9._-]*\/[a-z0-9._-]+)`[^\n]*de-listed/gi,
    /de-listed[^\n]*`([a-z0-9][a-z0-9._-]*\/[a-z0-9._-]+)`/gi,
  ]
  for (const line of text.split("\n")) {
    if (lineDeniesDelisting(line)) continue
    for (const re of PATTERNS) {
      for (const m of line.matchAll(re)) found.add(m[1]!)
    }
  }
  return found
}

/**
 * A SECOND, SEPARATE ACKNOWLEDGEMENT CHANNEL: "our cap removed this subject."
 *
 * Fixing the denial harvest above re-opened a red it had been silencing, and the red was TRUE: the 13
 * `ai.b77/*` subjects of the 2026-08-17 refresh really did leave, and the corpus contains no sentence
 * that clears them without lying. Measured after the denial fix: `--identity` EXIT 2, "13 subject(s)
 * left the cohort UNACKNOWLEDGED".
 *
 * Three ways out, and only one is honest:
 *
 *   - write an affirmative "de-listed" line — FALSE. All 13 are `active` + `isLatest` upstream
 *     (ADR 0086 §1). This is the option the old denial-harvesting bug effectively took on our behalf,
 *     and refusing it is the entire point of ADR 0085/0086.
 *   - refuse to clear `unknown` too — wedges every network-free CI leg with no reachable green, for
 *     the reason `acknowledgementClears` already documents.
 *   - teach the gate to read the acknowledgement the corpus ALREADY WROTE: "evicted by the cap".
 *
 * This is the third. ADR 0086 §4 states the cause for each of the 13 in exactly that form; the gate
 * simply could not read it. Making a mechanism able to see a record that already exists is not
 * widening what can be cleared — it is closing the gap between what a human recorded and what the
 * gate can observe.
 *
 * WHAT THIS CHANNEL DOES NOT DO. It is not a de-listing acknowledgement and must never be read as
 * one: it asserts a fact about OUR window (ADR 0074's alphabetical cap moved past the subject), not a
 * fact about the publisher. So it is harvested separately, cleared separately
 * (`acknowledgementClears`), and printed on its own line by the gate — never folded into the
 * de-listing set, whose whole meaning is "the publisher withdrew this."
 *
 * WHY IT STILL CANNOT CLEAR AN `evicted` DEPARTURE. `acknowledgementClears` refuses that class
 * outright and this change does not touch that refusal. An `evicted` classification requires a SOURCE
 * VIEW proving the subject is live upstream; when we have that, the departure is explained by
 * measurement and needs no prose. This channel clears only `unknown` — the network-free case, where a
 * human has recorded the cap as the cause and the source has not been consulted. The cause therefore
 * still prints as unestablished, exactly as a de-listing acknowledgement of an `unknown` does.
 */
const EVICTION_CUES = [
  "evicted by the cap",
  "evicted by adr 0074",
  "evicted by the alphabetical cap",
  "evicted by our cap",
] as const

/**
 * Harvest acknowledged CAP EVICTIONS from one ADR's text, line by line.
 *
 * Same line-level, normalise-then-match shape as the de-listing harvest, and the same fail-toward-
 * refusal posture: an unrecognised phrasing leaves the gate red asking a human, never silently clear.
 * The cue list is deliberately narrow — it names ADR 0074's cap specifically, so a loose sentence
 * about something being "evicted" in another sense cannot acknowledge a cohort departure.
 */
export function harvestAcknowledgedEvictions(text: string): Set<string> {
  const found = new Set<string>()
  const NAME = /`([a-z0-9][a-z0-9._-]*\/[a-z0-9._-]+)`/gi
  for (const line of text.split("\n")) {
    const normalised = line
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase()
    if (!EVICTION_CUES.some((cue) => normalised.includes(cue))) continue
    // The name is read from the RAW line (backticks intact) — the cue match is what the normalised
    // form is for. Reading names from the stripped line would harvest every bare word with a slash.
    for (const m of line.matchAll(NAME)) found.add(m[1]!)
  }
  return found
}

/**
 * Compare the committed cohort's name set against its own previous revision.
 *
 * Pure-ish by construction: the current bytes are read from disk, the previous from git. Both are
 * parsed by the same function, so a shape change cannot make one side silently empty.
 *
 * `source` defaults to `null`, which yields `unknown` for every departure. That default is the
 * conservative one and it is deliberate: this runs on CI legs with no network guarantee, and the
 * alternative — inferring a class from committed bytes alone — is how ADR 0085 printed a de-listing
 * for a version bump.
 */
export function checkCohortIdentity(
  snapshotPath: string = SNAPSHOT_PATH,
  source: SourceView = null,
): IdentityOutcome {
  const abs = path.join(repoRoot, snapshotPath)
  if (!existsSync(abs)) {
    return { kind: "refused", reason: `${snapshotPath} not found — nothing to compare` }
  }

  const prev = previousRevisionOf(snapshotPath)
  if ("reason" in prev) return { kind: "refused", reason: prev.reason }

  let currentNames: string[]
  let previousNames: string[]
  try {
    currentNames = namesFromSnapshotBytes(readFileSync(abs, "utf8"), `${snapshotPath} at HEAD`)
    previousNames = namesFromSnapshotBytes(prev.raw, `${snapshotPath} at ${prev.rev.slice(0, 8)}`)
  } catch (err) {
    return { kind: "refused", reason: (err as Error).message }
  }

  const current = new Set(currentNames)
  const previous = new Set(previousNames)

  // A SET DIFFERENCE, which is the whole correction: `refreshFromMirror.ts:275` already computes
  // `absentFromSource` this way for the mirror path, and the fetchRegistry → snapshot → bake path
  // this snapshot came from had no withdrawal concept at all. Same question, two answers, and the
  // serving plane was asking the path that could not answer ([[assert-which-source-answered]]).
  const lost = previousNames.filter((n) => !current.has(n)).sort()

  return {
    kind: "checked",
    lost,
    departures: lost.map((n) => classifyDeparture(n, currentNames, source)),
    gained: currentNames.filter((n) => !previous.has(n)).sort(),
    previousRevision: prev.rev,
    previousCount: previous.size,
    currentCount: current.size,
  }
}

/** Human-readable rendering. Kept next to the check so the message and the measure cannot drift. */
export function formatIdentityOutcome(outcome: IdentityOutcome): string {
  if (outcome.kind === "refused") {
    return `◇ COHORT IDENTITY: REFUSED — ${outcome.reason}`
  }
  const { lost, gained, previousRevision, previousCount, currentCount } = outcome
  const head = `cohort ${previousCount} → ${currentCount} since ${previousRevision.slice(0, 8)}`
  if (lost.length === 0) {
    return `✓ COHORT IDENTITY: no subject left the cohort (${head}, +${gained.length} gained)`
  }
  // CLASS FIRST, then the name (ADR 0085 D2). The old line read `LOST: <name>` for all four causes,
  // which is exactly how a version bump got reported as a de-listing: the label asserted the one
  // conclusion the check had not made. `why` is printed on every row, including `unknown`, because a
  // class without its evidence is the bare fact this ADR exists to stop reprinting.
  const rows = outcome.departures.map((d) => `    ${d.class.toUpperCase()}: ${d.name} — ${d.why}`)
  const counts = new Map<DepartureClass, number>()
  for (const d of outcome.departures) counts.set(d.class, (counts.get(d.class) ?? 0) + 1)
  const tally = [...counts].map(([c, n]) => `${n} ${c}`).join(", ")

  const superseded = outcome.departures.filter((d) => d.class === "superseded")
  const unknown = outcome.departures.filter((d) => d.class === "unknown")

  return (
    `⚠ COHORT IDENTITY: ${lost.length} subject(s) LEFT the cohort (${head}, +${gained.length} gained)\n` +
    `  Classified (ADR 0085 D2): ${tally}\n` +
    rows.join("\n") +
    `\n  A count cannot see this: ${lost.length} lost against ${gained.length} gained nets ` +
    `${gained.length - lost.length >= 0 ? "+" : ""}${gained.length - lost.length}, so the ratchet stays green.\n` +
    (superseded.length > 0
      ? `  ⚠ ${superseded.length} SUPERSEDED — this class is a DEFECT IN THIS SYSTEM, not a publisher\n` +
        `  action. ADR 0085 D1 removed the mechanism (a content hash chose which version represented\n` +
        `  a subject, dropping 58 of 293 live subjects). Its recurrence means D1 regressed or a new\n` +
        `  path reintroduced the same drop — do NOT acknowledge it as a de-listing.\n`
      : ``) +
    (unknown.length > 0
      ? `  ◇ ${unknown.length} UNKNOWN — the source was not consulted, so these are UNCLASSIFIED, not\n` +
        `  cleared and not confirmed. Per ADR 0082 an unknown is not a flavour of the other three:\n` +
        `  re-run with a source view before treating any of them as a de-listing.\n`
      : ``) +
    `  Per ADR 0084 D4 this is REPORTABLE, not automatically a fault: a publisher may legitimately\n` +
    `  pull their server. What is illegitimate is it happening unobserved. Acknowledge it in the ADR.`
  )
}
