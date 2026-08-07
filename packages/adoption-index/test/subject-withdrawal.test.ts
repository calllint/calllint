/**
 * subject-withdrawal — the dedicated measurement for R-11's two operators.
 *
 * `refresh-from-mirror.test.ts` already grades ONE withdrawal end-to-end, and that is the
 * integration proof: a shrinking cohort moves a subject while the mirror keeps both rows. What it
 * structurally CANNOT reach is every branch the two operators own, because the production path only
 * ever hands them the plan a real cohort produced. Four of the five branches below are unreachable
 * from a shrinking-cohort fixture at all:
 *
 *   - `reinstate` needs a subject that is already `WITHDRAWN` **and** observed again;
 *   - `skippedTerminal` needs a `TOMBSTONED` row, which no automatic path can create by design;
 *   - `unmatched` needs the two planes to disagree about what exists;
 *   - the transition refusal needs a row that moved between the plan and the write.
 *
 * So this file is not a duplicate of that one. It is the unit half the project contract requires
 * (implementation + positive + negative + unit test), and its negative controls are the four
 * statements R-11 makes that a green integration test would keep green if they were false.
 *
 * WHY `planWithdrawal` IS TESTED OVER HAND-BUILT SUBJECTS AND `applyWithdrawal` IS NOT.
 * `planWithdrawal` is pure and reads five fields, so a literal is a faithful input — and it is the
 * only way to present a `TOMBSTONED` row, which nothing in `src/` can write. `applyWithdrawal` runs
 * real SQL through the real migration set, so it gets a real store; a fake there would prove the
 * fake behaves, which is the mistake `identity-store.test.ts` records at length.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  resolveIdentity,
  toSourceRecord,
  planWithdrawal,
  applyWithdrawal,
  SUBJECT_LIFECYCLE_TRANSITIONS,
  isTerminalLifecycle,
  ADOPTION_LIFECYCLE_STATUSES,
  OFFICIAL_REGISTRY_SOURCE_ID,
  MIGRATIONS_DIRNAME,
  type SourceRecordV1,
  type StoredSubject,
  type AdoptionLifecycleStatus,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
const NOW = "2026-08-04T00:00:00.000Z"
const T1 = "2026-08-05T00:00:00.000Z"
const T2 = "2026-08-06T00:00:00.000Z"
const RETRIEVED = "2026-08-03T12:00:00.000Z"
const SOURCE_ID = OFFICIAL_REGISTRY_SOURCE_ID
const OFFICIAL_META = "io.modelcontextprotocol.registry/official"

const dirs: string[] = []
async function openStore(): Promise<AdoptionIndexStore> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-withdrawal-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  return AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now: NOW })
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Build a record through the SHIPPED adapter — never hand-authored (see the docblock). */
function record(name: string): SourceRecordV1 {
  const built = toSourceRecord(
    {
      server: { name, version: "1.0.0" },
      _meta: { [OFFICIAL_META]: { status: "active", isLatest: true } },
    } as never,
    RETRIEVED,
  )
  if (built === null) throw new Error(`fixture "${name}" was rejected by the shipped adapter`)
  return built
}

/** Persist a cohort of names and return the stored subjects, exactly as production does. */
async function seed(names: string[]): Promise<{ store: AdoptionIndexStore; subjects: StoredSubject[] }> {
  const store = await openStore()
  const identity = resolveIdentity({ records: names.map(record), sourceId: SOURCE_ID, observedAt: NOW })
  store.transaction((tx) => tx.persistIdentity(identity))
  return { store, subjects: store.listSubjects() }
}

/**
 * A stored subject with an overridden lifecycle, for `planWithdrawal`'s pure branches.
 *
 * Spreads a REAL subject rather than inventing one: `identity-store.test.ts` records nine tests that
 * passed green over a shape `tsc` rejects, because `vitest` transpiles without type-checking. Spreading
 * keeps every field production writes and lets the compiler catch a renamed one.
 */
function withStatus(subject: StoredSubject, status: AdoptionLifecycleStatus): StoredSubject {
  return { ...subject, lifecycleStatus: status }
}

