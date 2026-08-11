import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
// The real evaluator, not a re-implementation. A control that re-derives the gate's logic proves the
// control's logic (S0-OPEN-5's "not merely a comment claiming the parse happens").
import { evaluateNoRegression, type AggregatorReach, type ToolNameSources } from "@calllint/trust-index"

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
    const statuses = [...text.matchAll(/^\*\*Status:\*\* (?:\*\*)?(\w+)/gm)].map((m) => m[1])
    expect(
      statuses,
      "each row states a status; S0-OPEN-2/3/5 are CLOSED, S0-OPEN-1 and S0-OPEN-4 remain OPEN",
    ).toEqual(["OPEN", "CLOSED", "CLOSED", "OPEN", "CLOSED"])
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
    assertPointer(GATE, 90, "S0_REQUIRED_RECORDS = 25", "S0_REQUIRED_RECORDS")
    assertPointer(GATE, 108, "S0_REGRESSION_FLOOR = 19", "S0_REGRESSION_FLOOR")
    assertPointer(GATE, 124, "FIXTURE_PREFIX", "FIXTURE_PREFIX")
    // Drifted a SECOND time inside S batch 1, 401 → 498, when `stripComments` became string-aware; now
    // 568. Worth noting because it is the argument for content-addressed pointers rather than line
    // numbers: this one number has moved three times, and every time the failure named what it found.
    assertPointer(GATE, 568, "registryShort", "the shortfall computation")
  })

  it("the cap the record exonerates, and the un-paginated GET that exonerates it", () => {
    const f = "packages/trust-index/src/fetchRegistry.ts"
    assertPointer(f, 19, "DEFAULT_MAX_ENTRIES = 25", "the 25 cap")
    assertPointer(f, 109, ".slice(0, max)", "the cap applied after the sort")
    // The load-bearing one: a SINGLE GET with no cursor. This is why the 25 cap cannot be the
    // constraint that produced 19 — it is not even on the production path.
    assertPointer(f, 100, "doFetch(endpoint)", "the single un-paginated GET")
  })

  it("the measured upstream size, which is what falsifies the recorded reason", () => {
    assertPointer(
      "packages/adoption-index/src/identity/resolveIdentity.ts",
      16,
      "19_739",
      "the live cohort size",
    )
    assertPointer(
      "packages/adoption-index/src/operations/refreshFromMirror.ts",
      56,
      "65235",
      "the exhaustive walk",
    )
  })

  it("the served-cohort knob, and the workflow line that does not expose it", () => {
    assertPointer("packages/trust-index/src/refreshSnapshot.ts", 143, "resolveMaxEntries", "the knob")
    assertPointer(WORKFLOW, 20, "workflow_dispatch:", "the dispatch trigger")
    assertPointer(WORKFLOW, 73, "ingest:trust-index", "the ingest step")
  })
})

