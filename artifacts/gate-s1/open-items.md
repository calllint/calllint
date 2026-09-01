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

Note the count is **four refusals over ~~three~~ two missing sources**, and the gap is deliberate
rather than sloppy: `adapter-failure-rate` and `cas-dedup-rate` both have sources and still refuse,
because no ingest has run against this checkout since either writer landed. "Has a source" and "has a
measurement" are different states, and collapsing them is how a gate comes to report a number it never
took.

The gap widened from one measure to two on 2026-08-31 (ADR 0093), and that is the direction to expect:
building a writer moves a measure from *unbuildable* to *unrun*, which is progress that a
refusal-count alone cannot show. A reader watching only "4 refused" would see this batch as having
changed nothing.

Report mode exits **0 unconditionally, by design**: a report mode that could fail would be a
third enforcing mode by accident.

### The record has a machine reader, and it was proven able to red

Everything above is a claim in prose, and prose does not fail. `tests/invariants/gate-s1-claims.invariants.test.ts`
is the reader — **32 `it` blocks, three layers**, modelled on the Gate S0 suite because the failure
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

## S1-OPEN-1 — one of seven measures has no data source, so S1 cannot be CLAIMED passed

**Status:** **OPEN (narrowed three times: ~~four measures~~ → ~~three~~ → ~~two~~ → one, 2026-09-01).**

Three green measures are not Gate S1. ~~The refused ones are precisely the *scale* measures —
throughput, dedup efficiency, disk growth —~~ **re-aimed 2026-09-01:** that clause described the
refusals as a coherent *category*, and the category has since been dismantled from the inside —
throughput (ADR 0097) and dedup efficiency (ADR 0093) are now measurable, and what remains is one
measure blocked on something no code can produce. Struck rather than deleted because the framing was
load-bearing: it is *why* three green measures do not add up to S1. What is proven is still that the
served tree is **complete and self-consistent** at cohort scale, not that the pipeline *performs* at
that scale. Those are different claims and S1 asks the second one — but the gap is now one measure
wide, not three, and the honest statement of the remainder is narrower than the original prose.

**NARROWED THREE TIMES, and each narrowing is the part to check rather than accept.** This row
said "four", and said all four were blocked by the same thing: no queue driver. Both halves were wrong.
`adapter-failure-rate` acquired a real source — `refreshSnapshot.ts` now brackets every ingest in
`beginCompilerRun`/`concludeCompilerRun` and writes `reports/run-<id>.json`, which the gate reads —
and the other three are each blocked by something *different*, which the single shared remedy hid.
Splitting them is what makes each remaining blocker actionable.

**The third narrowing (ADR 0097, 2026-09-01) was of a kind the first two were not, and the difference
is the part worth carrying forward.** The first two closed because somebody *built the writer* the
reader had always assumed. The third closed because **the recorded blocker was false** — and it had
been false since before it was written down. Nothing was built for the sake of the row; a wrong reason
was retracted, and the observable it claimed to need turned out to be the wrong observable. The reason
it survived review for its whole life is that the **verdict it produced was correct**: the measure
genuinely could not be reported, so REFUSED was right every single day, and a correct verdict gives
nobody an occasion to re-derive the reason underneath it. That is the ADR 0096 fault class — two
consecutive ADRs now — and it is the argument for reading a blocker's evidence when the row is
*narrowed*, since that is the only moment anyone looks:

| measure | blocker | what would actually unblock it |
| --- | --- | --- |
| `adapter-failure-rate` | ~~no source~~ **RESOLVED** | a run report exists and is read; MEASURED once an ingest runs against the checkout |
| `processing-time-mean-p95` | ~~**SCHEMA**~~ **RETRACTED — the blocker was false (ADR 0097)** | ~~`compiler_jobs` has `created_at`/`updated_at`/`available_at` and no `started_at`/`finished_at` (`migrations/001-canonical-adoption-graph.sql`), so no duration is recorded anywhere. Adding the columns breaks the 14-column ↔ 14-property equality `domain/job.ts:13` documents → needs a migration **and an ADR**. Running the compiler cannot unblock this.~~ **Every clause after the first was wrong.** `compiler_runs` has carried `started_at`/`completed_at` since the same canonical DDL, with a real writer — so "no duration is recorded anywhere" was false of the schema this row cites. `compiler_jobs` holds **0 rows** and `enqueueJobs` has no non-test caller, so the two proposed columns would have been NULL forever and the measure would have computed mean/p95 over an empty set: the empty-denominator defect, bought at the price of breaking a documented equality. And reading the columns that *do* exist closes nothing — all 3 rows have `completed_at − started_at = 0 ms`, because `refreshSnapshot.ts` passes one pinned `TRUST_INGEST_NOW` as both endpoints. **Now MEASURED** from a monotonic per-attempt clock in `resolveArtifacts.ts`, reported in `calllint.compiler-run-report.v3`. No migration was needed. |
| `cas-dedup-rate` | ~~MISSING WRITER~~ **RESOLVED** | `artifacts/casManifest.ts` now writes `cas/manifests/run-<id>.json` and `refreshSnapshot.ts` calls it on both the success and the crash path (ADR 0093). MEASURED once an ingest runs with artifact resolution enabled. |
| `disk-growth` | **TIME** | two measurements separated by real runs. A baseline is recorded (below); the second one cannot be willed into existence. |

