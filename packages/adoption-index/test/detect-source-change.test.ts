/**
 * detectSourceChange — the §16.1 change decision, measured over its WHOLE input space.
 *
 * The detector is pure by construction (no clock, no fs, no db, no network), and this file is
 * the reason that matters: every input is three values, so the table below is not a sample of
 * the behaviour, it is the behaviour. A detector that read the store could only ever be tested
 * along the paths a fixture happened to reach.
 *
 * Negative controls this file is the measurement for:
 *   #1   the detector is keyed on a COUNT (`persisted.inserted === 0`) instead of the cohort
 *        digest — passes on every fixture where upstream only ever ADDS, fails on withdrawal
 *   #4   `absentFromSource.length > 0` is treated as skippable — the served tree keeps a page
 *        for a server upstream withdrew
 *   #12  the six unreachable `RebuildScope` tiers are `false` instead of `null` — a claim
 *        where there is no measurement
 *   #14  the detector is given a clock or a db handle — the purity control
 *
 * WHY #1 IS TESTED HERE AND NOT ONLY IN THE OPERATION. The unsound shortcut lives one layer up
 * (`sync.persisted.inserted`), so this file cannot mutate it. What it CAN do is pin the input
 * that discriminates: a withdrawal presents as `absentFromSource` non-empty with the digest
 * either moved OR unmoved, and the unmoved case is the one a count can never see. Both are
 * asserted below; `refresh-from-mirror.test.ts` then measures the same fact through the real
 * store, where the count is actually available to be wrongly trusted.
 */
import { describe, it, expect } from "vitest"
import {
  detectSourceChange,
  describeSourceChange,
  type RebuildScope,
  type SourceChangeVerdict,
} from "../src/index.js"

const D1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
const D2 = "sha256:2222222222222222222222222222222222222222222222222222222222222222"

/** The six tiers this batch cannot compute. Named so #12 is asserted, not eyeballed. */
const UNKNOWABLE_TIERS = [
  "identity",
  "artifact",
  "evidence",
  "decision",
  "semanticContract",
  "presentation",
] as const satisfies readonly (keyof RebuildScope)[]

function verdict(
  priorSnapshotDigest: string | null,
  nextSnapshotDigest: string,
  absentFromSource: readonly string[] = [],
): SourceChangeVerdict {
  return detectSourceChange({ priorSnapshotDigest, nextSnapshotDigest, absentFromSource })
}

describe("the whole input space — three inputs, every combination", () => {
  // Prior ∈ {null, equal, different} × absent ∈ {empty, non-empty}. Six rows is the complete
  // space, so this table is the specification rather than a selection from it.
  const CASES: ReadonlyArray<{
    prior: string | null
    next: string
    absent: readonly string[]
    changed: boolean
    reason: SourceChangeVerdict["reason"]
  }> = [
    { prior: null, next: D1, absent: [], changed: true, reason: "NO_PRIOR_DIGEST" },
    { prior: D1, next: D1, absent: [], changed: false, reason: "NO_CHANGE" },
    { prior: D1, next: D2, absent: [], changed: true, reason: "COHORT_DIGEST_MOVED" },
    { prior: null, next: D1, absent: ["io.a/one"], changed: true, reason: "SOURCE_WITHDRAWAL" },
    { prior: D1, next: D1, absent: ["io.a/one"], changed: true, reason: "SOURCE_WITHDRAWAL" },
    { prior: D1, next: D2, absent: ["io.a/one"], changed: true, reason: "SOURCE_WITHDRAWAL" },
  ]

  it.each(CASES)("prior=$prior next=$next absent=$absent ⇒ $reason", ({ prior, next, absent, changed, reason }) => {
    const v = verdict(prior, next, absent)
    expect(v.changed).toBe(changed)
    expect(v.reason).toBe(reason)
  })

  it("exactly ONE row in the space is skippable", () => {
    // The count is the assertion. A detector that skipped two of the six — or none — would
    // still satisfy every individual row above while being wrong about the whole.
    const skippable = CASES.filter((c) => !verdict(c.prior, c.next, c.absent).changed)
    expect(skippable).toHaveLength(1)
    expect(skippable[0]).toMatchObject({ prior: D1, next: D1, absent: [] })
  })
})

