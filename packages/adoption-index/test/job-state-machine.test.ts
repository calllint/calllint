/**
 * job-state-machine — R-6's two PURE layers: the transition tables and the document assertions.
 *
 * No store, no driver, no filesystem in this file. Everything storage-shaped is `job-lease.test.ts`'s,
 * and the split is deliberate: a table is either closed or it is not, and measuring that against a
 * real SQLite file would make a red test ambiguous between "the rule is wrong" and "the write path is
 * wrong".
 *
 * THE HARD PART OF THIS FILE IS NOT THE TABLES — it is proving the assertions about them can FAIL.
 * A closed-set assertion written the obvious way is vacuous in three distinct ways, and the plan
 * predicted these two guards (n and o) as the most likely to stay green:
 *
 *   - `expect(STATES).toContain("PENDING")` passes on a widened union. So the states are asserted as
 *     a SORTED EQUALITY against a literal list, which fails on an addition as well as a removal.
 *   - A forbidden-value scan (`expect(STATES).not.toContain("SUPPORTED")`) passes when the array it
 *     reads is empty or misspelled. So each such scan is paired with a POSITIVE assertion over the
 *     same array, and the array's length is pinned.
 *   - `Object.keys(TABLE)` reads the frozen object, which is what the source declares — but a table
 *     whose VALUES were widened has the same keys. So the edges are asserted per-state, sorted, and
 *     the total edge count is pinned as a second, independent number.
 *
 * Negative controls this file is the measurement for:
 *   #78 widen `COMPILER_JOB_TRANSITIONS` so a terminal job may leave     → a `DEAD_LETTER` resurrects
 *   #79 widen `COMPILER_RUN_TRANSITIONS` so a graded run may be re-graded → history becomes editable
 *   #80 write a misspelled state (`"SUCCEEEDED"`)                        → must be refused
 *   #81 delete the write-path enum assertions                            → the misspelling lands
 *   #83 make the exhaustion test strict-greater                          → a sixth hand-out
 *   #84 add `verdict: "SAFE"` to `metrics`                               → must be refused
 *   #85 add a non-numeric counter to `metrics`                           → must be refused
 *   #86 grade a 24/25 run as `SUCCEEDED`                                 → must be `PARTIAL`
 *   #88 `leaseOwner` set with `leaseExpiresAt` null                      → must be refused
 *   #89 a lease on a non-`LEASED` row                                    → must be refused
 *   #90 put an INV-10 terminal state into `CompilerJobState`             → the layer guard must fire
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  COMPILER_JOB_SCHEMA,
  COMPILER_JOB_STATES,
  COMPILER_JOB_TRANSITIONS,
  COMPILER_JOB_TYPES,
  COMPILER_RUN_METRIC_KEYS,
  COMPILER_RUN_SCHEMA,
  COMPILER_RUN_STATES,
  COMPILER_RUN_TRANSITIONS,
  COMPILER_RUN_TYPES,
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  LEASABLE_JOB_STATES,
  MAX_BACKOFF_MS,
  assertDigestShape,
  assertJobTransition,
  assertLeaseCoherent,
  assertRunMetrics,
  assertRunTransition,
  canTransitionJob,
  canTransitionRun,
  compilerJobId,
  compilerRunId,
  decideDisposition,
  emptyRunMetrics,
  gradeRun,
  isLeasableJobState,
  isTerminalJobState,
  isTerminalRunState,
  parseRunMetrics,
  retryDelayMs,
  serializeRunMetrics,
  type CompilerJobState,
  type CompilerRunMetrics,
  type CompilerRunState,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC_DIR = join(PKG_ROOT, "src")
const JOB_ID = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const DIGEST = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

/**
 * INV-10's seven terminal states, as a literal.
 *
 * Written out here rather than imported BECAUSE NOTHING EXPORTS THEM: R-6 measured that no column in
 * the canonical DDL carries them and no module declares them. That is STILL TRUE after R-7 — R-6's
 * further guess, that this made them "R-7's", is not; see `jobStates.ts` for the inversion. A test
 * that imported them would not compile; a test that omitted them could not detect the fusion this
 * guards against. So they are a literal, and the guard below asserts the literal is DISJOINT from
 * every vocabulary R-6 declares.
 */
const INV10_TERMINAL_STATES = [
  "SUPPORTED",
  "LOCAL_PREFLIGHT_REQUIRED",
  "UNSUPPORTED",
  "DEPRECATED",
  "TOMBSTONED",
  "IDENTITY_CONFLICT",
  "PROCESSING_FAILED",
] as const

