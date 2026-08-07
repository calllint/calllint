/**
 * R-10 — the Freshness Calculator (`docs/new17.md` §P4).
 *
 * Every measure here carries a NAMED negative control. Two disciplines this file holds
 * deliberately, both learned from earlier batches in this workstream:
 *
 *   - No `.every()` where a value matters. A control that reds with only "expected false to be
 *     true" has no name on it; materializing the set and `toEqual`-ing it prints what actually
 *     arrived AND stays non-vacuous on an empty array.
 *   - No threshold written as a literal. `CADENCE_DAYS * AGING_MULTIPLE` is imported and multiplied,
 *     because a test that restated `21` would agree with a mutated constant instead of catching it.
 */

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { AGING_MULTIPLE, CADENCE_DAYS } from "../src/freshness.js"
import {
  cadenceDaysFromCron,
  computeResolution,
  RESOLUTION_AXES,
  RESOLUTION_STATES,
  UNMEASURED_AXES,
  type ResolutionAxis,
} from "../src/resolution.js"

const DAY = 86_400_000
const T0 = "2026-07-17T00:00:00.000Z"
const at = (base: string, days: number): string => new Date(Date.parse(base) + days * DAY).toISOString()

describe("computeResolution decides status from the OLDEST axis (§P4)", () => {
  it("is FRESH exactly to the cadence boundary and AGING one day past it", () => {
    const now = at(T0, CADENCE_DAYS)
    expect(computeResolution({ axes: [{ axis: "source-observation", at: T0 }], now }).status).toBe("FRESH")
    expect(
      computeResolution({ axes: [{ axis: "source-observation", at: T0 }], now: at(T0, CADENCE_DAYS + 1) }).status,
    ).toBe("AGING")
  })

  it("is AGING to cadence*multiple and STALE one day past it", () => {
    const edge = CADENCE_DAYS * AGING_MULTIPLE
    expect(computeResolution({ axes: [{ axis: "source-observation", at: T0 }], now: at(T0, edge) }).status).toBe("AGING")
    expect(computeResolution({ axes: [{ axis: "source-observation", at: T0 }], now: at(T0, edge + 1) }).status).toBe(
      "STALE",
    )
  })

  /**
   * THE CONTROL FOR THE CENTRAL DESIGN DECISION. A fresh registry observation beside long-stale
   * vulnerability evidence must read STALE, and this is the case §P4 names outright: Registry
   * 未变化不代表 vulnerability evidence 未过期.
   *
   * An implementation that took the NEWEST axis — the natural mistake, since that is the answer to
   * "when did we last succeed" — passes every other test in this file and fails only this one. The
   * asserted value is the whole object, so a red prints which end was taken.
   */
  it("lets one stale axis decide even when another resolved today (newest-axis control)", () => {
    const now = at(T0, CADENCE_DAYS * AGING_MULTIPLE + 5)
    const r = computeResolution({
      axes: [
        { axis: "source-observation", at: now },
        { axis: "evidence-resolution", at: T0 },
      ],
      now,
    })
    expect({ status: r.status, last: r.lastSuccessfulResolution }).toEqual({ status: "STALE", last: now })
  })

  /**
   * `nextRequiredResolution` may fall BEFORE `lastSuccessfulResolution`, and that ordering is a
   * feature: it says one axis is already overdue even though another resolved recently. Asserted
   * because a "fix" that clamped the deadline to be >= the last success would erase exactly the
   * signal a maintainer needs.
   */
  it("puts the deadline before the last success when one axis lags", () => {
    const now = at(T0, 40)
    const r = computeResolution({
      axes: [
        { axis: "source-observation", at: T0 },
        { axis: "evidence-resolution", at: at(T0, 30) },
      ],
      now,
    })
    expect({ next: r.nextRequiredResolution, last: r.lastSuccessfulResolution }).toEqual({
      next: at(T0, CADENCE_DAYS),
      last: at(T0, 30),
    })
    expect(Date.parse(r.nextRequiredResolution ?? "")).toBeLessThan(Date.parse(r.lastSuccessfulResolution ?? ""))
  })
})

describe("INV-R11 — a failed refresh never extends freshness", () => {
  /**
   * The invariant's fixture, stated as a 2×2. Same subject, same clock; the only difference is
   * whether today's refresh SUCCEEDED. The degrading half and the non-degrading half are both
   * asserted, because a calculator that ignored `at: null` entirely would satisfy "it degrades"
   * (nothing changed) while breaking "a success advances it".
   */
  const now = at(T0, CADENCE_DAYS * AGING_MULTIPLE + 2)
  const stale = { axis: "source-observation" as const, at: T0 }

  it("degrades to STALE and names the failed axis when today's refresh failed", () => {
    const r = computeResolution({ axes: [stale, { axis: "evidence-resolution", at: null }], now })
    expect({
      status: r.status,
      last: r.lastSuccessfulResolution,
      blocking: r.blockingUnknowns,
      axes: r.basis.map((b) => b.axis),
    }).toEqual({ status: "STALE", last: T0, blocking: ["evidence-resolution"], axes: ["source-observation"] })
  })

  it("advances only when the same axis actually succeeded (the opposing half)", () => {
    const r = computeResolution({ axes: [stale, { axis: "evidence-resolution", at: now }], now })
    expect({ last: r.lastSuccessfulResolution, blocking: r.blockingUnknowns }).toEqual({ last: now, blocking: [] })
  })

  it("reports UNKNOWN with null instants when every axis failed — never a default FRESH", () => {
    const r = computeResolution({
      axes: [
        { axis: "source-observation", at: null },
        { axis: "evidence-resolution", at: null },
      ],
      now,
    })
    expect(r).toEqual({
      status: "UNKNOWN",
      basis: [],
      lastSuccessfulResolution: null,
      nextRequiredResolution: null,
      blockingUnknowns: ["source-observation", "evidence-resolution"],
      cadenceDays: CADENCE_DAYS,
    })
  })
})

