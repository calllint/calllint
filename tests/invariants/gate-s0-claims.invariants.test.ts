import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
// The real evaluator, not a re-implementation. A control that re-derives the gate's logic proves the
// control's logic (S0-OPEN-5's "not merely a comment claiming the parse happens").
import { evaluateNoRegression, type AggregatorReach, type ToolNameSources } from "@calllint/trust-index"
// Today's served cohort cap, imported for the same reason as the evaluator above: the cap is a
// FUNCTION of the committed count since the Cumulative Coverage Amendment, and a test that
// re-derived that curve would agree with its own copy rather than with the shipped one (ADR 0091).
import { servedCohortCap } from "../../packages/trust-index/src/fetchRegistry.js"

// The FIRST machine reader of `artifacts/gate-s0/**`, and the first machine reader of ANY Gate S0
// status record.
//
// Before this file, S0's status lived only in `docs/gate-s0-next.md` — gitignored. So the status of
// the gate that decides whether the registry-expansion axis may proceed existed on exactly one
// machine, in bytes no other clone and no reader could see. `grep -rn "S-OPEN"` returned zero: unlike
// Workstream M, S never got an `open-items.md` at all.
//
// That is M26-3's finding recurring in a second workstream, and one level worse. M26-3 found a
// corrected claim that reached only the copy something read; here the only copy is unreadable to
// everything, including a second checkout. The recorded blocker reason was false as a result —
// `docs/gate-s0-next.md:64` reads "cohort size 19/25, cannot satisfy S0's 25-record requirement",
// framed as an upstream shortage, while upstream holds 19_739 live names. Nothing could have caught
// that, because nothing read it.
//
// NOTHING HERE OPENS A SOCKET (INV-M4), and nothing here runs `gate:s0`. Running it would read
// `apps/web/public/trust/index.json` and make this suite depend on baked bytes — a served artifact
// this workstream must not couple a test to. So the assertions below are over S0's COMMITTED SOURCE
// and the artifact that describes it, which is what keeps the record from drifting from the gate.
//
// THREE LAYERS, each a claim the other two cannot make:
//   1. POINTER TRUTH — every `path:line` the artifact cites must still point at what it claims.
//      Line numbers drift silently; M26-3's equivalent layer caught a pointer at a BLANK LINE.
//   2. DERIVED-NOT-RESTATED — every number the artifact states is recomputed from the file it is
//      about. A record that restates a constant agrees with it when it changes.
//   3. ROW STATUS — each row's `**Status:**` is asserted verbatim, so a batch that closes a row by
//      deleting it, or leaves a closed row reading OPEN, reds by name.
const repoRoot = new URL("../../", import.meta.url)

/**
 * Thirteen agreeing tool names, for the cases below that are about something else.
 *
 * Synthetic on purpose: a test whose subject is a YAML parse failure must not also depend on the real
 * tool table, or a rename would red it and send the next reader to the wrong file. The 13 matches the
 * count these cases pass as `toolCounts`, because `mcp-tool-names-agree` compares the name arity
 * against the agreed count and would otherwise fail for a reason the case is not about.
 */
const AGREEING_TOOL_NAMES: ToolNameSources = {
  declared: [...Array(13)].map((_, i) => `tool_${i}`),
  enumerated: [...Array(13)].map((_, i) => `tool_${i}`),
}

/**
 * Read a repo-relative text file, with CRLF normalized to LF.
 *
 * Load-bearing here, unlike in the M26-3 reader next door, and measured rather than assumed with
 * `git check-attr text eol`:
 *   - `artifacts/gate-s0/**` is pinned `text eol=lf` by this batch, for the reason M26-0's pin
 *     comment names — but nothing hashes these bytes yet, so the pin is unguarded on its own.
 *   - `scripts/gate-s0.ts`, `package.json`, `.github/workflows/trust-ingest.yml` and the
 *     `packages/**` sources read below are `unspecified`. On a windows-latest checkout they arrive
 *     CRLF.
 *
 * Layer 1 splits those files on "\n" and asserts a line's CONTENT, and layer 2 matches numbers
 * inside them. A trailing `\r` sits past a `toContain` match but WOULD break an exact compare, and
 * ADR 0064 §6.2 was paid for by a gate that sliced un-normalized source, got -1 from `indexOf`,
 * silently widened its scope via `slice(start, -1)`, and then reported the defect in the wrong
 * method. Normalizing at the reader makes that class unreachable rather than relying on every
 * future assertion being accidentally `\r`-tolerant.
 *
 * MEASURED, and it corrected the claim this docblock first made. Control #181 converted the
 * artifact to CRLF *and* deleted this `.replace`, and all 14 tests still passed. Two reasons, both
 * accidental: JS treats `\r` as a line terminator under `/m`, so every `^...$` assertion here is
 * `\r`-tolerant for free, and `toContain` never sees the trailing byte. So normalization is
 * defense-in-depth for assertions not yet written — NOT what keeps this suite honest today, and a
 * docblock claiming otherwise would be the same class of unread false claim this batch exists to
 * fix. The `eol=lf` pin is therefore guarded by the explicit CR-byte assertion below, which is the
 * only thing here that fails when the pin is removed.
 */
const readRaw = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, repoRoot)), "utf8")

const readText = (rel: string): string => readRaw(rel).replace(/\r\n/g, "\n")

const ARTIFACT = "artifacts/gate-s0/open-items.md"
const GATE = "scripts/gate-s0.ts"
const WORKFLOW = ".github/workflows/trust-ingest.yml"

/**
 * Slice one `## S0-OPEN-N` row out of the artifact, asserting BOTH boundaries.
 *
 * A bare `indexOf` + `slice` is the shape ADR 0064 §6.2 forbids: a missing end marker yields -1,
 * `slice(start, -1)` silently widens the row to the whole rest of the file, and every assertion
 * over it then passes against text from a DIFFERENT row. So both ends are asserted before the cut,
 * and the last row is sliced to end-of-file explicitly rather than by falling through to -1.
 */
function row(n: number): string {
  const text = readText(ARTIFACT)
  const start = text.indexOf(`## S0-OPEN-${n}`)
  expect(start, `${ARTIFACT} must carry a "## S0-OPEN-${n}" heading`).toBeGreaterThan(-1)
  const nextIdx = text.indexOf(`## S0-OPEN-${n + 1}`)
  const end = nextIdx === -1 ? text.length : nextIdx
  expect(end, `the S0-OPEN-${n} row must not be empty`).toBeGreaterThan(start)
  return text.slice(start, end)
}

/**
 * Assert a `path:line` pointer resolves to a line CONTAINING `expected`.
 *
 * Asserting only that the line exists is satisfied by a BLANK line — the exact defect M26-3's
 * equivalent layer was written to catch (`server.ts:61` was blank; the real location was 171). So
 * the assertion is on the line's content, and the failure prints what actually sits there.
 */
function assertPointer(path: string, lineNo: number, expected: string, label: string): void {
  const lines = readText(path).split("\n")
  expect(
    lineNo,
    `${label}: line ${lineNo} is past the end of ${path} (${lines.length} lines)`,
  ).toBeLessThanOrEqual(lines.length)
  const actual = lines[lineNo - 1] ?? ""
  expect(
    actual,
    `${label}: ${path}:${lineNo} should contain ${JSON.stringify(expected)}, but that line reads ${JSON.stringify(actual)}`,
  ).toContain(expected)
}