describe("the two unions are closed sets (control #90)", () => {
  it("declares exactly five job states and four run states", () => {
    // SORTED EQUALITY, not `toContain`: this fails on an ADDITION as well as a removal, which is the
    // half a membership test cannot see. Control #90 adds `"SUPPORTED"` and this is what refuses it.
    expect([...COMPILER_JOB_STATES].sort()).toEqual([
      "DEAD_LETTER",
      "FAILED",
      "LEASED",
      "PENDING",
      "SUCCEEDED",
    ])
    expect([...COMPILER_RUN_STATES].sort()).toEqual(["FAILED", "PARTIAL", "RUNNING", "SUCCEEDED"])
    // The counts, pinned independently. A sorted-equality assertion against an array the source
    // built wrongly could in principle agree by coincidence; two numbers make that harder, and they
    // are what a reviewer checks against the schema's `enum` length.
    expect(COMPILER_JOB_STATES).toHaveLength(5)
    expect(COMPILER_RUN_STATES).toHaveLength(4)
  })

  it("declares exactly the seven job types and four run types, in the schema's order", () => {
    // ORDER, not just membership: `job.ts` claims these are transcribed "in its order", and an
    // unordered assertion would let the claim rot. The order is the committed schema's `enum` order.
    expect([...COMPILER_JOB_TYPES]).toEqual([
      "ingest-source",
      "resolve-identity",
      "resolve-artifact",
      "compile-evidence",
      "compile-decision",
      "compile-presentation",
      "emit-projection",
    ])
    expect([...COMPILER_RUN_TYPES]).toEqual(["full", "incremental", "reconcile", "dry-run"])
  })

  it("keeps INV-10's seven terminal states out of every R-6 vocabulary (control #90)", () => {
    // THE LAYER BOUNDARY, as an assertion rather than a docblock claim. The seven are one source
    // record's compiled CONCLUSION; the unions here are the compiler's QUEUE. Fusing them is the
    // specific defect this refuses. (R-6 expected the seven to land on
    // `adoption_records.lifecycle_status`; R-7 wrote that column with four uppercase values instead,
    // so the seven still have no home — which changes nothing about the disjointness asserted here.)
    //
    // VACUITY GUARD, because a forbidden-value scan over an empty array passes: the literal is
    // pinned at seven and each scanned array is pinned non-empty, so a scan cannot pass by reading
    // nothing. This is the shape [[optional-field-defeats-source-guards]] requires.
    expect(INV10_TERMINAL_STATES).toHaveLength(7)
    const vocabularies: readonly (readonly string[])[] = [
      COMPILER_JOB_STATES,
      COMPILER_RUN_STATES,
      COMPILER_JOB_TYPES,
      COMPILER_RUN_TYPES,
      LEASABLE_JOB_STATES,
      Object.keys(COMPILER_JOB_TRANSITIONS),
      Object.keys(COMPILER_RUN_TRANSITIONS),
    ]
    for (const vocabulary of vocabularies) {
      expect(vocabulary.length).toBeGreaterThan(0)
      for (const forbidden of INV10_TERMINAL_STATES) {
        expect(
          vocabulary,
          `${forbidden} belongs to INV-10's conclusion layer, not R-6's queue`,
        ).not.toContain(forbidden)
      }
    }

    // And the EDGES, not only the keys: a table may name the right five states and still point at an
    // eighth. Every value in both tables must be a declared member of that table's own union.
    for (const [from, tos] of Object.entries(COMPILER_JOB_TRANSITIONS)) {
      expect(COMPILER_JOB_STATES).toContain(from)
      for (const to of tos) expect(COMPILER_JOB_STATES).toContain(to)
    }
    for (const [from, tos] of Object.entries(COMPILER_RUN_TRANSITIONS)) {
      expect(COMPILER_RUN_STATES).toContain(from)
      for (const to of tos) expect(COMPILER_RUN_STATES).toContain(to)
    }
  })

  it("names the two schemas the committed files declare", () => {
    expect(COMPILER_JOB_SCHEMA).toBe("calllint.compiler-job.v1")
    expect(COMPILER_RUN_SCHEMA).toBe("calllint.compiler-run.v1")
  })

  it("freezes both unions and both tables against runtime widening", () => {
    // `Object.freeze` on the arrays and on the tables. Asserted because `readonly` is a TYPE, erased
    // before any of this runs — a caller could otherwise `push` a sixth state at runtime.
    expect(Object.isFrozen(COMPILER_JOB_STATES)).toBe(true)
    expect(Object.isFrozen(COMPILER_RUN_STATES)).toBe(true)
    expect(Object.isFrozen(COMPILER_JOB_TYPES)).toBe(true)
    expect(Object.isFrozen(COMPILER_RUN_TYPES)).toBe(true)
    expect(Object.isFrozen(LEASABLE_JOB_STATES)).toBe(true)
    expect(Object.isFrozen(COMPILER_JOB_TRANSITIONS)).toBe(true)
    expect(Object.isFrozen(COMPILER_RUN_TRANSITIONS)).toBe(true)
    for (const tos of Object.values(COMPILER_JOB_TRANSITIONS)) expect(Object.isFrozen(tos)).toBe(true)
    for (const tos of Object.values(COMPILER_RUN_TRANSITIONS)) expect(Object.isFrozen(tos)).toBe(true)
  })
})