describe("planWithdrawal — the four branches a shrinking cohort cannot reach", () => {
  it("plans ACTIVE → WITHDRAWN for an absent subject, carrying the stored `from`", async () => {
    const { store, subjects } = await seed(["io.a/keep", "io.b/gone"])
    try {
      const plan = planWithdrawal({
        subjects,
        absentFromSource: ["io.b/gone"],
        observedNativeIds: new Set(["io.a/keep"]),
      })
      expect(plan.withdraw.map((e) => `${e.canonicalName} ${e.from}->${e.to}`)).toEqual([
        "io.b/gone ACTIVE->WITHDRAWN",
      ])
      // The applier's transition check reads `from` off the plan, so a plan that invented it would
      // make that check unfalsifiable. Graded against the STORE, not against the literal above.
      const stored = subjects.find((s) => s.canonicalName === "io.b/gone")
      expect(plan.withdraw[0]!.from).toBe(stored!.lifecycleStatus)
      expect(plan.withdraw[0]!.subjectId).toBe(stored!.subjectId)
      expect(plan.reinstate).toEqual([])
      expect(plan.unmatched).toEqual([])
      expect(plan.skippedTerminal).toEqual([])
    } finally {
      store.close()
    }
  })

  it("plans WITHDRAWN → ACTIVE on re-observation, so a truncation heals", async () => {
    const { store, subjects } = await seed(["io.a/back"])
    try {
      const withdrawn = [withStatus(subjects[0]!, "WITHDRAWN")]
      const plan = planWithdrawal({
        subjects: withdrawn,
        absentFromSource: [],
        observedNativeIds: new Set(["io.a/back"]),
      })
      expect(plan.reinstate.map((e) => `${e.canonicalName} ${e.from}->${e.to}`)).toEqual([
        "io.a/back WITHDRAWN->ACTIVE",
      ])
      expect(plan.withdraw).toEqual([])
    } finally {
      store.close()
    }
  })

  it("skips a TOMBSTONED absence and reports it BY NAME, never as a digest", async () => {
    const { store, subjects } = await seed(["io.a/dead"])
    try {
      const plan = planWithdrawal({
        subjects: [withStatus(subjects[0]!, "TOMBSTONED")],
        absentFromSource: ["io.a/dead"],
        observedNativeIds: new Set(),
      })
      expect(plan.skippedTerminal).toEqual(["io.a/dead"])
      expect(plan.withdraw).toEqual([])
      // The vocabulary control. `skippedTerminal` sits beside `unmatched` in one object and
      // `unmatched` structurally cannot hold a digest, so a `sha256:…` here would let an operator
      // compare the two sets and conclude they are disjoint. This is the defect this batch actually
      // shipped and then fixed — the first draft pushed `subjectId`.
      expect(plan.skippedTerminal.some((n) => n.startsWith("sha256:"))).toBe(false)
    } finally {
      store.close()
    }
  })

  it("reports an absent name no subject claims as `unmatched`, sorted, never dropped", async () => {
    const { store, subjects } = await seed(["io.a/keep"])
    try {
      const plan = planWithdrawal({
        subjects,
        absentFromSource: ["io.z/ghost", "io.b/ghost"],
        observedNativeIds: new Set(),
      })
      expect(plan.unmatched).toEqual(["io.b/ghost", "io.z/ghost"])
      expect(plan.withdraw).toEqual([])
    } finally {
      store.close()
    }
  })

  it("is idempotent on an already-WITHDRAWN absence, so `withdrawnAt` cannot move (unit half)", async () => {
    const { store, subjects } = await seed(["io.b/gone"])
    try {
      const plan = planWithdrawal({
        subjects: [withStatus(subjects[0]!, "WITHDRAWN")],
        absentFromSource: ["io.b/gone"],
        observedNativeIds: new Set(),
      })
      expect(plan.withdraw).toEqual([])
      expect(plan.skippedTerminal).toEqual([])
      expect(plan.unmatched).toEqual([])
    } finally {
      store.close()
    }
  })
})

