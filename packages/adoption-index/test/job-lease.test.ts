/**
 * job-lease — R-6's queue against a REAL driver, because every claim it makes is about STORAGE.
 *
 * `job-state-machine.test.ts` covers the pure layer: the transition tables, the identity
 * derivations, the metric closure, the retry arithmetic. None of those need a database. What is left
 * is the part a fake cannot observe, and it is the part that matters:
 *
 *   - SINGLE OWNERSHIP is a property of one conditional UPDATE. Two workers racing for one row is
 *     only meaningful against a real statement whose `WHERE` and write are atomic together. A fake
 *     that returns "the first PENDING row" hands it to both and never notices.
 *   - IDEMPOTENCE BY IDENTITY is `ON CONFLICT(job_id) DO UPDATE` hitting the primary key. Whether
 *     `created_at` moves under a re-enqueue is a fact about the SQL, not about `compilerJobId`.
 *   - TERMINAL MEANS TERMINAL is `completeJob` reading the STORED state inside the transaction. A
 *     guard that lives in a caller is one the next caller bypasses (the R-4 second-writer lesson),
 *     so the assertion has to go through the store.
 *   - PER-JOB TRANSACTIONS are only visible when one bad row is present: the question is whether the
 *     rows already committed survive. One transaction around the loop discards them
 *     (`fail-DESTRUCTIVE`, the 19_737-subject incident), and no unit test of a pure function sees it.
 *   - EXPIRY IS AGAINST AN INJECTED `now`. With a real driver the alternative — `CURRENT_TIMESTAMP`
 *     — would actually work in the happy case, which is exactly why the test has to pin a `now` in
 *     the past and watch nothing get reclaimed.
 *
 * TIME IS A FIXED LADDER OF LITERALS, never `Date`. The suite reads no clock for the same reason the
 * source cannot: every assertion about expiry is an assertion about string comparison between two
 * stamps the test chose, and a test that derived one from the wall clock would be nondeterministic
 * about the one property it exists to check. ISO-8601 UTC sorts lexicographically, so `T00 < T01`.
 *
 * Negative controls this file is the measurement for:
 *   #70 select-then-update in `leaseJob`      → two owners on one row
 *   #71 drop `available_at <= :now`           → a backed-off job is handed out early
 *   #72 SQLite's clock instead of `now`       → the injected-stamp assertions go green wrongly
 *   #73 strict-greater expiry comparison      → a lease expiring exactly at `now` is never reclaimed
 *   #74 one transaction around the enqueue loop → one bad job discards the whole batch
 *   #75 widen the upsert to `state = excluded.state` → a re-enqueue revives a terminal row
 *   #76 `OR REPLACE` on the idempotent write  → `created_at` is advanced on a stable key
 *   #77 `OR IGNORE` on the idempotent write   → a re-schedule is silently dropped
 *   #78 widen `COMPILER_JOB_TRANSITIONS`      → a `DEAD_LETTER` job resurrects
 *   #79 widen `COMPILER_RUN_TRANSITIONS`      → a concluded run is re-graded
 *   #80 write a misspelled state              → must be refused (the DDL has no CHECK)
 *   #81 remove the write-path assertions      → #80 and #88/#89 stop failing
 *   #82 count attempts on completion          → a crash-looping job never reaches DEAD_LETTER
 *   #86 caller-supplied run state             → a 24/25 run is recorded SUCCEEDED
 *   #87 all-zero digest on a crashed run      → must be refused
 *
 * Every store is opened on a fresh temp directory and closed in `afterEach`, the arrangement
 * `evidence-compilation.test.ts` uses: a suite that shared one database would let an earlier test's
 * queue rows decide a later test's hand-out order.
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  openBetterSqlite3,
  resolveIndexPaths,
  beginCompilerRun,
  concludeCompilerRun,
  emptyRunMetrics,
  enqueueJobs,
  leaseNextJob,
  reclaimExpiredLeases,
  renewLease,
  settleAttempt,
  withCompilerRun,
  DEFAULT_JOB_PRIORITY,
  DEFAULT_MAX_ATTEMPTS,
  MIGRATIONS_DIRNAME,
  type CompilerRunMetrics,
  type JobRequest,
  type StoredCompilerJob,
} from "../src/index.js"

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const MIGRATIONS_DIR = join(PKG_ROOT, MIGRATIONS_DIRNAME)
/**
 * The store's own bytes, for the one guarantee behaviour cannot reach.
 *
 * Every other assertion in this file drives a real driver, which is the stronger form and the reason
 * the file exists. Single-claim atomicity is the exception: better-sqlite3 is synchronous, so this
 * process cannot interleave two workers, and two SEQUENTIAL calls return the right answer even from
 * a select-then-update implementation. Measured — control #70 stayed 41/41 green. So that one
 * property is asserted on the SQL's shape, with a vacuity guard.
 */
const storeSrc = readFileSync(join(PKG_ROOT, "src", "storage", "store.ts"), "utf8")

// The time ladder. Chosen literals, ordered by string comparison, never derived from a clock.
const T0 = "2026-08-04T00:00:00.000Z"
const T1 = "2026-08-04T00:05:00.000Z"
const T2 = "2026-08-04T00:10:00.000Z"
const T3 = "2026-08-04T00:15:00.000Z"
const T9 = "2026-08-04T01:00:00.000Z"