describe("the job transition table (control #78)", () => {
  it("declares exactly these edges, per state and in total", () => {
    // Per-state sorted lists AND a total. The total is the independent number: a table whose values
    // were widened in one row keeps every key and could still satisfy a laxer per-row assertion.
    expect([...COMPILER_JOB_TRANSITIONS.PENDING].sort()).toEqual(["LEASED", "PENDING"])
    expect([...COMPILER_JOB_TRANSITIONS.LEASED].sort()).toEqual([
      "DEAD_LETTER",
      "FAILED",
      "LEASED",
      "PENDING",
      "SUCCEEDED",
    ])
    expect(COMPILER_JOB_TRANSITIONS.SUCCEEDED).toEqual([])
    expect(COMPILER_JOB_TRANSITIONS.FAILED).toEqual([])
    expect(COMPILER_JOB_TRANSITIONS.DEAD_LETTER).toEqual([])
    const edges = Object.values(COMPILER_JOB_TRANSITIONS).reduce((n, tos) => n + tos.length, 0)
    expect(edges, "seven job edges: two from PENDING, five from LEASED").toBe(7)
  })

  it("makes the three terminal states terminal, and derives that rather than restating it", () => {
    expect(isTerminalJobState("SUCCEEDED")).toBe(true)
    expect(isTerminalJobState("FAILED")).toBe(true)
    expect(isTerminalJobState("DEAD_LETTER")).toBe(true)
    // The negative half — without it, an `isTerminal` that returned `true` unconditionally passes.
    expect(isTerminalJobState("PENDING")).toBe(false)
    expect(isTerminalJobState("LEASED")).toBe(false)
    // And EVERY state agrees with the table it is derived from, so the predicate cannot drift.
    for (const state of COMPILER_JOB_STATES) {
      expect(isTerminalJobState(state)).toBe(COMPILER_JOB_TRANSITIONS[state].length === 0)
    }
  })

  it("refuses every move out of a terminal state (control #78)", () => {
    const terminal: CompilerJobState[] = ["SUCCEEDED", "FAILED", "DEAD_LETTER"]
    for (const from of terminal) {
      for (const to of COMPILER_JOB_STATES) {
        expect(canTransitionJob(from, to)).toBe(false)
        expect(() => assertJobTransition(from, to, JOB_ID)).toThrow(
          new RegExp(`${from} -> ${to} is not a permitted transition`),
        )
        // The message names the terminality, which is the difference between "you cannot do that"
        // and "that row is finished". A reviewer reading a CI log needs the second.
        expect(() => assertJobTransition(from, to, JOB_ID)).toThrow(new RegExp(`\\(${from} is terminal\\)`))
      }
    }
    // The exhaustiveness of the loop above, pinned: 3 terminal × 5 targets = 15 refusals. Without
    // this, an empty `COMPILER_JOB_STATES` would make the whole block vacuous.
    expect(terminal.length * COMPILER_JOB_STATES.length).toBe(15)
  })

  it("permits the seven declared moves and refuses the rest", () => {
    // The complement, computed rather than listed: for all 25 ordered pairs, `canTransitionJob`
    // must agree with the table exactly. This is what makes a widened table fail here even if the
    // widening added an edge nobody wrote an explicit assertion for.
    let permitted = 0
    for (const from of COMPILER_JOB_STATES) {
      for (const to of COMPILER_JOB_STATES) {
        const declared = COMPILER_JOB_TRANSITIONS[from].includes(to)
        expect(canTransitionJob(from, to)).toBe(declared)
        if (declared) permitted += 1
        else expect(() => assertJobTransition(from, to, JOB_ID)).toThrow()
      }
    }
    expect(permitted).toBe(7)
  })

  it("keeps PENDING -> PENDING, which is what makes a re-enqueue idempotent", () => {
    // A self-edge that looks like a no-op and is not: the schema's idempotency rule is that
    // re-enqueueing unchanged inputs UPDATES the row (priority, availableAt). Removing this edge
    // would make `enqueueJob`'s own upsert path illegal.
    expect(canTransitionJob("PENDING", "PENDING")).toBe(true)
    // And `LEASED -> LEASED`, which is the renewal path. Declared edges with no implementation are
    // how a state machine lies; `job-lease.test.ts` exercises the writer this permits.
    expect(canTransitionJob("LEASED", "LEASED")).toBe(true)
  })
})