describe("applyWithdrawal — the write, and INV-R12 on both planes", () => {
  it("moves the subject plane and keeps `withdrawn_at` at the FIRST absence on replay", async () => {
    const { store, subjects } = await seed(["io.a/keep", "io.b/gone"])
    try {
      const plan = planWithdrawal({
        subjects,
        absentFromSource: ["io.b/gone"],
        observedNativeIds: new Set(["io.a/keep"]),
      })
      const first = applyWithdrawal({ store, plan, observedAt: T1 })
      expect(first.withdrawn.map((e) => e.canonicalName)).toEqual(["io.b/gone"])
      expect(first.unchanged).toBe(0)

      const gone = () => store.listSubjects().find((s) => s.canonicalName === "io.b/gone")!
      expect(gone().lifecycleStatus).toBe("WITHDRAWN")
      expect(gone().withdrawnAt).toBe(T1)
      // The untouched neighbour: a de-listing must not be cohort-wide.
      expect(store.listSubjects().find((s) => s.canonicalName === "io.a/keep")!.lifecycleStatus).toBe("ACTIVE")

      // Replay at a LATER clock. The plan is recomputed from the new stored state, so it is empty,
      // and the stamp must still read T1. A stamp that moved would make "first absence" unanswerable.
      const replayPlan = planWithdrawal({
        subjects: store.listSubjects(),
        absentFromSource: ["io.b/gone"],
        observedNativeIds: new Set(["io.a/keep"]),
      })
      const second = applyWithdrawal({ store, plan: replayPlan, observedAt: T2 })
      expect(second.withdrawn).toEqual([])
      expect(gone().withdrawnAt).toBe(T1)
    } finally {
      store.close()
    }
  })

  it("reports the STORE's `from`, not the plan's, when the row moved legally in between", async () => {
    const { store, subjects } = await seed(["io.b/gone"])
    try {
      // Plan against the ACTIVE row…
      const plan = planWithdrawal({
        subjects,
        absentFromSource: ["io.b/gone"],
        observedNativeIds: new Set(),
      })
      expect(plan.withdraw[0]!.from).toBe("ACTIVE")

      // …then move the row LEGALLY out from under that plan. `ACTIVE -> DEPRECATED` is permitted, so
      // the write below succeeds and performs `DEPRECATED -> WITHDRAWN` instead of what was planned.
      const id = subjects[0]!.subjectId
      store.transaction((tx) => tx.setSubjectLifecycle({ subjectId: id, status: "DEPRECATED", observedAt: T1 }))

      const result = applyWithdrawal({ store, plan, observedAt: T2 })
      // The guard for a one-spread fix. Echoing `entry` here reports a transition out of `ACTIVE` that
      // never happened; only the store knows which row it actually replaced. Reverting the fix reds
      // exactly this line, which is what makes the fix guarded rather than merely present.
      expect(result.withdrawn.map((e) => `${e.canonicalName} ${e.from}->${e.to}`)).toEqual([
        "io.b/gone DEPRECATED->WITHDRAWN",
      ])
      expect(store.listSubjects()[0]!.lifecycleStatus).toBe("WITHDRAWN")
    } finally {
      store.close()
    }
  })

  it("WITHDRAWAL IS NOT DELETION — the row, its alias and its identity all survive byte-identical", async () => {
    const { store, subjects } = await seed(["io.b/gone"])
    try {
      const before = subjects[0]!
      const aliasesBefore = store.listSubjectAliases()
      const plan = planWithdrawal({
        subjects,
        absentFromSource: ["io.b/gone"],
        observedNativeIds: new Set(),
      })
      applyWithdrawal({ store, plan, observedAt: T1 })

      const after = store.listSubjects()
      expect(after).toHaveLength(1)
      // Everything but the two lifecycle columns must be untouched. Asserted as a whole-object
      // comparison rather than field-by-field, so a column added later is covered without an edit.
      expect({ ...after[0]!, lifecycleStatus: before.lifecycleStatus, withdrawnAt: before.withdrawnAt })
        .toEqual(before)
      expect(store.listSubjectAliases()).toEqual(aliasesBefore)
    } finally {
      store.close()
    }
  })

  it("refuses a transition that is not in the frozen table, and refuses it INSIDE the write", async () => {
    const { store, subjects } = await seed(["io.a/dead"])
    try {
      // Reach the terminal state through LEGAL writes only — `ACTIVE -> WITHDRAWN -> TOMBSTONED` are
      // all in the table — rather than by forging a row with raw SQL. A fixture built by hand could
      // hold a value the writer would have refused, and then the refusal below would be proving
      // something about the fixture. This also exercises the human-authorized path itself.
      const id = subjects[0]!.subjectId
      store.transaction((tx) => tx.setSubjectLifecycle({ subjectId: id, status: "WITHDRAWN", observedAt: T1 }))
      store.transaction((tx) => tx.setSubjectLifecycle({ subjectId: id, status: "TOMBSTONED", observedAt: T1 }))
      expect(store.listSubjects()[0]!.lifecycleStatus).toBe("TOMBSTONED")

      // Now ask the automatic path to resurrect it. `planWithdrawal` filters terminal rows out, so
      // this plan is unreachable in production — which is exactly why the applier needs its own
      // check: the plan is not a trusted input, and a logic defect upstream must not silently re-list
      // a de-listed subject.
      const forged = {
        withdraw: [],
        reinstate: [
          {
            subjectId: id,
            canonicalName: "io.a/dead",
            from: "TOMBSTONED" as AdoptionLifecycleStatus,
            to: "ACTIVE" as AdoptionLifecycleStatus,
          },
        ],
        unmatched: [],
        skippedTerminal: [],
      }
      expect(() => applyWithdrawal({ store, plan: forged, observedAt: T2 })).toThrow(
        /TOMBSTONED -> ACTIVE is not a permitted lifecycle transition \(TOMBSTONED is terminal\)/,
      )
      // Fail-closed, not fail-destructive: the refusal rolls back its own transaction and the row is
      // left exactly as it was, rather than half-applied with no record of which half.
      expect(store.listSubjects()[0]!.lifecycleStatus).toBe("TOMBSTONED")
      expect(store.listSubjects()[0]!.withdrawnAt).toBe(T1)
    } finally {
      store.close()
    }
  })
})

