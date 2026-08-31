import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
// Imported, never re-derived — the same rule the gate itself follows and records. Workstream R measured
// raw-name joins at 0/19 against slug joins at 19/19, so a local copy of the slug rule is exactly how a
// completeness measure comes to agree with itself while disagreeing with the served tree. This suite
// re-derives the gate's own censuses below, so it would have inherited that defect verbatim.
import { parseSnapshot, registryCanonicalName, REGISTRY_NAMESPACE } from "../../packages/trust-index/src/snapshot.js"

// The first machine reader of `artifacts/gate-s2/**` and of `scripts/gate-s2.ts`.
//
// WHAT MAKES S2 DIFFERENT FROM S1, AND WHAT THIS SUITE THEREFORE HAS TO PIN. S1's record was written
// after its 100-record threshold had already been crossed: nothing could have redded at the crossing,
// because there was no gate on the other side of it. S2 exists at cohort 150 against a 500-record
// threshold — 350 records early — which means its central claim is not "the cohort is big enough" but
// "this gate is watching, and can say why it is red". A gate that arrives early and cannot red is
// strictly worse than one that arrives late, because its green gets consumed.
//
// So the load-bearing assertion here is NOT that `cohort-completeness` refuses today. It is that the
// refusal ATTRIBUTES the shortfall — upstream exhaustion vs. our own cap — and that each attribution
// is produced by the branch that decided it. Those two causes need opposite actions ("wait" vs. "raise
// TRUST_INGEST_MIRROR_MAX_ENTRIES"), and a gate that prints both and lets the reader pick is the
// OR-of-candidate-causes defect this repo has now shipped twice.
//
// THIS SUITE EXECUTES THE GATE, which is a deliberate departure from the S1 suite's "nothing here runs
// `gate:s1`" rule. That rule exists so a suite is not coupled to baked bytes in
// `apps/web/public/trust/index.json`. It does not apply to the attribution tests: `ADOPTION_INDEX_CWD`
// points the gate at a store the test creates, so the fixture is the only input.
//
// The reason it MUST execute is recorded in the S1 suite's `stripComments` docblock, and it is the
// sharpest lesson this repo has about testing messages: `blocked on SCHEMA` appeared twice in
// `gate-s1.ts` — once in the runtime refusal, once in the docblock above it — so rewriting the refusal
// left a source-scanning assertion GREEN against the comment. A four-branch attribution template
// cannot be validated by grepping for its pieces, because the pieces are all present in the broken
// version too. Only running it reveals which branch it chose.
//
// THREE LAYERS, matching the S0 and S1 suites because the failure modes are identical:
//   1. POINTER TRUTH — every `path:line` claim resolves to a line CONTAINING what it claims. Asserting
//      mere existence is satisfied by a blank line (M26-3's pointer at :61 was blank).
//   2. DERIVED-NOT-RESTATED — every number the artifact states is recomputed from the file it is about,
//      including the record's claim about its own reader's size.
//   3. ROW STATUS + THE REFUSAL — each row's `**Status:**` and `**Falsification:**` are asserted, and
//      the attribution is asserted by EXECUTION rather than by reading the prose that describes it.
const repoRoot = new URL("../../", import.meta.url)

const readRaw = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, repoRoot)), "utf8")

/** Normalized at the reader, per ADR 0064 §6.2. The CR-byte assertion below is what guards the pin. */
const readText = (rel: string): string => readRaw(rel).replace(/\r\n/g, "\n")

const ARTIFACT = "artifacts/gate-s2/open-items.md"
const GATE = "scripts/gate-s2.ts"
const SUITE = "tests/invariants/gate-s2-claims.invariants.test.ts"

/** The five measures S2 reports, under the exact ids it prints. */
const FIVE_MEASURES = [
  "cohort-completeness",
  "scale-retention",
  "source-completeness",
  "artifact-resolution",
  "page-quality",
] as const

/**
 * One row's text, bounded at BOTH ends.
 *
 * A bare `indexOf` + `slice(start, -1)` is the ADR 0064 §6.2 shape: a missing end marker yields -1, the
 * row silently widens to the rest of the file, and every assertion over it then passes against text
 * from a different row. The last row is sliced to end-of-file explicitly rather than by falling through.
 */
function row(n: number): string {
  const text = readText(ARTIFACT)
  const start = text.indexOf(`## S2-OPEN-${n}`)
  expect(start, `${ARTIFACT} must carry a "## S2-OPEN-${n}" heading`).toBeGreaterThan(-1)
  const nextIdx = text.indexOf(`## S2-OPEN-${n + 1}`)
  const end = nextIdx === -1 ? text.length : nextIdx
  expect(end, `the S2-OPEN-${n} row must not be empty`).toBeGreaterThan(start)
  return text.slice(start, end)
}