**The second narrowing was a DESIGN gap, not an implementation one, and the distinction is why it
needed an ADR.** `cas/manifests` had been declared in `INDEX_SUBDIRS` and censused by this gate since
the first commit, and nothing ever wrote one — the fourth instance in this store of the fault class
`storage/paths.ts:reportsRoot` names: a reader whose subject does not exist reads a benign value
forever and never says so. What made it *not* a missing function is that no manifest format existed
anywhere in the repo or the blueprint, so "write the writer" had no schema to write against. ADR 0093
§4 records the fork that was actually taken and the cheaper option that was rejected: summing
`verifyAndStore`'s `deduplicated` booleans into one counter would have closed the measure with one
integer and no new directory, and it cannot answer *against what* — nine requests for one blob and
nine distinct blobs sharing one prior both report "8 deduplicated" while meaning opposite things about
the store.

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
row on paper while asserting something nobody measured. (The `0ms` example stopped being hypothetical
on 2026-09-01: it is precisely what this row's own recorded remedy would have produced, and ADR 0097 §D1
is the arithmetic. The clause was written as a guard against a future reader and turned out to describe
the row itself.) The script refuses them at the type level
(`refused` carries no `ok` field, so it cannot be summed into a pass rate); this row is the prose
reason that refusal must survive review.

**Falsification:** stated per measure, because a shared clause is what let the collapsed version
survive — and because **three of the four** now have sources, so the ways they can be circumvented have
changed and are no longer the ways they can be blocked. Three of these four clauses have now been
re-aimed at least once. A falsification condition is not a fixed asset: when its subject acquires a
source, or when the blocker it names is retracted, the clause either fires on correct behaviour or on
nothing at all, and both failures are silent.

- `processing-time-mean-p95`, which now *may* legitimately be MEASURED — and this clause is the
  second on this row to be **re-aimed rather than deleted**, for a different reason than the first.
  `cas-dedup-rate`'s became unreachable because someone built the missing writer; this one became
  unreachable because **the condition it named was never the right one**. ~~if `gate:s1` prints a
  MEASURED tier while `compiler_jobs` carries no duration columns, the refusal has been circumvented~~
  — struck 2026-09-01: `compiler_jobs` still carries no duration columns and never will, so as written
  this clause fires on every correct run and is satisfied by no incorrect one. It is inverted, not
  merely stale, which is worse than the unreachable kind: it would have been read as forbidding the
  fix. Re-aimed at what can now actually go wrong — if the gate prints a duration derived from
  `completedAt − startedAt` (0 ms by construction, since both are one pinned `TRUST_INGEST_NOW`), or
  reports a mean over `n = 0`, or counts `NO_ADAPTER` artifacts as 0 ms samples instead of excluding
  them, or presents a v1/v2 report's *absence* of a distribution as a fast run rather than as a report
  predating the observable, the measure has been circumvented.
- `cas-dedup-rate` — the blocked-on-a-writer half of this clause is now **impossible**, and a
  falsification condition that cannot fire is the exact defect this row exists to record, so it is
  re-aimed at what can now go wrong instead of deleted: if the gate prints a rate whose denominator is
  a manifest's zero `references`, or collapses within-run reuse (`references − distinctDigests`) and
  already-on-disk (`deduplicated`) into a single "dedup rate", or reports totals a manifest states
  without recounting its own `references` list, the measure has been circumvented. ~~or while
  `cas/manifests` is without a writer~~ — struck 2026-08-31, unreachable since ADR 0093.