describe("a withdrawal is never skippable (control #4)", () => {
  it("reports SOURCE_WITHDRAWAL even when the cohort digest did NOT move", () => {
    // The load-bearing fixture. A subject past the cohort cap can vanish upstream without
    // changing the cap-limited entries at all, so digest-equality and withdrawal genuinely
    // co-occur — this is not a contrived pairing. A detector that checked the digest first
    // would return NO_CHANGE here and the run would be skipped.
    const v = verdict(D1, D1, ["io.example/gone"])
    expect(v.changed).toBe(true)
    expect(v.reason).toBe("SOURCE_WITHDRAWAL")
    expect(v.absentFromSource).toEqual(["io.example/gone"])
  })

  it("outranks a digest move, so the more consequential fact is the one reported", () => {
    // Both are true; the reason has to pick one. Withdrawal wins because the remedies differ:
    // a digest move is handled by reprojecting, a withdrawal needs a lifecycle decision this
    // batch deliberately does not make.
    expect(verdict(D1, D2, ["io.example/gone"]).reason).toBe("SOURCE_WITHDRAWAL")
  })

  it("outranks a missing prior digest too", () => {
    expect(verdict(null, D1, ["io.example/gone"]).reason).toBe("SOURCE_WITHDRAWAL")
  })

  it("carries every absent id through verbatim, in order", () => {
    // The caller logs this set rather than re-deriving it, so a detector that reported only a
    // count — or the first id — would make the run log unactionable.
    const ids = ["io.a/one", "io.b/two", "io.c/three"]
    expect(verdict(D1, D1, ids).absentFromSource).toEqual(ids)
  })

  it("an EMPTY absent list is not a withdrawal", () => {
    // The positive half of #4. A guard that fired on `absentFromSource !== undefined` rather
    // than on its length would make every run a withdrawal, and the tests above would all
    // still pass.
    expect(verdict(D1, D1, []).reason).toBe("NO_CHANGE")
  })
})

describe("the prior digest comes from durable state (control #2)", () => {
  it("null prior is its OWN reason, never conflated with a change", () => {
    // A first run and a moved cohort both rebuild, so the `changed` flag cannot distinguish
    // them. The reason must, because "the store was rebuilt from scratch" and "upstream
    // published something" call for different operator responses.
    const v = verdict(null, D1)
    expect(v.changed).toBe(true)
    expect(v.reason).toBe("NO_PRIOR_DIGEST")
    expect(v.reason).not.toBe("COHORT_DIGEST_MOVED")
  })

  it("a digest compared against ITSELF is the unchanged case — and only that", () => {
    // #2's shape, stated as an assertion: equality is what makes a run skippable, so if the
    // prior value came from this run's own computation the detector would return NO_CHANGE
    // always. `refresh-from-mirror.test.ts` is where the value's PROVENANCE is measured; here
    // we pin that equality alone decides.
    expect(verdict(D1, D1).changed).toBe(false)
    expect(verdict(D2, D2).changed).toBe(false)
    expect(verdict(D1, D2).changed).toBe(true)
  })

  it("distinguishes on the whole string, not a prefix", () => {
    // Both digests share the `sha256:` prefix and differ only after it. A comparison that
    // normalised, truncated, or compared prefixes would report NO_CHANGE for a moved cohort.
    const near = `${D1.slice(0, -1)}2`
    expect(near).not.toBe(D1)
    expect(verdict(D1, near).reason).toBe("COHORT_DIGEST_MOVED")
  })
})