/**
 * Strip comments so an assertion about the GATE'S SOURCE reads code, not the prose describing it.
 *
 * Lifted character-for-character from `scripts/gate-s0.ts:594` via the S1 suite, for the reason recorded
 * there: a leading-whitespace-anchored line pattern misses a TRAILING comment, while an unanchored one
 * eats the slashes inside a `https:` URL in a string. Only tracking quote state admits both. The
 * two-sided self-test below is what keeps the copy honest — a copied stripper with no copied self-test
 * is a precondition nobody checks.
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

/** `gate-s2.ts` with comments removed — what a reader of the gate's OUTPUT would actually see. */
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
    `${label}: ${path}:${lineNo} should contain ${JSON.stringify(expected)}, but reads ${JSON.stringify(actual)}`,
  ).toContain(expected)
}

/**
 * The committed snapshot's registry entries — the gate's `censusSource`, re-derived here.
 *
 * Through `parseSnapshot`, not `JSON.parse(...).entries`. The first draft of this helper read `.servers`,
 * which does not exist on the file (the key is `entries`), and returned 0 — a census that would have
 * silently agreed with an empty snapshot. Using the shipped parser is the same rule the gate follows and
 * the reason this file imports `registryCanonicalName` rather than copying the slug logic.
 */
function committedCohort(): number {
  return parseSnapshot(readText("packages/trust-index/snapshots/official-mcp-registry.json")).entries.length
}

/** The served registry pages — the gate's `censusServed`, re-derived through the same namespace filter. */
function servedCohort(): { readonly total: number; readonly names: ReadonlySet<string> } {
  const idx = JSON.parse(readText("apps/web/public/trust/index.json")) as {
    entries?: readonly { readonly canonicalName?: string }[]
  }
  const names = new Set(
    (idx.entries ?? [])
      .map((e) => e.canonicalName ?? "")
      .filter((n) => n.startsWith(`${REGISTRY_NAMESPACE}/`)),
  )
  return { total: names.size, names }
}