const D1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
const D2 = "sha256:2222222222222222222222222222222222222222222222222222222222222222"
const D3 = "sha256:3333333333333333333333333333333333333333333333333333333333333333"
const MANIFEST = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const OUTPUT = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const ALL_ZERO = `sha256:${"0".repeat(64)}`

const dirs: string[] = []
const stores: AdoptionIndexStore[] = []

afterEach(() => {
  for (const s of stores.splice(0)) s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function openStore(now = T0): Promise<AdoptionIndexStore> {
  const cwd = mkdtempSync(join(tmpdir(), "calllint-r6-"))
  dirs.push(cwd)
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: MIGRATIONS_DIR, db, now })
  stores.push(store)
  return store
}

/** `(delayMs) => stamp`, from a chosen base. The caller's one arithmetic, kept out of `src/`. */
function scheduleFrom(baseMs: number) {
  return (delayMs: number) => new Date(baseMs + delayMs).toISOString()
}

const BASE_MS = Date.parse(T0)

function job(subjectKey: string, inputDigest = D1, priority?: number): JobRequest {
  return { jobType: "compile-evidence", subjectKey, inputDigest, priority }
}

function byKey(store: AdoptionIndexStore, subjectKey: string): StoredCompilerJob {
  const found = store.listCompilerJobs().find((j) => j.subjectKey === subjectKey)
  if (found === undefined) throw new Error(`no queued job for "${subjectKey}"`)
  return found
}

describe("enqueue is idempotent by identity (controls #76, #77)", () => {
  it("inserts once and reports the second pass as an update, not a duplicate", async () => {
    const store = await openStore()
    const first = enqueueJobs({ store, jobs: [job("io.test/a"), job("io.test/b")], now: T0 })
    expect(first).toMatchObject({ queued: 2, updated: 0 })
    expect(store.listCompilerJobs()).toHaveLength(2)

    const second = enqueueJobs({ store, jobs: [job("io.test/a"), job("io.test/b")], now: T1 })
    expect(second).toMatchObject({ queued: 0, updated: 2 })
    // The row count is the assertion the schema's words name: re-enqueueing unchanged inputs
    // "updates the existing row instead of growing the queue".
    expect(store.listCompilerJobs()).toHaveLength(2)
    expect(second.jobIds).toEqual(first.jobIds)
  })

  it("does not advance created_at on a stable identity (control #76)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const before = byKey(store, "io.test/a")
    expect(before.createdAt).toBe(T0)

    enqueueJobs({ store, jobs: [job("io.test/a")], now: T2 })
    const after = byKey(store, "io.test/a")
    // `OR REPLACE` deletes and re-inserts, so `created_at` would become T2 and the row's history
    // would be lost. `ON CONFLICT DO UPDATE` touches only the three columns it names.
    expect(after.createdAt).toBe(T0)
    expect(after.updatedAt).toBe(T2)
    expect(after.jobId).toBe(before.jobId)
  })

  it("applies a re-schedule rather than dropping it (control #77)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a", D1, 100)], now: T0, availableAt: T9 })
    expect(byKey(store, "io.test/a")).toMatchObject({ priority: 100, availableAt: T9 })

    enqueueJobs({ store, jobs: [job("io.test/a", D1, 5)], now: T1, availableAt: T1 })
    // `OR IGNORE` would keep priority 100 and availableAt T9 — the job would stay unleasable and
    // low-priority, and nothing would report that the re-schedule was discarded.
    expect(byKey(store, "io.test/a")).toMatchObject({ priority: 5, availableAt: T1 })
  })

  it("advances availability to the later now when no availableAt is given (control #77)", async () => {
    // FOUND BY THE OFFLINE E2E, and not covered by the case above: that one passes `availableAt`
    // explicitly, so it never exercises the DEFAULT path — and the default is `input.now`
    // (`compilerQueue.ts:95`). A second enqueue at a later stamp therefore pushes availability
    // forward, which means a row leasable a moment ago is not leasable now.
    //
    // That is the ON CONFLICT clause working, not a defect: re-enqueueing is how a caller says "this
    // is due again", and `OR IGNORE` would silently keep the old stamp. It is asserted because it is
    // SURPRISING — the E2E leased at pass 1's stamp, got nothing, and the row count and `created_at`
    // both looked perfect. Only leasing saw it.
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    expect(byKey(store, "io.test/a").availableAt).toBe(T0)

    enqueueJobs({ store, jobs: [job("io.test/a")], now: T1 })
    expect(byKey(store, "io.test/a").availableAt).toBe(T1)
    // And the consequence, stated as behaviour rather than as a column value: the earlier stamp no
    // longer wins a lease, while the new one does.
    expect(leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T2 })).toBeNull()
    expect(leaseNextJob({ store, owner: "w", now: T1, leaseExpiresAt: T2 })).not.toBeNull()
  })

  it("treats a changed inputDigest as a different job", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a", D1)], now: T0 })
    const second = enqueueJobs({ store, jobs: [job("io.test/a", D2)], now: T0 })
    // The identity triple includes the digest, so new inputs are new work rather than a reschedule.
    expect(second).toMatchObject({ queued: 1, updated: 0 })
    expect(store.listCompilerJobs()).toHaveLength(2)
  })

  it("defaults priority to the DDL's value and availableAt to now", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    expect(byKey(store, "io.test/a")).toMatchObject({
      priority: DEFAULT_JOB_PRIORITY,
      availableAt: T0,
      state: "PENDING",
      attemptCount: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorDigest: null,
    })
  })
})

