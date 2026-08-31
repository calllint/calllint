# Gate S1 — carried open items, in committed bytes

Gate S1 is `scripts/gate-s1.ts`, wired as `gate:s1` (report), `gate:s1:gate` (enforcing) and
`gate:s1:regression` (the mode `ci:local` and `ci.yml` run). It grades the **100-record scale
slice** on the expansion ladder `S0(25) → S1(100) → S2(500) → S3(all) → S4(second source)`,
which gates registry expansion, which gates Phase 3+.

**This file exists because the gate did not, and the cohort crossed it anyway.** The seven
measures S1 is supposed to take are specified at `docs/new15-execution-status.md:342` — a file
that is **gitignored** (`.gitignore:44`). So S1's entire definition and status lived on one
machine. There was no script, no npm script, no CI step, and no test. Meanwhile the cohort went
**19 → 100 → 150** under ADR 0086's auto-growth and passed S1's 100-record threshold with
nothing on the other side of it. Nothing red, because there was no guard to red.

That is one rung past this repo's usual defect. `memory/maps/guards.md` records the dominant
fault class as *a guard that cannot observe its subject*; S1 was **a threshold with no guard at
all** — the limit case, and the harder one to notice, because a missing guard has no green to
inspect. Gate S0's own artifact hit the same shape from the other side (its status lived only in
`docs/gate-s0-next.md`, also gitignored, and the reason recorded there was false). This file is
the S1-side answer, in tracked bytes.

**The proof the crossing really happened**, rather than being inferred from the plan: Gate S0's
`S0_REGRESSION_FLOOR` reads **150**, raised by ADR 0083 to follow the cohort. A ratchet advanced
with the growth while the gate meant to grade that growth was absent.

---

## First measurement — 2026-08-28, at `fce13d9`

`pnpm gate:s1` on `main`. Three measures MEASURED and green; four REFUSED.

| measure (new15 §342 order) | tier | result |
|---|---|---|
| source completeness | MEASURED | ✓ 150/150 source records reached the served tree |
| artifact resolution rate | MEASURED | ✓ 149/150 resolvable; the 1 unresolvable is exactly the 1 the index marks `incomplete` |
| page quality | MEASURED | ✓ 149/149 baked subjects carry html+json+manifest and agree with the index on both digests |
| adapter failure rate | REFUSED | ✗ 0 attempts recorded |
| mean/p95 processing time | REFUSED | ✗ no job has a recorded start/finish |
| CAS dedup rate | REFUSED | ✗ 45 blobs exist, `cas/manifests` = 0 — no denominator (corrected 2026-08-28; first stated as `cas/blobs` = 0) |
| disk growth | REFUSED | ✗ no baseline; needs two measurements over time |

Cohort census: source **150 / 100 required** (met); served **150 registry pages / 150
committed** (held).

### Why four measures are REFUSED and not computed

> **CORRECTED 2026-08-28 — the refusals were right and this paragraph's reason was false.** See
> S1-OPEN-4 below for the measurement and the three defects it exposed. The struck text is the
> original claim, kept because a silently corrected paragraph teaches nobody which assumption failed.

~~`.var/calllint-adoption-index/` is empty: all ten data tables hold **0 rows**
(`adoption_records`, `artifact_versions`, `canonical_subjects`, `compiler_jobs`,
`compiler_runs`, `evidence_records`, `identity_conflicts`, `source_checkpoints`,
`source_records`, `subject_aliases`; only `schema_migrations` has rows), and `cas/blobs`,
`cas/manifests`, `cas/expanded`, `dead-letter/`, `reports/` are empty directories. The rolling
compiler has never run against this checkout.~~

**What is actually true.** `.var/` lands wherever `cwd` points, and the ingest worker's `cwd` is
*not* the repo root — `pnpm --filter @calllint/trust-index …` makes it the **package** directory.
So two stores exist, and the one the gate read is the empty one:

| | `.var/…` (repo root, what the gate read) | `packages/trust-index/.var/…` (what the worker writes) |
|---|---|---|
| `db/adoption-index.sqlite` | 131072 B | **2551808 B** |
| `canonical_subjects` | 0 | **298** |
| `source_records` | 0 | **1200** |
| `subject_aliases` | 0 | **839** |
| `artifact_versions` | 0 | **78** (FETCHED 45 / RESOLVED 25 / UNAVAILABLE 8) |
| `source_checkpoints` | 0 | **1** (`status: RUNNING`) |
| `cas/blobs` | 0 | **45** (mtimes 2026-08-04 — three weeks before this gate existed) |
| `compiler_jobs` / `compiler_runs` | 0 | **0** ← the only two that were genuinely empty |
| `schema_migrations` | 2 | 3 |