- `disk-growth` — if it prints growth from one measurement, or from two taken without an intervening
  run.
- `adapter-failure-rate`, which now *may* legitimately be MEASURED: if it prints a rate whose
  denominator includes `skippedNoAdapter`, or prints `0%` where zero attempts were made, the measure
  has been circumvented instead of the row.

(Stated against the specific missing artefacts, not against "`.var/` is empty" — the original
wording would have been *satisfied* by the mis-rooted read S1-OPEN-4 records.)

---

## S1-OPEN-2 — S2 (500 records) has the same shape, one rung up, and no guard yet either

**Status:** **CLOSED 2026-08-31 — the guard arrived before its threshold.**

`scripts/gate-s2.ts`, `gate:s2*` in `package.json`, and `artifacts/gate-s2/open-items.md` now
exist, with the served cohort at **150 of 500**. That is this row's closing condition met in the
only way that counts: *before* the threshold, not after it.

The finding that produced Gate S1 is not specific to S1. `docs/new15-execution-status.md` lists
Gates S1–S4 as ⬜, all in a gitignored file, and the cohort grows automatically under ADR 0086.
`S0_REGRESSION_FLOOR` is already **150**; the auto-growth adds +50/run toward a 500 ceiling. So
the cohort is on a path to cross **S2's 500-record threshold** the same way it crossed S1's —
~~and today there is no `scripts/gate-s2.ts`, no `gate:s2` script, and no tracked artifact.~~
**STRUCK: all three now exist.**

~~Recorded rather than pre-built, deliberately: writing S2 now would mean writing four more
REFUSED measures against the same empty store, which produces a second gate that cannot pass for
the same reason as this one. The useful sequence is S1-OPEN-1 first (give the measures a data
source), then S2.~~

**STRUCK, AND THE REASON IT WAS WRONG IS THE USEFUL PART.** The premise was that S2 could only be
built by duplicating S1's REFUSED runtime measures. It was not: S2 measures **only scale-specific
properties** and deliberately does *not* repeat the four runtime measures, precisely because they
are blocked on the same store for the same reasons this row cites. Two gates refusing one measure
for one reason is not twice the coverage — it is one finding printed twice, and whoever fixes it
must then find both. So the sequencing argument ("S1-OPEN-1 first, then S2") dissolved once the
overlap was removed, and waiting would have cost the thing the row existed to protect: arriving
first. S1-OPEN-1 remains open on its own merits and is *not* a prerequisite.

Left struck rather than deleted for the reason `gate-s0.ts` states about its own expired prose: a
silently corrected claim teaches nobody which assumption failed.

**What would close this row:** ~~`artifacts/gate-s2/open-items.md` plus `scripts/gate-s2.ts`
existing before the served cohort reaches 500 — i.e. the guard arriving *before* its threshold,
which is exactly what did not happen for S1.~~ **MET.** Both exist at cohort 150.

**Falsification:** the original read *if the served registry cohort reaches 500 with no `gate:s2` in
`package.json`, this row failed at the one thing it was written to prevent* — and that can no longer
happen. What replaces it is the risk that S2 exists but **cannot red**: a gate present and blind is
worse than a gate absent, because its green is consumed. So this row is falsified if `scripts/gate-s2.ts`
or `artifacts/gate-s2/open-items.md` is deleted, or if `cohort-completeness` stops being able to refuse.
The assertions above that used to require S2's *absence* were **inverted, not deleted**, and
`gate-s2-claims.invariants.test.ts` carries the executable proof of the refusal. See S2-OPEN-1..3 for
what S2 itself still owes.

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
| CAS dedup rate | REFUSED | ✗ 45 blobs, `cas/manifests` = 0 — `no CAS manifest exists` | **source acquired (ADR 0093).** Was MISSING WRITER: no format existed to write |
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

**`cas-dedup-rate` joined it in the second state on 2026-08-31**, and its move is the sharper
illustration, because the first state was *permanent* for that measure rather than merely current:
`cas/manifests=0` was not "no run yet", it was "no run, past or future, could produce this", since no
writer and no format existed. Both stores still print `cas/manifests=0` — the same number as before —
which is exactly why the refusal text and not the census is where the change is legible. A gate whose
census is unchanged can still have moved.

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


---

## Third measurement — 2026-09-01, at `7117aaa`+ (the first with a run report on disk)

