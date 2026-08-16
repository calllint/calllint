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
  const maxServed = currentNames.length > 0 ? [...currentNames].sort().at(-1)! : null
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
        `still \`active\` upstream, and sorts after the last served name (\`${maxServed}\`) — ` +
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
export function acknowledgementClears(d: Departure, acknowledged: ReadonlySet<string>): boolean {
  if (d.class === "superseded" || d.class === "evicted") return false
  return acknowledged.has(d.name)
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