The four measures remain `✗ REFUSED`, and the load-bearing reason is unchanged — **a rate over an
empty denominator renders as a perfect score.** That is not hypothetical. It is verbatim the defect
Gate S0's own first INV-R4 shipped: it read a nonexistent sidecar path, `existsSync` returned false
on all 39 iterations, the loop `continue`d every time, and it printed *"0 dangerous false-SAFE"* as
PASS from **zero observations**. A `0/0` here would have printed a flawless S1.

What changed is *which* emptiness justifies each refusal. `compiler_jobs` / `compiler_runs` are
empty in **every** candidate store, and not by accident: `enqueueJobs` / `beginCompilerRun` /
`withCompilerRun` (`packages/adoption-index/src/operations/compilerQueue.ts:94,343,438`) have **no
non-test caller** anywhere in `packages/*/src`, `apps/*/src`, `scripts/`, or `.github/workflows/`.
The queue is a library with no driver, so the two job-shaped measures cannot acquire a source by
running the worker that exists.

CAS dedup is refused for a **different** reason than first stated, and the corrected one is sharper:
45 blobs exist, `cas/manifests` holds 0, and the rate is blobs ÷ manifest references. Reporting
`45/0` as 100% would be the same empty-denominator defect **with a non-zero numerator** — the harder
version to spot, because the numerator looks like evidence.

REFUSED is a first-class outcome in the script's type, not a boolean with a comment:

```ts
type Outcome =
  | { readonly kind: "measured"; readonly ok: boolean; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }
```

A refusal can therefore never be summed into a pass rate, because it has no `ok` field to read.

### What each MEASURED assertion actually asserts

Stated because two of the three are weaker than their names suggest, and the difference matters:

- **source-completeness** is a true completeness claim: every entry in
  `packages/trust-index/snapshots/official-mcp-registry.json` must appear in
  `apps/web/public/trust/index.json` under `registryCanonicalName(e.name)`. The shipped function
  is **imported, not re-derived** — Workstream R measured raw-name joins at 0/19 and slug joins
  at 19/19, so a local copy of the slug rule is how this measure would silently mis-join.
- **artifact-resolution** asserts **agreement between two independent readings**, not a
  threshold. `synthesizeConfigText(e) === null` must select exactly the set the index marks
  non-`baked`. It deliberately does *not* require a resolution *rate*: an upstream entry
  declaring neither a package nor a remote is a fact about upstream, not a defect here. It
  reports `unresolvable-but-baked` and `incomplete-but-resolvable` separately so a disagreement
  names its direction.
- **page-quality** is completeness-and-self-agreement: every baked subject has `.html` + `.json`
  + `.manifest.json`, and the sidecar's `artifactDigest` / `pageDigest` agree with the index's.
  It is **not** a rendering judgement, because a rendering score would need a threshold nobody
  has set, and inventing one here would make S1 an authority on page quality by accident.

### Verified behaviourally, and with negative controls

The gate was run in every mode rather than read:

| invocation | exit | outcome |
|---|---|---|
| `pnpm gate:s1` | 0 | 3 MEASURED ✓ / 4 REFUSED ✗ |
| `pnpm gate:s1:gate` | 2 | refuses on the four absent data sources, by design |
| `pnpm gate:s1:regression` | 0 | enforces the three MEASURED plus the served-vs-committed floor |
| `pnpm gate:s1 --gate --regression` | 2 | mutual exclusion is REFUSED, not resolved by precedence |

Three negative controls, each mutating `apps/web/public/trust/index.json` and each tripping
exactly the intended assertion and no other:

- **NC1** — drop one served entry → red **source-completeness** *and* the served floor. Two
  independent observers catch it, which is the only reason the floor is worth having next to a
  completeness check.
- **NC2** — flip one entry's status to `incomplete` → red **artifact-resolution** only, reported
  as `incomplete-but-resolvable` (the correct direction).
- **NC3** — corrupt one `pageDigest` → red **page-quality** only.

The index was restored after each and byte-identity confirmed with an empty `git status
--porcelain`.