describe("the run transition table (control #79)", () => {
  it("declares exactly these edges, and no RUNNING self-edge", () => {
    expect([...COMPILER_RUN_TRANSITIONS.RUNNING].sort()).toEqual(["FAILED", "PARTIAL", "SUCCEEDED"])
    expect(COMPILER_RUN_TRANSITIONS.SUCCEEDED).toEqual([])
    expect(COMPILER_RUN_TRANSITIONS.PARTIAL).toEqual([])
    expect(COMPILER_RUN_TRANSITIONS.FAILED).toEqual([])
    const edges = Object.values(COMPILER_RUN_TRANSITIONS).reduce((n, tos) => n + tos.length, 0)
    expect(edges, "three run edges, all out of RUNNING").toBe(3)
    // Absent on purpose: `runId` includes the injected `startedAt`, so a second call recording the
    // same start is a duplicate rather than a resumption.
    expect(canTransitionRun("RUNNING", "RUNNING")).toBe(false)
  })

  it("makes all three conclusions terminal, PARTIAL included", () => {
    expect(isTerminalRunState("SUCCEEDED")).toBe(true)
    expect(isTerminalRunState("PARTIAL")).toBe(true)
    expect(isTerminalRunState("FAILED")).toBe(true)
    expect(isTerminalRunState("RUNNING")).toBe(false)
    for (const state of COMPILER_RUN_STATES) {
      expect(isTerminalRunState(state)).toBe(COMPILER_RUN_TRANSITIONS[state].length === 0)
    }
  })

  it("refuses re-grading a concluded run (control #79)", () => {
    const terminal: CompilerRunState[] = ["SUCCEEDED", "PARTIAL", "FAILED"]
    for (const from of terminal) {
      for (const to of COMPILER_RUN_STATES) {
        expect(canTransitionRun(from, to)).toBe(false)
        expect(() => assertRunTransition(from, to, DIGEST)).toThrow(new RegExp(`\\(${from} is terminal\\)`))
      }
    }
    expect(terminal.length * COMPILER_RUN_STATES.length).toBe(12)
  })

  it("agrees with its own table across all sixteen ordered pairs", () => {
    let permitted = 0
    for (const from of COMPILER_RUN_STATES) {
      for (const to of COMPILER_RUN_STATES) {
        const declared = COMPILER_RUN_TRANSITIONS[from].includes(to)
        expect(canTransitionRun(from, to)).toBe(declared)
        if (declared) permitted += 1
      }
    }
    expect(permitted).toBe(3)
  })

  it("keeps CompilerRunState.PARTIAL terminal, unlike the identically-spelled ResolutionState", () => {
    // THE SHARED-SPELLING HAZARD, as an assertion. `ResolutionState.PARTIAL` is RE-QUEUEABLE (it may
    // still reach `PUBLISHED`); this `PARTIAL` is a final grade. A later reader who fuses them gets a
    // projection shipping over an incomplete index, which is the exact harm the schema names.
    //
    // Asserted by reading the OTHER package's source: importing `@calllint/evidence` here would make
    // the two layers depend on each other, which is the coupling the separation exists to avoid.
    const resolutionSrc = readFileSync(
      join(PKG_ROOT, "..", "evidence", "src", "model", "stateMachine.ts"),
      "utf8",
    )
    // The probe must be reading the intended file — a rename would otherwise make this vacuous.
    expect(resolutionSrc).toContain("PARTIAL")
    expect(resolutionSrc).toMatch(/PARTIAL:\s*\[[^\]]*PUBLISHED/)
    // Its PARTIAL has outgoing edges; ours has none. Same word, different fact.
    expect(isTerminalRunState("PARTIAL")).toBe(true)
  })
})

describe("the leasable whitelist", () => {
  it("is PENDING alone, as a positive whitelist", () => {
    expect([...LEASABLE_JOB_STATES]).toEqual(["PENDING"])
    expect(isLeasableJobState("PENDING")).toBe(true)
    // Every other state, enumerated from the closed union rather than listed: a sixth state added
    // later becomes non-leasable by DEFAULT, which is the property a "not terminal and not LEASED"
    // test would lose.
    for (const state of COMPILER_JOB_STATES) {
      if (state === "PENDING") continue
      expect(isLeasableJobState(state), `${state} must not be leasable`).toBe(false)
    }
    expect(COMPILER_JOB_STATES.filter(isLeasableJobState)).toEqual(["PENDING"])
  })
})