describe("one transaction per job (control #74)", () => {
  it("keeps the jobs already queued when a later one is malformed", async () => {
    const store = await openStore()
    // A malformed digest is refused by the store's assertions — that is the fail-closed boundary and
    // it is meant to throw. What must NOT happen is the loss of the two rows already written.
    expect(() =>
      enqueueJobs({
        store,
        jobs: [job("io.test/a"), job("io.test/b"), { ...job("io.test/c"), inputDigest: "not-a-digest" }],
        now: T0,
      }),
    ).toThrow(/inputDigest must match sha256:/)

    const survivors = store.listCompilerJobs().map((j) => j.subjectKey)
    // With one transaction around the loop, this list is empty: 2 innocent jobs discarded because 1
    // was bad. That is the shape of the 19_737-subject incident, scaled down to where it is visible.
    expect(survivors).toEqual(["io.test/a", "io.test/b"])
  })

  it("keeps them when the malformed job is first, too", async () => {
    const store = await openStore()
    // The mirror case: a throw on the FIRST item must not prevent... nothing, because the loop stops.
    // Asserted so the per-job scope is not mistaken for per-job error RECOVERY — it is isolation of
    // what was already committed, not a skip-and-continue.
    expect(() =>
      enqueueJobs({ store, jobs: [{ ...job("io.test/a"), inputDigest: "bad" }, job("io.test/b")], now: T0 }),
    ).toThrow(/inputDigest must match sha256:/)
    expect(store.listCompilerJobs()).toHaveLength(0)
  })
})

