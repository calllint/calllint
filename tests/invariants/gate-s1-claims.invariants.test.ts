import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
// The shipped slug function, imported rather than re-derived — for the same reason the gate itself
// imports it. Workstream R measured raw-name joins at 0/19 and slug joins at 19/19, so a local copy
// of the slug rule is precisely how a completeness measure agrees with itself instead of with the
// served tree.
import { registryCanonicalName, REGISTRY_NAMESPACE } from "../../packages/trust-index/src/snapshot.js"

// The first machine reader of `artifacts/gate-s1/**`, and the first machine reader of ANY Gate S1
// record — because until this batch there was nothing to read.
//
// WHAT THIS SUITE IS ABOUT, and it is a different failure from the one the S0 suite guards. S0's
// status lived in a gitignored file, so its record was UNREAD and the reason recorded there was
// false. S1 had no record at all, and no gate: no script, no npm script, no CI step, no test. The
// cohort then went 19 → 100 → 150 under ADR 0086's auto-growth and crossed S1's own 100-record
// threshold with nothing on the other side of it.
//
// So the fault class is one rung past the repo's usual one. `memory/maps/guards.md` names the
// dominant defect as *a guard that cannot observe its subject*; S1 was **a threshold with no guard
// at all** — the limit case, and harder to notice, because a missing guard has no green to inspect.
// The proof the crossing actually happened rather than being inferred from a plan is Gate S0's
// `S0_REGRESSION_FLOOR = 150`: a ratchet that followed the growth up while the gate meant to grade
// that growth did not exist.
//
// NOTHING HERE RUNS `gate:s1`, and that is deliberate for the reason the S0 suite gives: running it
// would read `apps/web/public/trust/index.json` and couple this suite to baked bytes. The
// assertions are over S1's COMMITTED SOURCE, its tracked record, and the wiring — which is what
// keeps the record from drifting away from the gate.
//
// THREE LAYERS, modelled on the S0 suite because the failure modes are the same ones:
//   1. POINTER TRUTH — every `path:line` claim resolves to a line CONTAINING what it claims.
//      Asserting mere existence is satisfied by a blank line (M26-3's pointer at :61 was blank).
//   2. DERIVED-NOT-RESTATED — every number the artifact states is recomputed from the file it is
//      about, so a record that restates a constant cannot agree with it after it moves.
//   3. ROW STATUS + THE REFUSAL — each row's `**Status:**` is asserted verbatim, and the
//      load-bearing claim (four measures REFUSED, never computed) is asserted against the SOURCE,
//      not against the prose that describes it.
//
// THE ASSERTION THIS SUITE EXISTS FOR is in layer 3: that no refusal can be turned into a number.
// A rate over an empty denominator renders as a PERFECT SCORE, and that is not hypothetical — it is
// verbatim the defect `gate-s0.ts`'s own first INV-R4 shipped: a nonexistent sidecar path,
// `existsSync` false on all 39 iterations, the loop `continue`ing every time, and "0 dangerous
// false-SAFE" printed as PASS from zero observations. A `0/0` in Gate S1 would print a flawless S1
// for a subsystem that has never executed.
const repoRoot = new URL("../../", import.meta.url)

const readRaw = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, repoRoot)), "utf8")

// Normalized at the reader, per ADR 0064 §6.2. Same honest caveat the S0 suite records: JS treats
// `\r` as a line terminator under `/m` and `toContain` never sees a trailing byte, so this is
// defense-in-depth for assertions not yet written rather than what keeps the suite green. The
// `eol=lf` pin is guarded by the explicit CR-byte assertion below, which is the only thing here
// that fails when the pin is removed.
const readText = (rel: string): string => readRaw(rel).replace(/\r\n/g, "\n")

const ARTIFACT = "artifacts/gate-s1/open-items.md"
const GATE = "scripts/gate-s1.ts"

/** The seven measures new15 §342 names, in the order it names them. */
const SEVEN_MEASURES = [
  "source-completeness",
  "artifact-resolution",
  "page-quality",
  "adapter-failure-rate",
  "processing-time-mean-p95",
  "cas-dedup-rate",
  "disk-growth",
] as const

/**
 * The two that still have no data source in this checkout. Asserted as REFUSED, never as a number.
 *
 * NARROWED TWICE, and each narrowing is the thing to check rather than accept.
 *
 * FOUR → THREE (compiler-run bookkeeping): `adapter-failure-rate` acquired a real source
 * (`reports/run-<id>.json`, written by `refreshSnapshot.ts` around every ingest), so pinning it as
 * permanently-REFUSED would have pinned a false claim.
 *
 * THREE → TWO (ADR 0093, 2026-08-31): `cas-dedup-rate` acquired one the same way — `cas/manifests`
 * was the one blocker on this row that named a MISSING WRITER, and the writer now exists
 * (`packages/adoption-index/src/artifacts/casManifest.ts`). Its blocker is now the SAME as
 * `adapter-failure-rate`'s: no run has executed against this checkout. Both moved to
 * `ATTEMPT_SOURCED_MEASURES` below, where the assertions on them are STRICTER, not absent — a measure
 * with a source has more ways to go wrong than one with none.
 *
 * TWO → ONE (ADR 0097, 2026-09-01): `processing-time-mean-p95` acquired one, and this narrowing is
 * unlike the two above — no writer was built. Its recorded blocker was WRONG. The row said the measure
 * needed `started_at`/`finished_at` columns on `compiler_jobs` plus a migration; in fact `compiler_runs`
 * has carried both fields since the canonical DDL, the table the row named holds zero rows and has no
 * non-test writer, and the durations those columns would have yielded are 0 ms by construction. So the
 * measure was refusing for a reason that had stopped being true, behind a verdict that stayed correct
 * — which is why nobody re-derived it (the ADR 0096 fault class, twice in a row). It now reads a
 * monotonic per-attempt duration and moves to `ATTEMPT_SOURCED_MEASURES`.
 *
 * The one that remains did NOT acquire a source: `disk-growth` is blocked on elapsed time, which no
 * amount of building can produce. That per-measure divergence is asserted in its own test below,
 * because the batch that first narrowed this list found all four sharing one hint that was true of
 * only one of them.
 */
const REFUSED_MEASURES = ["disk-growth"] as const

/**
 * The measures that HAVE a source and may therefore reach `measured(...)` — where the assertions get
 * stricter rather than disappearing.
 *
 * Both are blocked on the same thing today (no run in this checkout) and neither may be pinned as
 * permanently-refused: an assertion that reds because a claim became TRUE is pinning the wrong
 * property, which is what the three → two narrowing above was forced by.
 */
const ATTEMPT_SOURCED_MEASURES = [
  "adapter-failure-rate",
  "cas-dedup-rate",
  "processing-time-mean-p95",
] as const

/**
 * Slice one `## S1-OPEN-N` row, asserting BOTH boundaries.
 *
 * A bare `indexOf` + `slice(start, -1)` is the ADR 0064 §6.2 shape: a missing end marker yields -1,
 * the row silently widens to the rest of the file, and every assertion over it then passes against
 * text from a different row. Both ends are asserted before the cut; the last row is sliced to
 * end-of-file explicitly rather than by falling through to -1.
 */
function row(n: number): string {
  const text = readText(ARTIFACT)
  const start = text.indexOf(`## S1-OPEN-${n}`)
  expect(start, `${ARTIFACT} must carry a "## S1-OPEN-${n}" heading`).toBeGreaterThan(-1)
  const nextIdx = text.indexOf(`## S1-OPEN-${n + 1}`)
  const end = nextIdx === -1 ? text.length : nextIdx
  expect(end, `the S1-OPEN-${n} row must not be empty`).toBeGreaterThan(start)
  return text.slice(start, end)
}

/**
 * Strip comments so an assertion about a REFUSAL MESSAGE reads the message, not a docblock above it.
 *
 * This suite shipped the defect it was written to prevent, and the negative control is what found it.
 * `blocked on SCHEMA` appeared TWICE in `gate-s1.ts`: once in the runtime refusal and once in the
 * docblock that describes it. Rewriting only the refusal — collapsing three distinct blockers back into
 * one shared "no data source" hint, which is the exact regression the test below names — left the suite
 * GREEN, because the regex still matched the comment.
 *
 * (That example is now HISTORICAL: ADR 0097 retracted the SCHEMA blocker, so the phrase survives in
 * `gate-s1.ts` only as struck prose, and the test below asserts it is absent from the CODE. The
 * stripper is not historical — `blocked on TIME` still appears in both a refusal and its docblock, and
 * every future blocker will too, because a refusal worth making is a refusal worth explaining.) The test was vouched for
 * by prose ARGUING FOR the rule while the enforced string no longer said it, which is this describe
 * block's own title read backwards, and one rung past the dominant fault class in
 * `memory/maps/guards.md`: not a guard that cannot observe its subject, but a guard observing the
 * ARGUMENT for its subject and reporting on the subject.
 *
 * Lifted from `scripts/gate-s0.ts:594` character-for-character rather than re-derived as a regex, for
 * the reason recorded there: a leading-whitespace-anchored line pattern misses a TRAILING comment,
 * while an unanchored one eats the slashes inside a `https:` URL in a string. Only tracking quote
 * state admits both. The two-sided guard below is what keeps that honest — a copied stripper with no
 * copied self-test is a precondition nobody checks.
 *
 * (Written without quoting either pattern: a docblock containing the literal two-character line
 * marker preceded by a star-slash closes itself, which is how the first draft of this comment turned
 * the whole suite into a syntax error and reported `no tests` rather than a failure.)
 */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "")
  let out = ""
  let quote: string | null = null
  for (let i = 0; i < noBlocks.length; i++) {
    const c = noBlocks[i]!
    if (quote !== null) {
      out += c
      if (c === "\\") {
        out += noBlocks[++i] ?? ""
      } else if (c === quote) {
        quote = null
      }
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      out += c
      continue
    }
    if (c === "/" && noBlocks[i + 1] === "/") {
      while (i < noBlocks.length && noBlocks[i] !== "\n") i++
      out += "\n"
      continue
    }
    out += c
  }
  return out
}