describe("the identity derivations", () => {
  it("keys a job on the DDL's UNIQUE triple and nothing else", () => {
    const a = compilerJobId("compile-evidence", "io.test/a", DIGEST)
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
    // Same triple ⇒ same id, which is what makes the upsert idempotent by identity.
    expect(compilerJobId("compile-evidence", "io.test/a", DIGEST)).toBe(a)
    // Each of the three moves it.
    expect(compilerJobId("resolve-artifact", "io.test/a", DIGEST)).not.toBe(a)
    expect(compilerJobId("compile-evidence", "io.test/b", DIGEST)).not.toBe(a)
    expect(compilerJobId("compile-evidence", "io.test/a", JOB_ID)).not.toBe(a)
  })

  it("hashes a NAMED object, so a boundary shift is not the same key", () => {
    // `hashJson({jobType, subjectKey, inputDigest})`, never a joined string: with a join,
    // `("a-b", "c")` and `("a", "b-c")` collide. Two triples that a `-`-join would fuse must differ.
    const left = compilerJobId("compile-evidence", "io.test/a-b", DIGEST)
    const right = compilerJobId("compile-evidence", "io.test/a", DIGEST)
    expect(left).not.toBe(right)
    // And the field names participate: swapping two values must move the key.
    expect(compilerJobId("compile-evidence", DIGEST, "io.test/a")).not.toBe(
      compilerJobId("compile-evidence", "io.test/a", DIGEST),
    )
  })

  it("includes startedAt in a run id, because a run is an EVENT", () => {
    const first = compilerRunId("full", DIGEST, "2026-08-04T00:00:00.000Z")
    const second = compilerRunId("full", DIGEST, "2026-08-04T01:00:00.000Z")
    // Two passes over an unchanged corpus are two runs. Keying on the manifest alone would make the
    // second silently replace the first and destroy the history the table exists to keep.
    expect(first).not.toBe(second)
    // Reproducible: the same stamp replays to the same id.
    expect(compilerRunId("full", DIGEST, "2026-08-04T00:00:00.000Z")).toBe(first)
    expect(compilerRunId("incremental", DIGEST, "2026-08-04T00:00:00.000Z")).not.toBe(first)
  })

  it("does not derive a job id from anything mutable", () => {
    // The negative half of the identity claim, asserted on the SOURCE because a hash cannot be
    // observed to exclude something. `compilerJobId`'s body must name exactly the three fields.
    const jobSrc = readFileSync(join(SRC_DIR, "domain", "job.ts"), "utf8")
    const body = /export function compilerJobId\([\s\S]*?\): string \{([\s\S]*?)\n\}/.exec(jobSrc)?.[1]
    expect(body, "compilerJobId's body must be readable for this assertion to mean anything").toBeDefined()
    expect(body).toContain("hashJson({ jobType, subjectKey, inputDigest })")
    for (const mutable of ["attemptCount", "priority", "availableAt", "createdAt", "updatedAt", "state"]) {
      expect(body, `${mutable} would give every re-enqueue a fresh key`).not.toContain(mutable)
    }
  })
})

describe("metrics are closed and numeric (controls #84, #85)", () => {
  it("declares the six counters in the schema's order and starts them at zero", () => {
    expect([...COMPILER_RUN_METRIC_KEYS]).toEqual([
      "sourceRecordsRead",
      "subjectsCompiled",
      "artifactsResolved",
      "evidenceCompiled",
      "recordsEmitted",
      "failures",
    ])
    expect(Object.isFrozen(COMPILER_RUN_METRIC_KEYS)).toBe(true)
    const empty = emptyRunMetrics()
    expect(Object.keys(empty).sort()).toEqual([...COMPILER_RUN_METRIC_KEYS].sort())
    expect(Object.values(empty)).toEqual([0, 0, 0, 0, 0, 0])
    // A fresh object each call — a shared frozen literal would let one run's counters leak into the
    // next, and `withCompilerRun` calls this on the crash path.
    expect(emptyRunMetrics()).not.toBe(emptyRunMetrics())
  })

  it("serializes in a fixed order regardless of the object's key order", () => {
    const forward = emptyRunMetrics()
    // Built in REVERSE insertion order: `JSON.stringify` follows insertion order, so a serializer
    // that did not impose one would produce different bytes for the same metrics — and this column
    // is digested.
    const reversed: CompilerRunMetrics = {
      failures: 0,
      recordsEmitted: 0,
      evidenceCompiled: 0,
      artifactsResolved: 0,
      subjectsCompiled: 0,
      sourceRecordsRead: 0,
    }
    expect(serializeRunMetrics(reversed)).toBe(serializeRunMetrics(forward))
    expect(serializeRunMetrics(forward)).toBe(
      '{"sourceRecordsRead":0,"subjectsCompiled":0,"artifactsResolved":0,"evidenceCompiled":0,"recordsEmitted":0,"failures":0}',
    )
    // And the naive form really would differ, which is what makes the assertion above non-vacuous.
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(forward))
  })

  it("round-trips, and validates on the way OUT as well as in", () => {
    const metrics: CompilerRunMetrics = { ...emptyRunMetrics(), subjectsCompiled: 19, failures: 2 }
    expect(parseRunMetrics(serializeRunMetrics(metrics), DIGEST)).toEqual(metrics)
    // The column is TEXT: a row written by a future caller that skipped the assertion would
    // otherwise be read back as a `CompilerRunMetrics` the type system believes in.
    expect(() => parseRunMetrics('{"sourceRecordsRead":0}', DIGEST)).toThrow(/must declare exactly/)
  })

  it("refuses an EXTRA key, which is how a verdict would arrive (control #84)", () => {
    // THE CLOSURE IS THE POINT. `metrics` must never become "a second, unaudited place where a
    // decision is made" (the schema), and a verdict arrives as an extra key — invisible to presence
    // checks. Product Principle 4 is the reason: deterministic rules decide verdicts, not run reports.
    expect(() => assertRunMetrics({ ...emptyRunMetrics(), verdict: "SAFE" }, DIGEST)).toThrow(
      /must declare exactly/,
    )
    expect(() => assertRunMetrics({ ...emptyRunMetrics(), score: 91 }, DIGEST)).toThrow(/must declare exactly/)
    // The error must NAME the offending key set, or a CI log says only "invalid".
    expect(() => assertRunMetrics({ ...emptyRunMetrics(), verdict: "SAFE" }, DIGEST)).toThrow(/verdict/)
  })

  it("refuses a missing key, a non-number, a fraction and a negative (control #85)", () => {
    const base = emptyRunMetrics()
    const { failures: _dropped, ...missing } = base
    expect(() => assertRunMetrics(missing, DIGEST)).toThrow(/must declare exactly/)
    expect(() => assertRunMetrics({ ...base, failures: "0" }, DIGEST)).toThrow(
      /metrics\.failures must be a non-negative integer/,
    )
    expect(() => assertRunMetrics({ ...base, failures: 1.5 }, DIGEST)).toThrow(/non-negative integer/)
    expect(() => assertRunMetrics({ ...base, failures: -1 }, DIGEST)).toThrow(/non-negative integer/)
    expect(() => assertRunMetrics({ ...base, failures: Number.NaN }, DIGEST)).toThrow(/non-negative integer/)
    expect(() => assertRunMetrics({ ...base, failures: null }, DIGEST)).toThrow(/non-negative integer/)
    // Non-objects, including the two JSON shapes that are typeof "object".
    expect(() => assertRunMetrics(null, DIGEST)).toThrow(/must be an object, found null/)
    expect(() => assertRunMetrics([], DIGEST)).toThrow(/must be an object, found an array/)
    expect(() => assertRunMetrics("{}", DIGEST)).toThrow(/must be an object/)
    // The positive case, so the block cannot pass by rejecting everything.
    expect(() => assertRunMetrics(base, DIGEST)).not.toThrow()
  })

  it("names the run in every message, so a failing batch says which row", () => {
    expect(() => assertRunMetrics({}, "run-42")).toThrow(/run "run-42"/)
  })
})