### `--regression`, not `--gate`, in CI — and the reason is measured

`ci:local` and `ci.yml`'s `test` job run `gate:s1:regression`. `--gate` is deliberately excluded:
four of its seven measures still refuse in this checkout, so it exits **2** by design. Wiring it
would pin the required check red for a reason no PR under review can clear — verbatim the hazard that
kept `gate:s0:gate` out of CI, and the mirror image of the reason report mode was refused there (a
step with no failing mode). The two enforcing modes are separated rather than blended, because a
single mode covering both would have had to soften one.

Note the count is **four refusals over three missing sources**, and the gap is deliberate rather than
sloppy: `adapter-failure-rate` has a source and still refuses, because no ingest has run against this
checkout since the writer landed. "Has a source" and "has a measurement" are different states, and
collapsing them is how a gate comes to report a number it never took.

Report mode exits **0 unconditionally, by design**: a report mode that could fail would be a
third enforcing mode by accident.

### The record has a machine reader, and it was proven able to red

Everything above is a claim in prose, and prose does not fail. `tests/invariants/gate-s1-claims.invariants.test.ts`
is the reader — **30 `it` blocks, three layers**, modelled on the Gate S0 suite because the failure
modes are the same ones:

1. **POINTER TRUTH** — every `path:line` this file cites must resolve to a line *containing* what it
   claims. Content-anchored, not existence-anchored: an existence check is satisfied by a blank line
   (M26-3's pointer at `:61` was blank), and the S0 suite's pointers have drifted **ten** times, five
   of those onto docblock prose — a line that existed.
2. **DERIVED-NOT-RESTATED** — every number here is recomputed from the file it describes. The census
   (`150 / 100 required`, `150 registry pages`) is re-joined from
   `packages/trust-index/snapshots/official-mcp-registry.json` against
   `apps/web/public/trust/index.json`, and `S1_REQUIRED_RECORDS` is read out of the gate rather than
   copied into this sentence.
3. **ROW STATUS + THE REFUSAL** — each row's `**Status:**` is asserted verbatim, each row must carry a
   `**Falsification:**` line, and the load-bearing claim is asserted **against the gate's source, not
   against this file's description of it**: each of the four measures must appear in a `refused(...)`
   call and must *not* appear in a `measured(...)` one.

Two assertions are worth naming because they guard the specific ways this kind of suite goes hollow:

- **`--gate` exclusion is asserted before presence.** With presence first, swapping
  `gate:s1:regression` for `gate:s1:gate` reds as a *missing step* and never names the hazard (that
  `--gate` refuses four measures by design, so wiring it pins the required check red).
- **`ci.yml` is PARSED, not string-matched.** An unquoted `: ` inside a step name makes the whole
  workflow unparseable, the `test` job never starts, and the required check is **absent** rather than
  red — a state every text assertion passes on. That is a measured failure from the S0 batch, not a
  hypothetical.

**Four negative controls, each mutating one file and each tripping exactly one assertion:**

| # | mutation | red assertion |
|---|---|---|
| NC1 | `refused("cas-dedup-rate", …)` → `measured("cas-dedup-rate", true, …)` | the refusal layer — *the defect this suite exists for* |
| NC2 | `ci.yml`'s step → `pnpm gate:s1:gate` | the parsed-wiring assertion |
| NC3 | S1-OPEN-2's `**Status:** **OPEN.**` → `**CLOSED.**` | the row-status layer |
| NC4 | one blank line prepended to `scripts/gate-s1.ts` | the pointer layer, naming what it found (`" */"`) |

Each mutation was reverted and byte-identity confirmed with `cmp` against a pre-mutation copy — not
with `git status`, which cannot see a change that happens to restore the same size.

**One defect this suite found in itself, recorded because the lesson is not the typo.** The census
assertion first reported **all 150** records missing from the served tree — the reverse of the
failure it was written to catch, and it accused the gate's subject of being broken. Cause:
`registryCanonicalName` *returns* the namespaced form (`mcp-registry/slug`), and the test prefixed
the namespace a second time, joining on `mcp-registry/mcp-registry/…`. Importing the shipped function
is therefore **necessary but not sufficient** — mis-composing it produces the same 0/N join
Workstream R measured for raw names. The tell was the shape of the failure: a join that misses
*everything* is a broken join, not a broken cohort.

---

## S1-OPEN-1 — three of seven measures have no data source, so S1 cannot be CLAIMED passed

**Status:** **OPEN (narrowed from four measures to three, 2026-08-31).**

Three green measures are not Gate S1. The refused ones are precisely the *scale* measures —
throughput, dedup efficiency, disk growth — so what is currently proven is that the served tree is
**complete and self-consistent at 150 records**, not that the pipeline *performs* at 150. Those are
different claims and S1 asks the second one.

**NARROWED 2026-08-31, and the narrowing is the part to check rather than accept.** This row said
"four", and said all four were blocked by the same thing: no queue driver. Both halves were wrong.
`adapter-failure-rate` acquired a real source — `refreshSnapshot.ts` now brackets every ingest in
`beginCompilerRun`/`concludeCompilerRun` and writes `reports/run-<id>.json`, which the gate reads —
and the other three are each blocked by something *different*, which the single shared remedy hid.
Splitting them is what makes each remaining blocker actionable:

| measure | blocker | what would actually unblock it |
| --- | --- | --- |
| `adapter-failure-rate` | ~~no source~~ **RESOLVED** | a run report exists and is read; MEASURED once an ingest runs against the checkout |
| `processing-time-mean-p95` | **SCHEMA** | `compiler_jobs` has `created_at`/`updated_at`/`available_at` and no `started_at`/`finished_at` (`migrations/001-canonical-adoption-graph.sql`), so no duration is recorded anywhere. Adding the columns breaks the 14-column ↔ 14-property equality `domain/job.ts:13` documents → needs a migration **and an ADR**. Running the compiler cannot unblock this. |
| `cas-dedup-rate` | **MISSING WRITER** | `cas/manifests` is declared in `INDEX_SUBDIRS` but has no writer and not even a `casManifestsRoot()` helper, unlike `casBlobsRoot()`/`casWorkRoot()`. No run, past or future, can produce the denominator. |
| `disk-growth` | **TIME** | two measurements separated by real runs. A baseline is recorded (below); the second one cannot be willed into existence. |

**Why the collapsed version was a defect and not just imprecision:** it named *one* remedy — "write
a queue driver" — for four blockers, three of which a queue driver does not touch. A reader who
built the driver would have found three measures still refusing and no statement of why. That is a
refusal whose remedy is unreachable, which is worse than one that says "not yet": it sends the next
reader to do work that will report success while changing nothing the gate can see. The same shape
as the defect this artifact exists to record, aimed at an instruction instead of a measurement.

(This is the second time this row's remedy was struck for that reason. The first: ~~a real R-9
controller/worker run against this checkout~~ — struck 2026-08-28, because the R-9 worker unit runs
three steps (`ingest:trust-index` → `project-adoption-index:trust-index` → `prune:cas`) and not one
of them touched the queue. Left struck rather than deleted, per this artifact's own rule.)

**What must NOT close this row:** computing any remaining measure from an empty store. A `0/0` dedup
rate, a `0` failure rate over zero attempts, or a `0ms` mean over an empty set would each close this
row on paper while asserting something nobody measured. The script refuses them at the type level
(`refused` carries no `ok` field, so it cannot be summed into a pass rate); this row is the prose
reason that refusal must survive review.

**Falsification:** if `gate:s1` ever prints a MEASURED tier for `processing-time-mean-p95` or
`cas-dedup-rate` while `compiler_jobs` is without duration columns or `cas/manifests` is without a
writer, this row's refusal has been circumvented. For `adapter-failure-rate`, which now *may*
legitimately be MEASURED: if it prints a rate whose denominator includes `skippedNoAdapter`, or
prints `0%` where zero attempts were made, the measure has been circumvented instead of the row.
(Stated against the specific missing artefacts, not against "`.var/` is empty" — the original
wording would have been *satisfied* by the mis-rooted read S1-OPEN-4 records.)

---

## S1-OPEN-2 — S2 (500 records) has the same shape, one rung up, and no guard yet either

**Status:** **OPEN.**

The finding that produced Gate S1 is not specific to S1. `docs/new15-execution-status.md` lists
Gates S1–S4 as ⬜, all in a gitignored file, and the cohort grows automatically under ADR 0086.
`S0_REGRESSION_FLOOR` is already **150**; the auto-growth adds +50/run toward a 500 ceiling. So
the cohort is on a path to cross **S2's 500-record threshold** the same way it crossed S1's —
and today there is no `scripts/gate-s2.ts`, no `gate:s2` script, and no tracked artifact.

Recorded rather than pre-built, deliberately: writing S2 now would mean writing four more
REFUSED measures against the same empty store, which produces a second gate that cannot pass for
the same reason as this one. The useful sequence is S1-OPEN-1 first (give the measures a data
source), then S2.

**What would close this row:** `artifacts/gate-s2/open-items.md` plus `scripts/gate-s2.ts`
existing before the served cohort reaches 500 — i.e. the guard arriving *before* its threshold,
which is exactly what did not happen for S1.

**Falsification:** if the served registry cohort reaches 500 with no `gate:s2` in `package.json`,
this row failed at the one thing it was written to prevent.

---

## S1-OPEN-3 — the served-vs-committed floor is derived, and that is a deliberate divergence from S0

**Status:** **OPEN (by design; documented so it is not "fixed" into a literal).**

S0 keeps a hardcoded `S0_REGRESSION_FLOOR = 150`, pinned by a test so it cannot be edited
downward (ADR 0083). S1 instead **derives** its floor from the committed snapshot at run time.
The two gates ask different questions and that is why the mechanism differs:

- S0 asks *did the committed cohort shrink between commits?* A literal is right there — only a
  literal reds when records are deleted.
- S1 asks *did the served tree keep up with source?* The answer must move with source, so a
  literal would have to be edited on every ingest, and a number edited weekly is a number nobody
  reads.

The risk retained is the one ADR 0083 names: a derived floor cannot catch a *simultaneous* drop
in both source and served. S0's literal covers exactly that case, which is why both gates run in
`ci:local` and neither replaces the other.

**Falsification:** if `gate:s1`'s floor is ever replaced by a hand-written literal, or if
`gate:s0:regression` leaves `ci:local`, the pair stops covering the case each was kept for.

---

## S1-OPEN-4 — this gate read the wrong store, and told every reader the compiler had never run

**Status:** **CLOSED (the mis-rooted read); OPEN (the adapter-attempt source it exposed).**

Split deliberately: one half was a defect and is fixed, the other is a measurement that is now
known to be *possible* and is still not taken. Merging them would let the fix's green stand in for
work nobody did.

### What was wrong

The gate hardcoded `repoRoot/.var/calllint-adoption-index` and reported, four times per run, *"the
rolling compiler has not run against this checkout"* with `cas/blobs=0, db=131072B`. Measured on
2026-08-28: the store the ingest worker actually writes, `packages/trust-index/.var/…`, held a
**2551808-byte** database — 298 canonical subjects, 1200 source records, 839 subject aliases, 78
artifact versions, **45 CAS blobs** whose mtimes are **2026-08-04**, i.e. three weeks *before* this
gate was written. The refusals were right. Their stated reason was false.

**The seam.** `resolveIndexPaths(cwd)` (`packages/adoption-index/src/storage/paths.ts:50`) resolves
`.var/` relative to whatever `cwd` it is handed, and `refreshSnapshot.ts:367` hands it
`process.cwd()`. Under `pnpm --filter @calllint/trust-index …` — how every store-writing script is
invoked — that is the **package** directory. Under the systemd unit it is `WorkingDirectory=/opt/
calllint`. One seam, two stores, and `.gitignore:64`'s unanchored `.var/` hides both from `git
status`, which is why three weeks passed unnoticed.

**This was already written down.** `paths.ts:115` warns that a mis-rooted sweep "would simply sweep
a directory nothing writes to and report `inspected 0` forever" — in the tree *before* this gate
existed, aimed at a CAS sweep. The gate reproduced it anyway, while its own docblock was naming this
repo's dominant fault class. A prose warning at the definition site did not prevent the same defect
one directory away; only an executed observation found it.

**Where "the repo root" came from.** The gate did not invent it. `refreshSnapshot.ts:324` stated, in
its own docblock, that `cwd` decides where `.var/` lands *"(the repo root, when this runs from the
workflow)"* — and the workflow runs `pnpm ingest:trust-index`, i.e. `--filter`, i.e. the package
directory. So the upstream comment was false about the very invocation it named, and the gate
inherited a wrong path from a source that read as authoritative. That sentence is now struck in place
(2026-08-28), which is why the strike is asserted in **three** files rather than two: leaving the
origin intact would let the next reader re-derive the same wrong root from the same sentence.

### Three defects, not one

| # | defect | evidence |
|---|---|---|
| 1 | wrong store root | `db=131072B` reported; real store 2551808 B |
| 2 | "directory listing establishes it" reasoning | the listing established *that directory* was empty, never that no run happened |
| 3 | `dirPopulated` counted the wrong unit | `readdirSync("cas/blobs").length` = **42** two-char shards for **45** blobs — and `paths.ts:117-118` explicitly warns callers "must not assume a shared traversal shape" |

Defect 2 is the load-bearing one. Defects 1 and 3 are a wrong path and a wrong unit; defect 2 is the
*argument* that made reading the database unnecessary, and it is what let a wrong path go unchecked.
The gate's comment said opening SQLite would "establish something the directory listing already
establishes." It did not. Skipping the read is still the right call (`better-sqlite3` is pinned
12.9.0 for an ABI cliff, and a gate that cannot start is worse than one that reports less) — but for
the cost, not because the filesystem is a substitute for the store.

### What changed

- `storeCandidates` **discovers** rather than assumes: `ADOPTION_INDEX_CWD` (the seam `pruneCas.ts:59`
  and `backupAdoptionIndex.ts:52` already use — this gate must not invent a second convention), then
  the repo root, then the package directory. A single corrected hardcoded path would only move the
  blind spot to the next invocation style.
- `countFiles` recurses, so the fan-out tree and the flat tree both count files.
- The store census prints **in every mode, unconditionally** — including the passing ones. A census
  shown only on failure leaves exactly the runs nobody inspects carrying the unverifiable claim.
- The refusal text no longer names an unreachable remedy (see S1-OPEN-1).

**All four modes still exit 0 / 2 / 0 / 2**, measured after the change. The behavioural contract did
not move; only the stated reasons became true.

### The half still open

`artifact_versions.artifact_status` carries a real distribution — **FETCHED 45 / RESOLVED 25 /
UNAVAILABLE 8** of 78 — and `UNAVAILABLE` is adapter-shaped. It is deliberately **not** reported as
"adapter failure rate": that column grades an **artifact's** resolution state, not one **attempt's**
outcome, so 8/78 would answer a different question than §342 asks while wearing the name of the one
it asks. §342 wants attempts, which live in `compiler_jobs`, which needs the driver S1-OPEN-1 owes.

**What would close this half:** ~~either a queue driver (then attempts are the source, and this column
is irrelevant), or an ADR deciding that artifact status is an acceptable proxy~~ — **CLOSED 2026-08-31
by the first branch, reached by a route this text did not anticipate.** Attempts are now the source,
and no queue driver was written: `refreshSnapshot.ts` brackets each ingest with
`beginCompilerRun`/`concludeCompilerRun` and writes `reports/run-<id>.json`, and the gate reads the
attempt counters out of that. The prediction "needs the driver S1-OPEN-1 owes" was wrong about the
mechanism while right about the requirement — recorded rather than corrected, because a remedy that
turned out to be one of several is a different lesson from a remedy that was simply mistaken.

The second branch (an ADR blessing `artifact_status` as a proxy) is now **moot and must stay closed**:
with real attempt counts available, substituting a state distribution for them would be a downgrade
disguised as a convenience.

**Falsification:** if a future edit reports 8/78 as "adapter failure rate" without either of those,
S1 will be publishing a number whose name misdescribes what it counted — the failure this row was
opened to prevent, in the one place where a number *is* available. Still live, and now cheaper to
violate rather than harder: a real source existing next to a convenient wrong one is exactly when a
name gets attached to the wrong column.

---

## Second measurement — 2026-08-31, at `e40f9e3`

`pnpm gate:s1` on `fix/daily-approval-burden`. **Three MEASURED and green; four REFUSED — the same
counts as the first measurement, and that stability is the finding, not a lack of progress.** What
changed is *why* one of the four refuses.

| measure (new15 §342 order) | tier | result | change since 2026-08-28 |
|---|---|---|---|
| source completeness | MEASURED | ✓ 150/150 source records reached the served tree | — |
| artifact resolution rate | MEASURED | ✓ 149/150 resolvable; the 1 unresolvable is exactly the 1 the index marks `incomplete` | — |
| page quality | MEASURED | ✓ 149/149 baked subjects carry html+json+manifest and agree with the index on both digests | — |
| adapter failure rate | REFUSED | ✗ `no run report exists yet` | **source acquired.** Was "0 attempts recorded" (no source at all) |
| mean/p95 processing time | REFUSED | ✗ blocked on SCHEMA — no `started_at`/`finished_at` columns | reason sharpened; blocker unchanged |
| CAS dedup rate | REFUSED | ✗ 45 blobs, `cas/manifests` = 0 — MISSING WRITER | reason sharpened; blocker unchanged |
| disk growth | REFUSED | ✗ baseline only | **baseline now recorded:** `packages/trust-index/.var/…` at 2551808 B, 45 blobs, 0 reports |

Store census, both candidates (the S1-OPEN-4 seam, printed unconditionally):

```
.var/calllint-adoption-index:                    cas/blobs=0,  cas/manifests=0, dead-letter=0, reports=0, db=131072B
packages/trust-index/.var/calllint-adoption-index: cas/blobs=45, cas/manifests=0, dead-letter=0, reports=0, db=2551808B
```

### The distinction this measurement exists to record

`adapter-failure-rate` **has a data source and still refuses.** Those are two different states, and
the gate now says which one it is in:

- *No source* → nothing could ever produce the number. That was the 2026-08-28 state.
- *Source, no data* → the writer exists, and no run has executed against this checkout since it
  landed. `reports=0` in both stores is the evidence.

The refusal names the second and points at `pnpm ingest:trust-index`, which is a **reachable** remedy —
unlike the one struck from S1-OPEN-1 twice. That the number is still absent is therefore not a defect
to fix but a run to perform, and the ingest was deliberately **not** performed here: it opens network
connections and rewrites tracked bytes (including advancing Gate S0's ratchet), which is not a thing a
measurement pass should do as a side effect.

**Verified through the real writer and the real gate, not by inspection.** The writer → JSON → gate
path was exercised end-to-end against a temp store via `ADOPTION_INDEX_CWD`, covering: a measured rate
(**18.2% = 10/55**, with 23 excluded from *both* halves), a zero-denominator refusal, a
stage-disabled refusal, a truncated-JSON refusal, a `v2`-schema refusal, and `--gate` exiting **2**.

---

## S1-OPEN-5 — `withCompilerRun` cannot record a crash in an async body, so a failed run stays RUNNING forever

**Status:** **OPEN (characterised and pinned by an executable test; not fixed).**

`withCompilerRun` (`packages/adoption-index/src/operations/compilerQueue.ts:438`) brackets a run in
`beginCompilerRun` / `concludeCompilerRun` and grades it from its own counters. Its `catch` is
**synchronous**: for a body returning a promise, the function returns that promise *before* it can
reject, so the `catch` never runs. The consequences are not cosmetic:

- `concludeCompilerRun` is never called, so the run keeps `state: RUNNING` and `completedAt: null`.
- `jobStates.ts` gives `RUNNING` **no self-edge and no path out except through conclude**, so the row
  is unreachable forever — not stale, *stranded*.
- Every measure that reads run outcomes silently loses that run. A crashed run becomes an absent run,
  which is the empty-denominator defect arriving through the back door: the gate would compute a clean
  rate over the runs that happened to succeed.

**Why it has never fired.** Both existing call sites (`compilerQueue.ts:759`, `:860`) pass synchronous
bodies, and `refreshSnapshot.ts` **open-codes the bracket** rather than calling this helper — precisely
because of this limitation. So the defect is latent, and the next async caller inherits it.

**Not fixed here, deliberately.** Making the helper generic over `T | Promise<T>` changes a shipped R-6
signature, which is a wider change than this batch's scope and wants its own review. Instead it now
**costs something**: `packages/adoption-index/test/job-lease.test.ts` characterises the behaviour as it
actually is — asserting `metricsRead === 0`, `state: "RUNNING"`, `completedAt: null` — with a comment
stating that these are the *wrong* values. A real fix reds the test, which is how a latent defect stops
being invisible without being silently tolerated. That red-on-fix property was itself verified (control
#R6) rather than assumed; a characterisation test that cannot detect its own fix is decoration.

**What would close this row:** an overload or a sibling (`withCompilerRunAsync`) that awaits the body
and concludes on rejection, plus the characterisation test inverted to assert the *correct* values —
`FAILED`, a non-null `completedAt`, metrics read once.

**Falsification:** if any caller passes an async body to `withCompilerRun` while it remains
synchronous, a crash in that body will write no run row at all, and the gate will report on a
population it cannot see. Grepping for `withCompilerRun(` with an `async` callback is the check.