describe("Gate S0 — every number the record states is derived from the file it is about", () => {
  it("S0_REQUIRED_RECORDS and DEFAULT_MAX_ENTRIES are the SAME number, which the record calls a coincidence", () => {
    const required = /S0_REQUIRED_RECORDS\s*=\s*(\d+)/.exec(readText(GATE))?.[1]
    const cap = /DEFAULT_MAX_ENTRIES\s*=\s*(\d+)/.exec(
      readText("packages/trust-index/src/fetchRegistry.ts"),
    )?.[1]
    expect(required, "the gate must still define S0_REQUIRED_RECORDS at all").not.toBeUndefined()
    expect(cap, "and fetchRegistry must still define DEFAULT_MAX_ENTRIES at all").not.toBeUndefined()
    // ORDER IS LOAD-BEARING, and the first draft had it backwards. The coincidence is asserted
    // BEFORE the two literal pins because pinning both to "25" first makes this assertion
    // unreachable: any mutation that moves either constant reds on a literal pin, so the claim the
    // row actually rests on could never be the one that fails. Asserted first, moving either
    // constant alone reds HERE, by name, on the coincidence itself.
    expect(
      cap,
      "the record argues the cohort requirement and the served cap coincide — raising one alone moves the gate, so re-read S0-OPEN-1 before editing this",
    ).toBe(required)
    // And the literal values, after: both moving together keeps the coincidence true while making
    // the row's "25 is exactly the boundary" prose stale, which is a different defect needing a
    // different message.
    expect(required, "S0-OPEN-1's prose says 25; a moved requirement makes that prose stale").toBe("25")
    expect(cap, "and the served cap the prose calls 25").toBe("25")
    expect(row(1)).toContain("25 is also exactly the boundary")
  })

  it("the committed snapshot is still the stale 19 the record blames, not a fresh cohort", () => {
    // Derived from the snapshot, never restated: `count` and the actual array length are asserted
    // SEPARATELY, because a hand-edited `count` is exactly the shape that would make this record
    // read as satisfied while the cohort had not moved.
    const snap = JSON.parse(
      readText("packages/trust-index/snapshots/official-mcp-registry.json"),
    ) as { fetchedAt: string; count: number; entries: readonly unknown[] }
    expect(snap.entries.length, "count must equal the real entry count").toBe(snap.count)
    // 19 is the value ON THIS BRANCH. The 2026-08-10 amendment records a 25-entry snapshot living
    // on `trust-ingest/registry-refresh`, which is precisely why this stays 19: merging that branch
    // is the event that closes S0-OPEN-1, and this assertion is what notices it happening. When it
    // reds with 25, the row's closing conditions are met and the row must be amended to CLOSED —
    // do not "fix" this number to make the suite green.
    expect(
      snap.count,
      `the record's whole argument rests on a stale 19-entry snapshot; it now holds ${snap.count}. If this is 25, #234 landed: S0-OPEN-1's falsification test is satisfied and the row must be amended to CLOSED, not this number edited`,
    ).toBe(19)
    expect(snap.fetchedAt).toBe("2026-07-17T00:00:00.000Z")
    // And the cap did NOT bind: 19 < 25 means fewer than 25 live entries reached the slice. This is
    // the arithmetic that redirected the blame from the cap to the stale pipeline.
    expect(
      snap.count,
      "a 25-cap over >=25 live entries yields exactly 25; 19 proves the cap never bound",
    ).toBeLessThan(Number(/DEFAULT_MAX_ENTRIES\s*=\s*(\d+)/.exec(
      readText("packages/trust-index/src/fetchRegistry.ts"),
    )?.[1]))
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
    expect(
      steps.length,
      `S0-OPEN-2's amendment states 20 &&-joined steps; ci:local now has ${steps.length}`,
    ).toBe(20)
    expect(row(2), "the row must state the new count, since wiring the gate is what changed it").toContain(
      "**20**",
    )
    // All three scripts must exist, or S0-OPEN-2's closure describes a gate that is gone.
    expect(Object.keys(pkg.scripts).filter((k) => k.startsWith("gate:s0")).sort()).toEqual([
      "gate:s0",
      "gate:s0:gate",
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

  it("the three env knobs are named in prose as workflow_dispatch inputs the workflow does not have", () => {
    const wf = readText(WORKFLOW)
    // ABSENCE, guarded by the vacuity check above plus a positive control on the same file: the
    // trigger IS present, so a `workflow_dispatch:` that gained `inputs:` is distinguishable from a
    // workflow that lost the trigger entirely.
    expect(wf, "positive control — the dispatch trigger itself must be present").toContain(
      "workflow_dispatch:",
    )
    expect(
      /workflow_dispatch:\s*\n\s+inputs:/.test(wf),
      "S0-OPEN-1's second half rests on workflow_dispatch having NO inputs; it now has some, so that half is discharged and the row must be amended",
    ).toBe(false)
    // The ingest step must still set no env. Sliced between asserted boundaries, never by indexOf
    // alone (ADR 0064 §6.2).
    const stepStart = wf.indexOf("- name: Ingest —")
    const stepEnd = wf.indexOf("- name: Resolve evidence")
    expect(stepStart, "the ingest step must be present").toBeGreaterThan(-1)
    expect(stepEnd, "and the step after it, to bound the slice").toBeGreaterThan(stepStart)
    const step = wf.slice(stepStart, stepEnd)
    expect(
      /^\s+env:/m.test(step),
      "the ingest step sets no env:, which is why the three knobs need a code change — if it gained one, re-read S0-OPEN-1",
    ).toBe(false)

    // DERIVED from the source's own prose, not restated: the docblock claims the knob is a
    // workflow_dispatch input. That claim is what the two assertions above falsify.
    //
    // The comment furniture is stripped BEFORE whitespace is collapsed. A bare `\s+`→" " leaves the
    // continuation `*` sitting inside the sentence ("(workflow_dispatch * input)"), so the needle
    // would miss and this would read as "the claim is gone" — a false green on the one assertion
    // that establishes there is a false claim to refute.
    const prose = readText("packages/trust-index/src/refreshSnapshot.ts")
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ")
    expect(
      prose,
      "resolveMaxEntries' docblock must still make the workflow_dispatch-input claim this row refutes",
    ).toContain("TRUST_INGEST_MAX_ENTRIES (workflow_dispatch input)")
    expect(
      prose,
      "and the 'ONLY knob' claim the row quotes must still be there to be quoted",
    ).toContain("the ONLY knob for 37 → 100+")
    for (const knob of [
      "TRUST_INGEST_MAX_ENTRIES",
      "TRUST_INGEST_MIRROR_MAX_ENTRIES",
      "TRUST_INGEST_MIRROR_MAX_PAGES",
    ]) {
      expect(row(1), `S0-OPEN-1 must name ${knob}`).toContain(knob)
      expect(
        wf.includes(`${knob}:`),
        `${knob} is named in prose as operator-settable but the workflow does not set or expose it`,
      ).toBe(false)
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
    // The refusal message became interpolated when `--regression` joined it (`under ${mode}`), so the
    // old literal `--no-run is refused under --gate` no longer appears in the source. This assertion
    // was correct to red on that change: it pins a real behaviour. What it pins is now the GUARD
    // rather than the string, and the guard is asserted to cover BOTH enforcing modes — a narrower
    // check would have gone green again the moment `--regression` was exempted from it.
    expect(gate, "--no-run must be refused under an enforcing mode, not honoured with a warning").toMatch(
      /\(isGate \|\| isRegression\) && noRun/,
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

  it("the ratchet floor is at or below the requirement, and matches the cohort actually served", () => {
    const floor = constant("S0_REGRESSION_FLOOR")
    const required = constant("S0_REQUIRED_RECORDS")

    // The relationship, not the values. A floor ABOVE the requirement would red the ratchet on
    // cohorts `--gate` accepts, inverting the two modes. The gate asserts this at load time too;
    // pinned here as well because that check exits the process, which a test cannot observe.
    expect(floor, "the ratchet floor must never exceed the requirement it sits under").toBeLessThanOrEqual(
      required,
    )

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

  it("neither enforcing mode can be asked to skip itself, and the two modes cannot be combined", () => {
    const gate = readText(GATE)
    // `--no-run` was already refused under `--gate`. `--regression` is the mode CI runs, which is
    // where an escape hatch would matter most, so the refusal must cover it.
    expect(gate, "--no-run must be refused under --regression too").toMatch(
      /\(isGate \|\| isRegression\) && noRun/,
    )
    expect(gate, "and the refusal must name which mode refused").toContain(
      "enforcement cannot be asked to skip itself",
    )
    // Combining them is refused rather than resolved by precedence: they enforce different claims,
    // so silently honouring one prints a verdict the caller did not ask for.
    expect(gate, "--gate and --regression must be mutually exclusive").toMatch(/isGate && isRegression/)
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
  it("S0-OPEN-1 stays OPEN, names the false reason verbatim, and warns off PR #234", () => {
    const r = row(1)
    expect(r).toContain("**Status:** OPEN")
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
    const flat = r.replace(/\s+/g, " ")
    expect(flat, `S0-OPEN-5 states the row count; REGRESSION_CHECKS now has ${rows}`).toContain(
      `**${rows} rows**`,
    )
    expect(flat, `S0-OPEN-5 states the remoteOnly count; the source now has ${remoteOnly}`).toContain(
      `of which **${remoteOnly}** are \`remoteOnly\``,
    )

    // (2) The bound/null split, read from the drift-checked artifact rather than from the row.
    const gateH = JSON.parse(readText("artifacts/phase-2.4/gate-H-no-regression.json")) as {
      regressionChecks: { id: string; workflowBinding: string | null }[]
    }
    const checks = gateH.regressionChecks ?? []
    expect(checks.length, "Gate H's artifact must carry its regressionChecks array").toBe(rows)
    const bound = checks.filter((c) => c.workflowBinding !== null)
    expect(
      flat,
      `S0-OPEN-5 states how many checks are recorded as bound; the artifact records ${bound.length}`,
    ).toContain(`**${bound.length} bound**`)
    // And the row's HEADING must carry the same number, because that is the sentence a reader sees
    // first. Two copies of a figure in one row is exactly the situation ADR 0069 §3.1 records going
    // wrong — prose and value written together from one reading, with nothing checking either.
    expect(
      flat,
      `S0-OPEN-5's heading states how many checks are text-matched; the artifact records ${bound.length}`,
    ).toContain(`asserts ${bound.length} checks are "wired" by matching text`)
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
    assertPointer(
      "scripts/phase-2.4-gates.ts",
      792,
      "function bindCheck",
      "S0-OPEN-5's cited structural binding decision",
    )
    assertPointer(
      "scripts/phase-2.4-gates.ts",
      742,
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

  it("the record does not claim the gate passes, and does not run it", () => {
    const text = readText(ARTIFACT)
    // Guarded by the vacuity check. The record must not assert a green gate anywhere: `--gate`
    // exits 2 today, and a record claiming otherwise would be the same class of false statement it
    // was written to correct.
    expect(
      /gate:s0:gate.{0,40}(passes|green|exits 0)/i.test(text),
      "the record must not claim the enforcing gate passes — it exits 2 on the cohort today",
    ).toBe(false)
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
