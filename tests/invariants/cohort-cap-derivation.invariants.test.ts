/**
 * THE RECURRENCE GUARD for ADR 0091.
 *
 * Seven assertions red on PR #349 — a scheduled snapshot refresh that was entirely correct. Three
 * root causes, one fault class: a guard reading a number that had stopped being its subject. The
 * Cumulative Coverage Amendment turned the cohort cap from a constant into a function of the previous
 * run, and turned ingest from an occasional authorized act into a weekly automatic one. Four
 * assertions still read the constant, one gate still waited for a human keystroke, and one test still
 * pinned a literal clock.
 *
 * Fixing those seven is not the same as preventing the eighth. What makes this class recur is that
 * every one of those guards was written against a snapshot that only moved when a human moved it, and
 * NOTHING IN THE REPO ASKS "would this still hold after the next ingest?" — the only thing that ever
 * asks is the ingest itself, a week later, in a bot PR nobody is watching.
 *
 * So this file asks it now. It SIMULATES the next scheduled run — cohort + STEP, instants + a week —
 * and asserts the three families stay coherent under it. A future change that re-pins any of them to
 * a literal reds HERE, on the PR that makes it, rather than on a bot PR seven days later.
 */
import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import path from "node:path"

import {
  DEFAULT_MAX_ENTRIES,
  CUMULATIVE_COVERAGE_STEP,
  CUMULATIVE_COVERAGE_CEILING,
  servedCohortCap,
} from "../../packages/trust-index/src/fetchRegistry.js"
import { advanceRatchetFloor, nextRatchetFloor } from "../../packages/trust-index/src/advanceRatchet.js"
import { CADENCE_DAYS, AGING_MULTIPLE } from "../../packages/trust-index/src/freshness.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const readText = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n")

const SNAPSHOT = "packages/trust-index/snapshots/official-mcp-registry.json"
const GATE = "scripts/gate-s0.ts"
const CLOCK_TEST = "packages/trust-index/test/resolution-wiring.test.ts"

const snapshot = JSON.parse(readText(SNAPSHOT)) as { count: number; fetchedAt: string; entries: unknown[] }
const floorOf = (src: string): number => {
  const m = /^const S0_REGRESSION_FLOOR = (\d+)$/m.exec(src)
  expect(m, `${GATE} must declare \`const S0_REGRESSION_FLOOR = <number>\``).not.toBeNull()
  return Number(m![1])
}

describe("the cap derivation is a GENERALIZATION of the constant it replaced, not a loosening", () => {
  /**
   * THE SAFETY ARGUMENT OF THIS WHOLE BATCH, asserted rather than claimed in a comment.
   *
   * Four assertions changed from reading `DEFAULT_MAX_ENTRIES` to calling `servedCohortCap(count)`.
   * That is only safe if the two agree wherever the old reader was correct — the pre-Amendment
   * regime, where the cohort sat at the bootstrap size. If they ever diverge there, the change
   * silently weakened four guards instead of generalizing their reader.
   */
  it("returns exactly DEFAULT_MAX_ENTRIES at the bootstrap cohort size", () => {
    expect(servedCohortCap(DEFAULT_MAX_ENTRIES)).toBe(DEFAULT_MAX_ENTRIES)
  })

  it("is the SMALLEST curve point at or above the count, so a committed cohort never exceeds its cap", () => {
    for (let count = 0; count <= CUMULATIVE_COVERAGE_CEILING; count += 7) {
      const cap = servedCohortCap(count)
      expect(cap, `cap(${count}) must cover the cohort`).toBeGreaterThanOrEqual(count)
      // Minimality: one step lower must NOT cover it. This is what stops the function from being
      // trivially satisfiable by returning the ceiling for everything — which would hand every
      // caller a cap far above the cohort and make `headroom` meaninglessly large.
      if (cap > DEFAULT_MAX_ENTRIES) {
        expect(cap - CUMULATIVE_COVERAGE_STEP, `cap(${count}) is not minimal`).toBeLessThan(count)
      }
    }
  })

  it("never returns a cap BELOW the cohort, including above the ceiling where an operator overrides by hand", () => {
    // Amendment Case 4: a manual override may commit more than the ceiling. Clamping to 500 there
    // would hand a guard a cap below the cohort — precisely the defect this batch removes, at the
    // one boundary a human reaches by hand.
    for (const count of [CUMULATIVE_COVERAGE_CEILING, CUMULATIVE_COVERAGE_CEILING + 1, 1_000]) {
      expect(servedCohortCap(count), `cap(${count}) must still cover the cohort`).toBeGreaterThanOrEqual(count)
    }
  })

  it("refuses a nonsense cohort instead of returning a number for it", () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => servedCohortCap(bad), `${bad} must throw, not silently produce a cap`).toThrow(RangeError)
    }
  })
})