`pnpm gate:s1` on `fix/daily-approval-burden`, after a real `pnpm ingest:trust-index`. **Five
MEASURED and green; two REFUSED.** The first change in the counts across three measurements, and it
came from performing the run the previous section declined to perform — plus fixing the defect that
would have made the run produce nothing anyway (ADR 0094).

| measure (new15 §342 order) | tier | result | change since 2026-08-31 |
|---|---|---|---|
| source completeness | MEASURED | ✓ 200/200 source records reached the served tree | cohort 150 → 200 |
| artifact resolution rate | MEASURED | ✓ 199/200 resolvable; the 1 unresolvable is exactly the 1 the index marks `incomplete` | scaled with the cohort |
| page quality | MEASURED | ✓ 199/199 baked subjects carry html+json+manifest and agree with the index on both digests | scaled with the cohort |
| adapter failure rate | **MEASURED** | ✓ 0.0% — 0/36 failed (0 unavailable + 0 rejected) over 36 fetched; 28 of 64 considered had no adapter and are excluded from BOTH halves | **REFUSED → MEASURED** |
| mean/p95 processing time | REFUSED | ✗ blocked on SCHEMA — `compiler_jobs` has no `started_at`/`finished_at` | unchanged; needs a migration + an ADR |
| CAS dedup rate | **MEASURED** | ✓ 0.0% within-run reuse (0/36) and 0.0% already-on-disk (0/36), reported as two counts | **REFUSED → MEASURED** |
| disk growth | REFUSED | ✗ baseline only, re-recorded at 185106432 B / 81 blobs / 1+ report | still one measurement; a rate needs two |

Store census, all candidates:

```
.var/calllint-adoption-index:                      cas/blobs=0,  cas/manifests=0, dead-letter=0, reports=0, db=131072B
packages/trust-index/.var/calllint-adoption-index: cas/blobs=81, cas/manifests=1, dead-letter=0, reports=2, db=185106432B
```

### What actually moved, and why it took a defect fix rather than a run

The second measurement said the two refusals were in the *source, no data* state and named
`pnpm ingest:trust-index` as a reachable remedy. **That was wrong, and reachably so.** Both writers
had been called on every ingest since commit one and had **refused on every one**: `runReportPath`
and `casManifestPath` validate their segment against a pattern that forbids `:`, while
`beginCompilerRun` mints ids shaped `sha256:<64 hex>`. Every run rejected its own id. ADR 0094 has
the detail; the correction that matters here is that "a run to perform" was really "a writer to
repair", and the record could not tell the difference because a refused write and an unattempted
write leave the same empty directory.

So `reports=2` and `cas/manifests=1` above are the **first such files in the project's history** —
one FAILED report from the run that tripped a cohort refusal, one SUCCEEDED report with its manifest.
`adapter-failure-rate` and `cas-dedup-rate` are measured here for the first time ever.

**`disk-growth` still refuses, and that refusal is the honest one.** The baseline moved 2551808 →
185106432 B, which looks exactly like growth and is not: the earlier figure was read from a store
this gate was mis-rooted against (S1-OPEN-4), and 45 → 81 blobs spans a full mirror walk. Two numbers
measured under different conditions are not a rate, so the gate declines to divide them.

~~**The two remaining refusals are structural, not procedural.** No number of ingests closes either:
one needs a schema migration plus an ADR, the other needs a second measurement separated by real
elapsed time.~~ That is the same distinction the second measurement drew, now applied to what is left.

**Correction 2026-09-01 (ADR 0097): half of that was wrong, and it was the half that sounded most
certain.** "Structural, not procedural" was true of `disk-growth` and false of
`processing-time-mean-p95` — the migration it named was for a table holding zero rows with no writer,
and the columns it said were missing had existed on `compiler_runs` all along, yielding `0 ms` because
one pinned instant is passed as both endpoints. The measure needed neither a migration nor an ADR-gated
schema change; it needed a second observable, which is a monotonic clock at the artifact-attempt seam.

Worth noting *where* the error sat: this paragraph is the third consecutive dated section on this row
to repeat the claim, each one inheriting it from the last, and none re-deriving it. Three restatements
made it read as settled. It is struck rather than deleted for exactly that reason — the sequence of
repetitions is the evidence for how a false blocker hardens, and deleting them would leave only the
correction, which reads as though the mistake were caught the first time.

Cohort census: source **200 / 100 required** (met); served **200 registry pages / 200
committed** (held).