describe("the cadence is DERIVED from the workflow's cron, not restated as a literal", () => {
  /**
   * The `schedule:` cron, READ from the workflow rather than copied here.
   *
   * This closes a real gap rather than adding decoration. Both `freshness.ts` and
   * `freshness.test.ts` justified `CADENCE_DAYS = 7` by naming this file's `cron: "17 6 * * 1"` in
   * prose, and the assertion that followed was `expect(CADENCE_DAYS).toBe(7)` — a restatement of
   * the literal. Editing the schedule to daily therefore left the constant describing a cron that
   * no longer existed, with the whole suite green. Same failure shape, and the same fix, as
   * `expansion-eligibility.test.ts`'s `timeout-minutes`.
   */
  function ingestCron(): string {
    const wf = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows", "trust-ingest.yml"),
      "utf8",
      // CRLF normalized at the READ. `git check-attr text eol` reports `unspecified` for this path,
      // so a Windows checkout can hold `\r\n` — the unpinned-newline shape that already cost this
      // workstream one windows-only red leg.
    ).replace(/\r\n/g, "\n")
    const m = /^\s*-?\s*cron:\s*["']([^"']+)["']\s*$/m.exec(wf)
    if (m === null) {
      throw new Error(
        "trust-ingest.yml declares no `cron:` — CADENCE_DAYS is justified by that schedule, and " +
          "without it the constant describes nothing",
      )
    }
    return m[1] ?? ""
  }

  it("agrees with the schedule the ingest workflow actually runs on", () => {
    expect(cadenceDaysFromCron(ingestCron())).toBe(CADENCE_DAYS)
  })

  it("decodes the two shapes the project uses, and refuses the rest (positive + negative)", () => {
    expect(cadenceDaysFromCron("17 6 * * 1")).toBe(7)
    expect(cadenceDaysFromCron("17 6 * * *")).toBe(1)
    // Refuses rather than guessing: a plausible-looking period for an irregular schedule would
    // install a wrong cadence silently, which is worse than asking a human for the number.
    expect(() => cadenceDaysFromCron("17 6 * * 1,4")).toThrow(/only `\*` \(daily\) or a single day-of-week/)
    expect(() => cadenceDaysFromCron("17 6 1 * *")).toThrow(/pinned day-of-month/)
    expect(() => cadenceDaysFromCron("17 6 * *")).toThrow(/expected a 5-field cron/)
  })
})

describe("the coverage limit is published, and adds up to §P4's nine axes", () => {
  /**
   * §P4 lists nine facts that jointly decide freshness. Two are measured, seven are not — and the
   * sum is asserted so a future batch cannot implement an axis while leaving its "unmeasurable" note
   * in place. That would be the exact inverse of the defect this batch closed on `publishedAt`: a
   * field with a producer and no consumer, versus a note with no subject.
   */
  const P4_AXIS_COUNT = 9

  it("accounts for every §P4 axis exactly once", () => {
    expect(RESOLUTION_AXES.length + UNMEASURED_AXES.length).toBe(P4_AXIS_COUNT)
    const overlap = UNMEASURED_AXES.map((u) => u.fact).filter((f) => (RESOLUTION_AXES as readonly string[]).includes(f))
    expect(overlap).toEqual([])
  })

  it("gives every unmeasured axis a stated reason, not a bare name", () => {
    const unreasoned = UNMEASURED_AXES.filter((u) => u.reason.trim().length < 20).map((u) => u.fact)
    expect(unreasoned).toEqual([])
  })

  it("offers UNKNOWN as a state, which the single-axis display value cannot", () => {
    expect([...RESOLUTION_STATES]).toEqual(["FRESH", "AGING", "STALE", "UNKNOWN"])
  })
})

describe("fail-closed inputs", () => {
  it("refuses an unparseable instant rather than treating it as the epoch", () => {
    expect(() => computeResolution({ axes: [{ axis: "source-observation", at: "not-a-date" }], now: T0 })).toThrow(
      /parseable ISO-8601/,
    )
    expect(() => computeResolution({ axes: [], now: "whenever" })).toThrow(/now must be a parseable/)
  })

  it("refuses a non-positive cadence", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeResolution({ axes: [], now: T0, cadenceDays: bad })).toThrow(/positive finite/)
    }
  })

  it("floors a clock-skewed age at zero instead of reporting a negative age", () => {
    const r = computeResolution({ axes: [{ axis: "source-observation", at: at(T0, 3) }], now: T0 })
    expect({ ageDays: r.basis[0]?.ageDays, status: r.status }).toEqual({ ageDays: 0, status: "FRESH" })
  })

  it("orders basis by axis name, so the bytes do not depend on the caller's argument order", () => {
    const forward: Array<{ axis: ResolutionAxis; at: string | null }> = [
      { axis: "source-observation", at: T0 },
      { axis: "evidence-resolution", at: T0 },
    ]
    const a = computeResolution({ axes: forward, now: at(T0, 1) })
    const b = computeResolution({ axes: [...forward].reverse(), now: at(T0, 1) })
    expect(a).toEqual(b)
    expect(a.basis.map((x) => x.axis)).toEqual(["evidence-resolution", "source-observation"])
  })
})