describe("the automatic ratchet advance cannot lower a floor", () => {
  /**
   * ADR 0083's protection, restated as the property that replaces the human keystroke.
   *
   * Automating a ratchet is only safe if the automation is INCAPABLE of the move the ratchet exists to
   * prevent. `Math.max` is that incapability, and this is the assertion that holds it — if a future
   * edit makes the advance a bare assignment, every one of these reds.
   */
  it("holds the floor when the cohort shrank, so a lost record still reds", () => {
    expect(nextRatchetFloor(150, 100), "a shrink must leave the high-water mark alone").toBe(150)
    expect(nextRatchetFloor(150, 0), "an empty cohort must not reset the ratchet to zero").toBe(150)
    expect(nextRatchetFloor(150, 149), "one lost record must not lower the floor").toBe(150)
  })

  it("advances to the cohort when it grew, and is idempotent at equality", () => {
    expect(nextRatchetFloor(100, 150)).toBe(150)
    expect(nextRatchetFloor(150, 150)).toBe(150)
  })

  it("is monotone over the entire growth curve, so no scheduled run can ever lower it", () => {
    let floor = DEFAULT_MAX_ENTRIES
    for (let count = DEFAULT_MAX_ENTRIES; count <= CUMULATIVE_COVERAGE_CEILING; count += CUMULATIVE_COVERAGE_STEP) {
      const next = nextRatchetFloor(floor, count)
      expect(next, `run at cohort ${count} lowered the floor`).toBeGreaterThanOrEqual(floor)
      floor = next
    }
    expect(floor, "the curve must end at the ceiling").toBe(CUMULATIVE_COVERAGE_CEILING)
  })

  /**
   * The FILE-WRITING half, exercised directly.
   *
   * `nextRatchetFloor` above is pure and easy to assert; `advanceRatchetFloor` is the one that runs in
   * ingest, and it is the one whose failure would be silent. Tested against a temp copy of the real
   * gate so the regex meets the declaration as actually written, not as a fixture imagines it.
   */
  describe("advanceRatchetFloor, against a copy of the real gate", () => {
    const withGateCopy = (body: (p: string) => void): void => {
      const dir = mkdtempSync(path.join(tmpdir(), "calllint-ratchet-"))
      try {
        const p = path.join(dir, "gate-s0.ts")
        writeFileSync(p, readText(GATE), "utf8")
        body(p)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    it("raises the floor to a grown cohort and rewrites only the digits", () => {
      withGateCopy((p) => {
        const before = readFileSync(p, "utf8")
        const current = floorOf(before)
        const grown = current + CUMULATIVE_COVERAGE_STEP
        const moved = advanceRatchetFloor(p, grown)
        expect(moved).toEqual({ from: current, to: grown, advanced: true })
        const after = readFileSync(p, "utf8")
        expect(floorOf(after), "the file must actually hold the new floor").toBe(grown)
        // The prose around the constant explains WHY the number is what it is. A rewrite that ate it
        // would leave a bare literal with no record — asserted by byte count, so any collateral edit
        // shows up rather than being eyeballed.
        expect(
          after.length - before.length,
          "only the digits may change; the surrounding record must survive",
        ).toBe(String(grown).length - String(current).length)
      })
    })

    it("holds, and does NOT write, when the cohort shrank", () => {
      withGateCopy((p) => {
        const before = readFileSync(p, "utf8")
        const current = floorOf(before)
        const moved = advanceRatchetFloor(p, current - 1)
        expect(moved).toEqual({ from: current, to: current, advanced: false })
        expect(readFileSync(p, "utf8"), "a hold must leave the file byte-identical").toBe(before)
      })
    })

    it("throws rather than appending when the declaration is gone", () => {
      withGateCopy((p) => {
        writeFileSync(p, "const SOMETHING_ELSE = 1\n", "utf8")
        expect(() => advanceRatchetFloor(p, 150), "a renamed constant must be loud").toThrow(
          /declares no .*S0_REGRESSION_FLOOR/,
        )
      })
    })

    it("refuses a nonsense cohort instead of writing one", () => {
      withGateCopy((p) => {
        const before = readFileSync(p, "utf8")
        for (const bad of [-1, 2.5, Number.NaN]) {
          expect(() => advanceRatchetFloor(p, bad)).toThrow(RangeError)
        }
        expect(readFileSync(p, "utf8"), "a refused call must not have written").toBe(before)
      })
    })
  })

  it("the file ingest will write IS the gate these guards read", () => {
    // THE LAST UNVERIFIED LINK, and the one that would fail only in a scheduled run. `GATE_S0_PATH` is
    // derived from `refreshSnapshot.ts`'s own location, so it is independent of `cwd` — but if the
    // module ever moves, or the bin starts running from `dist/`, the relative hops stop landing on the
    // gate and ingest would advance a floor in a file nobody reads. Reasoning that through is not the
    // same as measuring it, so the hops are resolved here against the real tree.
    const src = readText("packages/trust-index/src/refreshSnapshot.ts")
    const decl = /const GATE_S0_PATH = resolve\(\s*dirname\(fileURLToPath\(import\.meta\.url\)\),([^)]*)\)/.exec(src)
    expect(decl, "refreshSnapshot.ts must derive GATE_S0_PATH from its own module URL, never from cwd").not.toBeNull()
    const hops = [...(decl![1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
    const resolved = path.resolve(repoRoot, "packages/trust-index/src", ...hops)
    expect(resolved, "the hops must land on the gate the guards read").toBe(path.join(repoRoot, GATE))
    expect(floorOf(readFileSync(resolved, "utf8")), "and that file must declare the ratchet").toBeGreaterThan(0)
  })

  it("the committed floor and the committed cohort are a coherent pair AT HEAD", () => {
    // The state the gate refuses to load in: a floor above what has actually been ingested. Asserted
    // here as well as in the gate, because the ingest now writes BOTH files and a run that wrote one
    // without the other would leave the repo in exactly that state.
    expect(floorOf(readText(GATE)), "the floor may never lead the cohort (ADR 0083 D1)").toBeLessThanOrEqual(
      snapshot.entries.length,
    )
  })
})

describe("NEXT week's scheduled ingest — the control that makes this class non-recurring", () => {
  /**
   * What the next scheduled run will commit, computed the way the shipped engine computes it.
   *
   * This is the input NO existing guard was written against. Every one of the seven failures was a
   * guard that held at the cohort in front of it and broke at the next one, and the only thing that
   * ever discovered that was the run itself, in a bot PR, a week later.
   */
  const nextCohort = Math.min(CUMULATIVE_COVERAGE_CEILING, snapshot.entries.length + CUMULATIVE_COVERAGE_STEP)

  it("the cap derivation covers next week's cohort (family 1: the four cap readers)", () => {
    const cap = servedCohortCap(nextCohort)
    expect(cap, "next week's cohort must not exceed its own cap").toBeGreaterThanOrEqual(nextCohort)
    // The three arithmetic quantities that went negative on PR #349, recomputed at next week's size.
    // Each is the exact expression its own assertion uses, so a re-pinned reader reds here first.
    expect(cap - nextCohort, "`headroom` must stay non-negative or the retention probes go vacuous").toBeGreaterThanOrEqual(0)
    expect(cap - nextCohort + 2, "the overlap scan's bound must stay positive or its loop stops executing").toBeGreaterThan(0)
    expect(nextCohort, "the cohort must land ON the growth curve, which is what the truncation claim asserts").toBe(cap)
  })

  it("the ratchet lands coherent with next week's cohort (family 2: the gate)", () => {
    const advanced = nextRatchetFloor(floorOf(readText(GATE)), nextCohort)
    expect(advanced, "the advanced floor must equal next week's cohort, or the derived pin reds").toBe(nextCohort)
    expect(advanced, "and must never lead it, or the gate exits 2 at load time").toBeLessThanOrEqual(nextCohort)
  })

  it("the derived clock still reads AGING after next week's refresh (family 3: the clock)", () => {
    // Next week's instants: a refresh moves BOTH `fetchedAt` and `resolvedAt` forward together.
    const nextInstant = Date.parse(snapshot.fetchedAt) + 7 * 86_400_000
    const now = nextInstant + CADENCE_DAYS * 2 * 86_400_000
    const ageDays = Math.floor((now - nextInstant) / 86_400_000)
    expect(ageDays, "must not be FRESH, or the AGING assertions red").toBeGreaterThan(CADENCE_DAYS)
    expect(ageDays, "must not be STALE either").toBeLessThanOrEqual(CADENCE_DAYS * AGING_MULTIPLE)
  })

  it("the clock is DERIVED, not a literal — the one-line check that would have caught PR #349", () => {
    const src = readText(CLOCK_TEST)
    const decl = /^const NOW = (.*)$/m.exec(src)
    expect(decl, `${CLOCK_TEST} must declare \`const NOW = …\``).not.toBeNull()
    // A literal ISO instant is the shape that broke. The clock must be computed from the snapshot's
    // own instants, so a refresh moves the clock with it.
    expect(
      decl![1],
      `the bake clock in ${CLOCK_TEST} must be derived from the committed instants, never pinned — a literal reds on the next snapshot refresh (ADR 0091)`,
    ).not.toMatch(/^"\d{4}-\d{2}-\d{2}T/)
    expect(
      src.slice(decl!.index, decl!.index + 400),
      "and it must be anchored to the OLDER of the two instants, which is the axis the status is a function of",
    ).toMatch(/Math\.min\([\s\S]*resolvedAt[\s\S]*fetchedAt/)
  })
})

// ---------------------------------------------------------------------------
// 4. The floor's derived pin is a SINGLE POINT OF FAILURE, so it gets a guard.
//
// Automating the ratchet (D3) made the advance incapable of LOWERING a floor. It did not
// make the floor unfalsifiable: a hand edit downward is still possible, and — measured, not
// assumed — the gate does not catch it. Both of its checks are one-directional
// (`floor > cohort`; `cohort < floor`), and a lowered floor satisfies neither, by design: a low
// floor is slack, and a gate that treated slack as failure could not ratchet at all.
//
// So exactly ONE reader stands on the edit direction: the derived equality in gate-s0-claims.
// This block guards that guard. Its own failure mode is being deleted by someone who reads
// ADR 0083's "two protections are intact" and concludes the gate has it covered. It does not.
// ---------------------------------------------------------------------------
describe("the derived floor pin is the only reader on the edit direction", () => {
  const CLAIMS = "tests/invariants/gate-s0-claims.invariants.test.ts"

  it("still asserts the floor EQUALS the committed cohort", () => {
    // Equality, not `>=`: `>=` would accept a floor edited down to zero.
    expect(
      readText(CLAIMS),
      `${CLAIMS} must keep asserting \`toEqual({ floor: upstreamRegistry, upstreamRegistry })\` — it is the ONLY guard against a ratchet floor edited downward by hand, because both of the gate's own checks are one-directional and stay green on a lowered floor (ADR 0091 D4). Weakening it to an inequality, or deleting it, removes that guard outright.`,
    ).toContain("toEqual({ floor: upstreamRegistry, upstreamRegistry })")
  })

  it("and the gate's one-directional checks are unchanged, which is why the above is load-bearing", () => {
    const gate = readText("scripts/gate-s0.ts")
    // If either comparison is ever made two-directional, this test's premise changes and the
    // note above should be revisited rather than silently left stale.
    expect(gate, "the coherence check fires only when the floor LEADS the cohort").toContain(
      "S0_REGRESSION_FLOOR > committedCohort",
    )
    expect(gate, "and the regression check only when the cohort falls BELOW the floor").toContain(
      "censusRegistry < S0_REGRESSION_FLOOR",
    )
  })
})
