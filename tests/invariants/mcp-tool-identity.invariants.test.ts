import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { evaluateNoRegression, type AggregatorReach, type ToolNameSources } from "@calllint/trust-index"
import { TOOLS } from "../../packages/calllint-mcp/src/tools.js"

// S batch 4 — the control for a mutation that was MEASURED GREEN, and the reason the batch exists.
//
// `artifacts/adoption-index-v1/current-gaps.md:119-123` records an asymmetry: "`pack:smoke:mcp` pins
// tools (13) but only pins resources at >= 1". That row was true when written. It is now INVERTED, and
// the inversion is what this file is about (corrected in that artifact's §6 by append, since the
// original text is preserved as the record of what was observed then):
//
//   - The resources side it called weak was fixed by INV-M8. Today it derives its expectation from the
//     committed bundle, guards vacuity, and asserts SET EQUALITY with both differences named.
//   - The tools side it called strong was, until this batch, `tools.length !== 13` and nothing else.
//
// Measured on this branch before the fix, then rolled back byte-identical: renaming the SERVED
// `calllint_verify_tool_install` to `calllint_verify_tool_installX` while holding the cardinality at 13
// left `pnpm pack:smoke:mcp` at EXIT 0 — printing `tools/list(13)` on its own success line — and
// `pnpm typecheck` at EXIT 0. The wire served a tool that does not exist and the gate called it fine.
// That is INV-M8's 3-of-19 resources defect reproduced on the tools side, in the guard the record named
// as the STRONGER of the two.
//
// Bounded honestly: `packages/calllint-mcp/test/tools.test.ts:31` hand-enumerates the 13 names, so that
// rename WAS caught somewhere. This is a gate-strength gap, not an unguarded surface. The distinction
// still matters, for the reason `mcp-pack-smoke.mjs`'s own comments give: every in-package assertion
// reads the SOURCE array, and only the smoke reads the WIRE of the built, packed bundle.
//
// NOTHING HERE SPAWNS A SUBPROCESS. A test's conclusion must be its own assertion, never a child's
// exit code or stream ([[subprocess-negative-control-prints-fail]]) — so the smoke's assertion is
// re-derived over the same bytes rather than run.
const repoRoot = new URL("../../", import.meta.url)

const readText = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, repoRoot)), "utf8").replace(/\r\n/g, "\n")

const MCP = "packages/calllint-mcp"
const EXPECTED_TOOL_COUNT = 13

/**
 * The tool table's served names, scanned exactly as the two gates scan them.
 *
 * `[^"]+`, not `[a-z_]+`, and the difference is not cosmetic. Negative control #198 (rename a served
 * tool to `...installX`, hold the count at 13) under the tight class red on "captured 12 names" — the
 * VACUITY GUARD fired instead of the drift assertion, so the failure named the scan rather than the
 * renamed tool. Measured on today's bytes: both classes capture the same 13 names, so the looser one
 * costs no precision and lets each assertion fail for its own reason.
 */
const scanDeclared = (src: string): string[] =>
  [...src.matchAll(/^ {4}name: "([^"]+)",$/gm)].map((m) => m[1] as string)

/** The hand-written enumeration in `tools.test.ts`. The only name list NOT derived from the table. */
const scanEnumerated = (src: string): string[] =>
  [...src.matchAll(/^ {8}"([a-z_]+)",$/gm)].map((m) => m[1] as string)

const AGG: AggregatorReach = {
  workflow: "ci.yml",
  job: "build-and-test",
  present: true,
  needs: ["test"],
  parseError: null,
}

const COUNTS = [
  { source: "tools.ts", count: EXPECTED_TOOL_COUNT },
  { source: "mcp-pack-smoke.mjs", count: EXPECTED_TOOL_COUNT },
]

/** Drive the real evaluator and return just the measure this file is about. */
function toolNamesMeasure(toolNames: ToolNameSources) {
  const r = evaluateNoRegression(
    [
      {
        gate: "2.4-A",
        artifact: "artifacts/phase-2.4/gate-A-consistency.json",
        status: "PASSED",
        machineDecidable: true,
      },
    ],
    [],
    [],
    COUNTS,
    1,
    AGG,
    toolNames,
  )
  const m = r.measures.find((x) => x.id === "mcp-tool-names-agree")
  expect(m, "the evaluator must emit `mcp-tool-names-agree` — without it every case below is vacuous").toBeDefined()
  return m as { id: string; pass: boolean; observed: string }
}