describe("lease coherence (controls #88, #89)", () => {
  it("accepts the two coherent shapes", () => {
    expect(() => assertLeaseCoherent("LEASED", "worker-1", "2026-08-04T00:05:00.000Z", JOB_ID)).not.toThrow()
    for (const state of COMPILER_JOB_STATES) {
      if (state === "LEASED") continue
      expect(() => assertLeaseCoherent(state, null, null, JOB_ID)).not.toThrow()
    }
  })

  it("refuses a HALF-SET pair, in both directions (control #88)", () => {
    // Owner without expiry is a row held forever — the "permanently-held row" the schema exists to
    // prevent. Expiry without owner is a claim nobody made, which `reclaimExpiredLeases` would
    // release on behalf of no worker.
    expect(() => assertLeaseCoherent("LEASED", "worker-1", null, JOB_ID)).toThrow(
      /nullable together, found owner="worker-1" expiresAt=null/,
    )
    expect(() => assertLeaseCoherent("LEASED", null, "2026-08-04T00:05:00.000Z", JOB_ID)).toThrow(
      /nullable together/,
    )
  })

  it("refuses a lease on a non-LEASED row, and a LEASED row with no owner (control #89)", () => {
    for (const state of COMPILER_JOB_STATES) {
      if (state === "LEASED") continue
      expect(() => assertLeaseCoherent(state, "worker-1", "2026-08-04T00:05:00.000Z", JOB_ID)).toThrow(
        /a lease is only held while LEASED/,
      )
    }
    expect(() => assertLeaseCoherent("LEASED", null, null, JOB_ID)).toThrow(
      /state is LEASED with no leaseOwner/,
    )
  })
})

describe("digest shape", () => {
  it("accepts sha256:<64 hex> and refuses everything else", () => {
    expect(() => assertDigestShape(DIGEST, "inputDigest", JOB_ID)).not.toThrow()
    for (const bad of [
      "sha256:",
      "sha256:zz",
      "sha512:" + "a".repeat(64),
      "a".repeat(64),
      `sha256:${"A".repeat(64)}`, // uppercase hex is outside the schema's pattern
      `sha256:${"a".repeat(63)}`,
      `sha256:${"a".repeat(65)}`,
      "",
    ]) {
      expect(() => assertDigestShape(bad, "inputDigest", JOB_ID)).toThrow(/must match sha256:<64 hex>/)
    }
  })

  it("does NOT refuse the all-zero digest, which is why the nullability rule is separate (control #87)", () => {
    // `sha256:000…0` is a well-formed digest of nothing. A crashed run substituting it is refused by
    // `concludeCompilerRun`'s nullability rule, not by this one — two checks, both needed.
    expect(() => assertDigestShape(`sha256:${"0".repeat(64)}`, "outputManifestDigest", JOB_ID)).not.toThrow()
  })
})