describe("Gate S0 — the status record is parsed, and it is not degenerate", () => {
  // VACUITY GUARD, and it runs before any absence is asserted below. Every "the artifact does not
  // say X" assertion in this file is vacuously true against an empty or missing file, so the size
  // and row count are pinned first. [[absence-makes-a-gate-skip-itself]].
  it("the artifact parses, carries all five rows, and is substantial", () => {
    const text = readText(ARTIFACT)
    expect(text.length, "an empty artifact makes every absence assertion below vacuous").toBeGreaterThan(
      4000,
    )
    const headings = [...text.matchAll(/^## S0-OPEN-(\d+)/gm)].map((m) => m[1])
    expect(headings, "all five rows must be present, in order").toEqual(["1", "2", "3", "4", "5"])
    // Set equality over statuses, not `.every()`: a boolean collapse prints "expected false to be
    // true" with no name on it, and passes vacuously on an empty array.
    //
    // The status line is matched to end-of-line rather than as a bare `\w+`: S0-OPEN-3 closed at S
    // batch 1 and its status carries a date and an ADR reference after the word. A `(\w+)$` pattern
    // silently matched ZERO statuses on those bytes, and set-equality against a 3-element literal is
    // what printed the discrepancy instead of an empty array passing something.
    //
    // The literal is POSITIONAL, and that is the point: it names WHICH row moved. S batch 2 closed
    // S0-OPEN-2 and this assertion red with `['OPEN','CLOSED','CLOSED','OPEN']` against the previous
    // expectation — pointing at index 1, not at "a status changed somewhere". A `.filter(s => s ===
    // "OPEN").length` form would have printed `expected 2 to be 3` and left which row to a human.
    //
    // The fifth element arrived with S0-OPEN-5 in the same batch's post-push correction. Appending a
    // row is a deliberate edit to this literal, which is the property worth keeping: a row that
    // appears without one is a row nothing agreed to. S batch 3 closed S0-OPEN-5, which red this
    // assertion at index 4 — exactly the behaviour the positional form exists for.
    //
    // S batch 6 red it at index 4 again, for a DIFFERENT reason worth writing down: an amendment
    // appended to S0-OPEN-4 opened with its own `**Status:**` marker, so the extractor found SIX
    // markers across five rows and the sixth displaced the fifth row's. The count is load-bearing
    // beyond drift detection — `**Status:**` is a per-row token, and an amendment that reuses it
    // makes the artifact claim a row it does not have. The fix was to the prose, not to this literal.
    // Index 0 flipped OPEN → CLOSED on 2026-08-13, and the positional form did its job a third
    // time: it named row 1 rather than reporting "a status changed somewhere".
    //
    // Index 3 flipped OPEN → CLOSED on 2026-08-31, a FOURTH deliberate edit, and it closed the last
    // open row: this artifact is now all-CLOSED. That is worth stating rather than letting an
    // all-`CLOSED` array look like a default. The self page is back on `main` at cohort 150 (both
    // halves of S0-OPEN-4's own restated condition), the re-armed guards were negative-controlled
    // rather than trusted for being green, and Gate 2.4-B's panel was re-run — the one remedy its
    // 2026-08-13 amendment said no code change could supply.
    //
    // An ALL-CLOSED artifact is the state that most needs a positional literal, not the state that
    // makes one redundant: `filter(s => s === "OPEN").length === 0` would pass here too, and would go
    // on passing at every future length and every future status. The `.toEqual` pins arity and order.
    //
    // Measured, because the first draft of this comment credited it with more than it does: appending
    // a sixth row reds the ROW-NUMBER assertion above (`['1'…'6']` vs `['1'…'5']`), not this line —
    // a new row carrying `**Status:** **OPEN**` keeps this array's first five elements intact. Two
    // assertions cover the append case and only one of them is this one. What THIS line uniquely
    // refuses is a status flipped in place, which is what control #A exercised.
    //
    // S0-OPEN-4's own closure amendment records the matching gap one level up — nothing fires when a
    // row's closing condition becomes TRUE, so the row waits rather than watches.
    const statuses = [...text.matchAll(/^\*\*Status:\*\* (?:\*\*)?(\w+)/gm)].map((m) => m[1])
    expect(
      statuses,
      "each row states a status; all five are CLOSED as of 2026-08-31 (4 closed last, 1 on 2026-08-13, 2/3/5 earlier) — a sixth element means a row was appended without one",
    ).toEqual(["CLOSED", "CLOSED", "CLOSED", "CLOSED", "CLOSED"])
  })

  // THE ONLY ASSERTION HERE THAT READS THE `eol=lf` PIN, and it exists because control #181 proved
  // nothing else did: with the artifact converted to CRLF and `readText`'s normalization deleted,
  // all 14 tests passed. `.gitattributes` gained `artifacts/gate-s0/** text eol=lf` in this batch,
  // and [[served-asset-source-split-pattern]] is blunt about what that is worth on its own — "a pin
  // no gate reads is unguarded". Four artifact directories above it are pinned with no reader at
  // all; this is the first one whose pin fails something.
  //
  // Deliberately over the RAW bytes: `readText` would strip exactly what is being counted.
  it("the artifact is committed and checked out LF-only, which is what the eol=lf pin promises", () => {
    const raw = readRaw(ARTIFACT)
    const crs = (raw.match(/\r/g) ?? []).length
    expect(
      crs,
      `${ARTIFACT} carries ${crs} CR bytes — the eol=lf pin in .gitattributes is missing, unmatched, or the file was committed with CRLF already normalized in the index`,
    ).toBe(0)
  })
})

describe("Gate S0 — every path:line the record cites still points at what it claims", () => {
  it("the gate's own constants are where S0-OPEN-1 says they are", () => {
    // Drifted at S batch 1 (was :45 / :52 / :234). The EXECUTED tier added imports and a runner, so
    // every line below the docblock moved. This is `assertPointer` earning its keep: it asserts the
    // line's CONTENT, so the drift red with the real line quoted instead of passing on a line that
    // happened to exist. S0-OPEN-1's prose was corrected to match, and the old numbers are recorded
    // in its amendment rather than silently replaced — the third batch running to find drift this way.
    // Drifted AGAIN in S batch 2 (59→90, 66→124, 498→568): the docblock gained the third mode's
    // justification and `S0_REGRESSION_FLOOR` was inserted between the two constants. That is the
    // fourth consecutive batch to move these, which is the empirical case for content-addressed
    // pointers — and the reason every one of those drifts has been HARMLESS is that `assertPointer`
    // matches content: :59 now holds docblock prose, so an existence-only check would have passed.
    // DRIFTED A FIFTH TIME, in the ADR 0083 batch (90→95, 108→123, 124→163, 568→607): the gate
    // gained `committedRegistryCohort` plus the docblocks explaining why the load-time coherence
    // check no longer reads `S0_REQUIRED_RECORDS`. Same harmless drift as the four before it, caught
    // the same way — the failure quoted `"/**"`, the docblock prose now sitting at :90.
    //
    // ONE ANCHOR ALSO CHANGED VALUE, and unlike the line numbers that is a decision, not drift: this
    // read `S0_REGRESSION_FLOOR = 25`. ADR 0083 D2 advanced the ratchet to 100 to follow the cohort,
    // so the anchor follows. It stays value-pinned (unlike `DEFAULT_MAX_ENTRIES` below, whose value
    // was deliberately dropped from its anchor) because a ratchet's whole failure mode is being
    // edited DOWNWARD quietly — the derived assertion further down is the primary guard against
    // that, and this pointer is a second, cheaper reader of the same literal.
    // DRIFTED A SIXTH TIME, in the ADR 0084 batch (95→96, 123→124, 163→164, 607→650): the gate gained
    // `--identity`'s docblock, the `acknowledgedDelistings()` reader, and the identity print block. The
    // failure quoted `" */"` at :95 — docblock prose again — which is the sixth consecutive time this
    // mechanism has reported drift by naming what it actually found instead of passing on a line that
    // merely exists. Six batches is no longer anecdote: the *pointers* are the fragile part, and their
    // content anchors are the only reason each drift has been harmless.
    // A SEVENTH TIME, in the ADR 0085 D2 batch (96→100, 124→128, 164→168, 650→664): the gate's
    // `cohort-identity.js` import expanded to three lines to take `acknowledgementClears`, and the
    // scoping note was added to `acknowledgedDelistings`'s docblock. The failure quoted the
    // `S0_REQUIRED_RECORDS` docblock's own prose at :96 — prose for the third consecutive drift, which
    // is what an anchor pinned one line above a constant will always eventually catch.
    // AN EIGHTH TIME, in the ADR 0088 batch (100→102, 128→130, 168→170, 664→695): the gate took a
    // second import line (`harvestAcknowledgedDelistings`, `harvestAcknowledgedEvictions`) and the
    // `acknowledgedEvictions()` reader with its docblock. The failure quoted `" * to whatever happens
    // to be committed."` at :100 — docblock prose for the FOURTH consecutive drift. Eight batches, and
    // every single one was reported by the content anchor rather than by a line number that happened
    // to still exist. The pointers are the fragile part; the anchors are why the fragility is harmless.
    // THE FLOOR ANCHOR DROPS ITS VALUE (ADR 0091), joining `DEFAULT_MAX_ENTRIES` below. The reason it
    // kept one — "a ratchet's whole failure mode is being edited DOWNWARD quietly" — is now served by
    // two stronger readers: the derived equality further down, which pins the floor to the committed
    // cohort exactly, and the gate's own load-time coherence check, which exits 2 on a floor above the
    // cohort. Neither can be satisfied by a quiet downward edit.
    //
    // Keeping the value here would instead have made this pointer red on every scheduled ingest, since
    // the floor now advances weekly with the cohort — the same recurring-red defect this batch exists
    // to remove, reintroduced by a second reader that only ever checked that a literal had not moved.
    //
    // A TENTH TIME, in the Gate S1 batch (102→134, 130→162, 170→202, 695→727): `gate-s0.ts`'s docblock
    // took the 2026-08-28 amendment recording that `--gate` now exits **0** — two of its sentences had
    // told every reader the enforcing mode was expected to fail for a fortnight after S0-OPEN-1 closed.
    // Tenth consecutive drift, tenth harmless one, and reported the same way: the failure quoted
    // ` * \`docs/new15-execution-status.md\`. So nothing red at the crossing…` sitting at :102, prose for
    // the fifth consecutive time. Worth one more line because of WHAT the amendment says: the staleness
    // it corrects is the same fault class as a pointer that resolves to a line which merely exists.
    assertPointer(GATE, 134, "S0_REQUIRED_RECORDS = 25", "S0_REQUIRED_RECORDS")
    assertPointer(GATE, 162, "S0_REGRESSION_FLOOR", "S0_REGRESSION_FLOOR")
    assertPointer(GATE, 202, "FIXTURE_PREFIX", "FIXTURE_PREFIX")
    // Drifted a SECOND time inside S batch 1, 401 → 498, when `stripComments` became string-aware; then
    // 568, then 607, then 650, then 664, then 695, now 727. Worth noting because it is the argument for
    // content-addressed pointers rather than line numbers: this one number has moved eight times, and
    // every time the failure named what it found.
    assertPointer(GATE, 727, "registryShort", "the shortfall computation")
  })

  it("the cap the record exonerates, and the un-paginated GET that exonerates it", () => {
    const f = "packages/trust-index/src/fetchRegistry.ts"
    // MOVED 19 → 34 by ADR 0074's docblock, and the ANCHOR CHANGED SHAPE with it. It used to read
    // `DEFAULT_MAX_ENTRIES = 25`, pinning the declaration and its value in one string. The value is
    // now the thing expected to move again (100 → 500 → all), so the anchor is the declaration
    // alone; the value is asserted as a relationship by the inequality test below, and by
    // `tests/invariants/registry-cohort-retention.invariants.test.ts`.
    assertPointer(f, 34, "export const DEFAULT_MAX_ENTRIES", "the cohort cap")
    // ANCHOR RETIRED IN S BATCH 6 (ADR 0075). This read `assertPointer(f, 124, ".slice(0, max)")`
    // — "the cap applied after the sort", the last hop of `map -> filter -> sort -> slice` at the
    // ingest edge. That CHAIN is gone: the bare slice was replaced by `selectCohortEntries`, which
    // reserves `RESERVED_COHORT_NAMES` against the cap so the claimed subject is not evicted at
    // `cap + 1`. Note what is NOT true, because the first draft of this comment claimed it: the
    // string `.slice(0, max)` still EXISTS in this file, at :90, inside the new function — what
    // changed is what it slices (`byName.filter(isReserved)`, not the whole sorted cohort). An
    // anchor retired for "the string vanished" would be falsifiable by grep; retired because the
    // CLAIM it carried is no longer what that line says is the accurate reason, and it is why a
    // content-matching pointer catches this: it red with `"      }"` quoted, not on a live line.
    // DRIFTED A NINTH TIME, in the ADR 0091 batch (81→120, 103→142, 229→268, 224→263): `servedCohortCap`
    // and its docblock were added directly below `CUMULATIVE_COVERAGE_CEILING`, pushing everything after
    // it down by 39 lines. `DEFAULT_MAX_ENTRIES` at :34 sits ABOVE the insertion and did not move —
    // which is the ninth consecutive time the content anchors, not the line numbers, are what made a
    // drift harmless. Note this drift was caused by the batch that FIXED a recurring-red defect: even a
    // change whose whole purpose is removing brittleness moves lines, so the anchors earn their keep.
    assertPointer(f, 120, "RESERVED_COHORT_NAMES", "the names the cap may not evict")
    assertPointer(f, 142, "export function selectCohortEntries", "the reserved-first cap")
    // Moved 226 → 229 by Cumulative Coverage Amendment: added retainedNames parameter + logic (+3 lines).
    assertPointer(f, 268, "selectCohortEntries(", "the cap applied after the sort, at the ingest edge")
    // The load-bearing one: a SINGLE GET with no cursor. This is why the 25 cap cannot be the
    // constraint that produced 19 — it is not even on the production path. Drifted 115 → 177 → 183
    // in S batch 6, the FIFTH consecutive batch to move a pointer in this test — and it moved TWICE
    // within the batch. The second move was my own: negative control #214 showed the `Math.max(0, …)`
    // clamp had no failing mode AND that both copies' comments named a precondition that cannot
    // occur, so rewriting those six comment lines pushed every anchor below them down by six. Worth
    // recording rather than silently renumbering: a pointer's most likely mover is the batch that is
    // currently editing the file, not some future one, and content matching is what turned that into
    // a red line quoting `""` instead of a pointer that still resolved to a plausible-looking line.
    // Moved 183 → 224 by Cumulative Coverage Amendment: added retainedNames three-tier logic (+41 lines).
    assertPointer(f, 263, "doFetch(endpoint)", "the single un-paginated GET")
  })

  it("the measured upstream size, which is what falsifies the recorded reason", () => {
    assertPointer(
      "packages/adoption-index/src/identity/resolveIdentity.ts",
      16,
      "19_739",
      "the live cohort size",
    )
    // Moved 56 → 74 by ADR 0085's guard: the header docblock gained the paragraph naming the two
    // fail-closed guards as distinct subjects (`assertMirrorComplete` reads, `assertCohortConserved`
    // projects), and every anchor below it shifted by eighteen. Re-pinned, not loosened to a search,
    // for the reason the sibling row above already records — and the mover was again the batch
    // editing the file, which is the pattern [[a-pointer-rots-faster-than-its-claim]] predicts.
    assertPointer(
      "packages/adoption-index/src/operations/refreshFromMirror.ts",
      74,
      "65235",
      "the exhaustive walk",
    )
  })

  it("the served-cohort knob, and the workflow line that now exposes it", () => {
    // Moved 143 → 144 by ADR 0085's conservation log line: `refreshSnapshot.ts` gained ONE import
    // (`describeCohortConservation`) and every anchor below it shifted by one. Re-pinned rather than
    // loosened to a search, for the reason the two rows above already record — and the mover was
    // once again the batch editing the file, which is what [[a-pointer-rots-faster-than-its-claim]]
    // predicts. This guard catching a one-line import is the guard working, not a nuisance.
    // Moved 170 → 172 by Cumulative Coverage Amendment: added 2 lines to resolveMaxEntries docblock
    // for the gate's expected claim strings (workflow_dispatch input, ONLY knob).
    // Moved 181 → 188 by the compiler-run bookkeeping batch: `refreshSnapshot.ts` gained seven lines
    // above this anchor — the `beginCompilerRun` / `concludeCompilerRun` / `emptyRunMetrics` /
    // `gradeRun` / `writeRunReport` / `RUN_REPORT_SCHEMA` imports and the `CompilerRunMetrics` type.
    // Re-pinned, not loosened to a search, for the reason the rows above record; and the mover is once
    // again the batch editing the file, which is what [[a-pointer-rots-faster-than-its-claim]]
    // predicts. A guard that catches six added imports is the guard working.
    assertPointer("packages/trust-index/src/refreshSnapshot.ts", 188, "resolveMaxEntries", "the knob")
    assertPointer(WORKFLOW, 20, "workflow_dispatch:", "the dispatch trigger")
    // Moved 73 → 112 by the `inputs:` block this row's remedy called for, then 112 → 127 by ADR 0087's
    // batch: the job gained the `TRUST_INGEST_NOW` pin after checkout and the `:store` → pure-variant
    // comment block. The pointer is re-pinned rather than loosened to a search: a `path:line` that
    // drifts silently is the defect [[a-pointer-rots-faster-than-its-claim]] records, and 5 of 6
    // pointers had drifted that way.
    //
    // Moved 127 → 160 by the `pnpm build` step added ahead of the ingest: two scheduled runs
    // (32004879519, 32700871694) had died at the phase-2.4 refresh on `missing apps/cli/dist/index.js`,
    // BEFORE the PR-opening step, so the cohort sat frozen at 100 for two weeks with no red PR to
    // notice. The mover is once again the batch editing the file — the pattern that row predicts.
    assertPointer(WORKFLOW, 160, "ingest:trust-index", "the ingest step")
  })
})

describe("Gate S0 — every number the record states is derived from the file it is about", () => {
  it("S0_REQUIRED_RECORDS and DEFAULT_MAX_ENTRIES are NO LONGER the same number, and the record says so", () => {
    const required = /S0_REQUIRED_RECORDS\s*=\s*(\d+)/.exec(readText(GATE))?.[1]
    const cap = /DEFAULT_MAX_ENTRIES\s*=\s*(\d+)/.exec(
      readText("packages/trust-index/src/fetchRegistry.ts"),
    )?.[1]
    expect(required, "the gate must still define S0_REQUIRED_RECORDS at all").not.toBeUndefined()
    expect(cap, "and fetchRegistry must still define DEFAULT_MAX_ENTRIES at all").not.toBeUndefined()
    // ORDER IS STILL LOAD-BEARING, and the reasoning survives the inversion that S batch 5 made to
    // this test. The RELATIONSHIP is asserted before any literal pin, because a literal pinned
    // first makes the relationship unreachable: any mutation moving either constant reds on the
    // literal, so the claim the row rests on could never be the one that fails
    // ([[assertion-order-decides-falsifiability]]).
    //
    // WHAT INVERTED (ADR 0074). This previously asserted `cap === required` — both 25 — and called
    // that a coincidence worth recording. It was worse than a coincidence: the cohort size that
    // satisfied Gate S0 was the size at which the cap began evicting, and the evicted entry was
    // this project's own trust page. S batch 5 raised the cap to break the equality, so the
    // assertion is now the inequality and a revert reds HERE, by name.
    expect(
      Number(cap),
      `the served cap (${cap}) must stay STRICTLY ABOVE S0's requirement (${required}). At equality, closing S0's shortfall is the same action that evicts io.github.calllint/calllint — see ADR 0074 and S0-OPEN-4 before changing either`,
    ).toBeGreaterThan(Number(required))
    // The requirement's literal, after the relationship. The cap is deliberately NOT pinned to a
    // literal: it is the number ADR 0074 expects to move again (100 → 500 → all), and a pin would
    // red on a legitimate expansion while saying nothing about the property that matters.
    expect(required, "S0-OPEN-1's prose says 25; a moved requirement makes that prose stale").toBe("25")
    // The row's own boundary prose, which the 2026-08-11 amendment corrected rather than rewrote:
    // the original paragraph still argues the two numbers are equal, so the amendment must be
    // present for the record to be readable at all.
    expect(row(1)).toContain("25 is also exactly the boundary")
    expect(
      row(1),
      "S0-OPEN-1's boundary paragraph claims the cap IS 25; the ADR 0074 amendment must be appended or the row reads as current",
    ).toMatch(/AMENDED 2026-08-11.*ADR 0074/s)
  })

  it("the committed snapshot's `count` is not a hand-edited number, and the cohort never falls under the ratchet", () => {
    // Derived from the snapshot, never restated: `count` and the actual array length are asserted
    // SEPARATELY, because a hand-edited `count` is exactly the shape that would make this record
    // read as satisfied while the cohort had not moved.
    const snap = JSON.parse(
      readText("packages/trust-index/snapshots/official-mcp-registry.json"),
    ) as { fetchedAt: string; count: number; entries: readonly unknown[] }
    expect(snap.entries.length, "count must equal the real entry count").toBe(snap.count)
    // AMENDED BY ADR 0083 D3. This pinned `count` to 25 and `fetchedAt` to the 2026-08-10 instant,
    // with the message "the committed snapshot must stay at 25 (the S0 cohort requirement)". Both
    // literals described the PR #234 MERGE EVENT this assertion was written to verify. The cohort
    // has since moved to 100 by an authorized re-ingest (S0-OPEN-4 closure), so the pins asserted
    // that an INTENDED change had not happened — a stale literal reading as a guard.
    //
    // Replaced by the ratchet, read out of the gate rather than restated here, so one authorized
    // ingest updates one place: the floor advances, and this follows it. The direction is what
    // matters — a cohort BELOW the floor is a lost record, a cohort above it is growth the ratchet
    // has not caught up to yet, and only the former is a fault ([[top-level-guard-on-append-only-record]]).
    const ratchet = Number(
      /^const S0_REGRESSION_FLOOR = (\d+)$/m.exec(readText(GATE))?.[1],
    )
    expect(ratchet, `${GATE} must declare \`const S0_REGRESSION_FLOOR = <number>\``).not.toBeNaN()
    expect(
      snap.count,
      `the committed cohort (${snap.count}) fell below the ratchet floor (${ratchet}) — that is a LOST RECORD, not an ingest`,
    ).toBeGreaterThanOrEqual(ratchet)
    // `fetchedAt` is asserted as a well-formed ISO-8601 instant, not a specific one. It changes on
    // every legitimate ingest, so a literal here measures the timestamp of the last fetch and
    // nothing else; the SHAPE is the part a hand-edit would get wrong. Round-tripped through Date
    // rather than regex-matched, so `2026-08-32T99:99:99.999Z` fails.
    expect(snap.fetchedAt, "fetchedAt must be a well-formed ISO-8601 instant").toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    )
    // VALIDITY BEFORE ROUND-TRIP, and the negative control is why. `2026-08-32T99:99:99.999Z`
    // satisfies the regex above — the shape is right, the instant is not. Asserting the round-trip
    // directly made `.toISOString()` throw `RangeError: Invalid time value`, so the test red without
    // naming its subject or printing the offending value. A test's red must come from its own
    // assertion with its own message, never from an exception inside the expression being measured.
    expect(
      Number.isNaN(new Date(snap.fetchedAt).getTime()),
      `fetchedAt is ISO-8601-SHAPED but not a real instant: ${snap.fetchedAt}`,
    ).toBe(false)
    expect(
      new Date(snap.fetchedAt).toISOString(),
      "fetchedAt must round-trip through Date — a shaped, valid, but non-canonical instant fails here",
    ).toBe(snap.fetchedAt)
    // THE CAP STILL BINDS, and that is still the finding — but the number moved and, more
    // importantly, so did the consequence. History, kept because both inversions are the record:
    //
    //   1. The oldest comment read "19 < 25 ... the cap never bound", the arithmetic that redirected
    //      blame from the cap to the stale pipeline. True of the 19-entry snapshot, false of the 25.
    //   2. Then it asserted `count === 25` as "the cap's OUTPUT ... and the tail was truncated",
    //      adding: "113 live names sort before `io.github.calllint/calllint`, which is why this
    //      project's own page is not in these 25."
    //
    // Clause 2's last sentence is now FALSE, and falsifying it was the point of the re-ingest. The
    // cap is 100, the cohort is 100 — the cap still binds exactly — but ADR 0075's reserved
    // retention means the boundary no longer evicts the claimed subject. So the equality is kept
    // (it is what proves truncation) and the eviction claim is deleted rather than re-dated,
    // because it describes a mechanism that no longer exists at this boundary.
    //
    // Read from `fetchRegistry.ts` rather than pinned: this is the number ADR 0074 expects to move
    // again (100 → 500), and a literal would red on a legitimate expansion while saying nothing
    // about the property — that a cohort landing EXACTLY on the cap means the tail was cut.
    //
    // AMENDED BY ADR 0091. This read `DEFAULT_MAX_ENTRIES` directly, which WAS the cap until the
    // Cumulative Coverage Amendment made the cap a function of the previous run and demoted that
    // constant to the growth curve's starting point. At cohort 150 this handed the assertion 100 and
    // it red — correctly, reporting that a 100-cap cannot produce 150 entries. The subject was never
    // the constant; it is TODAY'S CAP, so today's cap is what is read now. `servedCohortCap` is
    // imported rather than re-derived here because a second copy of the curve arithmetic would agree
    // with itself instead of measuring the shipped one.
    const cap = servedCohortCap(snap.count)
    expect(cap, "the served cohort cap must be derivable from the committed count").not.toBeNaN()
    // WHAT THIS PROVES, AND WHAT IT NO LONGER PROVES. `servedCohortCap` returns the smallest curve
    // point at or above the count, so this equality now says: THE COHORT LANDS EXACTLY ON A GROWTH
    // CURVE POINT. That is still the truncation claim — a cap binding over thousands of live entries
    // fills to the cap exactly — and it still reds for a cohort that fell OFF the curve (a partial
    // fill from upstream running dry, which is a real event this must not absorb silently).
    //
    // It is weaker in one direction, stated rather than hidden: before the Amendment there was ONE
    // legal count (100), and now there are nine (100, 150 … 500). A cohort at 200 when the previous
    // run committed 100 would satisfy this while having skipped a step. That gap is closed elsewhere,
    // by the monotone advance in `advanceRatchet.ts` and its guard — not by this line pretending to a
    // precision it lost when the cap became a function.
    expect(
      snap.count,
      `this snapshot is the cap's OUTPUT: a ${cap}-cap over thousands of live entries yields exactly ${cap}, and the tail was truncated`,
    ).toBe(cap)
    // The subject the truncation used to evict is IN this cohort, at the boundary, by retention
    // rather than by luck. Asserted here as the counterpart to the deleted claim — the presence
    // itself is guarded properly (set form, plus its alphabetical last place) in
    // `registry-cohort-retention.invariants.test.ts:261`, so this is a one-line cross-check and not
    // a second, weaker copy of that guard.
    expect(
      (snap.entries as readonly { name?: string }[]).filter(
        (e) => e.name === "io.github.calllint/calllint",
      ),
      "the cap binds at exactly the cohort size, so ADR 0075 retention is the only thing keeping the claimed subject in — if this reds, the reserved list stopped being read",
    ).toHaveLength(1)
  })

  it("ci:local's step count is counted, not quoted, and now INCLUDES the gate's regression mode", () => {
    const pkg = JSON.parse(readText("package.json")) as {
      scripts: Record<string, string | undefined>
    }
    const ciLocal = pkg.scripts["ci:local"]
    // Asserted rather than `!`-asserted: a renamed or deleted `ci:local` is a real event, and it
    // should red HERE with that name on it instead of throwing "cannot read properties of
    // undefined" from inside a `.split()` two lines later.
    expect(ciLocal, "S0-OPEN-2 is about ci:local; package.json must still define it").toBeTypeOf(
      "string",
    )
    const steps = (ciLocal ?? "").split("&&").map((s) => s.trim()).filter(Boolean)
    // The EXCLUSION is asserted before the count, for the reason the coincidence is asserted before
    // its literals: adding `gate:s0` to `ci:local` also changes the count, so a count-first order
    // reds with "expected 20 to be 19" and never mentions that the row's entire subject — the gate
    // being outside `ci:local` — just stopped being true. Measured, not assumed: control #179 did
    // exactly that. Set form over `.every()` so the failure prints WHICH step arrived
    // ([[every-collapses-the-observed-value]]).
    // INVERTED IN S BATCH 2, and the inversion is the interesting part of this test's history.
    //
    // This assertion previously required `[]` — no `gate:s0` step in `ci:local` — with the message
    // "that closes S0-OPEN-2, so amend the row instead of leaving it OPEN". Wiring the gate red it
    // exactly as designed, naming the row's subject instead of an off-by-one. So the test did its
    // job; what changed is which state is correct. It now asserts the OPPOSITE, because a row that
    // has closed must not keep a guard that reds when its remedy is present.
    //
    // The set form is kept ([[every-collapses-the-observed-value]]) and so is the exclusion-before-
    // count ordering: `gate:s0:gate` must NEVER appear here. That mode is red on `main` for the
    // cohort shortfall, so wiring it would pin `ci:local` red for a reason no PR can clear — the
    // hazard the original comment was really guarding against, now stated precisely enough to
    // survive the row closing.
    expect(
      steps.filter((s) => /gate:s0/.test(s)),
      "ci:local must run exactly the regression mode — S0-OPEN-2 closed by wiring THIS mode, and only this one",
    ).toEqual(["pnpm gate:s0:regression"])
    // 20 → 21 in Workstream P Batch 8 (ADR 0080): `pnpm ledger:presentation:validate`. The count is
    // pinned rather than derived on purpose — a step LEAVING `ci:local` is exactly as much of an
    // event as one arriving, and only a literal reds on the departure.
    // 21 → 22 in Harness Distribution Surface (H0-H8): `pnpm check:harness-distribution`
    // 22 → 23 in Global Agent Distribution Authority (G3.5): `pnpm check:web-structure`
    // 23 → 25 in Global Agent Distribution Authority (G7 closure): `pnpm check:agent-surface`
    //   (§19/§20/GD-15 — the sitemap, the machine-surface pointers, and the public support
    //   labels had no guard at all) and `pnpm check:security-semantics` (§18 — verifies the
    //   committed zero-diff artifact still agrees with a live measurement).
    // 25 → 26 in Agent Discovery v2 (new19 Phase 1): `pnpm check:distribution-drift`. Ordered
    //   BEFORE `check:harness-distribution` and `check:agent-surface` deliberately — both read
    //   the generated tree, so a stale projection had to be caught before either could pass on
    //   the wrong bytes. The 25 recorded above stays as the measurement at cd0837c rather than
    //   being overwritten: two dated figures coexisting is what makes this list a history.
    // 26 → 27 in Agent Discovery v2 (new19 §19 watcher): `pnpm check:published-schema`. Ordered
    //   ahead of the drift gate for the same reason one level up — drift compares regenerated
    //   bytes against disk, and the schema contract ($id, schemaVersion.const,
    //   additionalProperties: false) decides what those bytes are allowed to be.
    // 27 → 28 at Gate S1: `pnpm gate:s1:regression`. The first amendment to this row that adds a
    //   GATE rather than a check, and it is here because the cohort crossed S1's own 100-record
    //   threshold (19 → 100 → 150, ADR 0086 auto-growth) while Gate S1 did not exist — no script,
    //   no npm script, no step. S1's status lived only in gitignored `docs/`, which is why nothing
    //   observed the crossing. `--regression` and not `--gate`, for the same reason the exclusion
    //   below pins for S0: four of S1's seven measures have no data source (the compiler store is
    //   empty in all ten tables), so `--gate` REFUSES and exits 2 by design, and wiring it would
    //   pin the required check red for a reason no PR under review can clear.
    expect(
      steps.length,
      `S0-OPEN-2's amendment states 28 &&-joined steps; ci:local now has ${steps.length}`,
    ).toBe(28)
    // Asserted against the row's LATEST amendment, not the whole row: the 2026-08-09 text says
    // **19** and the first closure says **20**, both left verbatim by this artifact's
    // append-never-edit convention. A `toContain` over the full row would therefore be satisfied by
    // the stale figures forever — it would pass today, and would have passed before the step was
    // added. Slicing to the last amendment is what keeps the assertion about the CURRENT claim.
    const row2 = row(2)
    const lastAmendment = row2.slice(row2.lastIndexOf("### Amendment"))
    // Bound to the SENTENCE that makes the measurement, not to the figure appearing anywhere in the
    // amendment. A negative control (NC-2) proved the looser `toContain("**26**")` form green while
    // the body claimed **25**: the heading `25 → **26** steps` satisfied it on its own. A heading is
    // a label, and the reader who needs the live count reads the sentence — so a body that states a
    // stale figure has to red even though the heading is still correct.
    const claim = lastAmendment.match(/`ci:local` now has \*\*(\d+)\*\* `&&`-joined steps/)
    expect(
      claim?.[1],
      "S0-OPEN-2's newest amendment must carry the `ci:local` now has **N** `&&`-joined steps sentence",
    ).not.toBeUndefined()
    expect(
      Number(claim?.[1]),
      "S0-OPEN-2's newest amendment must state the live step count in that sentence, since adding a step is what changed it",
    ).toBe(steps.length)
    // All four scripts must exist, or S0-OPEN-2's closure describes a gate that is gone. `gate:s0:identity`
    // joined at ADR 0084: a third ENFORCING mode, deliberately absent from `ci:local` and from the `test`
    // matrix because it needs full git history — the assertion above already pins that `ci:local` runs
    // exactly `gate:s0:regression`, and the identity mode's own host is pinned in its dedicated test.
    // The set form is kept (not `toContain`) so a script LEAVING is as much an event as one arriving.
    expect(Object.keys(pkg.scripts).filter((k) => k.startsWith("gate:s0")).sort()).toEqual([
      "gate:s0",
      "gate:s0:gate",
      "gate:s0:identity",
      "gate:s0:regression",
    ])
  })

  // The closure is CLAIMED in the artifact; these assertions are what make it guarded instead. The
  // row's own final paragraph names its falsification conditions ("if `ci:local` or `ci.yml` stops
  // invoking `gate:s0:regression`, or if `--regression` ever exits 0 with an assertion red") and both
  // are pinned — the first by the two invocation tests, the second by the branch-shape test.
  //
  // The load-bearing assertion is the REFUSAL, and it is the one a future batch is most likely to
  // undo quietly. Report mode was this row's own suggested remedy; it was refused because it exits 0
  // unconditionally. If somebody later schedules `gate:s0` in report mode as well — reasoning that
  // more measurement cannot hurt — every other assertion here still passes, and CI gains a step that
  // cannot fail. So the refusal is asserted over the artifact's prose, which is the only place the
  // reasoning lives.
  it("S0-OPEN-2's closure records WHICH remedy it refused, and refuses it for the measured reason", () => {
    const r = row(2)
    expect(r, "the row must state its own closure, not leave the status to be inferred").toContain(
      "**Status:** **CLOSED 2026-08-10**",
    )
    // Collapsed before matching — these sentences are hard-wrapped in the artifact, and a bare
    // substring match on wrapped prose is the ADR 0064 §6.2 trap (it red once already, on a claim
    // that was present).
    const flat = r.replace(/\s+/g, " ")
    expect(
      flat,
      "report mode's unconditional exit 0 is the measured reason the row's first disjunct was refused; without it the refusal reads as a preference",
    ).toContain("exits 0 *unconditionally*")
    expect(
      flat,
      "and the refusal must name the mode it refused, so a later batch cannot schedule it as an improvement",
    ).toMatch(/report mode.{0,400}refused|refused.{0,400}report mode/)
    // The original text must survive above the amendment. A row rewritten to look like it always
    // knew the answer destroys the only record of the estimate that misled it.
    expect(r, "the 2026-08-09 framing stays verbatim").toContain(
      "so nothing runs it on any schedule",
    )
    expect(
      r,
      "including the overstated runtime, which is the record of a cost estimated rather than timed",
    ).toContain("~25s wall clock")
    expect(r, "corrected beside it by measurement, not silently deleted").toContain("**7s / 9s / 9s**")
  })

  it("the 2026-08-10 amendment's numbers are consistent with the source they describe", () => {
    // The amendment carries four claims measured against a REMOTE run and a REMOTE branch, neither of
    // which a test may reach (INV-M4 forbids the network; reaching for `main`'s served bytes is what
    // S0-OPEN-2 exists to say a test must not do). So this asserts the one thing that is checkable
    // offline and is also the thing that rots: that the amendment's numbers agree with the committed
    // source they are about. A remote-only claim gets a date and a run id so it can be re-measured,
    // which is the honest form — NOT a string match dressed up as verification.
    const a = row(1)
    const at = (label: string, re: RegExp): string => {
      const m = re.exec(a)
      expect(m?.[1], `the 2026-08-10 amendment must still state ${label}`).not.toBeUndefined()
      return m?.[1] ?? ""
    }

    // The requirement was NOT lowered — that is the amendment's load-bearing claim, and it is
    // checkable here: the cohort figure the amendment reports must equal the gate's own constant.
    const met = at("the cohort it measured (`25 / 25 required`)", /Registry:\s+(\d+)\s+\/\s+\d+\s+required\s+\(met\)/)
    const required = /S0_REQUIRED_RECORDS\s*=\s*(\d+)/.exec(readText(GATE))?.[1]
    expect(
      met,
      `the amendment reports a cohort of ${met} meeting the requirement, but the gate now requires ${required} — one of the two moved, so the amendment is stale`,
    ).toBe(required)

    // The reconciliation the amendment quotes must be arithmetic, not decoration. 45 = 25 + 20.
    const total = Number(at("its reconciliation total", /reconciles\s+(\d+)\s*=/))
    const snapPart = Number(at("the snapshot half of that reconciliation", /reconciles\s+\d+\s*=\s*(\d+)\s+snapshot/))
    const fixPart = Number(at("the fixture half", /=\s*\d+\s+snapshot\s*\+\s*(\d+)\s+fixtures/))
    expect(snapPart + fixPart, `the amendment's own reconciliation must add up: ${snapPart} + ${fixPart} != ${total}`).toBe(total)
    expect(snapPart, "and its snapshot half is the cohort it reported meeting the requirement").toBe(Number(met))

    // The amendment claims the gate exited 0 on those bytes. Unreachable offline — so what is pinned
    // is that it named a re-measurable run rather than asserting a verdict from nowhere.
    expect(a, "a remote measurement must carry the run id that produced it, or it cannot be re-measured").toMatch(/`31368307622`/)
    // Collapsed before matching: this sentence is hard-wrapped in the artifact, so `has not passed`
    // spans a newline. A bare substring match on prose is the ADR 0064 §6.2 trap in miniature — the
    // first draft of this line looked for the unwrapped form and red on a claim that was present.
    expect(
      a.replace(/\s+/g, " "),
      "and the row must still say why a green gate on an unmerged branch leaves it OPEN",
    ).toContain("A gate that passes on an unmerged branch has not passed")
  })

  it("the three env knobs the prose calls workflow_dispatch inputs ARE now wired to the workflow", () => {
    const wf = readText(WORKFLOW)
    // This assertion is INVERTED from its first form, on the instruction the earlier version carried
    // in its own failure message ("it now has some, so that half is discharged and the row must be
    // amended"). It measured ABSENCE of `inputs:` / `env:` — the state that made the source's
    // "workflow_dispatch input" prose false. The wiring has landed, so absence is no longer the
    // truth to pin; what must be pinned is that the prose's claim is now SATISFIED, and stays so.
    expect(wf, "positive control — the dispatch trigger itself must be present").toContain(
      "workflow_dispatch:",
    )
    expect(
      /workflow_dispatch:\s*\n\s+(?:#[^\n]*\n\s*)*inputs:/.test(wf),
      "workflow_dispatch must carry an inputs: block, else the three knobs need a code change again",
    ).toBe(true)
    // The ingest step must SET the env. Sliced between asserted boundaries, never by indexOf
    // alone (ADR 0064 §6.2).
    const stepStart = wf.indexOf("- name: Ingest —")
    const stepEnd = wf.indexOf("- name: Resolve evidence")
    expect(stepStart, "the ingest step must be present").toBeGreaterThan(-1)
    expect(stepEnd, "and the step after it, to bound the slice").toBeGreaterThan(stepStart)
    const step = wf.slice(stepStart, stepEnd)
    expect(
      /^\s+env:/m.test(step),
      "the ingest step must set env:, which is what makes the three knobs settable without a code change",
    ).toBe(true)

    // DERIVED from the source's own prose, not restated: the docblock claims the knob is a
    // workflow_dispatch input. The assertions above now CONFIRM that claim rather than falsify it,
    // so the prose is pinned to keep the two in step — if the claim is ever deleted, this reds and
    // the wiring's justification is re-read rather than silently orphaned.
    //
    // The comment furniture is stripped BEFORE whitespace is collapsed. A bare `\s+`→" " leaves the
    // continuation `*` sitting inside the sentence ("(workflow_dispatch * input)"), so the needle
    // would miss and this would read as "the claim is gone" — a false green on the one assertion
    // that establishes which claim the wiring exists to satisfy.
    const prose = readText("packages/trust-index/src/refreshSnapshot.ts")
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ")
    expect(
      prose,
      "resolveMaxEntries' docblock must still make the workflow_dispatch-input claim the wiring satisfies",
    ).toContain("TRUST_INGEST_MAX_ENTRIES (workflow_dispatch input)")
    expect(
      prose,
      "and the 'ONLY knob' claim the row quotes must still be there to be quoted",
    ).toContain("the ONLY knob for 37 → 100+")
    // Each knob must be BOTH named by the row and exposed by the workflow. Asserted as a set rather
    // than a boolean per knob, so a failure prints which of the three is unwired instead of a bare
    // `expected false to be true` (the `.every()` collapse this repo has been bitten by before).
    const KNOBS = [
      "TRUST_INGEST_MAX_ENTRIES",
      "TRUST_INGEST_MIRROR_MAX_ENTRIES",
      "TRUST_INGEST_MIRROR_MAX_PAGES",
    ] as const
    for (const knob of KNOBS) {
      expect(row(1), `S0-OPEN-1 must name ${knob}`).toContain(knob)
    }
    expect(
      KNOBS.filter((k) => step.includes(`${k}:`)),
      "every knob the prose calls operator-settable must be set by the ingest step",
    ).toEqual([...KNOBS])
    // And each must be reachable from a dispatch input rather than hardcoded to a literal: an
    // `env:` pinning a constant would satisfy the assertion above while re-freezing the knob.
    for (const knob of KNOBS) {
      expect(
        new RegExp(`${knob}:\\s*\\$\\{\\{\\s*github\\.event\\.inputs\\.`).test(step),
        `${knob} must read a workflow_dispatch input, not a hardcoded value`,
      ).toBe(true)
    }
  })

  it("the pipeline failure and its late fix are both still true in git", () => {
    // The caps the 2026-08-03 run died on were raised by e24f6a0 (2026-08-05). Asserted over the
    // CURRENT values, since the record's claim is that the fix is in place and unexercised — not
    // that the old values are still there.
    const mirror = readText("packages/adoption-index/src/operations/refreshFromMirror.ts")
    expect(mirror).toContain("DEFAULT_MIRROR_MAX_ENTRIES = 100_000")
    expect(readText("packages/adoption-index/src/sources/officialRegistry.ts")).toContain(
      "DEFAULT_MAX_PAGES = 1000",
    )
    // And the row must still describe the failure it was written about.
    const r = row(1)
    expect(r).toContain("MirrorIncompleteError")
    expect(r).toContain("e24f6a0")
    expect(r, "the two-days-late ordering is the finding, not an aside").toContain("2026-08-05")
  })

  it("the assertion IDs S0-OPEN-3 tabulates are the ones the gate prints, in the tiers it prints them", () => {
    const gate = readText(GATE)
    // Parse the gate's OWN provenance labels rather than trusting the table. A rename moves an
    // assertion between tiers without any behaviour changing, and this is where it reds.
    //
    // The label set was `MEASURED` / `GATE-VERIFIED` until S batch 1. It is now three tiers, and the
    // old two-label parse is deliberately NOT kept as a fallback: a parser that accepts both
    // vocabularies would go green on a half-finished rename, which is the failure this assertion is
    // for. The 2026-08-10 amendment on S0-OPEN-3 records why the middle tier changed meaning.
    const ids = (re: RegExp): readonly string[] =>
      [...gate.matchAll(re)].map((m) => m[1]).filter((s): s is string => s !== undefined)
    const measured = ids(/\[MEASURED\]\s+(\S+)/g)
    const executed = ids(/\[EXECUTED\]\s+(\S+)/g)
    const scanned = ids(/\[SCANNED\]\s+(\S+)/g)
    expect(measured, "two MEASURED assertions, by id").toEqual(["INV-R5", "INV-R4"])
    expect(executed, "the three test-subject gates are RUN, as one batched invocation").toEqual([
      "INV-04+R7+R6",
    ])
    expect(scanned, "DEP-8 alone is SCANNED — its subject is source, so there is nothing to run").toEqual([
      "DEP-8",
    ])

    // `GATE-VERIFIED` must be GONE from the printed labels. It survives in the docblock on purpose,
    // as the quoted false-green example, so this is scoped to the `console.log` lines rather than the
    // whole file — asserting its absence file-wide would red on the record of why it was removed.
    const printed = [...gate.matchAll(/console\.log\(`\s+\[([A-Z-]+)\]/g)].map((m) => m[1])
    expect([...new Set(printed)].sort(), "the printed tier vocabulary is exactly these three").toEqual([
      "EXECUTED",
      "MEASURED",
      "SCANNED",
    ])

    // The five assertions still total five: three tiers, five subjects, with INV-04/R7/R6 batched
    // into one printed row. Stated as the subject count so a gate that silently dropped one reds.
    const r = row(3)
    for (const id of ["INV-R5", "INV-R4", "INV-04", "INV-R7", "INV-R6", "DEP-8"]) {
      expect(r, `S0-OPEN-3's tier table must name ${id}`).toContain(id)
    }
    expect(r, "the row is CLOSED by its own first disjunct — the three became EXECUTED").toContain(
      "**Status:** **CLOSED 2026-08-10**",
    )
    expect(r, "and the original three-of-five framing stays verbatim above the amendment").toContain(
      "three of S0's five",
    )
    expect(r).toContain("control #117")
    expect(gate, "INV-R6's precondition still anchors on the control identifier").toContain("control #117")

    // This assertion previously pinned `anchorIsComment: true` — a field that recorded, per gate, that
    // an anchor "lives in a comment" and therefore could not be scanned for. Both halves were wrong.
    // MEASURED: `control #117` occurs 3x in `committed-tree.test.ts` — :50 and :116 in comments, :145 in
    // the `it()` title. So the field's VALUE was false, and its QUESTION was the wrong one: what decides
    // whether the scan can see a deletion is not "is the anchor in a comment" but "does a comment ALSO
    // carry it", which makes the raw-text match satisfiable without the test. The field is gone and the
    // scan strips comments instead, so the situation it documented cannot arise. Pinned by behaviour.
    expect(gate, "the mis-named boolean must not come back").not.toContain("anchorIsComment")
    expect(gate, "the anchor is matched against code, not prose about the code").toContain("stripComments")
    expect(gate, "and a comments-only survivor must be named as such, not reported as merely absent").toContain(
      "anchor present only in COMMENTS",
    )
    // The stripper is guarded in BOTH directions from inside the gate. Control #169 loosened it and the
    // guard stayed green until the fixture gained a `https://` line, so the URL case is pinned by name.
    expect(gate, "the stripper must be guarded two-sidedly").toContain("OVER-STRIPPED")
    expect(gate, "including the case that control #169 walked through").toContain("https://")
  })

  it("the EXECUTED tier cannot be skipped into a pass", () => {
    // S0-OPEN-3 closed on four properties, not one. Three of them live in `scripts/gate-s0.ts` as
    // code that no other assertion here reads, so they are pinned by their own subject.
    const gate = readText(GATE)
    // `--no-run` must not be honoured under an enforcing mode, or the EXECUTED tier is skipped into a
    // pass. WHICH modes the guard covers is asserted by arity in "no enforcing mode can be asked to skip
    // itself, and no two can be combined" — do not re-pin the disjunction here. This assertion held
    // `/\(isGate \|\| isRegression\) && noRun/` and drifted twice: once when `--regression` joined the
    // guard, again when ADR 0084 added `--identity`. Both times the guard had been STRENGTHENED and the
    // literal red anyway, which is the shape this file documents elsewhere — a check whose subject is the
    // spelling of a condition rather than the condition. Two copies of one proposition also means the
    // weaker copy can go green while the real claim is broken. What survives here is only the part this
    // tier needs: the guard exists, and it EXITS rather than warning.
    expect(gate, "--no-run must be refused under an enforcing mode, not honoured with a warning").toMatch(
      /&& noRun\) \{[\s\S]{0,400}?process\.exit\(2\)/,
    )
    expect(gate, "and the refusal must name the mode that refused").toMatch(
      /--no-run is refused under \$\{mode\}/,
    )
    // A skip must not print the passing glyph. Asserted on the expression that chooses it.
    expect(gate, "a skipped tier prints an en-dash, never a tick").toMatch(/executedOk \?\s*"✓"\s*:.*"–"/s)
    // The verdict must come from the parsed report, not the child's exit status or stdout.
    expect(gate, "the runner's verdict is read from the JSON report").toContain("numFailedTests")
    expect(gate, "a report that cannot be read is a FAILURE, not an absence").toContain(
      "JSON report unparseable",
    )
    expect(gate, "a file the runner never collected must red by name").toContain("not collected by the runner")
    expect(gate, "zero collected tests is vacuous, not a pass").toContain("VACUOUS")
    // And the tier must actually gate: `allOk` has to consume it.
    expect(gate, "executedOk must be part of allOk, or the tier is decoration").toMatch(
      /const allOk\s*=.*executedOk/,
    )
  })
})

describe("Gate S0 — the regression mode CI runs enforces something, and the ratchet cannot be edited slack", () => {
  /**
   * Read a numeric constant out of the gate's source by name.
   *
   * Read rather than restated: both numbers are claims about `scripts/gate-s0.ts`, and a test that
   * hardcoded them would agree with a copy of the value instead of measuring it
   * ([[prose-justified-constant-is-ungated]]). Absence is its own failure with the name printed,
   * so a renamed constant reds here instead of silently reading as 0.
   */
  function constant(name: string): number {
    const m = new RegExp(`^const ${name} = (\\d+)$`, "m").exec(readText(GATE))
    expect(m, `${GATE} must declare \`const ${name} = <number>\``).not.toBeNull()
    return Number(m![1])
  }

  it("the ratchet floor tracks the cohort at HEAD, and is not ordered against the requirement", () => {
    const floor = constant("S0_REGRESSION_FLOOR")

    // REMOVED BY ADR 0083 D1: `expect(floor).toBeLessThanOrEqual(required)`, whose message was "the
    // ratchet floor must never exceed the requirement it sits under". It encoded a rule that became
    // unsatisfiable the moment the cohort passed the requirement: the assertion below demands the
    // floor EQUAL the cohort (100), and that clause forbade any floor above 25. No value satisfied
    // both ([[two-constants-equal-by-accident]] — each half defensible alone, the pair wrong).
    //
    // Satisfying it by holding the floor at 25 was the dangerous branch, and it is why this is an
    // ADR and not a test edit: against a 100-entry cohort, a floor of 25 lets 75 committed records
    // be lost with `pnpm gate:s0:regression` still EXIT 0. The guard whose only purpose is catching
    // a lost record would go blind to a 75-record loss — a silent green, strictly worse than the
    // noisy red the removed clause was protecting against.
    //
    // The relationship it was trying to express is not lost, only re-anchored: the gate's load-time
    // check now bounds the floor by the COMMITTED COHORT (`gate-s0.ts`, `committedRegistryCohort`),
    // so a floor above what has actually been ingested still exits 2. `S0_REQUIRED_RECORDS` is
    // deliberately NOT read here any more — the requirement and the ratchet answer different
    // questions (ambition vs. achievement) and ordering them against each other is what conflicted.

    // THE POINT OF THIS TEST. The floor is a ratchet, so the cheap way to defeat it is to edit the
    // literal downward when CI reds — a one-character diff that silently disables the guard. Pinning
    // it against the real cohort means lowering it requires failing this assertion, whose message
    // says why it exists.
    //
    // Pinned against the UPSTREAM SNAPSHOT, not `apps/web/public/trust/index.json`. The served copy
    // is the number the gate actually counts, so it looks like the more faithful anchor — but this
    // suite forbids itself from reading served bytes (asserted below, with its reason), and that
    // rule outranks the convenience. The snapshot is the INPUT the gate reconciles the served count
    // against under INV-R5, so if the two ever disagree, INV-R5 reds in the gate itself rather than
    // being silently absorbed here. Anchoring upstream also means this assertion measures the cohort
    // the repo has ingested rather than the cohort it has baked, which is the quantity the ratchet
    // is about.
    const snapshot: { entries: unknown[] } = JSON.parse(
      readText("packages/trust-index/snapshots/official-mcp-registry.json"),
    )
    const upstreamRegistry = snapshot.entries.length

    // STILL THE EQUALITY, and ADR 0091 changed only WHO SATISFIES IT. ADR 0083 named the route by
    // which the floor moves — "ingest, then the test's derived pin reds until the floor follows" —
    // and assumed the follower was a human performing an authorized expansion. The Cumulative
    // Coverage Amendment made ingest automatic and weekly, so that keystroke became a chore that
    // recurred every Sunday and red the bot's own PR until someone did it by hand. A guard whose
    // green depends on a weekly manual edit gets satisfied the cheap way eventually — by editing the
    // floor DOWN, which is the one thing this assertion exists to catch.
    //
    // So ingest now advances the floor itself, in the same act that writes the snapshot
    // (`refreshSnapshot.ts`, via `advanceRatchetFloor`), and this assertion is UNCHANGED: it still
    // demands exact equality, so a floor edited downward still reds here, and a floor raised above a
    // cohort that has not grown still reds here. What no longer happens is a red for the ONE case
    // that was never a defect — growth that did occur, followed by a human who had not yet typed it
    // in.
    //
    // The advance cannot lower a floor (`Math.max`, argued in `advanceRatchet.ts` and asserted in
    // `cohort-cap-derivation.invariants.test.ts`), so a SHRUNKEN cohort still leaves the floor at its
    // high-water mark — this assertion reds, and the gate's own load-time coherence check exits 2.
    // Both halves of ADR 0083's protection are intact; only the manual step is gone.
    expect(
      { floor, upstreamRegistry },
      "the ratchet floor must equal the registry cohort at HEAD — a lower floor is slack that hides a lost record, a higher one reds CI for growth that has not happened",
    ).toEqual({ floor: upstreamRegistry, upstreamRegistry })
  })

  it("--regression enforces the assertions and the ratchet, and does NOT enforce the 25-record requirement", () => {
    const gate = readText(GATE)

    // The mode exists at all.
    expect(gate, "the mode CI runs must be a real branch, not a flag that falls through to report").toMatch(
      /else if \(isRegression\)/,
    )

    // It consumes `allOk`, or it is decoration — the same check the EXECUTED tier gets above.
    expect(gate, "--regression must gate on allOk").toMatch(/isRegression\)[\s\S]{0,600}?if \(!allOk\)/)

    // It gates on the RATCHET, and the ratchet is a distinct boolean from the shortfall. Blending
    // them is precisely what made neither existing mode wireable, so the separation is pinned.
    expect(gate, "the regression direction has its own boolean").toContain(
      "cohortRegressed = censusRegistry < S0_REGRESSION_FLOOR",
    )
    expect(gate, "and --regression enforces it").toMatch(
      /isRegression\)[\s\S]{0,900}?if \(cohortRegressed\)/,
    )

    // And it must NOT enforce the shortfall. `registryShort` may be READ inside the branch (the
    // success message distinguishes the two cases), but it must never decide the exit code there —
    // that would pin CI red for S0-OPEN-1, which no PR under review can clear.
    // Both boundaries asserted before the cut (ADR 0064 §6.2). The first draft of this slice used
    // `indexOf("} else {")` for the end and got a NEGATIVE-length slice: that string also occurs
    // ~360 lines EARLIER, inside `runVitest`, so the end landed before the start and the branch came
    // back empty — an assertion over nothing, which would have passed the two `.test(...) === false`
    // checks below for the wrong reason. The end is therefore searched FROM the start index.
    const bStart = gate.indexOf("} else if (isRegression) {")
    expect(bStart, "the --regression branch must exist").toBeGreaterThan(-1)
    const bEnd = gate.indexOf("\n} else {", bStart)
    expect(bEnd, "the --regression branch must be followed by the report-mode branch").toBeGreaterThan(
      bStart,
    )
    const branch = gate.slice(bStart, bEnd)
    expect(branch.length, "the --regression branch must be non-empty").toBeGreaterThan(0)
    expect(
      /if \(registryShort\)[\s\S]{0,200}?process\.exit\(2\)/.test(branch),
      "--regression must not exit 2 on the 25-record shortfall — that is S0-OPEN-1's subject, clearable only by a served-bytes change",
    ).toBe(false)
  })

  it("no enforcing mode can be asked to skip itself, and no two can be combined", () => {
    const gate = readText(GATE)
    // ADR 0084 added `--identity` as a THIRD enforcing mode, so both claims below are now over three
    // modes rather than two. They are asserted by ARITY rather than by pinning the disjunction's exact
    // text: the previous form pinned `(isGate || isRegression) && noRun` literally and therefore red on
    // a change that STRENGTHENED it — the same "a red control can be the gate catching its own edit"
    // trap this file documents elsewhere. What must hold is that *every* enforcing mode is covered.
    const modes = ["isGate", "isRegression", "isIdentity"] as const

    const noRunGuard = /if \(\(([^)]*)\) && noRun\)/.exec(gate)
    expect(noRunGuard, "the `--no-run` refusal must still be a single guard over the enforcing modes").not.toBeNull()
    for (const m of modes) {
      expect(noRunGuard![1], `--no-run must be refused under ${m}: an escape hatch in ANY enforcing mode restores exactly what the guard exists to prevent`).toContain(m)
    }
    expect(gate, "and the refusal must name which mode refused").toContain(
      "enforcement cannot be asked to skip itself",
    )

    // Combining modes is refused rather than resolved by precedence: they enforce different claims, so
    // silently honouring one prints a verdict the caller did not ask for. With three modes the pairwise
    // form (`isGate && isRegression`) no longer covers it, so the gate counts how many were requested.
    const exclusion = /const enforcing = \[([^\]]*)\]\s*\.filter\(Boolean\)\.length/.exec(gate)
    expect(exclusion, "mutual exclusion must be decided by counting the requested modes, not by pairwise tests that silently miss a third").not.toBeNull()
    for (const m of modes) {
      expect(exclusion![1], `${m} must be counted when checking for combined modes`).toContain(m)
    }
    expect(gate, "and combining them must be refused, not resolved").toMatch(
      /if \(enforcing > 1\)[\s\S]{0,300}?process\.exit\(2\)/,
    )
  })

  // ADR 0084 D3. The identity witness reads a PREVIOUS REVISION of the snapshot, so its verdict depends
  // on clone depth — which makes WHERE it is wired part of the claim, not deployment trivia.
  it("the identity mode is enforced only where history is reachable, and its host blocks the merge", () => {
    const pkg: { scripts: Record<string, string> } = JSON.parse(readText("package.json"))
    expect(pkg.scripts["gate:s0:identity"], "the identity script must exist").toBe(
      "tsx scripts/gate-s0.ts --identity",
    )

    // Parsed, not text-matched: this file already paid for a text match on an unparseable workflow.
    const ci = parseYaml(readText(".github/workflows/ci.yml")) as {
      jobs: Record<string, { needs?: string[]; steps?: { run?: string; with?: Record<string, unknown> }[] }>
    }
    const host = ci.jobs["ledger-authenticity"]
    expect(host, "`ledger-authenticity` is the one full-history job; the identity check lives there").toBeTruthy()

    const runs = (j?: { steps?: { run?: string }[] }) => (j?.steps ?? []).map((s) => s.run ?? "").join("\n")

    // The load-bearing pair. On a depth-1 clone the check can ONLY return `refused`, so enforcing it on
    // the matrix would be a step with no failing mode — ADR 0084's own defect, reintroduced by its guard.
    expect(runs(host), "the identity mode must run on the fetch-depth: 0 job").toContain("pnpm gate:s0:identity")
    expect(runs(ci.jobs.test), "and must NOT run on the depth-1 matrix, where it could only ever refuse").not.toContain(
      "pnpm gate:s0:identity",
    )

    // Optional-chained rather than relying on the `toBeTruthy` above to narrow: it does not narrow for
    // tsc, and a missing host leaves `depth` undefined, which the `.toBe(0)` below reds on anyway.
    const depth = (host?.steps ?? []).find((s) => s.with && "fetch-depth" in s.with)
    expect(depth?.with?.["fetch-depth"], "its host must check out full history, or the check cannot measure").toBe(0)

    // A job whose failure the required check does not read is a status, not a gate (ADR 0071).
    expect(
      ci.jobs["build-and-test"]?.needs,
      "the host job must be in the required aggregator's needs, or a red identity check blocks nothing",
    ).toContain("ledger-authenticity")
  })

  it("the mode is actually invoked — by ci.yml AND by ci:local", () => {
    // S0-OPEN-2 was never about the gate being wrong; it was about nothing running it. So the
    // closing evidence is the invocation itself, asserted over both consumers.
    const pkg: { scripts: Record<string, string> } = JSON.parse(readText("package.json"))
    expect(pkg.scripts["gate:s0:regression"], "the regression script must exist").toBe(
      "tsx scripts/gate-s0.ts --regression",
    )
    expect(pkg.scripts["ci:local"], "ci:local must run it").toContain("pnpm gate:s0:regression")

    const ci = readText(".github/workflows/ci.yml")

    // PARSE BEFORE MATCHING, and this was paid for on the remote. The first push of this batch put
    // the step in as `- name: Gate S0 (regression: assertions + cohort ratchet)` — an unquoted `: `
    // inside a YAML scalar, which makes the WHOLE FILE unparseable. GitHub reported
    // "This run likely failed because of a workflow file issue"; the `test` job never started, so
    // `build-and-test` never appeared and the required check was simply ABSENT rather than red.
    //
    // Every assertion in this test passed on those bytes. `toContain("pnpm gate:s0:regression")` is
    // true of a file that no runner can execute, because a text match asserts that a STRING IS
    // PRESENT while the claim is that CI RUNS THE STEP. That is ADR 0069 §2's defect in this batch's
    // own closing evidence: a probe agreeing with the description of a claim instead of the claim.
    //
    // So the workflow is parsed, and the step is looked up as a STRUCTURE — a run: value inside the
    // named job's step list. An unparseable file now reds here by name instead of going green
    // locally and vanishing from the remote's check list.
    const wf = parseYaml(ci) as {
      jobs?: Record<string, { steps?: { name?: string; run?: string }[] }>
    }
    const steps = wf.jobs?.test?.steps ?? []
    expect(
      steps.length,
      "ci.yml must parse as YAML and its `test` job must have steps — a text match cannot tell an executable workflow from an unparseable one",
    ).toBeGreaterThan(0)
    const runs = steps.map((s) => s.run ?? "").filter((r) => r.includes("gate:s0"))
    expect(
      runs,
      "exactly one parsed step in ci.yml#test runs Gate S0, and it is the regression mode",
    ).toEqual(["pnpm gate:s0:regression"])
    // The aggregator is the single required status check. If the file stops parsing, this job stops
    // existing, and an ABSENT required check is not a red one — branch protection has nothing to fail.
    expect(
      Object.keys(wf.jobs ?? {}),
      "the required-check aggregator must survive in the parsed graph",
    ).toContain("build-and-test")

    // EXCLUSION BEFORE PRESENCE, and the order was fixed by a control that exposed it. Control #174
    // swapped `ci.yml`'s step to `gate:s0:gate` — the exact mistake this test exists to catch — and
    // the red said `expected '# Main CI for CallLint…' to contain 'pnpm gate:s0:regression'`. True,
    // but it names a MISSING step, not the hazard: the enforcing mode is red on `main` for the cohort
    // shortfall (S0-OPEN-1), so wiring it pins the required check red for a reason no PR under review
    // can clear. With presence asserted first, the exclusion below never ran at all.
    //
    // This is [[assertion-order-decides-falsifiability]] inside the file that cites it: an assertion
    // placed after one that fails on the same mutation is unreachable, and its subject goes unnamed.
    // Asserting the more specific claim first means the swap reds on the swap.
    expect(
      ci,
      "ci.yml must not run the enforcing gate: --gate is red on main for the cohort shortfall alone, so it would pin the required check red for a reason no PR can fix",
    ).not.toContain("gate:s0:gate")
    expect(ci, "ci.yml must run it").toContain("pnpm gate:s0:regression")

    // A FOURTH consumer of `ci:local`'s script string, discovered because appending a step red
    // `pnpm ci:local` at Gate 2.4-H rather than at the new step:
    // `artifacts/phase-2.4/gate-H-no-regression.json` embeds that `&&`-joined string VERBATIM and
    // byte-compares it. S0-OPEN-2's first amendment enumerated the consumers and missed this one.
    //
    // Asserted here so the coupling is documented by a test rather than rediscovered as a confusing
    // red. Kept narrow on purpose: the SHAPE of the two strings must agree (Gate H's copy contains
    // ci:local's exactly), not the artifact's contents in general — Gate H has its own drift check
    // and duplicating it here would make one gate's failure red in two places for one cause.
    const gateH: string = readText("artifacts/phase-2.4/gate-H-no-regression.json")
    expect(
      gateH,
      "Gate 2.4-H records ci:local verbatim, so editing ci:local without `pnpm eval:phase-2.4:gates:write` reds ci:local itself — at Gate H, not at the edited step",
    ).toContain(pkg.scripts["ci:local"])
  })

  it("EVERY workflow parses, because an unparseable one is a check that silently stops existing", () => {
    // Broader than this batch's subject on purpose. The defect above was mine and in `ci.yml`, but
    // nothing in this repo could have caught it in ANY of the fifteen workflow files, and the failure
    // mode is worse than a red build: a workflow that does not parse contributes NO check runs, so a
    // required check disappears from the rollup rather than failing. `gh pr checks` listed six green
    // checks and omitted `build-and-test` entirely; only `gh run list` showed the `.github/workflows/
    // ci.yml` entry as `failure` with no jobs at all.
    //
    // Two assertions per file, because they catch opposite things: a parse error, and a parse that
    // SUCCEEDS into the wrong shape. `- name: a: b` can also parse into a nested map on some inputs
    // rather than throwing, so `jobs` must exist and be an object afterwards.
    const dir = fileURLToPath(new URL(".github/workflows", repoRoot))
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .sort()
    // Non-vacuous: an empty list would make every assertion below pass by having nothing to check.
    expect(files.length, "there must be workflows to check").toBeGreaterThan(10)

    const broken: string[] = []
    const shapeless: string[] = []
    for (const f of files) {
      let doc: unknown
      try {
        doc = parseYaml(readText(`.github/workflows/${f}`))
      } catch (err) {
        // Name the file AND the parser's own message: "one workflow is invalid" sends the next reader
        // back to a bisect, while `ci.yml: Nested mappings are not allowed…at line 150` does not.
        broken.push(`${f}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`)
        continue
      }
      const jobs = (doc as { jobs?: unknown } | null)?.jobs
      if (typeof jobs !== "object" || jobs === null || Object.keys(jobs).length === 0) {
        shapeless.push(f)
      }
    }
    expect(broken, "every workflow must parse as YAML").toEqual([])
    expect(shapeless, "every workflow must parse into a non-empty `jobs` map").toEqual([])
  })

  // The control S0-OPEN-5 demanded by name: "a control that applies the pushed unparseable bytes and
  // observes Gate 2.4-H red naming the parse failure — not merely a comment claiming the parse
  // happens. A green Gate H on valid YAML proves nothing here: valid YAML is the case the current
  // regex already handles."
  //
  // The fragment is INLINED, not fetched. `git show d825330:…` would work here, but the CI checkout
  // is depth-1 and an unknown sha makes git commands FATAL rather than returning false
  // (`preview-snapshot.ts:565`) — a control that dies on the runner is not a control. Inlined bytes
  // are also the honest form: what is being asserted is a property of these bytes, not of git.
  it("applies the bytes GitHub REFUSED, and both probes disagree about them exactly as recorded", () => {
    // Verbatim from `d825330:.github/workflows/ci.yml` around line 150 — the unquoted `: ` inside an
    // unquoted step name, which is what made the whole file unparseable.
    const rejected = [
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Gate S0 (regression: assertions + cohort ratchet)",
      "        run: pnpm gate:s0:regression",
      "",
      "  build-and-test:",
      "    needs: [test]",
      "    runs-on: ubuntu-latest",
      "    steps:",
      '      - run: echo "aggregate"',
      "",
    ].join("\n")

    // (1) The runner's verdict: these bytes do not parse, and the message names WHY. Asserting only
    //     "it threw" would be satisfied by a typo in the fixture itself.
    let message: string | null = null
    try {
      parseYaml(rejected)
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message, "the rejected bytes must not parse — that is the premise of the whole row").not.toBeNull()
    if (message === null) throw new Error("unreachable: asserted non-null above")
    expect(
      message,
      "the parser must name the nested mapping; a different error would mean this fixture stopped reproducing the real defect",
    ).toContain("Nested mappings are not allowed")

    // (2) The OLD text probe, reproduced verbatim from the pre-close `observeGateH`, says BOUND on
    //     those same bytes. This is the falsifying observation: not "the old code was ugly" but
    //     "the old code returns BOUND for a file that starts zero jobs".
    const script = "gate:s0:regression"
    const textual =
      new RegExp(`run: pnpm ${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(rejected) &&
      /^  test:$/m.test(rejected)
    expect(textual, "the old text probe reports BOUND on bytes no runner will execute").toBe(true)

    // (3) And the aggregator's own line matches too, which is why the required check looked present
    //     while it had in fact stopped existing.
    expect(/^  build-and-test:$/m.test(rejected)).toBe(true)

    // (4) The measure that now carries this: fed a parse error, it must red NAMING the parse failure
    //     rather than reciting "bound to no workflow job" for every row. Driven through the real
    //     evaluator with the real message, so this cannot pass on a hand-written string.
    const firstLine = message.split("\n")[0] ?? message
    const result = evaluateNoRegression(
      [{ gate: "2.4-A", artifact: "artifacts/phase-2.4/gate-A-consistency.json", status: "PASSED", machineDecidable: true }],
      [],
      [],
      [
        { source: "tools.ts", count: 13 },
        { source: "mcp-pack-smoke.mjs", count: 13 },
      ],
      1,
      { workflow: "ci.yml", job: "build-and-test", present: false, needs: [], parseError: firstLine } satisfies AggregatorReach,
      // Supplied even though this case expects FAILED. `evaluateNoRegression`'s 7th parameter defaults
      // to two EMPTY name lists and empty must fail, so omitting it would make this test red for two
      // reasons at once and stop isolating the parse failure it is about.
      AGREEING_TOOL_NAMES,
    )
    expect(result.status, "Gate 2.4-H must be RED on the refused bytes").toBe("FAILED")
    expect(
      result.blockers.join(" "),
      "and it must name the parse failure — a red gate that blames the wrong thing is the defect, not the fix",
    ).toContain("Nested mappings are not allowed")
  })
})

describe("Gate S0 — the rows say OPEN, and what would make each false", () => {
  it("S0-OPEN-1 is CLOSED on evidence, still names the false reason verbatim, and keeps the #234 trap", () => {
    const r = row(1)
    // CLOSED 2026-08-13. The close must carry its two measurements, because this row's own
    // falsification test named BOTH and either alone is a false green: a passing gate on a stale
    // snapshot means the requirement was lowered, a fresh snapshot with a red gate means an
    // assertion broke. So the merge commit and the exit code are pinned, not the word "CLOSED".
    expect(r).toContain("**Status:** **CLOSED 2026-08-13**")
    expect(r, "the close must name the commit that put count:25 on main").toContain("1115639")
    expect(r, "and the gate result, since a closed row that never ran the gate is a claim").toContain(
      "EXIT 0",
    )
    expect(
      r,
      "the requirement must be recorded as UNMOVED — the cohort rose to meet it, not the reverse",
    ).toContain("still 25")
    // The scar. S0-OPEN-1 closed WITHOUT the self page being retained, and the row must hand that
    // to S0-OPEN-4 explicitly rather than let a CLOSED status imply the whole axis is settled.
    // Without this, the artifact's last open row keeps a trigger (cohort >= 26) that cannot observe
    // an eviction which already happened at 25.
    expect(r, "the closure must name the row that inherits the evicted self page").toContain("S0-OPEN-4")
    expect(
      r,
      "and must record that ADR 0075's reservation did not exist at the 2026-08-10 fetch",
    ).toContain("did not exist")
    // The false reason must be quoted verbatim. A record that paraphrases the claim it corrects
    // cannot be checked against the original.
    expect(r).toContain("cohort size 19/25, cannot satisfy S0's 25-record requirement")
    expect(r, "and it must say plainly that the number is right and the framing is not").toContain(
      "The **framing is false**",
    )
    expect(r, "the number itself must stay recorded as CORRECT — that asymmetry is the finding").toContain(
      "**number 19 is correct**",
    )
    expect(r).toContain("19_739")
    // The trap. A batch that merges #234 to "make progress" shrinks the cohort to 18.
    expect(r, "PR #234's count:18 must stay recorded as a trap").toContain("#234")
    expect(r).toContain("count: 18")
    expect(r).toContain("**What would make this row false.**")
  })

  it("each row states its own falsification condition, so none can be closed silently", () => {
    // All five, not the first three. The loop was written when the artifact had three rows and was
    // never widened as rows 4 and 5 arrived, so two rows were exempt from the one requirement this
    // file exists to impose. A hardcoded range over a growing list silently stops covering its tail.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(
        row(n),
        `S0-OPEN-${n} must state what would make it false — a row without one cannot be closed on evidence`,
      ).toContain("What would make this row false")
    }
  })

  // S0-OPEN-5's numbers are DERIVED from the two files it is about, never restated. The row exists
  // because a text match cannot see that a runner rejects a file; a row about that defect whose own
  // figures were copied by hand would be the same mistake in the record.
  it("S0-OPEN-5's count of text-matched bindings is derived from Gate H's source and artifact", () => {
    const r = row(5)
    // CLOSED as of S batch 3, and the close must name the ADR that carries the reasoning. A row that
    // flips to CLOSED without one is a status change nothing accounts for.
    expect(r).toContain("**Status:** **CLOSED 2026-08-11**")
    expect(r, "the close must cite the ADR that records why").toContain("ADR 0071")

    // ORDER IS LOAD-BEARING, and control #181 is why. The two `assertPointer` calls below were
    // written FIRST, and inserting a 20th REGRESSION_CHECKS row red them — line 718 moved — so the
    // count assertions this test exists for never ran. A pointer is *supporting* evidence for the
    // row; the row's claim is the counts. Putting the support first made the claim unreachable, which
    // is [[assertion-order-decides-falsifiability]] recurring in the same file that already cites it
    // (ADR 0070 §8, control #174, was the identical mistake one batch earlier). Counts first,
    // pointers after.
    //
    // (1) The row count and the remoteOnly count, read from the declaring source.
    const gatesSrc = readText("scripts/phase-2.4-gates.ts")
    const listStart = gatesSrc.indexOf("const REGRESSION_CHECKS")
    expect(listStart, "REGRESSION_CHECKS must be declared").toBeGreaterThan(-1)
    const listEnd = gatesSrc.indexOf("\n]", listStart)
    expect(listEnd, "the REGRESSION_CHECKS literal must be closed — a missing end widens the slice").toBeGreaterThan(
      listStart,
    )
    const list = gatesSrc.slice(listStart, listEnd)
    const rows = (list.match(/\bid: "/g) ?? []).length
    const remoteOnly = (list.match(/remoteOnly: true/g) ?? []).length
    // Whitespace-collapsed before matching. The row is hand-wrapped prose, so a needle spanning a
    // line break would red on a reflow that changed no claim — a guard whose failure mode is
    // "somebody rewrapped a paragraph" trains people to edit the guard.
    //
    // SCOPED TO THE LATEST AMENDMENT, and that narrowing is a repair, not a convenience.
    //
    // These three needles previously matched the WHOLE row, and the whole row carries this artifact's
    // append-never-edit history: the pre-close 2026-08-11 text says "**19 rows**", "of which **2**
    // are `remoteOnly`", and "**18 bound**" verbatim, and is frozen there by design. Measured on
    // today's bytes: all three needles are satisfied by the pre-close text ALONE. So from S batch 3
    // until this batch these assertions were green against preserved history, not against the current
    // claim — they could not have observed the live counts drifting, because the frozen sentence kept
    // answering for them. Adding the 20th row is what exposed it: `**20 rows**` appears nowhere in the
    // historical text, so the needle finally had to be satisfied by something current.
    //
    // This is [[a-pointer-rots-faster-than-its-claim]] inverted. There, the addresses expired while
    // the sentences stayed true. Here the sentences are deliberately immortal, so a `toContain` over
    // all of them measures whether a number was EVER correct — never whether it is correct now. A
    // guard whose subject is "the row's current claim" must read the row's current claim.
    const flat = r.replace(/\s+/g, " ")
    const latest = flat.slice(flat.lastIndexOf("### Amendment"))
    expect(
      latest,
      `S0-OPEN-5's newest amendment must state the live row count; REGRESSION_CHECKS now has ${rows}`,
    ).toContain(`**${rows} rows**`)
    expect(
      latest,
      `S0-OPEN-5's newest amendment must state the live remoteOnly count; the source now has ${remoteOnly}`,
    ).toContain(`of which **${remoteOnly}** are \`remoteOnly\``)

    // (2) The bound/null split, read from the drift-checked artifact rather than from the row.
    const gateH = JSON.parse(readText("artifacts/phase-2.4/gate-H-no-regression.json")) as {
      regressionChecks: { id: string; workflowBinding: string | null }[]
    }
    const checks = gateH.regressionChecks ?? []
    expect(checks.length, "Gate H's artifact must carry its regressionChecks array").toBe(rows)
    const bound = checks.filter((c) => c.workflowBinding !== null)
    expect(
      latest,
      `S0-OPEN-5's newest amendment must state how many checks are recorded as bound; the artifact records ${bound.length}`,
    ).toContain(`**${bound.length} bound**`)
    // The HEADING is asserted for its SUBJECT, never for a live count, and dropping the count from it
    // is the point of this change rather than a side effect of it.
    //
    // The heading reads: `Gate 2.4-H asserts 18 checks are "wired" by matching text`. Both halves of
    // that sentence are now historical — the row CLOSED by replacing the text match with a structural
    // parse (`bindCheck`), so "by matching text" describes code that no longer exists, and 18 was the
    // bound count at the time. The previous assertion pinned the LIVE bound count into that dead
    // clause, which had two failure modes and no success mode: leave the heading alone and it reds on
    // every new row, or update it and the heading asserts a live number about a mechanism the row
    // itself refuted. Updating it to 19 was the tempting edit; it would have produced a heading that
    // is false in a NEW way — a current figure certifying a superseded description.
    //
    // A heading is an index entry. It names which defect the row is about, and that never changes:
    // a count in a heading is a figure with no reader's business in it. So the live count is asserted
    // against the newest amendment (above), where it belongs, and the heading is asserted to still
    // name its subject — which is what a reader scanning `## S0-OPEN-` headings actually needs.
    expect(
      flat,
      "S0-OPEN-5's heading must still name its subject — the row is indexed by the defect, not by a count",
    ).toContain(`Gate 2.4-H asserts`)
    expect(
      flat,
      "S0-OPEN-5's heading must still name the wired-by-text defect it was filed for",
    ).toMatch(/are "wired" by matching text, so it cannot see that the runner rejects the file/)
    // The single null row is `ci:local` BY NAME, not "one of them". If a different row went null the
    // row's claim would be about something else entirely.
    expect(
      checks.filter((c) => c.workflowBinding === null).map((c) => c.id),
      "exactly ci:local is unbound by design — it is the chain, not a step",
    ).toEqual(["ci:local"])

    // (3) The pointers, LAST — see the ordering note above. These say the row's citations still
    //     resolve; they must never be able to pre-empt the counts, which are the row's own subject.
    //     Content-addressed, not existence-addressed: a line number that merely exists is satisfied
    //     by a blank line, the defect `assertPointer` was written for.
    //
    //     These follow the LATEST amendment's citations, not any earlier text's. Every pre-close and
    //     superseded amendment is preserved verbatim as history (same convention as S0-OPEN-3), so
    //     the original's `:717-719` two-regex citation and S batch 3's `:783`/`:733`/`:553`/`:711`
    //     all now point at code that has moved or no longer exists — by design. Asserting historical
    //     line numbers would force a rewrite of preserved history on every reflow; asserting the live
    //     ones is what keeps the row actionable.
    //
    //     S batch 4 moved five of the six below by inserting `readToolNameSources()` into the script
    //     and a sixth roll-up measure into `evaluateNoRegression`. It moved them from a DIFFERENT
    //     workstream with no interest in this row, which is the whole argument for asserting pointers
    //     here rather than trusting prose: every sentence in that amendment stayed true while its
    //     addresses expired. The re-anchored table lives in the 2026-08-11 (S batch 4) amendment.
    //
    //     P Batch 8 (ADR 0080) moved two more — 792 → 808 and 742 → 758 — and did so from yet another
    //     workstream, by adding the 20th `REGRESSION_CHECKS` row above them. Both reds arrived with the
    //     content, not just the number: 792 now reads `}`. The four unmoved anchors below are asserted
    //     unchanged rather than re-derived, which is what keeps a "nothing moved" claim falsifiable.
    assertPointer(
      "scripts/phase-2.4-gates.ts",
      808,
      "function bindCheck",
      "S0-OPEN-5's cited structural binding decision",
    )
    assertPointer(
      "scripts/phase-2.4-gates.ts",
      758,
      "function readWorkflowGraph",
      "S0-OPEN-5's cited one-parse-per-file reader",
    )
    // 640 → 641, from a single `import` line added at the top of the file. And 640 is now BLANK,
    // which is `assertPointer`'s reason for existing demonstrated on itself: an existence-addressed
    // pointer would still resolve here and point at nothing at all.
    assertPointer(
      "scripts/phase-2.4-gates.ts",
      641,
      "const REGRESSION_CHECKS",
      "S0-OPEN-5's cited check list",
    )
    assertPointer(
      "packages/trust-index/src/phase24Gates.ts",
      493,
      "readonly bindingFault",
      "S0-OPEN-5's cited required fault field",
    )
    assertPointer(
      "packages/trust-index/src/phase24Gates.ts",
      565,
      "function aggregatorMeasure",
      "S0-OPEN-5's cited aggregator-reach measure",
    )
    // The denominator, by CONTENT. A `6 + …` that silently reverted is the one edit in this close
    // with no failing mode of its own — it only feeds `<`, so a short measure count would pass
    // forever. This is the assertion that gives it one.
    //
    // `5 +` → `6 +` under S batch 4, which added `mcp-tool-names-agree`. Asserting the VALUE and not
    // merely the address is what makes that visible: a line-number-only pointer would still resolve
    // at 711 today, silently aimed at an unrelated statement.
    assertPointer(
      "packages/trust-index/src/phase24Gates.ts",
      759,
      "6 + checks.length + served.length",
      "S0-OPEN-5's cited synced denominator",
    )

    // (4) The row must keep its fix shape and its falsification condition, and — REVERSED by S batch
    //     3 — must now claim the repair, because the repair happened. The previous form asserted the
    //     row does NOT say Gate H parses, guarding a batch that deliberately left it alone. Left as
    //     it was, it would forbid the row from recording its own close: a guard written to keep a
    //     claim honest becomes a guard forbidding the truth the moment the world moves. Inverting it
    //     is the edit, not deleting it.
    expect(r, "the fix shape must stay recorded — a close does not erase how it was done").toContain(
      "**Shape of the fix, for whichever batch takes it.**",
    )
    expect(r).toContain("What would make this row false")
    expect(
      /resolves `workflowBinding` from a parsed workflow graph/.test(r),
      "the row must now state that Gate H parses — this batch made it true",
    ).toBe(true)
    // Both halves of its own falsification condition, named. The parse alone was never sufficient:
    // "A green Gate H on valid YAML proves nothing here."
    expect(
      r,
      "the close must cite the control that applies the REJECTED bytes, not just the parse",
    ).toContain("d825330")
    // And it must record which of its own sentences did not survive. A close that quietly drops a
    // falsified reason teaches the next reader to trust row prose.
    expect(
      r,
      "the close must record that this row's own second OPEN reason was measured false",
    ).toContain("second OPEN reason was measured false")
  })

  it("the record's gate claim matches the cohort the committed snapshot can actually supply", () => {
    const text = readText(ARTIFACT)
    // REVERSED 2026-08-13, on the precedent set for S0-OPEN-5 above: the previous form asserted the
    // record must NOT claim a green gate, because `--gate` exited 2 on a 19-entry cohort. `1115639`
    // put 25 on `main` and the gate exits 0, so the old form had become a guard forbidding the truth.
    //
    // Inverted rather than deleted, and NOT into a prose match. "The record says EXIT 0" is worth
    // nothing on its own — that is the class of statement this whole file exists to distrust. The
    // claim is checked against the one committed input that decides it: the snapshot's own `count`
    // versus `S0_REQUIRED_RECORDS` parsed from the gate's source. Both are COMMITTED SOURCE, so this
    // reader still never touches `apps/web/public/**` (the constraint the docblock states) and still
    // never shells out to the gate.
    const snapshotCount = (
      JSON.parse(readText("packages/trust-index/snapshots/official-mcp-registry.json")) as {
        count: number
      }
    ).count
    // Anchored to the DECLARATION form (`^const ... = N$`), matching the helper at :654, so a
    // comment mentioning the constant cannot satisfy this — [[probe-agrees-with-the-description-not-the-claim]].
    // `stripComments` lives in `scripts/gate-s0.ts` and is not in scope here; the anchor is what
    // replaces it.
    const required = Number(
      /^const S0_REQUIRED_RECORDS = (\d+)$/m.exec(readText(GATE))?.[1],
    )
    expect(required, "S0_REQUIRED_RECORDS must be parseable, else the comparison below is vacuous").toBe(
      25,
    )
    const cohortMeetsRequirement = snapshotCount >= required
    expect(
      cohortMeetsRequirement,
      `the snapshot supplies ${snapshotCount} against a requirement of ${required} — if this is false, the record must not claim a green gate`,
    ).toBe(true)
    // Only NOW is a pass claim permitted, and it is REQUIRED: a record that stayed silent about a
    // gate it can prove green is as stale as one claiming a green it cannot.
    expect(
      /gate:s0:gate.{0,40}(passes|green|exits 0)/i.test(text) || /EXIT 0/.test(text),
      "the cohort meets the requirement, so the record must say the gate passes rather than stay stale",
    ).toBe(true)
    // And this reader must not have acquired a dependency on baked bytes.
    //
    // Read via `import.meta.url`, NOT by re-stating this file's own path: a renamed or moved test
    // would make a hardcoded path throw ENOENT (or, worse, read a stale copy left behind) and the
    // failure would name the wrong thing. The self-read is also why the comment stripper matters —
    // every mention of the forbidden path in THIS file is inside a comment, including this one.
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8").replace(/\r\n/g, "\n")
    const code = self.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    // Two-sided guard on the stripper (see [[source-scan-must-read-code-not-prose]]): a stripper
    // that removed everything would make the absence below vacuously true.
    expect(code.length, "the comment stripper must not have eaten the code").toBeGreaterThan(2000)
    expect(code, "positive control — real assertions survive the strip").toContain("expect(")
    // The needle is ASSEMBLED, never written. Its first form failed on its own first run: a scan
    // for the literal "apps/web/public" found the scan's own argument, since a comment stripper
    // removes comments and this assertion is code. A self-scanning guard whose needle is its own
    // only occurrence reports a violation that is nothing but itself — the code-side twin of
    // [[source-scan-must-read-code-not-prose]], where the scan red on the docblock arguing FOR the
    // rule. Joining the segments keeps the forbidden path out of these bytes entirely.
    const servedRoot = ["apps", "web", "public"].join("/")
    expect(
      code.includes(servedRoot),
      `this reader must not read served bytes (${servedRoot}) — running the gate for real is S0-OPEN-2's business, not a test's`,
    ).toBe(false)
    // And the assembled needle must still be the string it stands for, or the absence above is an
    // absence of something else. A typo'd segment would make it unfalsifiable.
    expect(servedRoot, "the assembled needle must equal the path it forbids").toBe(
      "apps/" + "web/" + "public",
    )
  })
})