describe("a lease is a single claim with an expiry (controls #70, #71, #72, #73)", () => {
  it("hands one row to exactly one of two racing workers (control #70)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/only")], now: T0 })

    const first = leaseNextJob({ store, owner: "worker-1", now: T0, leaseExpiresAt: T1 })
    const second = leaseNextJob({ store, owner: "worker-2", now: T0, leaseExpiresAt: T1 })

    // Sequential calls, but this IS the race: `leaseJob` is one statement, so interleaving cannot
    // produce an outcome the second call does not already model — the loser sees `changes === 0`.
    expect(first?.subjectKey).toBe("io.test/only")
    expect(first?.leaseOwner).toBe("worker-1")
    expect(second).toBeNull()

    const rows = store.listCompilerJobs()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: "LEASED", leaseOwner: "worker-1", leaseExpiresAt: T1 })
  })

  it("claims the row with ONE conditional UPDATE, asserted on the SQL (control #70)", () => {
    // MEASURED, and the reason this test exists: control #70 replaced the single statement with a
    // real select-then-update — `SELECT … LIMIT 1`, then `UPDATE … WHERE job_id = :pickedId` — and
    // the behavioural test above STAYED GREEN, 41/41. It cannot see the defect, and its own comment
    // says why without noticing: "leaseJob is one statement, so interleaving cannot produce an
    // outcome the second call does not already model". That premise IS the thing under test. Two
    // SEQUENTIAL calls cannot expose it either way, because worker-2's SELECT runs after worker-1's
    // UPDATE has already committed, so the loser sees no candidate and returns null — the correct
    // answer, reached by the wrong mechanism. A concurrent interleaving would expose it, and this
    // driver has no way to produce one: better-sqlite3 is synchronous.
    //
    // So the guarantee is asserted where it lives — in the shape of the SQL. The claim must be one
    // UPDATE whose own WHERE re-tests `state = 'PENDING'`, so a row another worker took between the
    // pick and the write matches zero rows and `changes` is 0.
    //
    // The extraction stops at the SQL template's closing backtick, NOT at `.run(params)`. Measured:
    // anchoring on the call made control #70 fail on "must be readable" — the mutation passes a
    // different argument object — which reads as a broken probe rather than as the named defect. A
    // control has to fail ON ITS OWN CLAIM to be worth anything.
    const claim = /UPDATE compiler_jobs\s+SET state = 'LEASED'[\s\S]*?`/.exec(storeSrc)?.[0]
    expect(claim, "leaseJob's claiming statement must be readable for this assertion to mean anything").toBeDefined()
    // The state test is INSIDE the claiming statement, not in a separate read.
    expect(claim).toContain("WHERE state = 'PENDING' AND available_at <= :now")
    // And the row is chosen by a subquery in that same statement — never by an id read earlier.
    expect(claim).toMatch(/WHERE job_id = \(\s*SELECT job_id FROM compiler_jobs/)
    expect(claim, "a pre-read id is the select-then-update defect").not.toMatch(/:pickedId|:preread/)

    // The vacuity guard: `leaseJob` must hold exactly one statement that writes `state = 'LEASED'`,
    // so the assertions above cannot pass by matching one statement while a second, looser one does
    // the real work.
    const leaseBody = /private leaseJob\([\s\S]*?\n {2}\}/.exec(storeSrc)?.[0]
    expect(leaseBody, "leaseJob's body must be readable").toBeDefined()
    expect(leaseBody!.match(/state = 'LEASED'/g) ?? []).toHaveLength(1)
    // `.get(` anywhere in that body would be a read the claim then trusts.
    expect(leaseBody, "leaseJob must not read a row before claiming it").not.toContain(".get(")
  })

  it("increments attempt_count on hand-out, not on completion (control #82)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    expect(byKey(store, "io.test/a").attemptCount).toBe(0)

    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T1 })
    expect(leased?.attemptCount).toBe(1)
    // The worker never reports back — it crashed. The count must already have advanced, because a
    // counter incremented on completion never advances for a job that dies every time.
    expect(byKey(store, "io.test/a").attemptCount).toBe(1)
  })

  it("refuses to hand out a job whose backoff has not elapsed (control #71)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/later")], now: T0, availableAt: T9 })

    expect(leaseNextJob({ store, owner: "w", now: T1, leaseExpiresAt: T2 })).toBeNull()
    // Eligible once `now` reaches the schedule. `<=`, so the boundary instant is included.
    const at = leaseNextJob({ store, owner: "w", now: T9, leaseExpiresAt: "2026-08-04T02:00:00.000Z" })
    expect(at?.subjectKey).toBe("io.test/later")
  })

  it("orders hand-outs by (priority, available_at, job_id)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/low", D1, 200)], now: T0 })
    enqueueJobs({ store, jobs: [job("io.test/high", D2, 1)], now: T0 })
    enqueueJobs({ store, jobs: [job("io.test/mid", D3, 100)], now: T0 })

    const order: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const claimed = leaseNextJob({ store, owner: `w${i}`, now: T0, leaseExpiresAt: T9 })
      order.push(claimed?.subjectKey ?? "none")
    }
    expect(order).toEqual(["io.test/high", "io.test/mid", "io.test/low"])
  })

  it("restricts a claim to one job type when asked", async () => {
    const store = await openStore()
    enqueueJobs({
      store,
      jobs: [
        { jobType: "ingest-source", subjectKey: "io.test/a", inputDigest: D1, priority: 1 },
        { jobType: "compile-evidence", subjectKey: "io.test/a", inputDigest: D1, priority: 9 },
      ],
      now: T0,
    })
    // The type filter beats priority: the evidence job is priority 9 and still the one claimed.
    const claimed = leaseNextJob({
      store,
      owner: "w",
      now: T0,
      leaseExpiresAt: T9,
      jobType: "compile-evidence",
    })
    expect(claimed?.jobType).toBe("compile-evidence")
  })

  it("refuses a lease that is already expired", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    // An expiry at or before `now` is a claim the next sweep reclaims while its holder still believes
    // it holds the row. Refused at the boundary, not just below it.
    expect(() => leaseNextJob({ store, owner: "w", now: T1, leaseExpiresAt: T1 })).toThrow(/not after now/)
    expect(() => leaseNextJob({ store, owner: "w", now: T1, leaseExpiresAt: T0 })).toThrow(/not after now/)
    expect(() => leaseNextJob({ store, owner: "", now: T0, leaseExpiresAt: T1 })).toThrow(/owner must be named/)
  })

  it("returns null on an empty queue rather than throwing", async () => {
    const store = await openStore()
    expect(leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T1 })).toBeNull()
  })
})

describe("renewal names the owner in its own WHERE", () => {
  it("extends a claim the owner still holds", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T1 })
    const jobId = leased?.jobId ?? ""

    expect(renewLease({ store, jobId, owner: "w", now: T1, leaseExpiresAt: T3 })).toBe(true)
    const row = byKey(store, "io.test/a")
    expect(row.leaseExpiresAt).toBe(T3)
    // A renewal is the SAME attempt continuing. Counting it would let a slow job exhaust its budget
    // without ever failing.
    expect(row.attemptCount).toBe(1)
  })

  it("refuses a renewal from someone else", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const jobId = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T1 })?.jobId ?? ""

    expect(renewLease({ store, jobId, owner: "impostor", now: T1, leaseExpiresAt: T3 })).toBe(false)
    expect(byKey(store, "io.test/a").leaseExpiresAt).toBe(T1)
  })

  it("returns false rather than reviving a row that was reclaimed underneath it", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const jobId = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T1 })?.jobId ?? ""
    expect(reclaimExpiredLeases({ store, now: T2 })).toBe(1)

    // `state = 'LEASED'` is in the renewal's WHERE, so a slow worker cannot re-take a row the sweep
    // released. False, not a throw: losing a lease is the expected outcome of being slow.
    expect(renewLease({ store, jobId, owner: "w", now: T2, leaseExpiresAt: T9 })).toBe(false)
    expect(byKey(store, "io.test/a")).toMatchObject({ state: "PENDING", leaseOwner: null })
  })
})

describe("expiry is measured against the injected now (controls #72, #73)", () => {
  it("reclaims a lease that expired at or before now, and leaves a live one alone", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/dead"), job("io.test/live", D2)], now: T0 })
    leaseNextJob({ store, owner: "w1", now: T0, leaseExpiresAt: T1 })
    leaseNextJob({ store, owner: "w2", now: T0, leaseExpiresAt: T9 })

    // `<=`, so the boundary instant is reclaimed. Control #73 makes it strict-greater and a lease
    // expiring exactly at `now` is then never swept.
    expect(reclaimExpiredLeases({ store, now: T1 })).toBe(1)
    const rows = store.listCompilerJobs()
    const dead = rows.find((r) => r.leaseOwner === null)
    const live = rows.find((r) => r.leaseOwner === "w2")
    expect(dead).toMatchObject({ state: "PENDING", leaseExpiresAt: null })
    expect(live).toMatchObject({ state: "LEASED", leaseExpiresAt: T9 })
  })

  it("reclaims nothing when the injected now is before every expiry (control #72)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })

    // THIS is the assertion `CURRENT_TIMESTAMP` fails. The real wall clock is years past T0, so a
    // store reading its own clock would reclaim the row; a store reading the injected stamp cannot.
    expect(reclaimExpiredLeases({ store, now: T1 })).toBe(0)
    expect(byKey(store, "io.test/a")).toMatchObject({ state: "LEASED", leaseOwner: "w" })
  })

  it("leaves available_at and attempt_count untouched when it reclaims", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0, availableAt: T0 })
    leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T1 })
    reclaimExpiredLeases({ store, now: T2 })

    const row = byKey(store, "io.test/a")
    // The crashed attempt stays counted — that is what stops a crash-looping job from evading
    // DEAD_LETTER — and the schedule is not advanced, because advancing it would be a delay nobody
    // asked for and moving it back would be a clock read.
    expect(row).toMatchObject({ state: "PENDING", attemptCount: 1, availableAt: T0 })
  })

  it("is a no-op sweep when nothing is leased", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    expect(reclaimExpiredLeases({ store, now: T9 })).toBe(0)
  })
})

describe("settling an attempt applies the retry policy (controls #78, #82, #83)", () => {
  it("concludes a success and clears the error columns", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")

    const disposition = settleAttempt({
      store,
      job: leased,
      outcome: "SUCCESS",
      now: T1,
      schedule: scheduleFrom(BASE_MS),
      errorCode: "SHOULD_BE_CLEARED",
      errorDigest: D2,
    })
    expect(disposition).toBe("SUCCEEDED")
    // A row that succeeded carries no error: a stale code would make a healthy job read as one that
    // failed and was somehow fixed.
    expect(byKey(store, "io.test/a")).toMatchObject({
      state: "SUCCEEDED",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorDigest: null,
    })
  })

  it("releases a retryable failure with a computed backoff", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")

    const disposition = settleAttempt({
      store,
      job: leased,
      outcome: "RETRYABLE",
      now: T1,
      schedule: scheduleFrom(BASE_MS),
      errorCode: "UPSTREAM_503",
      errorDigest: D3,
    })
    expect(disposition).toBe("RETRY_SCHEDULED")
    const row = byKey(store, "io.test/a")
    // First retry: 30 s after the base the caller supplied. The store never computed this stamp.
    expect(row).toMatchObject({
      state: "PENDING",
      availableAt: "2026-08-04T00:00:30.000Z",
      lastErrorCode: "UPSTREAM_503",
      lastErrorDigest: D3,
      attemptCount: 1,
    })
  })

  it("concludes a permanent failure without consuming the budget", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")

    expect(
      settleAttempt({
        store,
        job: leased,
        outcome: "PERMANENT",
        now: T1,
        schedule: scheduleFrom(BASE_MS),
        errorCode: "MALFORMED_INPUT",
      }),
    ).toBe("FAILED")
    // FAILED at attempt 1 of 5: a refusal to retry, not an exhaustion. The distinction is legible
    // from the state alone, without parsing `lastErrorCode`.
    expect(byKey(store, "io.test/a")).toMatchObject({ state: "FAILED", attemptCount: 1 })
  })

  it("reaches DEAD_LETTER on the last permitted attempt, not one later (control #83)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })

    const handOuts: number[] = []
    let disposition = ""
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS + 2; i += 1) {
      const leased = leaseNextJob({ store, owner: `w${i}`, now: T9, leaseExpiresAt: "2026-08-05T00:00:00.000Z" })
      if (leased === null) break
      handOuts.push(leased.attemptCount)
      disposition = settleAttempt({
        store,
        job: leased,
        outcome: "RETRYABLE",
        now: T9,
        // Every retry is scheduled in the past relative to the lease `now`, so the loop can keep
        // claiming: the test is about the attempt CEILING, not about waiting out a backoff.
        schedule: () => T0,
      })
    }

    // Exactly five hand-outs, the fifth of which is terminal. With `>` instead of `>=` there are six.
    expect(handOuts).toEqual([1, 2, 3, 4, 5])
    expect(disposition).toBe("DEAD_LETTER")
    expect(byKey(store, "io.test/a")).toMatchObject({ state: "DEAD_LETTER", attemptCount: 5 })
  })

  it("honours a per-stage maxAttempts", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")

    // One attempt allowed, and it was just used: the first retryable failure is already exhaustion.
    expect(
      settleAttempt({ store, job: leased, outcome: "RETRYABLE", now: T1, schedule: () => T0, maxAttempts: 1 }),
    ).toBe("DEAD_LETTER")
  })

  it("refuses a nonsense retry budget", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")
    const base = { store, job: leased, outcome: "RETRYABLE" as const, now: T1, schedule: () => T0 }
    expect(() => settleAttempt({ ...base, maxAttempts: 0 })).toThrow(/maxAttempts must be a positive integer/)
    expect(() => settleAttempt({ ...base, maxAttempts: 2.5 })).toThrow(/maxAttempts must be a positive integer/)
    expect(() => settleAttempt({ ...base, backoffMs: -1 })).toThrow(/backoffMs must be a non-negative integer/)
  })

  it("refuses to move a terminal row, through the store (control #78)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")
    settleAttempt({ store, job: leased, outcome: "PERMANENT", now: T1, schedule: () => T0 })

    // The stale handle still says LEASED. The refusal comes from the STORED state, read inside the
    // transaction — which is what makes terminality a property of the store rather than of a
    // caller's control flow. A guard in one caller is one the next caller bypasses.
    expect(() => settleAttempt({ store, job: leased, outcome: "SUCCESS", now: T2, schedule: () => T0 })).toThrow(
      /FAILED -> SUCCEEDED/,
    )
    expect(byKey(store, "io.test/a").state).toBe("FAILED")
  })

  it("refuses a release to PENDING with no schedule", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")
    // Reached through the store directly, because `settleAttempt` cannot express it: `schedule` is
    // required, so the omission is unrepresentable at the operations layer. The store still refuses.
    expect(() =>
      store.transaction((tx) => tx.completeJob({ jobId: leased.jobId, state: "PENDING", now: T1 })),
    ).toThrow(/requires an availableAt/)
  })

  it("keeps a terminal row terminal across a re-enqueue (control #75)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")
    settleAttempt({ store, job: leased, outcome: "PERMANENT", now: T1, schedule: () => T0 })

    // The upsert names three columns and `state` is not among them, so a re-enqueue of a terminal
    // identity is a schedule update on a row that will never be leased again. Widen it to
    // `state = excluded.state` and this row silently returns to PENDING, bypassing the table.
    const again = enqueueJobs({ store, jobs: [job("io.test/a")], now: T2 })
    expect(again).toMatchObject({ queued: 0, updated: 1 })
    expect(byKey(store, "io.test/a")).toMatchObject({ state: "FAILED", updatedAt: T2 })
    expect(leaseNextJob({ store, owner: "w2", now: T9, leaseExpiresAt: "2026-08-05T00:00:00.000Z" })).toBeNull()
  })

  it("refuses a misspelled state on the write path (controls #80, #81)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")

    // `state TEXT NOT NULL` with no CHECK: SQLite accepts any string, and TypeScript is erased at
    // runtime. So the closure has to be asserted by the store, and a cast is how a real caller with
    // a typo arrives here.
    //
    // WHICH MESSAGE, and this is the whole point of the assertion rather than a detail: control #81
    // removed `assertJobState(completion.state, …)` and this test STAYED GREEN, 83/83. The throw
    // still happened — from `assertJobTransition`, whose message reads `LEASED -> SUCEEDED is not a
    // permitted transition` and therefore contains the misspelling. A `/SUCEEDED/` matcher accepts
    // it, so the test was passing on the transition table's shape while the enum-closure guard it
    // names was gone. That is only true by luck: a misspelling of a state the table DOES admit from
    // `LEASED` (say `PENDIGN` for a release) would reach the column with no complaint at all.
    let thrown: unknown
    try {
      store.transaction((tx) => tx.completeJob({ jobId: leased.jobId, state: "SUCEEDED" as never, now: T1 }))
    } catch (err) {
      thrown = err
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown)
    expect(thrown, "a misspelled state must be refused, not written").toBeInstanceOf(Error)
    // The ENUM guard's message, naming the closed set. Not the transition table's.
    expect(message).toMatch(/state must be one of \[/)
    expect(message).toContain("SUCEEDED")
    expect(message, "the transition table is a different guard and cannot stand in for this one").not.toContain(
      "is not a permitted transition",
    )
    expect(byKey(store, "io.test/a").state).toBe("LEASED")
  })

  it("refuses a misspelling the transition table WOULD admit (control #81)", async () => {
    const store = await openStore()
    enqueueJobs({ store, jobs: [job("io.test/a")], now: T0 })
    const leased = leaseNextJob({ store, owner: "w", now: T0, leaseExpiresAt: T9 })
    if (leased === null) throw new Error("expected a leased job")

    // The case the test above cannot make, and the reason enum closure is a SEPARATE guard: `LEASED
    // -> PENDING` is permitted, so a typo in `PENDING` is invisible to the transition table. Without
    // `assertJobState` on the incoming value, `COMPILER_JOB_TRANSITIONS["LEASED"].includes("PENDIGN")`
    // is merely false and the failure — if any — names the wrong rule. With it, the closed set is.
    expect(() =>
      store.transaction((tx) =>
        tx.completeJob({ jobId: leased.jobId, state: "PENDIGN" as never, now: T1, availableAt: T2 }),
      ),
    ).toThrow(/state must be one of \[.*\], found "PENDIGN"/)
    expect(byKey(store, "io.test/a").state).toBe("LEASED")
  })

  it("refuses a half-set lease through the store (controls #88, #89)", async () => {
    const store = await openStore()
    // The operations layer cannot express a half-set lease either; the store is where the rule lives,
    // and `completeJob` re-checks it against the state being written.
    expect(() =>
      store.transaction((tx) =>
        tx.leaseJob({ owner: "w", now: T1, leaseExpiresAt: T0 }),
      ),
    ).toThrow(/not after now/)
  })
})