describe("the retry policy, as a pure function (controls #82, #83)", () => {
  it("maps the three outcomes", () => {
    expect(decideDisposition("SUCCESS", 1, 5)).toBe("SUCCEEDED")
    expect(decideDisposition("PERMANENT", 1, 5)).toBe("FAILED")
    expect(decideDisposition("RETRYABLE", 1, 5)).toBe("RETRY_SCHEDULED")
  })

  it("exhausts at attemptCount >= maxAttempts, not strictly greater (control #83)", () => {
    // With `maxAttempts = 5` the fifth hand-out sets `attemptCount = 5`, and that attempt is the LAST
    // one permitted — so a failure at 5 is exhaustion. `>` would grant a sixth.
    expect(decideDisposition("RETRYABLE", 4, 5)).toBe("RETRY_SCHEDULED")
    expect(decideDisposition("RETRYABLE", 5, 5)).toBe("DEAD_LETTER")
    expect(decideDisposition("RETRYABLE", 6, 5)).toBe("DEAD_LETTER")
    // The whole budget, counted: exactly four retries are scheduled across attempts 1..5, which is
    // "the initial one plus four retries" as `DEFAULT_MAX_ATTEMPTS` documents.
    const scheduled = [1, 2, 3, 4, 5].filter((n) => decideDisposition("RETRYABLE", n, 5) === "RETRY_SCHEDULED")
    expect(scheduled).toEqual([1, 2, 3, 4])
    // A budget of one means the first failure is terminal.
    expect(decideDisposition("RETRYABLE", 1, 1)).toBe("DEAD_LETTER")
  })

  it("never consumes the budget for a PERMANENT failure", () => {
    // `FAILED` is a REFUSAL to retry; `DEAD_LETTER` is an EXHAUSTION. Both terminal, both need a
    // human, and a reader can tell them apart without parsing `last_error_code`.
    for (const attempts of [1, 4, 5, 99]) {
      expect(decideDisposition("PERMANENT", attempts, 5)).toBe("FAILED")
      expect(decideDisposition("SUCCESS", attempts, 5)).toBe("SUCCEEDED")
    }
  })

  it("doubles the backoff, caps it, and cannot reach the cap through Infinity", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5)
    expect(DEFAULT_BACKOFF_MS).toBe(30_000)
    expect(MAX_BACKOFF_MS).toBe(3_600_000)
    // 30 s, 1 m, 2 m, 4 m across the four retries — the docblock's own numbers.
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n, DEFAULT_BACKOFF_MS))).toEqual([
      30_000, 60_000, 120_000, 240_000,
    ])
    // Capped, not unbounded: a next attempt scheduled for the next century has lost the row.
    expect(retryDelayMs(20, DEFAULT_BACKOFF_MS)).toBe(MAX_BACKOFF_MS)
    // The `doublings > 30` branch caps BEFORE multiplying, so the result is a number, not Infinity.
    expect(retryDelayMs(1000, DEFAULT_BACKOFF_MS)).toBe(MAX_BACKOFF_MS)
    expect(Number.isFinite(retryDelayMs(1000, DEFAULT_BACKOFF_MS))).toBe(true)
    // A zero backoff stays zero rather than becoming the cap.
    expect(retryDelayMs(3, 0)).toBe(0)
  })
})

describe("run grading is a measurement, not a caller's opinion (control #86)", () => {
  it("grades a run with failures as PARTIAL even when a manifest exists", () => {
    // 24 of 25 is "not a success, and grading it as one would let a projection ship over an
    // incomplete index" (the schema).
    const metrics: CompilerRunMetrics = { ...emptyRunMetrics(), subjectsCompiled: 24, failures: 1 }
    expect(gradeRun(metrics, DIGEST)).toBe("PARTIAL")
  })

  it("grades a run with no manifest as FAILED whatever the counters say", () => {
    expect(gradeRun(emptyRunMetrics(), null)).toBe("FAILED")
    expect(gradeRun({ ...emptyRunMetrics(), subjectsCompiled: 25 }, null)).toBe("FAILED")
    // Including one that also had failures — the manifest rule is checked FIRST.
    expect(gradeRun({ ...emptyRunMetrics(), failures: 3 }, null)).toBe("FAILED")
  })

  it("grades an all-zero run with a manifest as SUCCEEDED", () => {
    // Correct rather than suspicious: a reconcile pass over an unchanged corpus reads nothing and
    // emits nothing. `PARTIAL` means something FAILED, not that something was skipped.
    expect(gradeRun(emptyRunMetrics(), DIGEST)).toBe("SUCCEEDED")
  })

  it("is a total function over the three inputs that matter", () => {
    for (const failures of [0, 1, 2]) {
      for (const digest of [DIGEST, null]) {
        const graded = gradeRun({ ...emptyRunMetrics(), failures }, digest)
        expect(graded).toBe(digest === null ? "FAILED" : failures > 0 ? "PARTIAL" : "SUCCEEDED")
        // Whatever it grades must be a declared, TERMINAL run state.
        expect(COMPILER_RUN_STATES).toContain(graded)
        expect(isTerminalRunState(graded)).toBe(true)
        // And a legal move out of RUNNING, so grading can never produce an unwritable state.
        expect(canTransitionRun("RUNNING", graded)).toBe(true)
      }
    }
  })
})

