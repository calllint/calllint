import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
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

/** The four with no data source in this checkout. Asserted as REFUSED, never as a number. */
const REFUSED_MEASURES = [
  "adapter-failure-rate",
  "processing-time-mean-p95",
  "cas-dedup-rate",
  "disk-growth",
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
  it("the artifact parses, carries all four rows, and is substantial", () => {
    const text = readText(ARTIFACT)
    expect(
      text.length,
      "a record short enough to be a stub cannot carry the reasoning the rows below assert",
    ).toBeGreaterThan(4000)
    for (const n of [1, 2, 3, 4]) {
      expect(text, `${ARTIFACT} must carry a "## S1-OPEN-${n}" heading`).toContain(`## S1-OPEN-${n}`)
    }
    // Pinned as a count so a fifth row cannot be added without this suite gaining assertions for
    // it — the shape S0-OPEN-5 grew into when a 20th REGRESSION_CHECKS row arrived unread.
    //
    // Raised 3→4 on 2026-08-28 for S1-OPEN-4, and the raise was EARNED rather than typed: this
    // assertion redded first with "a fourth needs its own assertions rather than inheriting these",
    // and the S1-OPEN-4 block below is those assertions. Bumping the literal alone would have been
    // the exact evasion the message names.
    const rows = [...text.matchAll(/^## S1-OPEN-\d+/gm)]
    expect(
      rows.length,
      "four rows are asserted here; a fifth needs its own assertions rather than inheriting these",
    ).toBe(4)
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
    assertPointer(GATE, 106, "S1_REQUIRED_RECORDS = 100", "S1_REQUIRED_RECORDS")
    assertPointer(GATE, 121, "function committedRegistryCohort", "the derived ratchet floor")
    assertPointer(GATE, 203, "type Outcome", "the outcome union that makes refusal first-class")
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
  it("all seven measures new15 names are present in the gate, under those exact ids", () => {
    const src = readText(GATE)
    for (const id of SEVEN_MEASURES) {
      expect(src, `the gate must take (or refuse) the "${id}" measure new15 §342 names`).toContain(
        `"${id}"`,
      )
    }
  })

  it("the four measures with no data source are REFUSED, and cannot be reported as a rate", () => {
    const src = readText(GATE)
    // THE ASSERTION THIS FILE EXISTS FOR. Each of the four must be passed to `refused(...)` — not to
    // `measured(...)`. A future batch computing any of them over the empty store would print a
    // perfect score, which is the exact defect gate-s0.ts's first INV-R4 shipped.
    for (const id of REFUSED_MEASURES) {
      const refusedCall = new RegExp(`refused\\(\\s*"${id}"`)
      expect(
        src,
        // The reason names the QUEUE tables, not "the store", and that wording is load-bearing: the
        // store is NOT empty (298 subjects, 45 blobs — see S1-OPEN-4), and a failure message repeating
        // the struck claim would teach the next reader the same false thing the gate's docblock did.
        `"${id}" has no data source in this checkout (\`compiler_jobs\` / \`compiler_runs\` are empty in every candidate store, because the queue has no driver), so it must be REFUSED — computing it as 0/0 renders as a perfect score`,
      ).toMatch(refusedCall)
      const measuredCall = new RegExp(`measured\\(\\s*"${id}"`)
      expect(
        src,
        `"${id}" must NOT be reported as a measured value while its data source is empty`,
      ).not.toMatch(measuredCall)
    }
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
    expect(
      src,
      "report mode's unconditional exit 0 must be stated at the exit, where a future batch would otherwise add a failing condition to it",
    ).toContain("a report mode that could fail would be a third enforcing mode by accident")
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
    for (const n of [1, 2, 3, 4]) {
      const r = row(n).replace(/\s+/g, " ")
      expect(
        r,
        `S1-OPEN-${n} must name what would falsify it — a row without one can be closed by assertion`,
      ).toMatch(/\*\*Falsification:\*\*/)
      expect(r, `S1-OPEN-${n} must carry an explicit status`).toMatch(/\*\*Status:\*\* \*\*(OPEN|CLOSED)/)
    }
  })

  it("S1-OPEN-1's blocker is the QUEUE being undriven, not a directory being empty", () => {
    const r = row(1).replace(/\s+/g, " ")
    expect(r, "the row must name the four refused measures as its subject").toContain(
      "four refused ones are precisely the *scale* measures",
    )
    // The row's premise is now stated against the two queue tables rather than against "`.var/` is
    // empty", and the reason is S1-OPEN-4: the original premise was SATISFIED by a mis-rooted read, so
    // a filesystem-emptiness assertion here was green for the wrong reason while 45 blobs sat in the
    // other store. What actually blocks the row is that nothing enqueues — asserted against source.
    expect(
      r,
      "S1-OPEN-1 must name the missing queue driver as the blocker; 'run the worker' is not a remedy",
    ).toMatch(/no non-test caller|queue driver/)
    const queue = readText("packages/adoption-index/src/operations/compilerQueue.ts")
    expect(queue, "the queue functions the row names must still exist").toMatch(/export function enqueueJobs/)
    expect(queue, "the queue functions the row names must still exist").toMatch(
      /export function beginCompilerRun/,
    )
  })

  it("S1-OPEN-2 names S2 as the same shape one rung up, and S2 indeed has no gate yet", () => {
    const r = row(2).replace(/\s+/g, " ")
    expect(r, "the row must name the next threshold it is about").toContain("500")
    const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string | undefined> }
    // The row's own falsification condition, asserted. If a `gate:s2` script appears, this reds and
    // the row should close — which is the outcome the row asks for.
    expect(
      Object.keys(pkg.scripts).filter((k) => k.startsWith("gate:s2")),
      "S1-OPEN-2 claims S2 has no gate; if one now exists, close the row rather than deleting this assertion",
    ).toEqual([])
    expect(
      existsSync(fileURLToPath(new URL("scripts/gate-s2.ts", repoRoot))),
      "S1-OPEN-2 claims there is no gate-s2.ts; if there is, the row is stale",
    ).toBe(false)
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
    // refusal has to be explicit: the cheapest way to close S1-OPEN-1 on paper is to rename this
    // column into the measure §342 asks for.
    expect(
      src,
      "adapter-failure-rate must stay REFUSED while its only source grades artifacts, not attempts",
    ).toMatch(/refused\(\s*"adapter-failure-rate"/)
    expect(
      src,
      "the refusal must say why artifact_status is not a substitute",
    ).toContain("grades an artifact's state, not an attempt's outcome")
  })
})