describe("a run is bracketed and graded from its own counters (controls #79, #86, #87)", () => {
  const metrics = (over: Partial<CompilerRunMetrics> = {}): CompilerRunMetrics => ({
    ...emptyRunMetrics(),
    ...over,
  })

  it("opens RUNNING with null output and six zeros", async () => {
    const store = await openStore()
    const runId = beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    const rows = store.listCompilerRuns()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      runId,
      runType: "full",
      state: "RUNNING",
      outputManifestDigest: null,
      completedAt: null,
      metrics: emptyRunMetrics(),
    })
  })

  it("grades a clean pass SUCCEEDED and a partial one PARTIAL (control #86)", async () => {
    const store = await openStore()
    const clean = beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    concludeCompilerRun({
      store,
      runId: clean,
      outputManifestDigest: OUTPUT,
      completedAt: T1,
      metrics: metrics({ subjectsCompiled: 25 }),
    })

    const partial = beginCompilerRun({ store, runType: "incremental", inputManifestDigest: MANIFEST, startedAt: T2 })
    concludeCompilerRun({
      store,
      runId: partial,
      outputManifestDigest: OUTPUT,
      completedAt: T3,
      metrics: metrics({ subjectsCompiled: 24, failures: 1 }),
    })

    const byId = new Map(store.listCompilerRuns().map((r) => [r.runId, r]))
    // 24 of 25 is not a success. The state is not a parameter, so a caller cannot record it as one.
    expect(byId.get(clean)?.state).toBe("SUCCEEDED")
    expect(byId.get(partial)?.state).toBe("PARTIAL")
    expect(byId.get(partial)?.metrics.failures).toBe(1)
  })

  it("records a crashed run FAILED with a null manifest, and re-throws (control #87)", async () => {
    const store = await openStore()
    const boom = new Error("compiler crashed mid-pass")
    let counted = 0

    expect(() =>
      withCompilerRun(
        {
          store,
          runType: "full",
          inputManifestDigest: MANIFEST,
          startedAt: T0,
          completedAt: T1,
          metricsOf: () => {
            counted += 1
            // Called INSIDE the catch, after the throw: a snapshot taken before the body would
            // report zeros for work that actually happened.
            return metrics({ sourceRecordsRead: 7, failures: 1 })
          },
        },
        () => {
          throw boom
        },
      ),
    ).toThrow(boom)

    expect(counted).toBe(1)
    const row = store.listCompilerRuns()[0]
    expect(row).toMatchObject({ state: "FAILED", outputManifestDigest: null, completedAt: T1 })
    expect(row?.metrics.sourceRecordsRead).toBe(7)
  })

  it("refuses an all-zero digest as a stand-in for no output (control #87)", async () => {
    const store = await openStore()
    const runId = beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    // `sha256:000…0` is a WELL-FORMED digest, so shape validation cannot refuse it. The refusal is
    // that a FAILED run has no output at all — reached through the store, because `gradeRun` would
    // grade a non-null digest as SUCCEEDED and never produce this pairing.
    expect(() =>
      store.transaction((tx) =>
        tx.concludeCompilerRun({
          runId,
          state: "FAILED",
          outputManifestDigest: ALL_ZERO,
          completedAt: T1,
          metrics: metrics({ failures: 1 }),
        }),
      ),
    ).toThrow(/produced no output, so outputManifestDigest must be null/)
    expect(store.listCompilerRuns()[0]?.state).toBe("RUNNING")
  })

  it("does NOT record a rejected async body — the bracket is synchronous (S1-OPEN-5, control #R6)", async () => {
    // A FAILING-BY-DESIGN CHARACTERISATION of a real defect, asserted as the WRONG behaviour it
    // currently has. Read the expectations below as "this is what it does today", not "this is what
    // it should do".
    //
    // `withCompilerRun` is typed `body: (runId: string) => T` and brackets it in a SYNCHRONOUS
    // `try/catch` (`compilerQueue.ts:438`). When `T` is a promise, the `try` block completes the
    // instant the promise is CONSTRUCTED — the rejection surfaces a tick later, after the `catch` has
    // gone out of scope. So the handler never runs, no FAILED row is written, and the run sits in
    // `RUNNING` forever. `jobStates.ts` gives `RUNNING` no self-edge, so nothing can conclude it
    // afterwards either: the row is unreachable for the rest of the database's life.
    //
    // That is verbatim the state the function's own docblock says it exists to prevent ("a pass that
    // crashes mid-way leaves a row stuck in RUNNING forever"). It holds for the synchronous case it
    // was written for and silently inverts for the async one.
    //
    // WHY NOTHING CAUGHT IT: both existing call sites in this file (:759, :860) drive it with a
    // synchronous body, and `refreshSnapshot.ts` — the only production caller-shaped code, whose
    // `refreshFromMirror` is `async` — open-codes the bracket instead of using this one, precisely
    // because of this defect. So the async path had no test and no user. A guard that cannot observe
    // its subject is this repo's dominant fault class (`memory/maps/guards.md`); this is the variant
    // where the subject exists but no caller ever reaches it.
    //
    // NOT FIXED HERE, deliberately: making the bracket generic over `T | Promise<T>` changes a shipped
    // R-6 signature, which needs its own batch. This test is what makes the defect cost something —
    // it fails loudly the moment someone fixes it, and the fix is to invert these assertions.
    //
    // Verified to do that (control #R6): teaching the bracket to recognise a thenable and attach a
    // `.catch` reds this test at the `metricsRead` assertion — "expected 1 to be +0" — so the fixer
    // is told exactly which claim went stale rather than being left to guess.
    const store = await openStore()
    const boom = new Error("async compiler crashed mid-pass")
    let metricsRead = 0

    // The rejection escapes the bracket unhandled, so it is awaited here rather than at the call.
    const returned = withCompilerRun(
      {
        store,
        runType: "full",
        inputManifestDigest: MANIFEST,
        startedAt: T0,
        completedAt: T1,
        metricsOf: () => {
          metricsRead += 1
          return metrics({ sourceRecordsRead: 7, failures: 1 })
        },
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => {
        throw boom
      },
    )

    // The promise still rejects — the error is not swallowed, it simply arrives unbracketed.
    await expect(returned).rejects.toBe(boom)

    // THE DEFECT, in two observations. `metricsOf` is never called, because the `catch` never ran...
    expect(metricsRead, "today the crash handler does not run for an async body").toBe(0)
    // ...and the row is stranded in RUNNING with no completedAt, which is the state the bracket
    // exists to make impossible.
    expect(store.listCompilerRuns()).toHaveLength(1)
    expect(store.listCompilerRuns()[0]).toMatchObject({ state: "RUNNING", completedAt: null })
  })

  it("refuses a concluded run with no manifest", async () => {
    const store = await openStore()
    const runId = beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    expect(() =>
      store.transaction((tx) =>
        tx.concludeCompilerRun({
          runId,
          state: "SUCCEEDED",
          outputManifestDigest: null,
          completedAt: T1,
          metrics: emptyRunMetrics(),
        }),
      ),
    ).toThrow(/must carry an outputManifestDigest/)
  })

  it("refuses to re-grade a concluded run (control #79)", async () => {
    const store = await openStore()
    const runId = beginCompilerRun({ store, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    concludeCompilerRun({
      store,
      runId,
      outputManifestDigest: OUTPUT,
      completedAt: T1,
      metrics: metrics({ subjectsCompiled: 24, failures: 1 }),
    })
    // The run record IS the reproducibility record: "two runs over the same input manifest produce
    // the same output manifest" is only checkable if a stored output cannot be rewritten after
    // the fact.
    expect(() =>
      concludeCompilerRun({
        store,
        runId,
        outputManifestDigest: OUTPUT,
        completedAt: T2,
        metrics: metrics({ subjectsCompiled: 25 }),
      }),
    ).toThrow(/PARTIAL -> SUCCEEDED/)
    expect(store.listCompilerRuns()[0]).toMatchObject({ state: "PARTIAL", completedAt: T1 })
  })

  it("keeps two passes over an unchanged manifest as two rows", async () => {
    const store = await openStore()
    const first = beginCompilerRun({ store, runType: "reconcile", inputManifestDigest: MANIFEST, startedAt: T0 })
    const second = beginCompilerRun({ store, runType: "reconcile", inputManifestDigest: MANIFEST, startedAt: T2 })
    // A run is an EVENT. Keying on the manifest alone would make the second replace the first and
    // destroy the history the table exists to keep.
    expect(first).not.toBe(second)
    expect(store.listCompilerRuns()).toHaveLength(2)
    // Newest start first, per `listCompilerRuns`' ORDER BY.
    expect(store.listCompilerRuns().map((r) => r.startedAt)).toEqual([T2, T0])
  })

  it("does not conclude the run on the success path", async () => {
    const store = await openStore()
    const runId = withCompilerRun(
      {
        store,
        runType: "dry-run",
        inputManifestDigest: MANIFEST,
        startedAt: T0,
        completedAt: T1,
        metricsOf: () => emptyRunMetrics(),
      },
      (id) => id,
    )
    // The bracket guarantees a crash is recorded; only the BODY knows what it produced, so a bracket
    // that concluded on success would be inventing the digest a later replay compares against.
    expect(store.listCompilerRuns()[0]).toMatchObject({ runId, state: "RUNNING", completedAt: null })
  })
})

describe("the queue survives a reopen", () => {
  it("reads back every column after the store is closed and reopened", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "calllint-r6-reopen-"))
    dirs.push(cwd)
    const paths = resolveIndexPaths(cwd)
    for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })

    const first = AdoptionIndexStore.open({
      cwd,
      migrationsDir: MIGRATIONS_DIR,
      db: await openBetterSqlite3(paths.db),
      now: T0,
    })
    enqueueJobs({ store: first, jobs: [job("io.test/a", D1, 7)], now: T0, availableAt: T9 })
    const runId = beginCompilerRun({ store: first, runType: "full", inputManifestDigest: MANIFEST, startedAt: T0 })
    concludeCompilerRun({
      store: first,
      runId,
      outputManifestDigest: OUTPUT,
      completedAt: T1,
      metrics: { ...emptyRunMetrics(), sourceRecordsRead: 3, recordsEmitted: 2 },
    })
    first.close()

    const second = AdoptionIndexStore.open({
      cwd,
      migrationsDir: MIGRATIONS_DIR,
      db: await openBetterSqlite3(paths.db),
      now: T2,
    })
    stores.push(second)
    // Both readers validate on the way OUT — the TEXT columns have no CHECK, so a row written by
    // some future path that skipped the assertions must fail here rather than be handed back as a
    // union member the type system believes in.
    expect(second.listCompilerJobs()[0]).toMatchObject({
      subjectKey: "io.test/a",
      priority: 7,
      availableAt: T9,
      state: "PENDING",
      createdAt: T0,
    })
    expect(second.listCompilerRuns()[0]).toMatchObject({
      state: "SUCCEEDED",
      outputManifestDigest: OUTPUT,
      metrics: { ...emptyRunMetrics(), sourceRecordsRead: 3, recordsEmitted: 2 },
    })
  })
})