/** `gate-s1.ts` with comments removed — what a reader of the gate's OUTPUT would actually see. */
const gateCode = (): string => stripComments(readText(GATE))

/** Assert a `path:line` pointer resolves to a line CONTAINING `expected`. */
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

describe("Gate S1 — the record parses, and it is not degenerate", () => {
  // VACUITY GUARD, running before any absence is asserted below. Every "the record does not say X"
  // assertion is vacuously true against an empty or missing file, so size and row count are pinned
  // first. [[absence-makes-a-gate-skip-itself]].
  it("the artifact parses, carries all five rows, and is substantial", () => {
    const text = readText(ARTIFACT)
    expect(
      text.length,
      "a record short enough to be a stub cannot carry the reasoning the rows below assert",
    ).toBeGreaterThan(4000)
    for (const n of [1, 2, 3, 4, 5]) {
      expect(text, `${ARTIFACT} must carry a "## S1-OPEN-${n}" heading`).toContain(`## S1-OPEN-${n}`)
    }
    // Pinned as a count so a new row cannot be added without this suite gaining assertions for
    // it — the shape S0-OPEN-5 grew into when a 20th REGRESSION_CHECKS row arrived unread.
    //
    // Raised 3→4 on 2026-08-28 for S1-OPEN-4, and 4→5 on 2026-08-31 for S1-OPEN-5. BOTH raises were
    // EARNED rather than typed: each time, this assertion redded first with "a new row needs its own
    // assertions rather than inheriting these", and the per-row block below is those assertions.
    // Bumping the literal alone would have been the exact evasion the message names — which is why the
    // literal is kept instead of being derived from the heading count. A self-deriving count would
    // accept any number of unexamined rows, turning the tripwire into a mirror.
    const rows = [...text.matchAll(/^## S1-OPEN-\d+/gm)]
    expect(
      rows.length,
      "five rows are asserted here; a sixth needs its own assertions rather than inheriting these",
    ).toBe(5)
  })

  // The ONLY assertion that fails when the `eol=lf` pin is removed. The normalization at the reader
  // makes every other assertion here `\r`-tolerant, which is exactly why the pin needs a dedicated
  // reader: control #181 proved the S0 suite stayed green with its pin deleted AND the artifact
  // converted to CRLF.
  it("the artifact is committed LF, which is what the .gitattributes pin claims", () => {
    expect(
      readRaw(ARTIFACT).includes("\r"),
      `${ARTIFACT} must contain no CR bytes — .gitattributes pins artifacts/gate-s1/** text eol=lf`,
    ).toBe(false)
    expect(
      readText(".gitattributes"),
      "the pin must exist, or this assertion is guarding a claim nothing makes",
    ).toContain("artifacts/gate-s1/** text eol=lf")
  })
})

describe("Gate S1 — every path:line the record cites still points at what it claims", () => {
  it("the gate's own constants and its refusal type are where they are claimed to be", () => {
    // Content-anchored, not existence-anchored, and the S0 suite's history is the argument: those
    // pointers have drifted TEN times across ten batches, and every drift was harmless only because
    // the anchor matched content. Five of the ten reds quoted docblock prose — a line that existed.
    //
    // Drifted 93→106 / 108→121 / 155→203 on 2026-08-28, when the mis-rooted-store correction lengthened
    // the gate's docblock. Worth recording as the eleventh drift and the first on THIS suite: the red
    // named what it actually read (`"  registryCanonicalName,"`), which is the entire difference between
    // this and an `existsSync`-style check that a blank line satisfies.
    //
    // Drifted 203→214 on 2026-09-01 (ADR 0096), when that same docblock grew again to record that its
    // `ADOPTION_INDEX_CWD` override was a PREFERRED candidate rather than an exclusive one. Twelfth
    // drift, and the red again quoted the line it read (`"  readonly status: string"`).
    assertPointer(GATE, 106, "S1_REQUIRED_RECORDS = 100", "S1_REQUIRED_RECORDS")
    assertPointer(GATE, 121, "function committedRegistryCohort", "the derived ratchet floor")
    assertPointer(GATE, 214, "type Outcome", "the outcome union that makes refusal first-class")
  })

  it("the committed snapshot and the served index are where the gate reads them", () => {
    // Both are the gate's inputs. A moved path would make the gate read nothing and — depending on
    // its error handling — either refuse everything or, worse, measure over an empty set.
    for (const p of [
      "packages/trust-index/snapshots/official-mcp-registry.json",
      "apps/web/public/trust/index.json",
    ]) {
      expect(existsSync(fileURLToPath(new URL(p, repoRoot))), `${p} must exist — the gate reads it`).toBe(
        true,
      )
    }
    const src = readText(GATE)
    expect(src, "the gate must read the committed snapshot").toContain(
      "packages/trust-index/snapshots/official-mcp-registry.json",
    )
    expect(src, "the gate must read the served index").toContain("apps/web/public/trust/index.json")
  })
})

describe("Gate S1 — every number the record states is derived from the file it is about", () => {
  it("the record's claim about its OWN size is derived from this suite, not restated", () => {
    // The record describes this suite as "N `it` blocks", and until now that N was a hand-written
    // number nothing checked. It said **19** while the suite held 28 — stale by nine, and stale in the
    // flattering direction, which is the direction that matters: a record understating its own coverage
    // invites someone to "add the missing tests" that already exist, and one overstating it vouches for
    // assertions nobody wrote.
    //
    // The defect is that layer 2 of this very file ("every number the record states is recomputed from
    // the file it is about") was applied to every number EXCEPT the record's description of its own
    // reader. A rule with a hole exactly where the rule is written down is the same shape as a guard
    // that cannot observe itself, so the hole is closed here rather than the number merely corrected.
    const suite = readText("tests/invariants/gate-s1-claims.invariants.test.ts")
    // Counted from `it(` at a line start (modulo indentation), which is what a reader means by a test.
    // Not `expect(` — that count changes with every assertion added inside an existing block, so it
    // would red on work that does not change what the record claims.
    const blocks = suite.match(/^\s*it\(/gm)?.length ?? 0
    expect(blocks, "this suite must contain tests for the count to be about anything").toBeGreaterThan(0)
    expect(
      readText(ARTIFACT),
      `the record must state this suite's real size (${blocks} \`it\` blocks), derived rather than remembered`,
    ).toContain(`**${blocks} \`it\` blocks, three layers**`)
  })

  it("the 100-record requirement the record names is the gate's own constant", () => {
    const src = readText(GATE)
    const m = src.match(/const S1_REQUIRED_RECORDS = (\d+)/)
    expect(m?.[1], "the gate must declare S1_REQUIRED_RECORDS").not.toBeUndefined()
    expect(
      Number(m?.[1]),
      "S1 is the 100-record slice on the S0(25) → S1(100) → S2(500) ladder",
    ).toBe(100)
    // Derived from the source, not restated: if the constant moves, this reds rather than the
    // record quietly describing a different gate.
    expect(
      readText(ARTIFACT),
      `the record must state the same requirement the gate enforces (${m?.[1]})`,
    ).toContain(`**150 / 100 required**`)
  })

  it("the cohort census the record states is recomputed from the committed bytes", () => {
    const snapshot = JSON.parse(readText("packages/trust-index/snapshots/official-mcp-registry.json")) as {
      count: number
      entries: { name: string }[]
    }
    // `count` is a hand-editable field; the entries array is the fact. Asserted against each other
    // for the same reason the S0 suite does it — a snapshot whose header disagrees with its body
    // would let a census claim be true of neither.
    expect(
      snapshot.entries.length,
      "the snapshot's `count` must agree with its own entries array",
    ).toBe(snapshot.count)

    const index = JSON.parse(readText("apps/web/public/trust/index.json")) as {
      entries: { canonicalName: string; status?: string }[]
    }
    const servedRegistry = index.entries.filter((e) =>
      e.canonicalName.startsWith(`${REGISTRY_NAMESPACE}/`),
    )

    // THE MEASUREMENT THE GATE MAKES, recomputed here independently. Joined on the SLUG via the
    // shipped function: raw-name joins measured 0/19 in Workstream R.
    //
    // `registryCanonicalName` RETURNS the namespaced form (`mcp-registry/slug`) — it is not a bare
    // slug needing a prefix. Writing `${REGISTRY_NAMESPACE}/${registryCanonicalName(...)}` here
    // produced `mcp-registry/mcp-registry/…` and missed all 150, i.e. the reverse of the failure this
    // suite is checking for, and it reported the gate's own subject as broken. Noted rather than
    // quietly fixed: importing the shipped function is necessary but not sufficient — mis-composing
    // it is the same 0/N join Workstream R measured for raw names. The 0-of-150 shape is the tell.
    const servedNames = new Set(servedRegistry.map((e) => e.canonicalName))
    const missing = snapshot.entries.filter((e) => !servedNames.has(registryCanonicalName(e.name)))
    expect(
      missing.map((e) => e.name),
      "every committed source record must have a served page — this is source-completeness, the measure Gate S1 exists to take",
    ).toEqual([])

    // The record's stated figures, derived rather than trusted.
    const artifact = readText(ARTIFACT)
    expect(
      artifact,
      `the record states the source census; the snapshot holds ${snapshot.entries.length}`,
    ).toContain(`${snapshot.entries.length}/${snapshot.entries.length} source records reached the served tree`)
    expect(
      artifact,
      `the record states the served census; the index holds ${servedRegistry.length} registry pages`,
    ).toContain(`served **${servedRegistry.length} registry pages / ${snapshot.entries.length}\ncommitted**`)
  })

  it("the cohort really did cross 100 — so S1's threshold was passed with no gate present", () => {
    // The load-bearing FINDING, asserted rather than narrated. If this reds, either the cohort
    // shrank below the threshold (in which case S1's absence was harmless after all) or the
    // snapshot stopped being the cohort's source.
    const snapshot = JSON.parse(readText("packages/trust-index/snapshots/official-mcp-registry.json")) as {
      entries: unknown[]
    }
    expect(
      snapshot.entries.length,
      "the record's central claim is that the cohort crossed S1's 100 threshold; if it did not, the record needs rewriting rather than this assertion softening",
    ).toBeGreaterThanOrEqual(100)

    // The SECOND, INDEPENDENT witness to the same crossing: Gate S0's ratchet followed the growth
    // while Gate S1 did not exist. Read from S0's source, not from S1's prose about it.
    const s0 = readText("scripts/gate-s0.ts")
    const floor = s0.match(/const S0_REGRESSION_FLOOR = (\d+)/)
    expect(floor?.[1], "Gate S0 must still declare its ratchet floor").not.toBeUndefined()
    expect(
      Number(floor?.[1]),
      "S0's ratchet advanced past 100 while S1 had no script at all — that is the evidence the threshold was crossed unobserved",
    ).toBeGreaterThanOrEqual(100)
  })
})

describe("Gate S1 — the refusal is enforced by the source, not by the prose that describes it", () => {
  // TWO-SIDED GUARD on the stripper copied from `gate-s0.ts:594`, over a synthetic fixture rather than
  // over `gate-s1.ts`, so it measures the function and not today's file. Both directions are failures
  // of equal weight, and both are the reason the character scanner exists instead of a regex:
  //
  //   under-strip → a refusal message stays "present" via the docblock above it (the defect being fixed)
  //   over-strip  → every message reads as absent, and a correct gate reports as broken
  //
  // Asserted FIRST in this describe block: a stripper checked after the assertions that depend on it
  // is a precondition nobody checks ([[assertion-order-decides-falsifiability]]).
  it("the comment stripper keeps code and drops prose, in both directions", () => {
    const KEEP = `refused("x", "blocked on SCHEMA")`
    const KEEP_URL = `refused("y", "see https://x.dev — blocked on SCHEMA")`
    const fixture = [
      `// a comment saying blocked on SCHEMA`,
      `/* a block saying blocked on SCHEMA */`,
      KEEP,
      KEEP_URL,
      `const z = 1 // a trailing comment saying blocked on SCHEMA`,
    ].join("\n")
    const out = stripComments(fixture)
    expect(
      out.split("blocked on SCHEMA").length - 1,
      "exactly the two in-string occurrences must survive — 3 means comments leaked, <2 means over-strip",
    ).toBe(2)
    expect(out, "a plain refusal message must survive stripping").toContain(KEEP)
    expect(out, "a refusal message containing `https://` must survive — the control #169 case").toContain(
      KEEP_URL,
    )
  })

  it("all seven measures new15 names are present in the gate, under those exact ids", () => {
    const src = readText(GATE)
    for (const id of SEVEN_MEASURES) {
      expect(src, `the gate must take (or refuse) the "${id}" measure new15 §342 names`).toContain(
        `"${id}"`,
      )
    }
  })

  it("the measure with no data source is REFUSED, and cannot be reported as a rate", () => {
    const src = gateCode()
    // THE ASSERTION THIS FILE EXISTS FOR. Each must be passed to `refused(...)` — not to
    // `measured(...)`. A future batch computing any of them over the empty store would print a
    // perfect score, which is the exact defect gate-s0.ts's first INV-R4 shipped.
    for (const id of REFUSED_MEASURES) {
      const refusedCall = new RegExp(`refused\\(\\s*"${id}"`)
      expect(
        src,
        // The reason names the QUEUE tables, not "the store", and that wording is load-bearing: the
        // store is NOT empty (298 subjects, 45 blobs — see S1-OPEN-4), and a failure message repeating
        // the struck claim would teach the next reader the same false thing the gate's docblock did.
        `"${id}" has no data source in this checkout, so it must be REFUSED — computing it as 0/0 renders as a perfect score`,
      ).toMatch(refusedCall)
      const measuredCall = new RegExp(`measured\\(\\s*"${id}"`)
      expect(
        src,
        `"${id}" must NOT be reported as a measured value while its data source is empty`,
      ).not.toMatch(measuredCall)
    }
  })

  it("a measure WITH a source keeps both paths — it may report, and it must still be able to refuse", () => {
    const src = gateCode()
    // THE OTHER HALF, and the one the list above cannot state. `REFUSED_MEASURES` has shrunk three times
    // (four → three → two → one), each time because a measure acquired a source, and each time the
    // protection that measure had — "must never reach `measured(...)`" — was correctly deleted. Deleted
    // and not replaced is how a measure ends up with no guard at all: it is now ALLOWED to print a
    // number, and nothing here would notice if that became the only thing it could do.
    //
    // So the property asserted is the PAIR. A sourced measure must retain a reachable `refused(...)`,
    // because every one of these reads a file that may be absent, unreadable, or empty, and the repo's
    // dominant fault is a rate computed over an empty denominator rendering as a perfect score. A batch
    // that "simplified" any of these by defaulting the missing case to zero would delete the refusal
    // call, and this is the assertion that reds.
    for (const id of ATTEMPT_SOURCED_MEASURES) {
      expect(
        src,
        `"${id}" has a source, so it must be able to report a number`,
      ).toMatch(new RegExp(`measured\\(\\s*"${id}"`))
      expect(
        src,
        `"${id}" must ALSO keep a refusal path — its source can be absent or empty, and 0/0 renders as a perfect score`,
      ).toMatch(new RegExp(`refused\\(\\s*"${id}"`))
    }
  })

  it("each remaining refusal names its OWN blocker, not one shared hint", () => {
    const src = gateCode()
    // The defect this test is the measurement for. All four runtime measures once shared one refusal
    // hint — "no queue driver exists (S1-OPEN-1)" — which was true of none of them exactly. Attempts
    // WERE happening (all four compile stages are wired and default-ON in `refreshSnapshot.ts`); they
    // were simply unrecorded. Pinning three genuinely different blockers behind one sentence sent the
    // reader to build a driver that would have fixed none of the three that remain.
    //
    // Asserted as three DISTINCT causes, because a future batch collapsing them back into a shared
    // constant is the regression, and a shared constant reads as tidier than the truth.
    //
    // READ FROM `gateCode()`, NOT `readText(GATE)`, and that is the whole point of this test now: the
    // first version read raw text, and each of these three phrases appears twice — once in the refusal
    // and once in the docblock describing it. A negative control that collapsed the refusals back to a
    // shared hint left this GREEN off the comments alone. What a reader sees is the MESSAGE.
    // `processing-time-mean-p95` USED TO BE ASSERTED HERE, as `blocked on SCHEMA … started_at`. It was
    // removed rather than rewritten, and the distinction matters: it is no longer refused for a blocker
    // at all, so there is no per-measure blocker left to pair. ADR 0097 retracted the one it had (the
    // named columns were the wrong table, and the recorded remedy would have produced 0 ms). Its three
    // refusal states are asserted BY EXECUTION in CASE 2d below, which is the only instrument that can
    // tell three branches of one template apart — the lesson `stripComments` is here to record.
    expect(src, "disk-growth is blocked on elapsed time, and nothing else").toMatch(
      /blocked on TIME[\s\S]{0,300}two measurements/,
    )
    // And the retracted blocker must not come back as a live claim. The gate may still DESCRIBE it —
    // ADR 0097 requires it to, struck, at :397 — but no refusal message may assert it again, which is
    // why this reads `gateCode()`: the struck prose is a comment and correctly invisible here.
    expect(
      src,
      "the `blocked on SCHEMA` blocker was retracted by ADR 0097 and must not survive as a live refusal",
    ).not.toContain("blocked on SCHEMA")
    // `cas-dedup-rate` is deliberately ABSENT from the list above, and its absence is asserted rather
    // than left implicit: `MISSING WRITER` was this row's own blocker until ADR 0093 built the writer,
    // and a stale copy of that phrase is exactly the claim that outlives its subject. The gate must no
    // longer say it — anywhere, comments included, since the phrase's only remaining purpose would be
    // to describe a blocker that no longer exists.
    expect(
      readText(GATE),
      "the MISSING WRITER blocker was closed by ADR 0093 and must not survive as a live claim",
    ).not.toMatch(/^(?![^\n]*was blocked on)[^\n]*MISSING WRITER/m)
    // Each blocker must reach the reader through its OWN measure's refusal, not merely exist somewhere
    // in the file: the regexes above span up to 400 characters and would still match if two of these
    // phrases migrated into one message. Sliced per measure, so the pairing is what is asserted.
    const messageFor = (id: string): string => {
      const at = src.indexOf(`refused(\n  "${id}"`)
      expect(at, `"${id}" must be refused with a message of its own`).toBeGreaterThan(-1)
      return src.slice(at, src.indexOf("\n)", at))
    }
    expect(messageFor("disk-growth"), "elapsed time belongs to disk-growth").toContain("blocked on TIME")
    // And the struck hint must not come back.
    expect(
      src,
      "the shared `no queue driver exists` hint was wrong for three of four measures and must not return",
    ).not.toMatch(/const storeHint/)
  })

  it("adapter-failure-rate may be computed ONLY from a run report, and refuses over an empty denominator", () => {
    const src = gateCode()
    // The measure this batch gave a source. It is now allowed to reach `measured(...)`, which the
    // previous version of this suite forbade outright — so the assertions have to get stricter, not
    // disappear. Three things make the number trustworthy, and each is read from the source:
    //
    //   1. it comes from the run report, not from `artifact_status` (S1-OPEN-4's whole point);
    //   2. the denominator excludes `skippedNoAdapter`, so a cohort where most subjects have no
    //      adapter cannot dilute the rate toward a flattering zero;
    //   3. a zero denominator REFUSES instead of printing 0%.
    expect(src, "the rate must be read from the run report").toMatch(/attempts\.artifacts/)
    expect(
      src,
      "the denominator must exclude skippedNoAdapter — not-tried is not tried-and-failed",
    ).toMatch(/skippedNoAdapter[\s\S]{0,600}excluded from BOTH halves/)
    expect(
      src,
      "a zero denominator must REFUSE, never report 0% — the empty-denominator defect",
    ).toMatch(/attempted === 0[\s\S]{0,400}refused\(/)
    // The three REFUSED branches that must exist before a number is ever printed: no report at all,
    // a report this gate cannot parse, and a report whose artifact stage never ran. Each is a
    // different fact demanding a different remedy, and collapsing them was a real defect in this
    // batch's own first draft — a refusal that says "run an ingest" when one already ran misdirects.
    expect(src, "an absent report must refuse").toMatch(/no run report exists yet/)
    expect(src, "an unreadable report must refuse DISTINCTLY from an absent one").toMatch(
      /NONE is readable by this gate/,
    )
    expect(src, "a disabled artifact stage must refuse, not read as 0%").toMatch(
      /artifact resolution DISABLED/,
    )
    // An unknown schema must not be read with v1 semantics: a renamed counter would otherwise
    // produce a confident wrong rate, which is worse than no rate.
    expect(src, "the schema must be checked exactly, not by prefix").toMatch(
      /"calllint\.compiler-run-report\.v1"/,
    )
  })

  it("refusal is a distinct kind in the outcome type, so it cannot be summed into a pass rate", () => {
    const src = readText(GATE)
    // Asserted over the TYPE, not over a comment. A refusal modelled as `{ok: false}` would be
    // indistinguishable from a failed measurement, and a refusal modelled as `{ok: true}` would be
    // indistinguishable from a pass. Neither can be expressed here: the refused variant has no `ok`
    // field to read.
    expect(src, "the outcome must be a discriminated union").toContain("type Outcome")
    expect(src, 'the measured variant carries the boolean').toMatch(/kind:\s*"measured";\s*readonly ok: boolean/)
    expect(
      src,
      "the refused variant must carry NO ok field — that is what makes a refusal unsummable",
    ).toMatch(/kind:\s*"refused";\s*readonly message: string\s*\}/)
  })

  it("--gate exits non-zero on a refusal, so an absent data source is never a pass", () => {
    const src = readText(GATE)
    // The three enforcing conditions, read from the source. `--gate` must fail on ANY refusal: the
    // full S1 claim needs all seven measures, and three-of-seven green is not S1.
    expect(src, "--gate must treat refusals as failures").toContain("measure(s) REFUSED (no data source)")
    expect(src, "--gate must also enforce the cohort requirement").toContain(
      "cohortShort) problems.push",
    )
    // And it must NOT be satisfiable by softening: the message says so, and the message is the only
    // place a future reader learns why three green measures do not close the gate.
    expect(
      readText(ARTIFACT).replace(/\s+/g, " "),
      "the record must state that a 0/0 must never close S1-OPEN-1, or the refusal is a preference rather than a rule",
    ).toContain("A `0/0` dedup rate")
  })

  it("report mode cannot fail, and the source says why", () => {
    const src = readText(GATE)
    // Report mode exiting 0 unconditionally is DELIBERATE and is the reason it is not scheduled
    // anywhere — the same measurement that kept `gate:s0` report mode out of CI.
    //
    // Read from RAW text, because the rationale IS a comment and is meant to be: its reader is the
    // next person to edit the exit, not anyone running the gate. But presence alone is too weak for
    // what this test's own failure message claims ("stated AT the exit") — a `toContain` over the
    // whole file is satisfied by the sentence sitting anywhere, including a docblock 700 lines above
    // the code it governs, which is how a rationale ends up describing an exit that has since grown a
    // failing condition. So placement is asserted, not just presence.
    const RATIONALE = "a report mode that could fail would be a third enforcing mode by accident"
    expect(src, "the rationale must exist at all").toContain(RATIONALE)
    const after = src.slice(src.indexOf(RATIONALE))
    // Between the rationale and the process.exit it explains there must be no `process.exit` carrying
    // a non-zero code, and no new failing branch. The window is the tail of the file, so this also
    // fails if the rationale drifts upward away from the exit.
    const tail = after.slice(0, after.indexOf("process.exit(0)") + "process.exit(0)".length)
    expect(
      tail,
      "report mode's unconditional exit 0 must be stated AT the exit — the rationale drifted away from the code it governs",
    ).toMatch(/process\.exit\(0\)/)
    expect(
      tail,
      "no failing condition may be added between the rationale and report mode's exit — that is exactly the third enforcing mode it forbids",
    ).not.toMatch(/process\.exit\([1-9]|process\.exitCode\s*=/)
  })
})

describe("Gate S1 — the mode CI runs is the one that can pass, and it is actually invoked", () => {
  it("the three scripts exist, and only the regression mode is wired", () => {
    const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string | undefined> }
    // Set form, not `toContain`: a script LEAVING is as much an event as one arriving
    // ([[every-collapses-the-observed-value]]).
    expect(Object.keys(pkg.scripts).filter((k) => k.startsWith("gate:s1")).sort()).toEqual([
      "gate:s1",
      "gate:s1:gate",
      "gate:s1:regression",
    ])
    expect(pkg.scripts["gate:s1:regression"], "the regression script must invoke the gate's mode").toBe(
      "tsx scripts/gate-s1.ts --regression",
    )

    const ciLocal = pkg.scripts["ci:local"]
    expect(ciLocal, "ci:local must be defined for this wiring claim to mean anything").toBeTypeOf("string")
    const steps = (ciLocal ?? "").split("&&").map((s) => s.trim()).filter(Boolean)
    // EXCLUSION BEFORE PRESENCE, and the ordering is borrowed from the S0 suite where a control
    // proved it matters: with presence asserted first, a `--gate`-for-`--regression` swap reds as a
    // MISSING step and never names the hazard. The hazard is that `gate:s1:gate` refuses four
    // measures by design, so wiring it pins the required check red for a reason no PR can clear.
    expect(
      steps.filter((s) => /gate:s1/.test(s)),
      "ci:local must run exactly the regression mode — --gate REFUSES four measures by design, so wiring it would pin CI red for a reason no PR under review can clear",
    ).toEqual(["pnpm gate:s1:regression"])
  })

  it("ci.yml runs it as a PARSED step, not as a string that happens to appear", () => {
    // PARSE BEFORE MATCHING, and the S0 suite paid for this on the remote: an unquoted `: ` inside a
    // step name makes the WHOLE file unparseable, the `test` job never starts, and the required
    // check is ABSENT rather than red. Every text assertion passes on those bytes.
    const wf = parseYaml(readText(".github/workflows/ci.yml")) as {
      jobs?: Record<string, { steps?: { name?: string; run?: string }[] }>
    }
    const steps = wf.jobs?.test?.steps ?? []
    expect(
      steps.length,
      "ci.yml must parse and its `test` job must have steps — a text match cannot tell an executable workflow from an unparseable one",
    ).toBeGreaterThan(0)
    const runs = steps.map((s) => s.run ?? "").filter((r) => r.includes("gate:s1"))
    expect(
      runs,
      "exactly one parsed step in ci.yml#test runs Gate S1, and it is the regression mode",
    ).toEqual(["pnpm gate:s1:regression"])
    expect(
      Object.keys(wf.jobs ?? {}),
      "the required-check aggregator must survive in the parsed graph — an ABSENT required check is not a red one",
    ).toContain("build-and-test")
  })

  it("the gate is in scripts/, which vitest does not collect — so this suite is its only reader", () => {
    // Stated as an assertion because it is the reason this file exists at all. `vitest.config.ts`
    // includes `packages/**`, `apps/**`, `tests/**`; `scripts/` is out of scope, so nothing in the
    // suite reaches `gate-s1.ts` except a test that reads it deliberately.
    const cfg = readText("vitest.config.ts")
    expect(cfg, "vitest must not collect scripts/ — if it starts to, this suite's premise changes").not.toMatch(
      /include:[^)]*scripts\/\*\*/,
    )
    expect(existsSync(fileURLToPath(new URL(GATE, repoRoot))), "the gate source must exist").toBe(true)
  })
})

describe("Gate S1 — the rows say OPEN, and what would make each false", () => {
  it("every row states its own falsification condition, so none can be closed silently", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const r = row(n).replace(/\s+/g, " ")
      expect(
        r,
        `S1-OPEN-${n} must name what would falsify it — a row without one can be closed by assertion`,
      ).toMatch(/\*\*Falsification:\*\*/)
      expect(r, `S1-OPEN-${n} must carry an explicit status`).toMatch(/\*\*Status:\*\* \*\*(OPEN|CLOSED)/)
    }
  })

  it("S1-OPEN-1 names a DIFFERENT blocker per measure, and each matches the gate's own refusal", () => {
    const r = row(1).replace(/\s+/g, " ")
    // REWRITTEN with the narrowing. The old form asserted the phrase "four refused ones are precisely
    // the *scale* measures", which is a restatement of a count — and a count is the weakest thing this
    // row says. It also went stale the moment one measure acquired a source, which is the tell: an
    // assertion that reds because a claim became TRUE was pinning the wrong property.
    //
    // What matters is that the row no longer offers ONE remedy for measures that do not share a
    // blocker. So each remaining measure must appear beside its own blocker, and the pairing is checked
    // against `gate-s1.ts` — the row and the refusal it documents must not drift apart. A row that
    // named the right three blockers in the wrong order would pass a presence check and misdirect a
    // reader just as effectively.
    //
    // `processing-time-mean-p95` LEFT THIS LOOP on 2026-09-01 (ADR 0097), and it is the third measure
    // to leave — but the first to leave without anything being built. The other two acquired sources;
    // this one's blocker was retracted as false. Its cell is now asserted below as a RETRACTION rather
    // than paired with a blocker, because there is no blocker left to pair and a loop demanding one
    // would force the row to keep asserting the thing the ADR withdrew.
    for (const [measure, blocker] of [["disk-growth", /TIME/]] as const) {
      const at = r.indexOf(`\`${measure}\``)
      expect(at, `the row must name ${measure} as one of its subjects`).toBeGreaterThan(-1)
      // The table cell, not the whole row: a blocker mentioned anywhere would otherwise vouch for
      // every measure, which is precisely the collapse this rewrite undid.
      const cell = r.slice(at, r.indexOf("|", r.indexOf("|", at + measure.length + 2) + 1))
      expect(cell, `${measure}'s own cell must name its own blocker`).toMatch(blocker)
    }
    // And each measure that ACQUIRED a source must be recorded as resolved rather than quietly dropped.
    // Deleting one would leave the row truthful and the history unreadable — this artifact's own rule.
    expect(r, "the first resolved measure must be struck, not deleted").toMatch(
      /`adapter-failure-rate` \| ~~no source~~ \*\*RESOLVED\*\*/,
    )
    expect(r, "the second resolved measure must be struck, not deleted").toMatch(
      /`cas-dedup-rate` \| ~~MISSING WRITER~~ \*\*RESOLVED\*\*/,
    )
    // THE THIRD, and it must be distinguishable from the other two IN THE ROW'S OWN WORDS. `RESOLVED`
    // would be the wrong label: nothing was built and no blocker was cleared, so a reader scanning this
    // table for "what did we have to construct" must not be told this one joined that set. The row has
    // to say the blocker was WRONG, which is a different fact with a different lesson — and the one
    // that generalises, since the next false blocker will also be sitting behind a correct verdict.
    expect(r, "the retracted blocker must be struck AND labelled as a retraction, not as a build").toMatch(
      /`processing-time-mean-p95` \| ~~\*\*SCHEMA\*\*~~ \*\*RETRACTED/,
    )
    expect(r, "and it must name the ADR that retracted it, so the evidence is one hop away").toMatch(
      /RETRACTED[^|]*ADR 0097/,
    )
    expect(
      r,
      "a retraction is not a resolution — labelling it RESOLVED would file a false blocker alongside two real ones",
    ).not.toMatch(/`processing-time-mean-p95` \| ~~[^|]*~~ \*\*RESOLVED\*\*/)
    // The struck remedy must survive too: it is the second one struck on this row, and both were
    // struck for naming an unreachable action.
    expect(r, "the earlier struck remedy must remain").toMatch(/~~a real R-9 controller\/worker run/)
    // The blockers are asserted against the GATE's refusal text, so the row cannot describe a blocker
    // the gate does not enforce. Read through `gateCode()`, for the reason `stripComments` records.
    const gate = gateCode()
    expect(gate, "the gate must still refuse disk-growth on elapsed time").toMatch(
      /"disk-growth"[\s\S]{0,400}blocked on TIME/,
    )
    // THE PAIRING FOR THE RETRACTED ONE runs in the opposite direction: the row claims the blocker is
    // gone, so what the gate must NOT contain is the refusal the row used to document. Asserted here
    // and not only where the ADR is discussed, because this is the test that reads the ROW — a row
    // announcing a retraction while the gate still enforced the blocker would be the same row/code
    // drift this block exists to catch, just with the two sides swapped.
    expect(
      gate,
      "the row says the SCHEMA blocker was retracted, so the gate must no longer refuse on it",
    ).not.toContain("blocked on SCHEMA")
    // The CAS manifest writer this row's strike credits must EXIST — the strike is about nothing
    // otherwise, which is the failure mode the row itself was opened to record one rung down. Asserted
    // against the writer's own exports, not against a filename: a file present and empty would satisfy
    // a path check while producing no denominator at all.
    const manifest = readText("packages/adoption-index/src/artifacts/casManifest.ts")
    expect(manifest, "the writer the strike credits must exist").toMatch(/export function writeCasManifest/)
    expect(manifest, "and it must build what the gate reads").toMatch(/export function buildCasManifest/)
    // The queue functions the row's struck history names must still exist, or the strike is about
    // nothing.
    const queue = readText("packages/adoption-index/src/operations/compilerQueue.ts")
    expect(queue, "the queue functions the row names must still exist").toMatch(/export function enqueueJobs/)
    expect(queue, "the queue functions the row names must still exist").toMatch(
      /export function beginCompilerRun/,
    )
  })

  it("S1-OPEN-2 is CLOSED: S2 arrived before its threshold, and the row says so", () => {
    const r = row(2).replace(/\s+/g, " ")
    expect(r, "the row must name the next threshold it is about").toContain("500")

    // INVERTED 2026-08-31, NOT DELETED. This assertion required S2's ABSENCE and redded the moment
    // `scripts/gate-s2.ts` was created — which is precisely the outcome S1-OPEN-2 asked for, and the row
    // instructed the next reader to "close the row rather than deleting this assertion". So the subject
    // stays and the polarity flips: what used to prove the row was still true now proves it was closed
    // for the stated reason rather than by someone tired of a red test.
    const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string | undefined> }
    expect(
      Object.keys(pkg.scripts).filter((k) => k.startsWith("gate:s2")).sort(),
      "S1-OPEN-2 is closed by S2 EXISTING; the three script modes are what make it runnable",
    ).toEqual(["gate:s2", "gate:s2:gate", "gate:s2:regression"])
    expect(
      existsSync(fileURLToPath(new URL("scripts/gate-s2.ts", repoRoot))),
      "the row is CLOSED only while the gate it points at exists",
    ).toBe(true)
    // The tracked artifact is half the closing condition, and the half that made this row necessary:
    // S1's own status lived in gitignored `docs/` on one machine. A gate with no tracked status is a
    // gate that cannot be handed over, so its absence must red here too.
    expect(
      existsSync(fileURLToPath(new URL("artifacts/gate-s2/open-items.md", repoRoot))),
      "S1-OPEN-2's closing condition names the ARTIFACT as well as the script — `docs/` is gitignored",
    ).toBe(true)

    // The row must not merely stop saying OPEN; it must say what happened. A status flipped to CLOSED
    // with the old reasoning silently deleted is the failure mode `gate-s0.ts` records about its own
    // expired prose — nobody learns which assumption failed.
    // `CLOSED`, not `RESOLVED`: the row-status check above admits only OPEN|CLOSED, and S1-OPEN-4 already
    // spends `CLOSED` on this exact sense. A third synonym would make the vocabulary unenforceable.
    expect(r, "the row must record its own closure, with the cohort it closed at").toContain("CLOSED")
    expect(r, "and must keep the superseded claims visible rather than deleted").toContain("STRUCK")
  })

  it("S1-OPEN-3's divergence from S0 is real: S0 keeps a literal, S1 derives", () => {
    const r = row(3).replace(/\s+/g, " ")
    expect(r, "the row must state that S1 derives where S0 pins").toContain("**derives**")
    // Both halves asserted against the two sources, because the row's whole point is that the two
    // gates differ ON PURPOSE. If S1 grows a literal floor, or S0 loses its literal, the pair stops
    // covering the case each was kept for — which is exactly what the row's falsification says.
    const s0 = readText("scripts/gate-s0.ts")
    expect(s0, "S0 must still keep a hardcoded ratchet literal").toMatch(
      /const S0_REGRESSION_FLOOR = \d+/,
    )
    const s1 = readText(GATE)
    expect(s1, "S1 must derive its floor from the committed snapshot").toContain(
      "function committedRegistryCohort",
    )
    expect(
      s1,
      "S1 must NOT declare a hardcoded floor literal — a number edited weekly is a number nobody reads",
    ).not.toMatch(/const S1_REGRESSION_FLOOR = \d+/)
    // And both must run in ci:local, because neither replaces the other: S0's literal is the only
    // thing that catches a SIMULTANEOUS drop in source and served.
    const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string | undefined> }
    const chain = pkg.scripts["ci:local"] ?? ""
    expect(chain, "S0's regression mode must stay wired — it covers the case S1's derived floor cannot").toContain(
      "pnpm gate:s0:regression",
    )
    expect(chain, "S1's regression mode must be wired").toContain("pnpm gate:s1:regression")
  })

  // S1-OPEN-4's own assertions — the ones the row-count guard demanded rather than a bumped literal.
  //
  // Every assertion here is against the GATE'S SOURCE, not against the row's description of it. The
  // defect S1-OPEN-4 records is precisely a truthful-sounding sentence about the wrong subject, so a
  // suite that checked the prose would reproduce it one level up.
  it("S1-OPEN-4: the gate DISCOVERS its store rather than hardcoding one root", () => {
    const src = readText(GATE)
    // The three candidates, in the order the row states. The package-directory one is the whole fix:
    // it is where `pnpm --filter` actually writes, and its absence was the defect.
    expect(
      src,
      "the gate must consider the package-directory store — that is where `pnpm --filter` writes",
    ).toContain('path.join(repoRoot, "packages/trust-index", STORE_DIRNAME)')
    expect(
      src,
      "the gate must honour ADOPTION_INDEX_CWD — the seam pruneCas.ts/backupAdoptionIndex.ts already use",
    ).toContain("ADOPTION_INDEX_CWD")
    // The single-root form must be GONE, not merely supplemented. A gate that kept the old constant
    // alongside the new list would still read the empty store wherever the constant was used.
    expect(
      src,
      "the single hardcoded storeRoot must be gone — a leftover constant is a second, silent definition",
    ).not.toMatch(/const storeRoot = path\.join\(repoRoot, "\.var/)
  })

  it("a rejected run report is refused with the reason that ACTUALLY applies, not an OR of candidates", () => {
    // THE ONE EXECUTING TEST IN THIS SUITE, and the deviation from the header's "NOTHING HERE RUNS
    // `gate:s1`" is deliberate and narrow. That rule exists so the suite is not coupled to baked bytes
    // in `apps/web/public/trust/index.json` — a real hazard for the cohort measures. It does not apply
    // here: `ADOPTION_INDEX_CWD` points the gate at a store this test creates, so the only input is the
    // fixture, and the assertions read stdout rather than the served tree.
    //
    // It has to execute, because the defect it pins WAS A MESSAGE, and a source-scanning assertion is
    // the exact instrument that failed to catch one in this suite already (see `stripComments` above:
    // `blocked on SCHEMA` matched a docblock, so collapsing the runtime refusal stayed green). A
    // template assembled from three branches cannot be validated by grepping for its pieces; the pieces
    // were all present in the defective version too. Only running it shows which one it chose.
    //
    // The defect: `isRunReport` was a type guard, so its caller re-derived the cause from the outside
    // and could only print both candidates joined by "or". A report whose schema was RIGHT and whose
    // counter had been renamed rendered as
    //
    //     schema `calllint.compiler-run-report.v1`, not `calllint.compiler-run-report.v1`, or missing
    //     required fields
    //
    // — a sentence denying its own first clause. The refusal was correct; the reason misdirected, which
    // is the defect class this gate's own `newestRunReport` docblock describes for "absent" vs
    // "unreadable" reports, reappearing one level down. Fixed by making the reason a return value of
    // the check, so no second reader can guess.
    const dir = mkdtempSync(join(tmpdir(), "gate-s1-reject-"))
    const reports = join(dir, ".var", "calllint-adoption-index", "reports")
    mkdirSync(reports, { recursive: true })

    // A valid report, then each way it can go wrong. `valid` is not asserted on here — it exists to
    // prove the fixture shape is one the gate ACCEPTS, so a rejection below is attributable to the one
    // field each case damages rather than to a fixture the gate would have refused anyway.
    const valid = {
      schema: "calllint.compiler-run-report.v1",
      runId: "fixture",
      runType: "full",
      outcome: "SUCCEEDED",
      startedAt: "2026-08-31T00:00:00.000Z",
      completedAt: "2026-08-31T00:01:00.000Z",
      outputManifestDigest: null,
      inputManifestDigest: `sha256:${"a".repeat(64)}`,
      metrics: {},
      attempts: {
        artifacts: { considered: 55, fetched: 10, unavailable: 5, rejected: 5, skippedNoAdapter: 23, cached: 12 },
        evidence: null,
      },
    }

    const runGate = (name: string, body: string): string => {
      for (const e of readdirSync(reports)) rmSync(join(reports, e), { force: true })
      writeFileSync(join(reports, `run-${name}.json`), body)
      // `--gate` is NOT used: it exits non-zero on refusal (correctly), and this test is about the TEXT
      // of a refusal, not its exit code. Report mode exits 0 unconditionally, which is why it is safe
      // to read here without `try`.
      return execFileSync("pnpm", ["gate:s1"], {
        cwd: fileURLToPath(repoRoot),
        encoding: "utf8",
        env: { ...process.env, ADOPTION_INDEX_CWD: dir },
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      })
    }

    try {
      // CASE 1 — right schema, renamed counter. The case that produced the self-contradiction.
      //
      // Built by mutating a deep copy rather than by writing a second literal, so the ONLY difference
      // from the accepted fixture is the renamed key. A hand-written variant could differ in a second
      // way and still red, which would attribute the refusal to the wrong field.
      const drift = JSON.parse(JSON.stringify(valid)) as {
        attempts: { artifacts: Record<string, unknown> }
      }
      delete drift.attempts.artifacts.unavailable
      drift.attempts.artifacts.unavail = 5
      const driftOut = runGate("drift", JSON.stringify(drift))
      expect(
        driftOut,
        "field drift must name the OFFENDING FIELD, so the reader knows what to reconcile",
      ).toContain("`attempts.artifacts.unavailable` is missing")
      // The regression itself, asserted as a self-contradiction rather than as a string: any message
      // that denies the schema it just quoted is this defect, whatever wording it arrives in.
      expect(
        driftOut,
        "a report whose schema MATCHED must never be told its schema is not the one it is",
      ).not.toMatch(/schema `calllint\.compiler-run-report\.v1`, not `calllint\.compiler-run-report\.v1`/)
      expect(
        driftOut,
        "the generic half must not assert an unknown schema either — the schema was known and correct",
      ).not.toContain("An unknown schema is REFUSED")

      // CASE 2 — a genuinely unknown schema. The cause CASE 1 was wrongly given, so it must still be
      // reachable: a fix that stopped naming schema mismatch at all would trade one wrong reason for
      // another, and only asserting both cases can tell those apart.
      //
      // The example is `v4`, not `v3`, and not `v2` before that. Each bump makes the previous control's
      // premise FALSE — v2 became readable on 2026-08-31, v3 on 2026-09-01 (ADR 0097) — and each time
      // this assertion redded for the right reason: an unknown-version control had come to name a known
      // version. It moves one ahead of the writer rather than being deleted, which is the only edit that
      // preserves what it measures. The accepted set is enumerated, so v4 is refused by construction and
      // not by a prefix test that would have swallowed it.
      const v4Out = runGate("v4", JSON.stringify({ ...valid, schema: "calllint.compiler-run-report.v4" }))
      expect(v4Out, "a real schema mismatch must still say so, exactly").toContain(
        "schema `calllint.compiler-run-report.v4`, not `calllint.compiler-run-report.v1` or " +
          "`calllint.compiler-run-report.v2` or `calllint.compiler-run-report.v3`",
      )
      expect(v4Out, "and must NOT be described as a field problem it does not have").not.toContain(
        "attempts.artifacts",
      )

      // CASE 2b — v2 is READ, not refused. The other half of an enumerated accepted set, and the half a
      // set can silently lose: dropping v1 or fumbling the membership test would leave the gate refusing
      // the very reports its own writer now emits, and CASE 2 alone cannot see that (everything refuses
      // there, so "refuses correctly" and "refuses everything" look identical).
      //
      // v2 adds a `source` section this gate does not read and leaves `attempts.artifacts` byte-identical,
      // so the SAME fixture with only the version changed must still produce a rate.
      const v2Out = runGate("v2", JSON.stringify({ ...valid, schema: "calllint.compiler-run-report.v2" }))
      expect(v2Out, "v2 changed nothing this gate reads, so it must be MEASURED, not refused").toMatch(
        /\[MEASURED\] adapter-failure-rate/,
      )
      expect(v2Out, "and the rate must come from the v2 file's own counters").toContain("10/32")

      // CASE 2c — v1 still reads after the bump. The reports written before 2026-08-31 are the repo's
      // entire history; a gate that refused them to signal that a newer writer exists would report
      // nothing for the period it can still measure.
      const v1Out = runGate("v1", JSON.stringify(valid))
      expect(v1Out, "v1 must remain readable — dropping it discards every report already on disk").toMatch(
        /\[MEASURED\] adapter-failure-rate/,
      )

      // CASE 2d — processing-time's THREE states, and the invariant ADR 0097 §Consequences promises.
      //
      // THE NEGATIVE CONTROL IS ALREADY IN THE FIXTURE, which is why this case can be asserted at all:
      // `valid.startedAt` and `valid.completedAt` are sixty seconds apart. So a gate that derived a
      // duration the cheap way — `completedAt - startedAt`, the next reader's obvious "fix" — would
      // print `60000 ms` off these fixtures, from a run that timed nothing. That number must appear in
      // no output, for any of the three states. In the real store those two fields are two copies of one
      // pinned `TRUST_INGEST_NOW` and their difference is 0 ms, which renders as an instantaneous
      // compiler; here the same wrong arithmetic renders as a minute. Both are fabrications, and this
      // fixture is the one that can SEE it, because 60000 cannot arise from anything else.
      //
      // Asserted by EXECUTION, not by grep, for this file's usual reason: all three states are messages
      // assembled from one template, and every wrong version contains the pieces.
      const withProcessing = {
        ...valid,
        schema: "calllint.compiler-run-report.v3",
        processing: { n: 4, skipped: 23, meanMs: 812, p95Ms: 1500, minMs: 300, maxMs: 1500 },
      }
      const p3Out = runGate("p3", JSON.stringify(withProcessing))
      expect(p3Out, "a v3 report carrying a distribution must be MEASURED").toMatch(
        /\[MEASURED\] processing-time-mean-p95/,
      )
      expect(p3Out, "and it must print the file's own numbers, not a recomputation of its own").toContain(
        "mean **812 ms**",
      )
      expect(p3Out, "the p95 too").toContain("p95 **1500 ms**")
      expect(p3Out, "with the sample count, because a mean without an n is not a measurement").toContain("n=4")
      expect(p3Out, "and the excluded skips named, so the denominator is auditable").toContain("23 considered")

      // State 2 — v3 that attempted nothing. `processing: null` is a RUN THAT HAPPENED, not a missing
      // observable, and the two have different remedies (nothing to do vs. re-run), so the messages must
      // differ. Asserted as a pair: if either collapsed into the other's wording, one of these reds.
      const pNullOut = runGate("pnull", JSON.stringify({ ...withProcessing, processing: null }))
      expect(pNullOut, "a v3 run that attempted nothing is REFUSED, never 0 ms").toMatch(
        /\[REFUSED \] processing-time-mean-p95/,
      )
      expect(pNullOut, "and it must say the run HAPPENED and attempted nothing").toContain(
        "produced a v3 report with NO distribution",
      )
      expect(pNullOut, "which is NOT the pre-v3 state, and must not borrow its wording").not.toContain(
        "PREDATES THE OBSERVABLE",
      )

      // State 3 — pre-v3. The state every report already on disk is in, and the one whose refusal must
      // not read as "the run was fast".
      expect(v1Out, "a v1 report predates the observable and must say so").toContain("PREDATES THE OBSERVABLE")
      expect(v2Out, "as must v2 — the bump that added `source` did not add a duration").toContain(
        "PREDATES THE OBSERVABLE",
      )
      expect(v1Out, "a pre-v3 report must never be MEASURED for processing time").not.toMatch(
        /\[MEASURED\] processing-time-mean-p95/,
      )

      // THE INVARIANT ITSELF, over every output this test produced. 60000 is the fixture's
      // `completedAt - startedAt`; no state may ever print it.
      for (const [label, out] of [
        ["v1", v1Out], ["v2", v2Out], ["v3+dist", p3Out], ["v3+null", pNullOut],
      ] as const) {
        expect(
          out,
          `${label}: a duration derived from \`completedAt - startedAt\` (60000 ms here, 0 ms in the ` +
            `real store) must never reach the reader — ADR 0097`,
        ).not.toContain("60000")
      }

      // CASE 3 — not JSON at all. The third distinguishable cause, and the one whose remedy differs
      // most: nothing to reconcile, the file is truncated.
      const junkOut = runGate("junk", '{"schema": "calllint.compiler-run-report.v1", "runId"')
      expect(junkOut, "unparseable input must be named as such").toContain("not parseable as JSON")
      expect(junkOut, "and must not be reported as a schema or field problem").not.toContain("schema `")

      // ALL THREE must still refuse. The point of the fix is a truthful reason, never a readable file:
      // a message change that accidentally let one of these through would be a far worse defect than
      // the one being fixed, and nothing above would notice, since each case only asserts on wording.
      //
      // `v2`/`v1` are deliberately NOT in this loop — they are the accepted cases, asserted MEASURED
      // above. Only the three refusals belong here.
      for (const [label, out] of [["drift", driftOut], ["v4", v4Out], ["junk", junkOut]] as const) {
        expect(out, `${label} must be REFUSED, never measured — an unvalidated report is not a rate`).toMatch(
          /\[REFUSED \] adapter-failure-rate/,
        )
        expect(out, `${label} must not produce a percentage`).not.toMatch(
          /\[MEASURED\] adapter-failure-rate/,
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it("cas-dedup-rate is computed from a manifest, refuses an empty denominator, and catches a manifest that disagrees with itself", () => {
    // THE SECOND EXECUTING TEST, and for the same reason as the first: what ADR 0093 closed was a
    // measure whose entire content is a MESSAGE carrying two counts, and this suite has already been
    // burned once by grepping for a message's pieces (see `stripComments` — `blocked on SCHEMA` matched
    // a docblock, so collapsing the runtime refusal stayed green). The pieces are present in every
    // wrong version too. Only running it shows which branch it took and what it printed.
    //
    // Four fixtures, each isolating one branch. `ADOPTION_INDEX_CWD` points the gate at a store this
    // test creates, so the only input is the fixture.
    const dir = mkdtempSync(join(tmpdir(), "gate-s1-dedup-"))
    const manifests = join(dir, ".var", "calllint-adoption-index", "cas", "manifests")
    mkdirSync(manifests, { recursive: true })

    const digest = (c: string): string => `sha256:${c.repeat(64)}`
    /** Two references to one blob and one to another: within-run reuse 1 of 3, already-on-disk 2 of 3. */
    const references = [
      { artifactVersionId: "av-1", digest: digest("a"), deduplicated: false },
      { artifactVersionId: "av-2", digest: digest("a"), deduplicated: true },
      { artifactVersionId: "av-3", digest: digest("b"), deduplicated: true },
    ]
    const valid = {
      schema: "calllint.cas-manifest.v1",
      runId: "fixture",
      completedAt: "2026-08-31T00:01:00.000Z",
      references,
      totals: { references: 3, distinctDigests: 2, deduplicated: 2 },
    }

    const runGate = (name: string, body: string): string => {
      for (const e of readdirSync(manifests)) rmSync(join(manifests, e), { force: true })
      writeFileSync(join(manifests, `run-${name}.json`), body)
      // Report mode, not `--gate`: this is about the TEXT of a measure, and `--gate` exits non-zero on
      // the other refusals that are still outstanding in any checkout.
      return execFileSync("pnpm", ["gate:s1"], {
        cwd: fileURLToPath(repoRoot),
        encoding: "utf8",
        env: { ...process.env, ADOPTION_INDEX_CWD: dir },
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      })
    }

    try {
      // CASE 1 — the MEASURED branch, which no checkout of this repo has ever exercised: the measure
      // had refused on every run since it was written, so "it can produce a number at all" was
      // unproven until this fixture. Both counts are asserted, with their denominators, because the
      // whole design decision ADR 0093 §4 records is that these are TWO facts and neither is "the"
      // dedup rate.
      const ok = runGate("ok", JSON.stringify(valid))
      expect(ok, "a readable manifest must be MEASURED, not refused").toMatch(/\[MEASURED\] cas-dedup-rate/)
      expect(ok, "within-run reuse is references minus distinct digests, over references").toContain("1/3")
      expect(ok, "already-on-disk is the deduplicated count, over the same denominator").toContain("2/3")
      expect(ok, "and the distinct-blob count must be stated, since it is the other denominator").toContain(
        "2 distinct blob(s)",
      )
      // The two counts must not be collapsed into one number. A single "dedup rate" is the defect the
      // ADR names: 40 unique artifacts into a warm store and one blob requested 40 times both read as
      // "high dedup" and mean opposite things.
      expect(ok, "the two reuse facts must be labelled distinctly, not merged").toContain("within-run reuse")
      expect(ok, "the two reuse facts must be labelled distinctly, not merged").toContain("already-on-disk")

      // CASE 2 — a manifest that exists and references NOTHING. The empty-denominator defect
      // reproduced by a PRESENT manifest, which is why building the writer did not retire the refusal:
      // `45 blobs / 0 references` would render as 100% exactly as `45 blobs / 0 manifests` did.
      const empty = runGate(
        "empty",
        JSON.stringify({ ...valid, references: [], totals: { references: 0, distinctDigests: 0, deduplicated: 0 } }),
      )
      expect(empty, "a zero denominator must REFUSE, never print 0% or 100%").toMatch(
        /\[REFUSED \] cas-dedup-rate/,
      )
      expect(empty, "and must say the stage ran and resolved nothing — not that no manifest exists").toContain(
        "references NO blobs",
      )

      // CASE 3 — totals that disagree with the references they summarize. The reason the gate recounts
      // instead of trusting `totals`: the evidence to check the number sits in the same file, so a
      // reader that trusted it would be trusting the one field a buggy writer gets wrong.
      const lying = runGate(
        "lying",
        JSON.stringify({ ...valid, totals: { references: 3, distinctDigests: 3, deduplicated: 2 } }),
      )
      expect(lying, "a self-contradicting projection must be REFUSED").toMatch(/\[REFUSED \] cas-dedup-rate/)
      expect(lying, "and the refusal must name BOTH sides, since which one is right is unknowable here").toContain(
        "the projection disagrees with itself",
      )
      expect(lying, "naming the field that disagrees").toContain("`totals.distinctDigests` states 3")

      // CASE 4 — a schema the gate does not know. Exact membership, never a prefix: a `.v2` that
      // renamed `deduplicated` would otherwise be read with v1 semantics and produce a confident wrong
      // pair of counts. Asserted for the same reason the run report's v3 case is.
      const v2 = runGate("v2", JSON.stringify({ ...valid, schema: "calllint.cas-manifest.v2" }))
      expect(v2, "an unknown manifest schema must refuse").toMatch(/\[REFUSED \] cas-dedup-rate/)
      expect(v2, "naming the version it found and the set it would have taken").toContain(
        "schema `calllint.cas-manifest.v2`, not `calllint.cas-manifest.v1`",
      )
      // A present-but-unreadable manifest must NOT be reported as an absent one: one says "run an
      // ingest", the other says "an ingest ran and wrote something this gate cannot read", and sending
      // a reader to repeat an act that already happened is the misdirection `newestRunReport` records.
      expect(v2, "an unreadable manifest is not a missing one").not.toContain("no CAS manifest exists")

      for (const [label, out] of [["empty", empty], ["lying", lying], ["v2", v2]] as const) {
        expect(out, `${label} must not produce a rate`).not.toMatch(/\[MEASURED\] cas-dedup-rate/)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it("S1-OPEN-4: blob counting recurses, because cas/blobs is a two-character fan-out", () => {
    const src = readText(GATE)
    expect(src, "the gate must count files recursively").toMatch(/function countFiles/)
    expect(
      src,
      "countFiles must recurse into subdirectories — measured: 42 shards for 45 blobs",
    ).toMatch(/isDirectory\(\)/)
    // The exact shape that produced the undercount, asserted absent. `paths.ts` warns that the blob
    // tree is a fan-out while `work/` is flat and that callers "must not assume a shared traversal
    // shape"; the first version assumed it anyway.
    expect(
      src,
      "the shard-counting form (`readdirSync(dir).length` on a fan-out) must not return",
    ).not.toMatch(/readdirSync\(full\)\.length/)
    const paths = readText("packages/adoption-index/src/storage/paths.ts")
    expect(
      paths,
      "the warning this defect ignored must still be at the definition site",
    ).toContain("must not assume a shared traversal shape")
  })

  it("S1-OPEN-4: the store census prints in every mode, including the passing ones", () => {
    const src = readText(GATE)
    expect(src, "the census must be built").toMatch(/const storeCensus/)
    // Printed OUTSIDE any mode branch. A census shown only on failure leaves exactly the runs nobody
    // inspects — the green ones — carrying the unverifiable claim that produced this row.
    const printIdx = src.indexOf("console.log(storeCensus)")
    expect(printIdx, "the census must actually be printed, not merely computed").toBeGreaterThan(-1)
    const gateBranch = src.indexOf("if (isGate)")
    if (gateBranch > -1) {
      expect(
        printIdx,
        "the census must print before any mode-specific branch, so every mode shows it",
      ).toBeLessThan(gateBranch)
    }
  })

  it("S1-OPEN-4: the false claim is struck in all three places it lived, not deleted", () => {
    // Struck rather than removed, for the reason gate-s0.ts states about its own expired prose: a
    // silently corrected claim teaches nobody which assumption failed. Asserted in BOTH files because
    // the sentence appeared in both, and correcting one would leave the other lying.
    const src = readText(GATE)
    expect(
      src,
      "the gate's docblock must keep its false store claim struck, with the correction beside it",
    ).toMatch(/~~and the compiler's local store is empty/)
    // THE THIRD SITE, and the one that came first. The gate did not invent "the repo root" — it
    // inherited it from refreshSnapshot.ts's own docblock, which asserted `.var/` lands at the repo
    // root "when this runs from the workflow". Striking the two downstream copies while leaving the
    // upstream claim intact would let the next reader re-derive the same wrong path from the same
    // sentence, which is how this defect survived three weeks in the first place.
    const upstream = readText("packages/trust-index/src/refreshSnapshot.ts")
    expect(
      upstream,
      "the ORIGIN of the wrong root must be struck too — otherwise the next reader re-derives it",
    ).toMatch(/~~\(the repo root, when this runs from the workflow\)~~/)
    expect(upstream, "and must name the mechanism, not just retract the claim").toMatch(/--filter/)
    const r = row(4).replace(/\s+/g, " ")
    expect(r, "the row must name the cwd seam that produced two stores").toMatch(
      /resolveIndexPaths|pnpm --filter/,
    )
    expect(r, "the row must record that the warning already existed at paths.ts").toContain("paths.ts:115")
    // The measured numbers, so the row cannot drift into a vaguer story than the one that was taken.
    for (const n of ["2551808", "45", "298"]) {
      expect(r, `S1-OPEN-4 must keep the measured figure ${n} — a row without numbers is an anecdote`).toContain(n)
    }
  })

  it("S1-OPEN-4: artifact_status is NOT reported as adapter failure rate", () => {
    const src = readText(GATE)
    // The open half. 8/78 UNAVAILABLE is available and adapter-shaped, which is exactly why the
    // distinction has to be explicit: the cheapest way to close this measure on paper is to rename
    // that column into it.
    //
    // The measure is no longer REFUSED unconditionally — it now has a real attempt-counting source —
    // so what this row guards is narrower and sharper than it was: the SOURCE must be the run report's
    // attempt counts, and the reason `artifact_status` is not a substitute must still be stated where
    // the next reader will find it.
    expect(
      gateCode(),
      "the rate must be computed from ATTEMPT counts in the run report, never from artifact_status",
    ).toMatch(/attempts\.artifacts/)
    // DELIBERATELY over RAW text, unlike the assertions above, and the asymmetry is the point. This
    // sentence lives at `gate-s1.ts:400` as a `//` comment and nowhere else, because its audience is
    // whoever next edits the gate — not whoever reads its output. Asserting it against `gateCode()`
    // would red on a true statement; asserting a REFUSAL against raw text is what let a collapsed
    // blocker pass. Which text a guard reads has to follow who the string is for.
    expect(
      src,
      "the rationale must say why artifact_status is not a substitute, in the source where it would be swapped in",
    ).toContain("grades an artifact's state, not an attempt's outcome")
    // And it must not silently start reading the column instead.
    expect(
      gateCode(),
      "artifact_status must not become the source of this measure without S1-OPEN-4 being closed first",
    ).not.toMatch(/measured\(\s*"adapter-failure-rate"[\s\S]{0,200}artifact_status/)
  })

  it("S1-OPEN-5: the async-crash defect it describes is real in the source, and pinned by a test", () => {
    const r = row(5).replace(/\s+/g, " ")
    // ASSERTED AGAINST THE SUBJECT, not against the row's description of it. A row claiming a defect
    // that has since been fixed is worse than no row: it sends a reader to fix working code, and it
    // makes the artifact's other claims cheaper to disbelieve. So the shape is read out of
    // `compilerQueue.ts` — if someone fixes `withCompilerRun`, this reds and the row must close.
    const queue = readText("packages/adoption-index/src/operations/compilerQueue.ts")
    const at = queue.indexOf("export function withCompilerRun")
    expect(at, "the function the row is about must exist").toBeGreaterThan(-1)
    const body = queue.slice(at, at + 900)
    // The defect IS the synchronous signature: a `T` return with a plain `try`/`catch` cannot observe a
    // rejected promise. Both halves are asserted, because either one alone is satisfiable by a fix that
    // does not actually work — an `async` wrapper that still fails to await, or an `await` inside a
    // signature that still returns `T`.
    expect(body, "the row claims a synchronous bracket; if it is now async, close the row").toMatch(
      // Not `[^)]*` for the parameter list: it contains a `)` of its own in `(runId: string) => T`, so a
      // negated-class match stops early and reds against correct code. Anchored on the return type
      // instead, which is the half that actually encodes the defect.
      /function withCompilerRun<T>\(.*\):\s*T\s*\{/,
    )
    expect(
      body,
      "the row claims the body is not awaited; if it now is, the defect is fixed and the row is stale",
    ).not.toMatch(/await\s+body\(/)
    // And the characterisation test must still exist, or the row's "it now costs something" is false.
    // Asserted on the ASSERTED-WRONG values, not merely on the test's title: a renamed test that no
    // longer checks `RUNNING` would leave the row vouched for by a name.
    const leaseTest = readText("packages/adoption-index/test/job-lease.test.ts")
    expect(
      leaseTest,
      "the characterisation test the row relies on must exist — a latent defect with no test is just a comment",
    ).toContain("S1-OPEN-5")
    expect(
      leaseTest,
      "it must pin the stranded state, which is what makes a real fix red it",
    ).toMatch(/state:\s*"RUNNING"[\s\S]{0,80}completedAt:\s*null/)
    // The row must name the reason the fix was deferred, not merely that it was. "Not fixed" without a
    // reason is indistinguishable from "not noticed", and this artifact exists because of that gap.
    expect(r, "the row must say why the fix is out of scope, not just that it is").toMatch(
      /shipped R-6 signature/,
    )
  })
})