describe("RebuildScope tells `unknown` apart from `no` (control #12)", () => {
  it("leaves the six tiers this batch cannot compute as null, never false", () => {
    for (const v of [verdict(D1, D1), verdict(D1, D2), verdict(null, D1), verdict(D1, D1, ["io.a/one"])]) {
      for (const tier of UNKNOWABLE_TIERS) {
        // `false` would assert "no rebuild needed" — a claim with nothing behind it. `null`
        // says "this batch cannot know", which is the honest report and the thing a later
        // batch can safely overwrite.
        expect(v.rebuild[tier], `${v.reason}.${tier}`).toBeNull()
      }
    }
  })

  it("declares all seven tiers on every verdict, so the shape never depends on the branch", () => {
    const KEYS: readonly (keyof RebuildScope)[] = ["canonicalize", ...UNKNOWABLE_TIERS]
    for (const v of [verdict(D1, D1), verdict(D1, D2), verdict(null, D1), verdict(D1, D1, ["io.a/one"])]) {
      expect(Object.keys(v.rebuild).sort()).toEqual([...KEYS].sort())
    }
  })

  it("canonicalize is the one tier that is a real boolean, and it tracks `changed`", () => {
    expect(verdict(D1, D1).rebuild.canonicalize).toBe(false)
    expect(verdict(D1, D2).rebuild.canonicalize).toBe(true)
    expect(verdict(null, D1).rebuild.canonicalize).toBe(true)
    expect(verdict(D1, D1, ["io.a/one"]).rebuild.canonicalize).toBe(true)
  })

  it("no verdict is `changed` with nothing to rebuild, or unchanged with something", () => {
    // The two directions that would make the verdict internally contradictory. Asserted over
    // the whole space rather than per branch, because the invariant is about the pair.
    for (const prior of [null, D1, D2]) {
      for (const absent of [[], ["io.a/one"]]) {
        const v = verdict(prior, D1, absent)
        expect(v.rebuild.canonicalize).toBe(v.changed)
      }
    }
  })

  it("returns a FRESH scope object per call, so a caller cannot poison the shared constants", () => {
    // The module holds `NO_REBUILD`/`CANONICALIZE` as module-level constants and spreads them.
    // If a verdict handed back the constant itself, one caller mutating `rebuild.identity`
    // would silently rewrite every later verdict in the process.
    const a = verdict(D1, D1)
    const b = verdict(D1, D1)
    expect(a.rebuild).not.toBe(b.rebuild)
    expect(a.rebuild).toEqual(b.rebuild)
  })
})

describe("the detector is pure (control #14)", () => {
  it("is deterministic — same inputs, same verdict, twice", () => {
    expect(verdict(D1, D2, ["io.a/one"])).toEqual(verdict(D1, D2, ["io.a/one"]))
  })

  it("does not mutate its input", () => {
    const absent = ["io.a/one"]
    const input = { priorSnapshotDigest: D1, nextSnapshotDigest: D2, absentFromSource: absent }
    detectSourceChange(input)
    expect(input).toEqual({ priorSnapshotDigest: D1, nextSnapshotDigest: D2, absentFromSource: ["io.a/one"] })
    expect(absent).toEqual(["io.a/one"])
  })

  it("takes exactly one argument — no clock, no store, no fetch", () => {
    // A signature check is the cheapest possible guard against the impure refactor, and it
    // fails at the moment someone adds `now` or `store` as a second parameter rather than
    // months later when a test starts needing a fixture database.
    expect(detectSourceChange).toHaveLength(1)
  })
})

describe("describeSourceChange — one actionable line per reason", () => {
  it("covers every reason with a distinct, non-empty line", () => {
    const lines = [
      describeSourceChange(verdict(D1, D1)),
      describeSourceChange(verdict(null, D1)),
      describeSourceChange(verdict(D1, D2)),
      describeSourceChange(verdict(D1, D1, ["io.a/one"])),
    ]
    for (const line of lines) expect(line.length).toBeGreaterThan(0)
    // Distinctness is the assertion: four reasons that render the same line would make the
    // run log unable to tell an operator which one happened.
    expect(new Set(lines).size).toBe(4)
  })

  it("says the rebuild was SKIPPED only on the unchanged verdict", () => {
    expect(describeSourceChange(verdict(D1, D1))).toMatch(/skipped/)
    for (const v of [verdict(null, D1), verdict(D1, D2), verdict(D1, D1, ["io.a/one"])]) {
      expect(describeSourceChange(v)).not.toMatch(/skipped/)
    }
  })

  it("names the withdrawn subjects, and says de-listing is NOT applied", () => {
    const line = describeSourceChange(verdict(D1, D1, ["io.a/one", "io.b/two"]))
    expect(line).toContain("io.a/one")
    expect(line).toContain("io.b/two")
    expect(line).toContain("2 current subject(s)")
    // The line has to disclaim the remedy. A withdrawal detected and reported reads as
    // handled unless the log says the lifecycle change is still owed.
    expect(line).toMatch(/de-listing is NOT applied/)
  })
})
