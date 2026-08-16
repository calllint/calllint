/**
 * The three open PRODUCT JUDGEMENTS get a machine reader.
 *
 * `artifacts/adoption-index-v1/current-gaps.md` states all three, and every one of them is a
 * DELIBERATE non-decision: mechanism present, surface or wiring withheld until a human answers a
 * question that is not mechanical. That shape is invisible to every other guard in this repo,
 * because nothing is broken — the code is correct, the tests are green, and the absence is the
 * point. Prose is the only thing carrying it.
 *
 * Which makes the failure mode a documentation drift with teeth, in BOTH directions:
 *
 *   - A later batch reads "no claim-facing control API" as a TODO, wires the withdrawal operators to
 *     an MCP tool, and ships an irreversible authority decision to an autonomous caller. The artifact
 *     still says the surface is withheld. Nothing reds.
 *   - Or the reverse: someone answers the question, wires it correctly, and the artifact is never
 *     updated — so the next reader sees a closed gap described as open and rebuilds it
 *     (`Blueprint v1.4:216`, 不允许重复建设 — §3 of that same artifact records five claims that had
 *     already shipped).
 *
 * So each judgement below is pinned by its PREMISE, not by its prose. The assertion is not "the
 * artifact says X"; it is "the state of the code that makes X true is still that state." When a
 * premise flips, this file reds and names which judgement moved and which sentence now lies.
 *
 * This is ADR 0084 D4 generalized past the cohort: an event that is legitimate is still not allowed
 * to happen UNOBSERVED. A red here is a demand for acknowledgement — update the artifact, or record
 * the decision in an ADR — never an accusation that the change was wrong.
 *
 * Deliberately NOT asserted: that the judgements stay open. Closing one is the goal. What must not
 * happen is closing one silently.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(__dirname, "../..")
const GAPS = "artifacts/adoption-index-v1/current-gaps.md"

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

/**
 * Read every `src/` TypeScript file under a package, excluding tests and declarations.
 *
 * A premise like "no caller exists" is only measurable over a KNOWN file set. Globbing by hand keeps
 * the denominator visible: an empty set would make every "absent from" assertion below vacuously
 * true, which is the [[a-fixture-corpus-that-avoids-the-key-space]] shape, so the callers of this
 * function assert the count is non-zero before asserting anything is missing from it.
 */
function srcFiles(relDir: string): string[] {
  const abs = path.join(ROOT, relDir)
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !/\.test\.ts$/.test(e.name)) out.push(p)
    }
  }
  walk(abs)
  return out
}

function concatSources(relDirs: string[]): { text: string; fileCount: number } {
  const files = relDirs.flatMap((d) => srcFiles(d))
  return { text: files.map((f) => readFileSync(f, "utf8")).join("\n"), fileCount: files.length }
}