describe("S4 — a rename that preserves the count must not survive", () => {
  it("the two name sources agree today, and both carry the full arity", () => {
    // The POSITIVE control, first: if this reds, a red below might only mean the scan broke.
    const declared = scanDeclared(readText(`${MCP}/src/tools.ts`))
    const enumerated = scanEnumerated(readText(`${MCP}/test/tools.test.ts`))

    // Counts before the set claim. Two empty captures compare equal, so a set assertion placed first
    // would be satisfied by a scan that found nothing ([[assertion-order-decides-falsifiability]]).
    expect(
      declared.length,
      `the tool-table scan must capture every served name — an indent change or a reformat silently empties it, and then every set claim below passes by meaning nothing`,
    ).toBe(EXPECTED_TOOL_COUNT)
    expect(
      enumerated.length,
      "the hand-written enumeration must list every name — it is the only side a table rename does NOT move",
    ).toBe(EXPECTED_TOOL_COUNT)

    // And the table itself must be what the package exports, so the regex is not measuring a comment
    // or a fixture that happens to match the shape.
    expect([...declared].sort(), "the scan must reproduce the EXPORTED registry, not merely 13 matching lines").toEqual(
      TOOLS.map((t) => t.name).sort(),
    )
    expect([...enumerated].sort()).toEqual([...declared].sort())
  })

  it("control #198 — a served rename holding the count at 13 is RED, and the measure names the tool", () => {
    // The mutation, applied to the DATA the gate reads rather than to the file: the identical shape
    // that measured EXIT=0 on `pack:smoke:mcp` and `typecheck` before this batch.
    const declared = scanDeclared(readText(`${MCP}/src/tools.ts`))
    const enumerated = scanEnumerated(readText(`${MCP}/test/tools.test.ts`))
    const renamed = declared.map((n) =>
      n === "calllint_verify_tool_install" ? "calllint_verify_tool_installX" : n,
    )
    expect(
      renamed.length,
      "the mutation must PRESERVE the cardinality — that is the whole point; a count change is control #201",
    ).toBe(declared.length)
    expect(renamed, "and it must actually differ, or this control proves nothing").not.toEqual(declared)

    const m = toolNamesMeasure({ declared: renamed, enumerated })
    expect(m.pass, "a rename that holds the count at 13 must NOT pass — it did before this batch").toBe(false)
    // The failure must name the drifted tool, not the scan. This is the assertion that distinguishes
    // the fixed gate from the one that red on "captured 12 names".
    expect(
      m.observed,
      `the measure must name the tool that moved, on BOTH sides of the difference. Observed: ${m.observed}`,
    ).toContain("calllint_verify_tool_installX")
    expect(m.observed).toContain("calllint_verify_tool_install")
    expect(m.observed, "and it must not report a count shortfall — the count is intact").not.toContain("name scan captured")
  })

  it("control #199 — a PAIRED rename is red too, because neither side is derived from the other", () => {
    // The failure mode `mcp-pack-smoke.mjs` alone cannot see. Its expectation is derived FROM the
    // table, so a rename in the table moves both of its sides at once and the smoke stays green by
    // construction ([[audit-keyed-on-its-own-subject]]). Measured: after D1 landed, mutating
    // `tools.ts` left `pack:smoke:mcp` at EXIT 0 for exactly this reason.
    //
    // The gate measure escapes that because its second source is the HAND-WRITTEN enumeration. Renaming
    // in both places is a real, if deliberate, product change — and it must still be visible, because
    // `13` is a frozen product surface and the names are part of it.
    const declared = scanDeclared(readText(`${MCP}/src/tools.ts`)).map((n) =>
      n === "explain_finding" ? "explain_findingX" : n,
    )
    const enumerated = scanEnumerated(readText(`${MCP}/test/tools.test.ts`)).map((n) =>
      n === "explain_finding" ? "explain_findingX" : n,
    )
    // Both sides moved, so the SET EQUALITY holds — and that is precisely why a set-only measure would
    // be green here. What still discriminates is the smoke's WIRE read, asserted in its own test below.
    const m = toolNamesMeasure({ declared, enumerated })
    expect(
      m.pass,
      "a paired rename agrees with itself; the gate measure cannot see it, and saying so is more honest than pretending it can",
    ).toBe(true)
    // So the claim is bounded HERE rather than in prose: the set difference is what the smoke asserts,
    // and it must exist for the un-paired case (#198) even though it cannot see this one.
    expect(
      readText("scripts/mcp-pack-smoke.mjs"),
      "the smoke must compare the SERVED names, not only their count — that is what covers #198 on the wire",
    ).toContain("tools/list name set drifted from the tool table")

    // MEASURED, and narrower than predicted. Applying this mutation to real bytes left
    // `pack:smoke:mcp` at EXIT 0 — the smoke derives its expectation FROM `tools.ts` and the wire is
    // BUILT from `tools.ts`, so one file moves both sides. The wire read does NOT rescue a paired
    // rename; only the frozen 13 and tests that name a tool for other reasons do.
    //
    // Two such tests red under it: the ADR 0003 non-execution invariant ("explain_finding spawns
    // nothing") and the dual-revision serving test. That is real coverage — but INCIDENTAL, keyed to
    // whichever tools happen to be named elsewhere, and it would vanish if those tests looped over
    // `TOOLS` instead. Asserted so the incidental coverage stops being invisible: if the last direct
    // mention of this tool disappears, this reds and the next reader learns the gap widened.
    expect(
      readText(`${MCP}/test/no-exec.test.ts`),
      "the ADR 0003 non-execution invariant must keep naming a tool literally — that incidental mention is all that catches a paired rename beyond the frozen count",
    ).toContain("explain_finding")
  })

  it("control #200 — a scan that captures nothing is RED on the capture, not green on the set", () => {
    // The vacuity guard's own failing mode. Without it, an indent change in `tools.ts` empties both
    // sides, the set difference is `[]` both ways, and the measure passes while observing nothing
    // ([[a-gate-that-cannot-pass-on-success]] in mirror image).
    const m = toolNamesMeasure({ declared: [], enumerated: [] })
    expect(m.pass, "two empty name lists must FAIL — they compare equal, which is the trap").toBe(false)
    expect(
      m.observed,
      "and the failure must report the CAPTURE, so the next reader goes to the regex and not to the tool table",
    ).toContain("name scan captured")
    expect(m.observed).toContain("table=0")

    // The default is the same empty pair, on purpose: a producer that forgets to pass the sources
    // cannot go green. Asserted, because a default that passed would be undetectable from outside.
    const bare = evaluateNoRegression(
      [
        {
          gate: "2.4-A",
          artifact: "artifacts/phase-2.4/gate-A-consistency.json",
          status: "PASSED",
          machineDecidable: true,
        },
      ],
      [],
      [],
      COUNTS,
      1,
      AGG,
    )
    expect(
      bare.measures.find((x) => x.id === "mcp-tool-names-agree")?.pass,
      "omitting the 7th parameter must FAIL — a default that passes hides a producer that stopped observing",
    ).toBe(false)
  })

  it("control #201 — dropping a tool is RED on the arity, so the kept literal still has a failing mode", () => {
    // The batch deliberately KEEPS `!== 13` in the smoke, on the argument that 13 is a frozen PRODUCT
    // surface (unlike the resource count, which is a function of the committed bundle and must be
    // derived). An argued literal that could not fail would be prose, so this is the assertion that
    // pays for it.
    const declared = scanDeclared(readText(`${MCP}/src/tools.ts`)).slice(0, 12)
    const enumerated = scanEnumerated(readText(`${MCP}/test/tools.test.ts`))
    const m = toolNamesMeasure({ declared, enumerated })
    expect(m.pass, "12 declared against an agreed 13 must fail").toBe(false)
    expect(m.observed).toContain("table=12")
  })

  it("control #203 — CRLF must NOT change the answer, or windows-latest reds alone", () => {
    // `packages/calllint-mcp/**` is not `eol=lf` pinned, so a windows-latest checkout arrives CRLF.
    // Under `/m`, `$` treats `\r` as a line terminator, which makes `/^ {4}name: "…",$/gm` tolerant —
    // ACCIDENTALLY so ([[crlf-tolerance-is-accidental-under-regex-m]]). Predicted green before running;
    // asserted here so the tolerance stops being accidental and a future tightening (say `[^"\r]+`, or
    // an exact `toBe` on a line) reds here instead of on the Windows runner alone.
    const lf = readFileSync(fileURLToPath(new URL(`${MCP}/src/tools.ts`, repoRoot)), "utf8").replace(
      /\r\n/g,
      "\n",
    )
    const crlf = lf.replace(/\n/g, "\r\n")
    expect(crlf, "the fixture must actually carry CR bytes, or this control tests nothing").toContain("\r\n")
    const fromCrlf = scanDeclared(crlf)
    expect(
      fromCrlf,
      "the scan must return the SAME names from CRLF bytes — a Windows-only red here would be a false failure, not a finding",
    ).toEqual(scanDeclared(lf))
    // And no captured name may carry a stray CR, which is the shape that would poison a set difference
    // into naming every tool as drifted.
    expect(
      fromCrlf.filter((n) => n.includes("\r")),
      "a captured name carrying \\r would make every set comparison report total drift",
    ).toEqual([])
  })
})