describe("the transition table is the single source of truth", () => {
  it("declares a row for every status, and `isTerminalLifecycle` derives from it", () => {
    // Non-vacuous and self-describing: the set form prints what actually arrived, where `.every()`
    // would red with only "expected false to be true" and would pass on an empty enumeration.
    expect([...ADOPTION_LIFECYCLE_STATUSES].sort()).toEqual(
      Object.keys(SUBJECT_LIFECYCLE_TRANSITIONS).sort(),
    )
    const terminal = ADOPTION_LIFECYCLE_STATUSES.filter((s) => isTerminalLifecycle(s))
    const noSuccessors = ADOPTION_LIFECYCLE_STATUSES.filter(
      (s) => SUBJECT_LIFECYCLE_TRANSITIONS[s].length === 0,
    )
    expect([...terminal].sort()).toEqual([...noSuccessors].sort())
    expect([...terminal]).toEqual(["TOMBSTONED"])
  })

  it("permits WITHDRAWN -> TOMBSTONED in the TABLE, because the automatic path is not the table", () => {
    // This assertion was WRONG in its first form — it asserted no status reaches `TOMBSTONED` at all,
    // and it went red against a shipped, deliberate capability. The table's job is to say which moves
    // are *legal*; `WITHDRAWN -> TOMBSTONED` is legal on purpose, as "an explicit, human-authorized
    // conclusion". What keeps a cohort from tombstoning anything is the WRITER, not the table — so
    // pinning the table shut would have forbidden the human path and measured the wrong module.
    expect(SUBJECT_LIFECYCLE_TRANSITIONS.WITHDRAWN).toContain("TOMBSTONED")
    // The escape hatch a truncated run needs, in the same table.
    expect(SUBJECT_LIFECYCLE_TRANSITIONS.WITHDRAWN).toContain("ACTIVE")
    // …and nothing may leave the terminal state.
    expect(SUBJECT_LIFECYCLE_TRANSITIONS.TOMBSTONED).toEqual([])
  })

  it("the AUTOMATIC path emits WITHDRAWN and ACTIVE only — never TOMBSTONED", () => {
    // The real invariant, measured where it actually lives: over what `planWithdrawal` can EMIT. Every
    // `to` the applier writes comes from a plan entry, and this is the whole output space of the pure
    // planner over an adversarial input — every non-terminal status absent AND observed at once.
    const statuses = ADOPTION_LIFECYCLE_STATUSES.filter((s) => !isTerminalLifecycle(s))
    const subjects = statuses.map(
      (s, i) =>
        ({
          subjectId: `sha256:${i}`,
          canonicalName: `io.x/${s.toLowerCase()}`,
          canonicalSlug: `x-${s.toLowerCase()}`,
          displayName: s,
          identityStatus: "RESOLVED",
          identityDigest: `sha256:d${i}`,
          firstSeenAt: NOW,
          lastSeenAt: NOW,
          lifecycleStatus: s,
          withdrawnAt: null,
        }) satisfies StoredSubject,
    )
    const plan = planWithdrawal({
      subjects,
      absentFromSource: subjects.map((s) => s.canonicalName),
      observedNativeIds: new Set(subjects.map((s) => s.canonicalName)),
    })
    const emitted = [...new Set([...plan.withdraw, ...plan.reinstate].map((e) => e.to))].sort()
    expect(emitted).toEqual(["ACTIVE", "WITHDRAWN"])
    // Non-vacuity: an empty plan would satisfy the line above for the wrong reason.
    expect(plan.withdraw.length + plan.reinstate.length).toBeGreaterThan(0)
  })
})