describe("Gate S2 — the record exists, is tracked, and carries its three rows", () => {
  it("the artifact parses, carries all three rows, and is substantial", () => {
    const text = readText(ARTIFACT)
    expect(
      text.length,
      "a record short enough to be a stub cannot carry the reasoning the rows below assert",
    ).toBeGreaterThan(4000)
    for (const n of [1, 2, 3]) {
      expect(text, `${ARTIFACT} must carry a "## S2-OPEN-${n}" heading`).toContain(`## S2-OPEN-${n}`)
    }
    // A LITERAL, deliberately, and the S1 suite's own note says why: a self-deriving count accepts any
    // number of unexamined rows, which turns a tripwire into a mirror. A fourth row must red here and
    // gain its own assertions rather than inheriting these.
    const rows = [...text.matchAll(/^## S2-OPEN-\d+/gm)]
    expect(
      rows.length,
      "three rows are asserted here; a fourth needs its own assertions rather than inheriting these",
    ).toBe(3)
  })

  it("the artifact is committed LF, and the .gitattributes pin it relies on exists", () => {
    // The ONLY assertion that fails when the pin is removed. Every other assertion here reads through
    // `readText`, which normalizes CRLF — which is precisely why the pin needs a dedicated reader.
    // Control #181 proved the S0 suite stayed green with its pin deleted AND the artifact CRLF-converted.
    expect(
      readRaw(ARTIFACT).includes("\r"),
      `${ARTIFACT} must contain no CR bytes — .gitattributes pins artifacts/gate-s2/** text eol=lf`,
    ).toBe(false)
    expect(
      readText(".gitattributes"),
      "the pin must exist, or this assertion guards a claim nothing makes",
    ).toContain("artifacts/gate-s2/** text eol=lf")
  })

  it("the record is TRACKED, which is the reason it is a file rather than prose in a spec", () => {
    // S1's status lived only in `docs/new15-execution-status.md`. `docs/` is gitignored, so S1's status
    // existed on exactly one machine, and a gate whose status no second clone can read cannot be handed
    // over. This asserts the hazard is still real (the ignore rule is still there) AND that this file
    // escapes it — the second half alone would pass in a repo that had stopped ignoring `docs/`.
    expect(readText(".gitignore"), "the hazard this artifact avoids must still exist to be avoided").toMatch(
      /^docs\/$/m,
    )
    const tracked = execFileSync("git", ["ls-files", "--", ARTIFACT], {
      cwd: fileURLToPath(repoRoot),
      encoding: "utf8",
    }).trim()
    expect(tracked, `${ARTIFACT} must be tracked by git, not merely present on this machine`).toBe(ARTIFACT)
  })
})

describe("Gate S2 — every path:line the record cites still points at what it claims", () => {
  it("the gate's threshold, its outcome union, and its remedy table are where they are claimed", () => {
    // Content-anchored, not existence-anchored. The S0 suite's pointers drifted ten times across ten
    // batches and every drift was harmless only because the anchor matched content; five of the ten reds
    // quoted docblock prose — a line that existed.
    assertPointer(GATE, 111, "S2_REQUIRED_RECORDS = CUMULATIVE_COVERAGE_CEILING", "the imported threshold")
    assertPointer(GATE, 186, "type Outcome", "the outcome union that makes refusal first-class")
    assertPointer(GATE, 483, "const TRUNCATION_REMEDY", "the per-reason knob table")
    assertPointer(GATE, 348, "function checkSourceReport", "the check that returns its own reason")
  })

  it("the record's own pointers resolve, and the gate reads the inputs it names", () => {
    const text = readText(ARTIFACT)
    for (const p of ["scripts/gate-s2.ts", "artifacts/gate-s1/open-items.md"]) {
      expect(text, `the record cites ${p}`).toContain(p)
      expect(existsSync(fileURLToPath(new URL(p, repoRoot))), `${p} must exist — the record cites it`).toBe(
        true,
      )
    }
    // The `.gitignore:44` pointer is the record's argument for existing as a tracked file. A drifted
    // line number there would leave the argument citing something unrelated.
    assertPointer(".gitignore", 44, "docs/", "the record's gitignore citation")
    const src = readText(GATE)
    for (const p of [
      "packages/trust-index/snapshots/official-mcp-registry.json",
      "apps/web/public/trust/index.json",
    ]) {
      expect(src, `the gate must read ${p}`).toContain(p)
      expect(existsSync(fileURLToPath(new URL(p, repoRoot))), `${p} must exist — the gate reads it`).toBe(
        true,
      )
    }
  })

  it("the comment stripper keeps code and drops prose, in both directions", () => {
    // The two-sided self-test the S1 suite records as mandatory for a copied stripper. Without it, a
    // stripper that returned "" would make every source assertion below vacuously... fail, and one that
    // returned its input unchanged would make them all vacuously pass — the dangerous direction.
    const out = stripComments(
      ['// UPSTREAM EXHAUSTION UNKNOWN in a comment', 'const u = "https://example.com/x" // trailing'].join(
        "\n",
      ),
    )
    expect(out, "prose must be dropped").not.toContain("UPSTREAM EXHAUSTION UNKNOWN")
    expect(out, "a URL inside a string must survive — its // is not a comment").toContain(
      "https://example.com/x",
    )
    expect(out, "a trailing comment must be dropped").not.toContain("trailing")
  })
})

describe("Gate S2 — every number the record states is derived from the file it is about", () => {
  it("the record's claim about its OWN reader's size is derived, not remembered", () => {
    // The defect this closes was found in the S1 record: it described its suite as 19 `it` blocks while
    // the suite held 28 — stale by nine, in the flattering direction. A record understating its coverage
    // invites someone to add tests that already exist; one overstating it vouches for tests nobody wrote.
    // Counted from `it(` at a line start, which is what a reader means by a test. Not `expect(`, which
    // moves with every assertion added inside an existing block.
    const blocks = readText(SUITE).match(/^\s*it\(/gm)?.length ?? 0
    expect(blocks, "this suite must contain tests for the count to be about anything").toBeGreaterThan(0)
    expect(
      readText(ARTIFACT),
      `the record must state this suite's real size (${blocks} \`it\` blocks), derived rather than remembered`,
    ).toContain(`**${blocks} \`it\` blocks, three layers**`)
  })

  it("the 500-record threshold is IMPORTED from the pipeline's constant, never written here", () => {
    // S2-OPEN-1 says "Do NOT close this row by editing the threshold", and this is what makes that
    // enforceable rather than advisory: the gate has no literal 500 to edit. Lowering the threshold to
    // match reality requires touching `CUMULATIVE_COVERAGE_CEILING`, which the ingest pipeline uses.
    const code = gateCode()
    expect(code, "the gate must import the ceiling rather than restating it").toContain(
      "CUMULATIVE_COVERAGE_CEILING",
    )
    expect(
      code,
      "the gate must not hardcode its own threshold — a literal is a number someone edits downward",
    ).not.toMatch(/S2_REQUIRED_RECORDS\s*=\s*500/)
    const fetchSrc = readText("packages/trust-index/src/fetchRegistry.ts")
    const m = fetchSrc.match(/CUMULATIVE_COVERAGE_CEILING\s*=\s*(\d+)/)
    expect(m?.[1], "the pipeline must declare the ceiling this gate imports").not.toBeUndefined()
    expect(Number(m?.[1]), "S2 is the 500-record rung on the S0(25) → S1(100) → S2(500) ladder").toBe(500)
    expect(
      readText(ARTIFACT),
      `the record must state the same threshold the pipeline declares (${m?.[1]})`,
    ).toContain(`**Threshold:** ${m?.[1]} served registry records`)
  })

  it("the cohort-at-creation the record states is recomputed from the committed bytes", () => {
    // The record's headline claim is that the gate arrived EARLY, and this is that claim's arithmetic:
    // cohort at creation, and the distance to the threshold. Both derived, so a record describing a
    // different cohort than the one on disk reds here rather than misdating the gate's own achievement.
    const cohort = committedCohort()
    const served = servedCohort()
    expect(cohort, "the committed snapshot must carry registry entries").toBeGreaterThan(0)
    // A JOIN, not two counts that happen to be equal. Equal totals are satisfied by two disjoint sets of
    // the same size, which is exactly the state `source-completeness` exists to catch — and the slug
    // function is imported for it, because Workstream R measured raw-name joins at 0/19.
    const snapshotNames = new Set(
      parseSnapshot(readText("packages/trust-index/snapshots/official-mcp-registry.json")).entries.map((e) =>
        registryCanonicalName(e.name),
      ),
    )
    const missing = [...snapshotNames].filter((n) => !served.names.has(n))
    expect(
      missing.slice(0, 5),
      "every committed registry subject must have a served page — the gate's own source-completeness",
    ).toEqual([])
    expect(
      served.total,
      "committed and served registry cohorts must agree in SIZE as well as membership",
    ).toBe(cohort)
    const text = readText(ARTIFACT)
    expect(
      text,
      `the record must state the real cohort at creation (${cohort}), derived rather than typed`,
    ).toContain(`**Cohort at creation:** **${cohort}**`)
    expect(
      text,
      `and the real distance to the threshold (${500 - cohort} records early)`,
    ).toContain(`**${500 - cohort} records before its threshold**`)
  })

  it("the growth arithmetic the record cites is the pipeline's own step, not a guess", () => {
    const fetchSrc = readText("packages/trust-index/src/fetchRegistry.ts")
    const step = Number(fetchSrc.match(/CUMULATIVE_COVERAGE_STEP\s*=\s*(\d+)/)?.[1] ?? 0)
    expect(step, "the pipeline must declare the growth step the gate's message multiplies by").toBe(50)
    // The gate prints "~N more ingest run(s)"; N must come from the constant, so a changed step changes
    // the projection instead of leaving a stale one in the refusal.
    expect(gateCode(), "the runs-to-go projection must divide by the pipeline's step").toMatch(
      /CUMULATIVE_COVERAGE_STEP/,
    )
  })
})

describe("Gate S2 — the five measures exist, and refusal cannot become a number", () => {
  it("all five measures are present under the exact ids the gate prints", () => {
    const code = gateCode()
    for (const m of FIVE_MEASURES) {
      expect(code, `the gate must report "${m}"`).toContain(`"${m}"`)
    }
    expect(
      readText(ARTIFACT),
      "the record must name the measure S2 exists for",
    ).toContain("cohort-completeness")
  })

  it("refusal is a distinct kind with NO ok field, so it cannot be summed into a pass rate", () => {
    // The empty-denominator defect, which is not hypothetical: `gate-s0.ts`'s first INV-R4 had a
    // nonexistent sidecar path, `existsSync` false on all 39 iterations, and printed "0 dangerous
    // false-SAFE" as PASS from zero observations. If `refused` carried `ok: false` it would be summable;
    // if it carried `ok: true` a refusal would inflate a pass rate. It carries neither.
    const code = gateCode()
    const outcome = code.slice(code.indexOf("type Outcome"), code.indexOf("type Outcome") + 400)
    expect(outcome, "the outcome union must have a refused arm").toContain("refused")
    const refusedArm = outcome.slice(outcome.indexOf("refused"))
    expect(
      refusedArm.slice(0, refusedArm.indexOf("}") + 1),
      "the refused arm must NOT carry an `ok` field — that is what keeps it out of a pass rate",
    ).not.toMatch(/\bok\b/)
  })

  it("the three unattributable states are distinguished by KIND, not re-derived from prose", () => {
    // `checkSourceReport` returns its `kind` alongside its reason, and the reason is produced by the
    // branch that rejected. This is the OR-of-candidate-causes fix applied at construction rather than
    // after the fact: a second reader that re-derives the cause from the value drifts from what the check
    // actually rejected, which is how `gate-s1.ts` came to print "schema `v1`, not `v1`, or missing
    // required fields" — a sentence denying its own first clause.
    const code = gateCode()
    for (const k of ["too-old", "unmeasured", "invalid"]) {
      expect(code, `the check must classify \`${k}\` as its own kind`).toContain(`"${k}"`)
    }
    expect(code, "the check must return a reason with the kind, not leave it to the caller").toMatch(
      /kind:\s*"(too-old|unmeasured|invalid)"[\s\S]{0,200}reason:/,
    )
  })

  it("cursor-repeat maps to NO knob, which is the only reason truncationReason is a separate field", () => {
    const code = gateCode()
    expect(code, "record-cap must name the mirror entry cap").toContain("TRUST_INGEST_MIRROR_MAX_ENTRIES")
    expect(code, "page-cap must name the mirror page cap").toContain("TRUST_INGEST_MIRROR_MAX_PAGES")
    // `null`, not a third variable name. A knob invented for this exit is the confidently-wrong remedy:
    // the source returned a cursor it had already given us, and no configuration change extends the read.
    expect(code, "cursor-repeat must map to null — no local knob exists").toMatch(
      /"cursor-repeat":\s*null/,
    )
  })
})

describe("Gate S2 — the rows say OPEN, and what would make each false", () => {
  it("every row states its own falsification condition and an explicit status", () => {
    for (const n of [1, 2, 3]) {
      const r = row(n).replace(/\s+/g, " ")
      expect(
        r,
        `S2-OPEN-${n} must name what would falsify it — a row without one can be closed by assertion`,
      ).toMatch(/\*\*Falsification:\*\*/)
      // Same OPEN|CLOSED vocabulary the S1 record uses. A third synonym makes the vocabulary
      // unenforceable, which is what "RESOLVED" did to S1-OPEN-2 until it was normalized.
      expect(r, `S2-OPEN-${n} must carry an explicit status`).toMatch(/\*\*Status:\*\* \*\*(OPEN|CLOSED)/)
    }
  })

  it("S2-OPEN-1 names both causes and refuses to prefer one without evidence", () => {
    const r = row(1).replace(/\s+/g, " ")
    expect(r, "the row must say the upstream total is unrecorded — that is the whole unknown").toMatch(
      /unrecorded/i,
    )
    expect(r, "and must name the knob that would be wrongly raised if the cause were guessed").toContain(
      "capReached",
    )
    // The row's own instruction, asserted so it survives a reader who finds the red inconvenient.
    expect(r, "the row must forbid closing itself by editing the threshold").toContain(
      "Do NOT close this row by editing the threshold",
    )
    expect(r, "and must name the falsifying observation, which points at OUR cap").toContain(
      "capReached: true",
    )
  })

  it("S2-OPEN-2 records the ci:local omission as a DECISION, and the gate is genuinely absent from it", () => {
    const r = row(2).replace(/\s+/g, " ")
    const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string | undefined> }
    const steps = (pkg.scripts["ci:local"] ?? "").split("&&").map((s) => s.trim())
    // Derived from the wiring, not from the prose: the row claims S2 is not in `ci:local`, and if someone
    // wires it in without updating the row, THIS reds rather than the record quietly lying.
    expect(
      steps.filter((s) => s.includes("gate:s2")),
      "S2-OPEN-2 claims S2 is not in ci:local — wiring it in must red this row's assertion",
    ).toEqual([])
    expect(
      steps.some((s) => s.includes("gate:s1:regression")),
      "S1's regression mode IS wired — the contrast is what makes S2's omission a decision",
    ).toBe(true)
    expect(r, "the row must state the condition for wiring it in").toMatch(/400/)
  })

  it("S2-OPEN-3 distinguishes S3 and S4 rather than calling them copies of this gate", () => {
    const r = row(3).replace(/\s+/g, " ")
    // The useful content of this row is WHY the next two rungs are not this gate again. A row that just
    // said "do S3 and S4 next" would be a to-do; these two claims are what make it a design note.
    expect(r, "S3's difference is that `all` has no numeric threshold to assert").toMatch(
      /no numeric threshold/i,
    )
    expect(r, "S4's difference is that it is a generality claim, not a scale rung").toMatch(/generality/i)
    expect(r, "and S4's real obstacle is the single-source join this gate depends on").toContain(
      "REGISTRY_NAMESPACE",
    )
  })
})

describe("Gate S2 — the refusal is asserted by RUNNING the gate, not by reading its source", () => {
  // The one executing block, and the reason is the lesson quoted in this file's header: a message defect
  // cannot be pinned by grepping for its pieces. The pieces were all present in the defective version of
  // `gate-s1.ts`'s refusal too, and this suite's own `stripComments` exists because a docblock once
  // satisfied an assertion meant for a runtime string.
  const dir = mkdtempSync(join(tmpdir(), "gate-s2-attrib-"))
  const reports = join(dir, ".var", "calllint-adoption-index", "reports")
  mkdirSync(reports, { recursive: true })

  /**
   * A v2 report the gate ACCEPTS. Not asserted on directly — it exists so that each variant below
   * differs from an accepted fixture in exactly one field, which is what makes a refusal attributable to
   * that field rather than to a fixture the gate would have rejected anyway.
   *
   * `snapshotMaxEntries` IS AT THE THRESHOLD ON PURPOSE, and this is the correction that made the
   * mirror-attribution tests below mean anything. It was 200 — under the 500 threshold — so every variant
   * was intercepted by the cohort-cap branch before reaching the `capReached` branch it was written to
   * exercise, and the suite was green because it asserted only that a message NAMED something, never that
   * the branch under test was the one that ran. A fixture whose cohort cap already bounds the cohort
   * cannot isolate a question about the mirror read.
   */
  const validV2 = {
    schema: "calllint.compiler-run-report.v2",
    runId: "fixture",
    runType: "full",
    outcome: "SUCCEEDED",
    startedAt: "2026-08-31T00:00:00.000Z",
    completedAt: "2026-08-31T00:01:00.000Z",
    outputManifestDigest: null,
    inputManifestDigest: `sha256:${"a".repeat(64)}`,
    metrics: {},
    attempts: { artifacts: null, evidence: null },
    source: {
      recordsRead: 150,
      capReached: false,
      truncationReason: null,
      snapshotMaxEntries: 500,
      mirrorMaxEntries: 100_000,
    },
  }

  /**
   * Run the gate in REPORT mode against a fixture store.
   *
   * Report mode, not `--gate`: `--gate` exits non-zero on a refusal (correctly), and these assertions are
   * about the TEXT of the refusal rather than the exit code, which is asserted separately below. Report
   * mode exits 0 unconditionally, so this is safe to read without a `try`.
   */
  const runGate = (name: string, body: string | null): string => {
    for (const e of readdirSync(reports)) rmSync(join(reports, e), { force: true })
    if (body !== null) writeFileSync(join(reports, `run-${name}.json`), body)
    return execFileSync("pnpm", ["gate:s2"], {
      cwd: fileURLToPath(repoRoot),
      encoding: "utf8",
      env: { ...process.env, ADOPTION_INDEX_CWD: dir },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    })
  }

  const withSource = (over: Record<string, unknown>): string =>
    JSON.stringify({ ...validV2, source: { ...validV2.source, ...over } })

  it("with NO report, the shortfall is UNKNOWN and the gate says so instead of guessing", () => {
    const out = runGate("none", null)
    // `REFUSED\s*\]` because the gate pads the tier label to align the measure column. Matching the
    // padding exactly would couple this to the width of the longest label, which is cosmetic.
    expect(out, "the measure must REFUSE, never fail and never pass").toMatch(
      /\[REFUSED\s*\] cohort-completeness/,
    )
    expect(out, "the attribution must be explicitly unknown").toContain("UPSTREAM EXHAUSTION UNKNOWN")
    expect(out, "and must name the remedy that would produce the missing evidence").toContain(
      "pnpm ingest:trust-index",
    )
    // The product principle applied to the product's own gate. Without this, "no evidence" would read as
    // "probably upstream", which is the confidently-wrong reason: consumed and acted on, sending someone
    // to accept a shortfall our own cap in fact caused.
    expect(out, "UNKNOWN must not be presented as either cause").toContain("UNKNOWN is not SAFE")
    expect(out, "neither attribution may be claimed without evidence").not.toContain(
      "THE SHORTFALL IS UPSTREAM'S",
    )
    expect(out, "and certainly not ours").not.toContain("THE SHORTFALL IS OURS")
  })

  // THE TEST THAT WAS MISSING, AND THE DEFECT IT PINS. Before this branch existed the gate attributed the
  // shortfall by reading `capReached` alone — a fact about the MIRROR read (cap 100_000) — while the
  // measure's subject is the SERVED COHORT (cap `snapshotMaxEntries`, auto-grown +50/run). Fed the values
  // the next real ingest will write, it printed: "read the source TO ITS END — 65235 record(s) with caps
  // snapshot=200 ... neither of which bound it. So upstream held fewer than 500 live records."
  //
  // Every clause false, and refuted by numbers in its own sentence: 65235 is not "fewer than 500", and
  // snapshot=200 is a cap that bound the cohort printed beside the claim that none did. Not a wording
  // slip — it sends an operator to accept a shortfall our own cap caused, which is exactly the
  // confidently-wrong reason this measure was built to refuse.
  it("a cohort cap under the threshold is attributed to US even when the mirror was exhausted", () => {
    // Deliberately the strongest possible exhaustion evidence — a huge read, `capReached: false` — so the
    // ONLY thing that can produce a correct answer here is reading the cohort cap. If the gate regresses to
    // attributing by `capReached`, this fixture is the one it gets most confidently wrong.
    const out = runGate(
      "cohort-capped",
      withSource({
        recordsRead: 65_235,
        capReached: false,
        truncationReason: null,
        snapshotMaxEntries: 200,
        mirrorMaxEntries: 100_000,
      }),
    )
    expect(out, "the cohort cap bound the emitted set, so the shortfall is ours").toContain(
      "THE COHORT CAP BOUND IT, NOT UPSTREAM",
    )
    // The knob that actually governs the cohort. Naming a mirror knob here is the specific wrong advice:
    // the mirror read already reached the end of the source, so raising either mirror cap changes nothing.
    expect(out, "the cohort knob must be named").toContain("TRUST_INGEST_MAX_ENTRIES")
    expect(out, "a mirror knob is useless when the mirror already exhausted the source").not.toContain(
      "TRUST_INGEST_MIRROR_MAX_ENTRIES",
    )
    expect(out, "nor the page cap").not.toContain("TRUST_INGEST_MIRROR_MAX_PAGES")
    // The false claim, asserted absent by its exact wording. This is the regression that shipped.
    expect(out, "it must NOT claim upstream is short — 65235 records were just read").not.toContain(
      "THE SHORTFALL IS UPSTREAM'S",
    )
    expect(out, "and must not deny that any cap bound it, with the binding cap printed alongside").not.toContain(
      "neither of which bound it",
    )
    expect(out, "upstream exhaustion is unknowable from a cohort-capped run, and must be left unclaimed").toContain(
      "Upstream exhaustion is UNKNOWN from this run",
    )
    expect(out, "and must still REFUSE rather than fail").toMatch(/\[REFUSED\s*\] cohort-completeness/)
  })

  // The fixture's own validity, asserted rather than assumed. Six tests below ask questions about the
  // MIRROR read, and every one of them is silently void if the shared fixture's cohort cap is under the
  // threshold — the cohort-cap branch intercepts first, and each test still passes because it only checks
  // that a message names something. That is how the defect above survived a green suite: the assertions
  // never established WHICH branch produced the text they matched.
  it("the shared fixture cannot bound the cohort, or every mirror-attribution test below is void", () => {
    expect(
      validV2.source.snapshotMaxEntries,
      "`snapshotMaxEntries` must be >= S2's threshold, else the cohort-cap branch answers first and the " +
        "mirror-read tests below assert nothing about the branch they name",
    ).toBeGreaterThanOrEqual(500)
    expect(
      validV2.source.mirrorMaxEntries,
      "and the mirror cap must exceed the cohort cap, the invariant `resolveMirrorMaxEntries` enforces",
    ).toBeGreaterThan(validV2.source.snapshotMaxEntries)
  })

  it("capReached:false attributes the shortfall UPSTREAM, and says no local change helps", () => {
    const out = runGate("exhausted", withSource({ capReached: false, truncationReason: null }))
    expect(out, "the read reached the end of the source, so the shortfall is upstream's").toContain(
      "THE SHORTFALL IS UPSTREAM'S, NOT A DEFECT",
    )
    expect(out, "and the remedy must be explicitly none-here, not a knob").toContain(
      "NO LOCAL CHANGE RAISES THIS",
    )
    expect(out, "it must not name a knob for a shortfall it just attributed upstream").not.toContain(
      "TRUST_INGEST_MIRROR_MAX_ENTRIES",
    )
    expect(out, "and must still REFUSE — the threshold is genuinely unmet").toMatch(
      /\[REFUSED\s*\] cohort-completeness/,
    )
  })

  it("capReached:true with record-cap attributes the shortfall to US, and names the right knob", () => {
    const out = runGate("record", withSource({ capReached: true, truncationReason: "record-cap" }))
    expect(out, "our cap ended the read, so the shortfall is ours").toContain(
      "THE SHORTFALL IS OURS, NOT UPSTREAM'S",
    )
    expect(out, "the binding cap's knob must be NAMED, not described").toContain(
      "raise `TRUST_INGEST_MIRROR_MAX_ENTRIES`",
    )
    // The two caps are not interchangeable, and "raise the limit" without a variable name is what sends
    // an operator to the wrong one. Naming exactly one is the whole point.
    expect(out, "it must not offer the page cap as an alternative for a record-cap exit").not.toContain(
      "raise `TRUST_INGEST_MIRROR_MAX_PAGES`",
    )
    expect(out, "and must not claim upstream is short when our own cap bound the read").not.toContain(
      "THE SHORTFALL IS UPSTREAM'S",
    )
  })

  it("page-cap names the OTHER knob — proving the remedy varies with the reason", () => {
    // Without this, the record-cap test above is satisfied by a gate that prints
    // TRUST_INGEST_MIRROR_MAX_ENTRIES unconditionally. Two exits, two distinct knobs, neither leaking
    // into the other is what proves the mapping is a lookup rather than a constant.
    const out = runGate("page", withSource({ capReached: true, truncationReason: "page-cap" }))
    expect(out, "a page-cap exit must name the page cap").toContain("raise `TRUST_INGEST_MIRROR_MAX_PAGES`")
    expect(out, "and must not name the record cap").not.toContain("raise `TRUST_INGEST_MIRROR_MAX_ENTRIES`")
  })

  it("cursor-repeat says NO knob exists rather than inventing one", () => {
    const out = runGate("cursor", withSource({ capReached: true, truncationReason: "cursor-repeat" }))
    expect(out, "the gate must state that no configuration change extends this read").toContain(
      "NO local knob",
    )
    expect(out, "and must not offer either cap as a remedy").not.toMatch(
      /raise `TRUST_INGEST_MIRROR_MAX_(ENTRIES|PAGES)`/,
    )
  })

  it("an UNRECOGNISED exit refuses to guess a knob, instead of defaulting to one", () => {
    // The dangerous default. A `Record` lookup returns `undefined` for an unknown key, and a gate that
    // treated `undefined` as "probably the record cap" would send an operator to raise a limit that was
    // never binding — the same misdirection as the OR-of-candidates defect, one layer down.
    const out = runGate("weird", withSource({ capReached: true, truncationReason: "quota-exhausted" }))
    expect(out, "the unknown reason must be quoted back").toContain("quota-exhausted")
    expect(out, "and the gate must say it will not guess").toContain("will not guess")
    expect(out, "no knob may be offered for a reason the gate does not know").not.toMatch(
      /raise `TRUST_INGEST_MIRROR_MAX_(ENTRIES|PAGES)`/,
    )
  })

  it("capped-but-no-reason names the WRITER as the defect, since the cap cannot be identified", () => {
    const out = runGate("noreason", withSource({ capReached: true, truncationReason: null }))
    expect(out, "an incoherent report must be reported as such").toContain("records no reason")
    expect(out, "and the remedy is the writer, not a knob").toContain("syncSource")
    expect(out, "no knob may be named when the binding limit is unidentifiable").not.toMatch(
      /raise `TRUST_INGEST_MIRROR_MAX_(ENTRIES|PAGES)`/,
    )
  })

  it("a v1 report is refused as TOO OLD, by name, rather than read with v2 semantics", () => {
    // The schema-drift case, and the reason v1 gets its own `kind`: a v1 report is not malformed, it is
    // an accurate record of a run that did not measure this. The remedy is a new ingest, not editing the
    // old report — so "invalid" would send the reader to corrupt a truthful file.
    const v1 = JSON.parse(JSON.stringify(validV2)) as Record<string, unknown>
    v1["schema"] = "calllint.compiler-run-report.v1"
    delete v1["source"]
    const out = runGate("v1", JSON.stringify(v1))
    expect(out, "the version found must be named").toContain("calllint.compiler-run-report.v1")
    expect(out, "and the reason must be that it predates the section, not that it is malformed").toContain(
      "predates the `source` section",
    )
    expect(out, "the attribution stays unknown — a v1 report cannot answer the question").toContain(
      "UPSTREAM EXHAUSTION UNKNOWN",
    )
  })

  it("a v3 report is refused naming v3, never read with v2 semantics", () => {
    // Exact-match, never prefix. A prefix match on `calllint.compiler-run-report.` accepts every future
    // version sight unseen, which is the failure mode where a field's MEANING changes and the gate keeps
    // reading it confidently.
    const out = runGate("v3", JSON.stringify({ ...validV2, schema: "calllint.compiler-run-report.v3" }))
    expect(out, "the version in the FILE must be named — that is the contract that was broken").toContain(
      "calllint.compiler-run-report.v3",
    )
    expect(out, "the attribution stays unknown").toContain("UPSTREAM EXHAUSTION UNKNOWN")
    expect(out, "an unknown schema must never be attributed as upstream exhaustion").not.toContain(
      "THE SHORTFALL IS UPSTREAM'S",
    )
  })

  it("--gate exits 2 on the refusal, and --regression exits 0 — the modes differ by design", () => {
    // The three modes are what make S2 usable before its threshold: `--gate` is the full claim and is
    // EXPECTED red at cohort 150, while `--regression` enforces only the measures with a committed source
    // and is the mode CI would run. If both behaved alike, S2 would be either unusable or vacuous.
    const run = (args: readonly string[]): number => {
      for (const e of readdirSync(reports)) rmSync(join(reports, e), { force: true })
      try {
        execFileSync("pnpm", [...args], {
          cwd: fileURLToPath(repoRoot),
          encoding: "utf8",
          env: { ...process.env, ADOPTION_INDEX_CWD: dir },
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
        })
        return 0
      } catch (e) {
        return (e as { status?: number }).status ?? -1
      }
    }
    expect(run(["gate:s2:gate"]), "the full S2 claim is unmet at this cohort, so --gate must be red").toBe(2)
    expect(
      run(["gate:s2:regression"]),
      "the four measures with a committed source pass, so --regression must be green",
    ).toBe(0)
  })

  it("the served floor --regression enforces is DERIVED from the committed snapshot, not a literal", () => {
    // S1-OPEN-3's lesson, carried forward: a hardcoded floor is a number someone edits downward to make
    // a red CI green. Derived, the only way to lower it is to shrink the committed snapshot, which is the
    // thing the floor exists to notice.
    const code = gateCode()
    expect(code, "the floor must come from a function over the committed bytes").toMatch(
      /committedRegistryCohort/,
    )
    const cohort = committedCohort()
    expect(
      code,
      `the gate must not hardcode the current cohort (${cohort}) as its floor`,
    ).not.toMatch(new RegExp(`ratchetFloor\\s*=\\s*${cohort}\\b`))
  })
})
