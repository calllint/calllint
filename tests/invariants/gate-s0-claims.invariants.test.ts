import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

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
  it("the artifact parses, carries all three rows, and is substantial", () => {
    const text = readText(ARTIFACT)
    expect(text.length, "an empty artifact makes every absence assertion below vacuous").toBeGreaterThan(
      4000,
    )
    const headings = [...text.matchAll(/^## S0-OPEN-(\d+)/gm)].map((m) => m[1])
    expect(headings, "all three rows must be present, in order").toEqual(["1", "2", "3"])
    // Set equality over statuses, not `.every()`: a boolean collapse prints "expected false to be
    // true" with no name on it, and passes vacuously on an empty array.
    const statuses = [...text.matchAll(/^\*\*Status:\*\* (\w+)$/gm)].map((m) => m[1])
    expect(statuses, "each row states a status; all three are OPEN today").toEqual([
      "OPEN",
      "OPEN",
      "OPEN",
    ])
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
    assertPointer(GATE, 45, "S0_REQUIRED_RECORDS = 25", "S0_REQUIRED_RECORDS")
    assertPointer(GATE, 52, "FIXTURE_PREFIX", "FIXTURE_PREFIX")
    assertPointer(GATE, 234, "registryShort", "the shortfall computation")
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

  it("ci:local's step count is counted, not quoted, and still excludes gate:s0", () => {
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
    expect(
      steps.filter((s) => /gate:s0/.test(s)),
      "gate:s0 is now INSIDE ci:local (argued against at scripts/gate-s0.ts:5-7) — that closes S0-OPEN-2, so amend the row instead of leaving it OPEN",
    ).toEqual([])
    expect(
      steps.length,
      `S0-OPEN-2 states 19 &&-joined steps; ci:local now has ${steps.length}`,
    ).toBe(19)
    expect(row(2)).toContain("**19**")
    // Both scripts must still exist, or S0-OPEN-2 describes a gate that is gone.
    expect(Object.keys(pkg.scripts).filter((k) => k.startsWith("gate:s0")).sort()).toEqual([
      "gate:s0",
      "gate:s0:gate",
    ])
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

  it("the five assertion IDs S0-OPEN-3 tabulates are the five the gate prints", () => {
    const gate = readText(GATE)
    // Parse the gate's OWN provenance labels rather than trusting the table. A rename flips three
    // of five assertions without any behaviour changing, and this is where it reds.
    const ids = (re: RegExp): readonly string[] =>
      [...gate.matchAll(re)].map((m) => m[1]).filter((s): s is string => s !== undefined)
    const measured = ids(/\[MEASURED\]\s+(\S+)/g)
    const verified = ids(/\[GATE-VERIFIED\]\s+(\S+)/g)
    expect(measured, "two MEASURED assertions, by id").toEqual(["INV-R5", "INV-R4"])
    expect(verified, "three GATE-VERIFIED assertions, by id").toEqual(["INV-04+R7", "INV-R6", "DEP-8"])
    // The SPLIT is the claim, not the ids alone: S0-OPEN-3's whole argument is 3-of-5 verified by
    // reading a string. A batch that promotes one to MEASURED changes that ratio, and the row must
    // be amended rather than left describing a split that moved.
    expect(measured.length + verified.length, "five assertions in total").toBe(5)
    const r = row(3)
    expect(r, "the row's count must match the parsed split").toContain("three of S0's five")
    for (const id of [...measured, ...verified]) {
      expect(r, `S0-OPEN-3's table must name ${id}`).toContain(id.replace("+R7", " + INV-R7"))
    }
    expect(r).toContain("control #117")
    expect(gate, "INV-R6's probe still looks for the control identifier it is verified by").toContain(
      "control #117",
    )
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
    for (const n of [1, 2, 3]) {
      expect(
        row(n),
        `S0-OPEN-${n} must state what would make it false — a row without one cannot be closed on evidence`,
      ).toContain("What would make this row false")
    }
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