describe("the pure layers read no clock (INV-R6)", () => {
  it("names no Date and no fetch in either domain module or the queue operations", () => {
    // Asserted on the DECLARATION, per [[optional-field-defeats-source-guards]]: a capability that
    // cannot be represented cannot be reached by a future edit either. `compilerQueue.ts` is included
    // because its whole design is that a timestamp is UNREPRESENTABLE there — every absolute stamp is
    // a parameter or comes from the injected `ScheduleFn`.
    const files = ["domain/job.ts", "domain/jobStates.ts", "operations/compilerQueue.ts"]
    for (const rel of files) {
      const src = readFileSync(join(SRC_DIR, rel), "utf8")
      // Comments discuss `Date` in prose ("never a `Date.parse`"), so the scan must read CODE — the
      // migrate.ts lesson: a sentence claiming compliance is not a violation.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      expect(code.length, `${rel} must not read as empty`).toBeGreaterThan(200)
      expect(code, `${rel} must not read the clock`).not.toMatch(/new Date\(/)
      expect(code, `${rel} must not read the clock`).not.toContain("Date.now(")
      expect(code, `${rel} must not parse a stamp`).not.toContain("Date.parse(")
      expect(code, `${rel} must not reach the network`).not.toMatch(/\bfetch\b/)
      // Nor spawn anything: a job is a row NAMING work, and R-6 executes none of it.
      expect(code, `${rel} must not execute anything`).not.toMatch(/child_process|execSync|spawn\(/)
    }
  })

  it("makes the run grade UNREACHABLE as a caller parameter (control #86)", () => {
    // MEASURED, and the reason this is a declaration test rather than another behavioural one:
    // control #86 added `state?:` to `ConcludeRunInput` and `input.state ?? gradeRun(…)` to the
    // body, and every suite STAYED GREEN, 84/84. Of course it did — no existing caller passes the
    // new property, so an OPTIONAL capability is invisible to behaviour. That is
    // [[optional-field-defeats-source-guards]] in its exact form: the required version of the same
    // edit would break every call site, and the optional one breaks nothing while making the defect
    // reachable by the next caller who reads the type.
    //
    // The two behavioural #86 tests are still right and still needed — they prove `gradeRun` grades
    // 24/25 as PARTIAL. What they cannot prove is that grading is the ONLY route to a state, and
    // that is the claim `concludeCompilerRun`'s docblock actually makes ("the state is not a
    // parameter").
    const queueSrc = readFileSync(join(SRC_DIR, "operations", "compilerQueue.ts"), "utf8")
    const decl = /export interface ConcludeRunInput \{[\s\S]*?\n\}/.exec(queueSrc)?.[0]
    expect(decl, "ConcludeRunInput must be readable for this assertion to mean anything").toBeDefined()

    // CLOSED ENUMERATION of the properties, so an addition fails as loudly as a substitution. The
    // trailing `?` is captured deliberately: `state?:` must fail here, not slip through as `state`.
    const fields = [...decl!.matchAll(/^ {2}(\w+\??)(?=:)/gm)].map((m) => m[1])
    expect(fields.sort()).toEqual(["completedAt", "metrics", "outputManifestDigest", "runId", "store"])
    // VACUITY GUARD: an empty match list would satisfy any `not.toContain` below.
    expect(fields.length, "the property scan must actually have read properties").toBe(5)

    // The FORBIDDEN shape, named directly — both spellings, since optional is the one that hides.
    expect(decl, "a caller-supplied grade is the defect control #86 injects").not.toMatch(/^ {2}state\??:/m)

    // And the body must derive it, with no fallback a caller can reach.
    const body = /export function concludeCompilerRun\([\s\S]*?\n\}/.exec(queueSrc)?.[0]
    expect(body, "concludeCompilerRun's body must be readable").toBeDefined()
    expect(body).toMatch(/const state = gradeRun\(input\.metrics, input\.outputManifestDigest\)/)
    expect(body, "a `?? gradeRun(...)` fallback means the caller wins when it supplies one").not.toContain("??")
  })

  it("declares ScheduleFn as a DURATION -> stamp, so the arithmetic lives at the edge", () => {
    const queueSrc = readFileSync(join(SRC_DIR, "operations", "compilerQueue.ts"), "utf8")
    // The signature is the design: a `ScheduleFn` that took an absolute stamp would put the
    // arithmetic back in here, and one that returned a number would put the formatting back.
    expect(queueSrc).toMatch(/export type ScheduleFn = \(delayMs: number\) => string/)
    // And it is REQUIRED on the one input that needs it — an optional capability is the shape that
    // gave clean typecheck where the required form gave 12 errors.
    expect(queueSrc).toMatch(/^ {2}schedule: ScheduleFn$/m)
    expect(queueSrc, "an optional schedule would let a caller reach a store-refused write").not.toMatch(
      /^ {2}schedule\?: ScheduleFn$/m,
    )
  })
})