/**
 * Remove block and line comments so an "absent from" scan measures CODE, not prose.
 *
 * This repo has already shipped the inverse defect twice: a source guard that red on the docblock
 * arguing FOR the rule it enforced ([[source-scan-must-read-code-not-prose]]). Here the hazard is
 * concrete — `trust-index/src/resolution.ts:76` names `applyWithdrawal` in a comment whose whole
 * purpose is to record that the axis is unmeasured. A scan that counts a mention as an invocation
 * turns every honest note about a gap into a red.
 *
 * Deliberately naive: this is a token-presence scan over TypeScript source, not a parser. It does not
 * try to respect `//` inside a string literal, because a false STRIP could only ever hide a caller,
 * and the assertions using it are re-derived from `grep` in the same batch.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("the three open product judgements have a machine reader", () => {
  it("the artifact still states all three, so this file has a subject", () => {
    const gaps = readText(GAPS)
    // If a section is renamed or removed, every premise assertion below silently stops describing
    // anything real. Pinned first, in assertion order: a literal pinned AFTER the claim it supports
    // makes that claim unreachable ([[assertion-order-decides-falsifiability]]).
    expect(gaps, "§1.2 — the ingestion-scale judgement").toContain("No incremental sync")
    expect(gaps, "§1.5 — the claim-facing control surface judgement").toContain("No claim-facing control API")
    expect(gaps, "§1.6 — the scale-threshold judgement").toContain("No scale-threshold instrumentation")
  })

  it("the artifact names this reader, so the link cannot rot one-way", () => {
    // Every premise above is stated in the artifact, and the artifact now cites this file back. Without
    // this assertion the link is one-directional: someone rewrites a section, drops the reference, and
    // the guard keeps passing while the prose it guards no longer admits a guard exists
    // ([[a-pointer-rots-faster-than-its-claim]]).
    //
    // Pinned on the BASENAME, not a line number: this file's own line numbers move on every edit, and a
    // pointer that reds on unrelated edits gets deleted rather than fixed.
    const gaps = readText(GAPS)
    expect(gaps, "the artifact must cite its machine reader by name").toContain("open-judgements.invariants.test.ts")

    // And each judgement's own section must carry the citation, not just the file somewhere. Measured by
    // splitting on the section headings the first test already pinned.
    const sections = gaps.split(/^### /m)
    for (const [heading, judgement] of [
      ["1.1 No durable source mirror", "J1"],
      ["1.5 No claim-facing control API", "J2"],
      ["1.6 No scale-threshold instrumentation", "J3"],
    ] as const) {
      const body = sections.find((s) => s.startsWith(heading))
      expect(body, `${judgement}: §${heading} must still exist to carry its reader citation`).toBeDefined()
      expect(
        body as string,
        `${judgement}: §${heading} states a premise this file pins, so it must cite the reader — ` +
          "otherwise the next reader rewrites the section with no idea a guard depends on it",
      ).toContain("open-judgements.invariants.test.ts")
    }
  })

  /**
   * J1 — the projection wiring (R-7).
   *
   * R-7 wrote `calllint.adoption-record.v1` and deliberately did NOT rewire the projections, because
   * binding "is the record right?" to "is the served tree unchanged?" in one PR makes a red on either
   * side undiagnosable. The premise is that `emitCohort`/`bake` still do not read a compiled record.
   */
  it("J1: the projections still do not read a compiled adoption record", () => {
    // The judgement is about the SERVING path, so it is measured on the serving path's own file.
    // `adoption-index/src/**` legitimately mentions records everywhere — that package DEFINES them.
    //
    // Comments stripped: the most likely edit to `bake.ts` is a NOTE saying it deliberately does not
    // read a compiled record — the honest documentation of this very judgement. A raw-text scan would
    // red on that note and be read as "the wiring happened", which is the opposite of the truth
    // ([[source-scan-must-read-code-not-prose]]).
    const bake = stripComments(readText("packages/trust-index/src/bake.ts"))

    expect(
      /adoption_records|adoptionRecordDigest\s*\(/.test(bake),
      "J1 PREMISE MOVED: `bake.ts` now reads a compiled adoption record. R-7's recorded reason for " +
        "leaving the projections untouched was that binding record-correctness to served-bytes-stability " +
        "in one change makes a red on either side undiagnosable. If that wiring has now happened, " +
        `${GAPS} §1.1 and CHANGELOG's R-7 entry both describe a state that no longer exists — update ` +
        "them, or record the decision in an ADR.",
    ).toBe(false)
  })

  /**
   * J2 — the publisher de-listing surface (§1.5), the load-bearing one.
   *
   * The withdrawal MECHANISM shipped in R-11 (`planWithdrawal` / `applyWithdrawal` /
   * `setSubjectLifecycle`). What was withheld is any way for a publisher or an agent to INVOKE it,
   * because a de-listing is a claim-facing authority decision and exposing it before the authority
   * model exists is the same mistake as shipping a verdict with no evidence.
   *
   * This is the judgement whose accidental closure is actually dangerous, so it is pinned twice:
   * once on the absence of a caller, once on `TOMBSTONED` being unreachable automatically.
   */
  it("J2: the withdrawal mechanism exists and no agent-facing surface invokes it", () => {
    // Direction 1 — the mechanism must still BE there. If it were deleted, "surface withheld" would
    // be true for the wrong reason, and this test would go green while the gap silently changed
    // meaning back to "no mechanism at all" ([[a-clamp-with-no-failing-mode]]).
    //
    // Asserted at the DEFINITION sites, which are `operations/*.ts` — not `domain/subjectLifecycle.ts`.
    // That file holds the transition TABLE and its docblock mentions `applyWithdrawal` in prose only,
    // so pinning the mechanism there would have been a guard reading a comment
    // ([[source-scan-must-read-code-not-prose]]).
    expect(
      readText("packages/adoption-index/src/operations/planWithdrawal.ts"),
      "J2: `planWithdrawal` is the premise; §1.5 describes the mechanism as present",
    ).toContain("export function planWithdrawal")
    expect(
      readText("packages/adoption-index/src/operations/applyWithdrawal.ts"),
      "J2: `applyWithdrawal` is the premise; §1.5 describes the mechanism as present",
    ).toContain("export function applyWithdrawal")

    // Direction 2 — no agent-facing surface may call it. Measured over a known, non-empty file set.
    const { text, fileCount } = concatSources(["packages/calllint-mcp/src", "apps/cli/src"])
    expect(fileCount, "J2: the agent-facing surfaces must be a non-empty file set, or this proves nothing").toBeGreaterThan(
      0,
    )
    // Comments are stripped before scanning. `trust-index/src/resolution.ts:76` mentions
    // `applyWithdrawal` in a prose note explaining that the axis is unmeasured — a scan that counted
    // that as a caller would red on the sentence documenting the gap it is guarding
    // ([[source-scan-must-read-code-not-prose]]). That file is outside this file set, but the
    // stripping is what makes the assertion measure invocation rather than mention.
    const code = stripComments(text)

    // `setSubjectLifecycle` is a TRANSACTION METHOD (`tx.setSubjectLifecycle`), not a free function,
    // so it is matched on its call form. Grepping for an `export function` of that name finds nothing
    // and would have made this row vacuous.
    for (const op of ["planWithdrawal", "applyWithdrawal", "setSubjectLifecycle"]) {
      expect(
        code.includes(op),
        `J2 PREMISE MOVED: an agent- or user-facing surface now calls \`${op}\`. A de-listing is an ` +
          `authority decision, and ${GAPS} §1.5 records that the surface is withheld ON PURPOSE until ` +
          "the authority model exists — not merely unbuilt. If the authority model now exists, say so " +
          "in an ADR and update §1.5. If it does not, this is an irreversible operation reachable by an " +
          "autonomous caller.",
      ).toBe(false)
    }
  })

  it("J2b: TOMBSTONED stays unreachable from any automatic path", () => {
    // The transition table PERMITS `WITHDRAWN -> TOMBSTONED` precisely so the irreversible conclusion
    // stays reachable from an explicit, human-authorized path. Both halves are asserted, because
    // either alone is satisfiable while the other is wrong.
    expect(
      readText("packages/adoption-index/src/domain/subjectLifecycle.ts"),
      "the terminal state must remain permitted, or the lifecycle is incomplete",
    ).toContain("TOMBSTONED")

    // The enforcement point is `planWithdrawal`, NOT `applyWithdrawal`. `applyWithdrawal` writes
    // whatever `entry.to` the plan carries (`tx.setSubjectLifecycle({ status: entry.to })`) — it has no
    // opinion about which status that is, and contains no `TOMBSTONED` token to assert on. So the
    // safety property lives one step upstream: the automatic planner proposes `WITHDRAWN` only.
    const plan = readText("packages/adoption-index/src/operations/planWithdrawal.ts")
    expect(plan, "J2b: the automatic path must still conclude WITHDRAWN").toContain('to: "WITHDRAWN"')

    // Measured over CODE, because this file's docblock names `TOMBSTONED` five times explaining why it
    // is unreachable. Asserting on the raw text would red on the prose that documents the guarantee.
    expect(
      stripComments(plan).includes("TOMBSTONED"),
      "J2b PREMISE MOVED: `planWithdrawal` now names TOMBSTONED in executable code. §1.5's stated safety " +
        "property is that no cohort OBSERVATION can reach the irreversible state — an upstream de-listing " +
        "must not be able to conclude, by itself, that a subject is gone for good. If a human-authorized " +
        "tombstone path now exists, it needs an ADR and a §1.5 update, not a new branch in the planner.",
    ).toBe(false)
  })

  /**
   * J3 — the 100 → 500 expansion (§1.6).
   *
   * Nothing measures ingest cost, mirror read volume, or bake time as a function of cohort size, so
   * 100 → 500 has no evidence behind it. Two premises: the single-shot fetch has no cursor (§1.2),
   * and the cap value the artifact reasons about is the cap that is actually compiled in.
   */
  it("J3: ingestion is still single-shot, and the cap in the artifact is the compiled cap", () => {
    const fetch = readText("packages/trust-index/src/fetchRegistry.ts")

    // §1.2's measurement, re-run rather than quoted. Its own text records the grep it used. Comments
    // stripped for the same reason as J1: a note explaining "no cursor is threaded here" is the
    // expected shape of an honest edit, and must not read as the mechanism having arrived.
    const fetchCode = stripComments(fetch)
    for (const token of ["cursor", "updated_since", "updatedSince", "watermark"]) {
      expect(
        fetchCode.includes(token),
        `J3 PREMISE MOVED: \`fetchRegistry.ts\` now contains \`${token}\`. §1.2 says the ingestion path ` +
          '"has no mechanism that survives being asked for 500" and §1.6 says nothing measures the step. ' +
          "Incremental sync is exactly the mechanism whose absence those sections assert.",
      ).toBe(false)
    }

    // The cap is read from the source, not pinned to a literal here: pinning 100 in this file would
    // make a second copy of a fact the code already owns, and the artifact's §1.6 amendment is the
    // record of the last move (25 -> 100). What must hold is that the artifact DISCUSSES the compiled
    // value — a cap that moved to 500 with §1.6 still reasoning about 100 is the drift being caught.
    const cap = /export const DEFAULT_MAX_ENTRIES = (\d+)/.exec(fetch)
    expect(cap, "J3: `DEFAULT_MAX_ENTRIES` must be findable to be compared against the artifact").not.toBeNull()
    const capValue = cap![1] as string
    const gaps = readText(GAPS)
    expect(
      gaps.includes(`DEFAULT_MAX_ENTRIES = ${capValue}`) || gaps.includes(`25 → ${capValue}`),
      `J3 PREMISE MOVED: the compiled cap is ${capValue}, and ${GAPS} §1.6 does not reason about that ` +
        "value. §1.6's whole claim is that an expansion step must arrive with its own artifact " +
        "(ADR 0061 §11) — a cap that moved without one is the gate being bypassed, not a config tweak.",
    ).toBe(true)
  })

  /**
   * §1.6's LAST paragraph is stale, and this test records that rather than pinning it.
   *
   * That paragraph (dated 2026-08-11, ADR 0074's amendment) says the cap "**cannot** remove the
   * eviction, only defer it — measured, the claimed subject is evicted at cohort `cap + 1` at every
   * cap." ADR **0075** landed the NEXT DAY and is titled, verbatim, "The cap deferred the eviction;
   * the selection rule removes it." `selectCohortEntries` retains every reserved name whenever
   * `max >= 1`, so `cap + 1` no longer evicts the claimed subject at any cap. Both sentences cannot
   * be true, and the one in the artifact is the older one.
   *
   * So the assertion here is the opposite of what a prose-following reader would write: it pins that
   * the RETENTION RULE is present, and it deliberately does NOT pin the `cap + 1` claim. Pinning that
   * claim would have gone green today for an unrelated reason — `.slice(0, max)` does appear in the
   * file, at the line that caps the RESERVED partition — which is a probe agreeing with a sentence
   * instead of measuring the mechanism ([[probe-agrees-with-the-description-not-the-claim]]).
   *
   * What stays open in §1.6 is the INSTRUMENTATION, asserted by `J3` above. The eviction half is
   * closed, and the sentence saying otherwise is flagged in this file's summary rather than silently
   * pinned into a guard.
   */
  it("§1.6's eviction claim is superseded by ADR 0075, and the retention rule is what holds", () => {
    const fetch = readText("packages/trust-index/src/fetchRegistry.ts")

    // ADR 0075's mechanism, at the file the artifact cites. This is what actually protects the claimed
    // subject, and it is a DIFFERENT mechanism from the cap — conflating the two is how the 25 -> 100
    // move gets mistaken for having solved S0-OPEN-4.
    //
    // Comments stripped BEFORE the function is located. A `[\s\S]{0,N}` bound over raw source is a
    // length guess about a comment, not about code: the first draft used 900 and matched nothing,
    // because this function carries an eight-line note about negative `max`. Bumping N would defer the
    // same failure to the next comment ([[hardcoded-range-stops-covering-its-tail]]); stripping removes
    // the cause, and the tokens being asserted are code either way.
    const code = stripComments(fetch)
    expect(code, "ADR 0075's reserved-name retention is what protects the claimed subject, not the cap").toContain(
      "RESERVED_COHORT_NAMES",
    )
    const select = /export function selectCohortEntries[\s\S]*?\n}/.exec(code)
    expect(select, "`selectCohortEntries` must be findable, or the retention claim is unmeasured").not.toBeNull()
    expect(
      select![0].includes("isReserved"),
      "ADR 0075 REVERTED: the cap is a bare alphabetical prefix again, so the claimed subject is evicted " +
        "at `cap + 1` once more. That would make §1.6's last paragraph true again and reopen S0-OPEN-4 " +
        "as a DEFECT rather than an observation (ADR 0075 §8) — record it in an ADR.",
    ).toBe(true)

    // And the amendment that supersedes it must still be findable. If ADR 0075 were removed from the
    // tree, the reasoning above would be resting on a document that no longer exists.
    expect(
      readdirSync(path.join(ROOT, "adrs")).some((f) => f.startsWith("0075-")),
      "ADR 0075 is the record that supersedes §1.6's eviction paragraph; it must remain in `adrs/`",
    ).toBe(true)
  })
})