describe("S4 — the wire read is the only check that spans the whole chain", () => {
  it("the smoke pins the count, guards vacuity, and asserts the set — in that order", () => {
    // Order is load-bearing and cannot be asserted by running the script: a set claim placed before
    // the vacuity guard is satisfied by an empty scan. So the ORDER is asserted over the source, which
    // is the only place it is visible.
    const smoke = readText("scripts/mcp-pack-smoke.mjs")
    const count = smoke.indexOf("tools/list expected 13 tools")
    const vacuity = smoke.indexOf("tool-table scan captured")
    const set = smoke.indexOf("tools/list name set drifted from the tool table")
    expect(count, "the smoke must still pin the frozen product count").toBeGreaterThan(-1)
    expect(vacuity, "the smoke must guard its own scan against capturing nothing").toBeGreaterThan(-1)
    expect(set, "the smoke must compare the SERVED name set, which is the gap this batch closed").toBeGreaterThan(-1)
    expect(vacuity, "the vacuity guard must precede the set claim").toBeLessThan(set)
    expect(count, "and the frozen count comes first of all").toBeLessThan(vacuity)

    // The scan the smoke performs must be the same one the gate performs, or the two files could agree
    // on a wrong surface while each looked right ([[prose-justified-constant-is-ungated]]).
    expect(
      smoke,
      "the smoke's capture class must stay `[^\"]+` — the tight class red on the SCAN instead of on the renamed tool",
    ).toContain('name: "([^"]+)",')
    expect(readText("scripts/phase-2.4-gates.ts")).toContain('name: "([^"]+)",')
  })
})
