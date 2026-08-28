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
| CAS dedup rate | REFUSED | ✗ `cas/blobs` = 0, `cas/manifests` = 0 |
| disk growth | REFUSED | ✗ no baseline; needs two measurements over time |

Cohort census: source **150 / 100 required** (met); served **150 registry pages / 150
committed** (held).

### Why four measures are REFUSED and not computed

`.var/calllint-adoption-index/` is empty: all ten data tables hold **0 rows**
(`adoption_records`, `artifact_versions`, `canonical_subjects`, `compiler_jobs`,
`compiler_runs`, `evidence_records`, `identity_conflicts`, `source_checkpoints`,
`source_records`, `subject_aliases`; only `schema_migrations` has rows), and `cas/blobs`,
`cas/manifests`, `cas/expanded`, `dead-letter/`, `reports/` are empty directories. The rolling
compiler has never run against this checkout.

The four measures are therefore printed as `✗ REFUSED` with the reason and the remedy, never as
a number. This is the load-bearing design decision in the script, and it is not a stylistic
preference — **a rate over an empty denominator renders as a perfect score.** That is not
hypothetical. It is verbatim the defect Gate S0's own first INV-R4 shipped: it read a
nonexistent sidecar path, `existsSync` returned false on all 39 iterations, the loop `continue`d
every time, and it printed *"0 dangerous false-SAFE"* as PASS from **zero observations**. A
`0/0` here would have printed a flawless S1 — a gate reporting excellence about a subsystem that
has never executed.

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
four of its seven measures have no data source, so it exits **2** by design. Wiring it would pin
the required check red for a reason no PR under review can clear — verbatim the hazard that kept
`gate:s0:gate` out of CI, and the mirror image of the reason report mode was refused there (a
step with no failing mode). The two enforcing modes are separated rather than blended, because a
single mode covering both would have had to soften one.

Report mode exits **0 unconditionally, by design**: a report mode that could fail would be a
third enforcing mode by accident.

### The record has a machine reader, and it was proven able to red

Everything above is a claim in prose, and prose does not fail. `tests/invariants/gate-s1-claims.invariants.test.ts`
is the reader — **19 assertions, three layers**, modelled on the Gate S0 suite because the failure
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

## S1-OPEN-1 — four of seven measures have no data source, so S1 cannot be CLAIMED passed

**Status:** **OPEN.**

Three green measures are not Gate S1. The four refused ones are precisely the *scale* measures —
throughput, failure rate, dedup efficiency, disk growth — so what is currently proven is that
the served tree is **complete and self-consistent at 150 records**, not that the pipeline
*performs* at 150. Those are different claims and S1 asks the second one.

**What would close this row:** a real R-9 controller/worker run against this checkout, populating
`compiler_runs` / `compiler_jobs` and the CAS, followed by a re-measurement in which the four
REFUSED lines become MEASURED. At that point `gate:s1:gate` becomes runnable, and the question of
whether it belongs in CI can be asked on evidence instead of predicted.

**What must NOT close this row:** computing any of the four from an empty store. A `0/0` dedup
rate, a `0` failure rate over zero attempts, or a `0ms` mean over an empty set would each close
this row on paper while asserting something nobody measured. The script refuses them at the type
level; this row is the prose reason that refusal must survive review.

**Falsification:** if `gate:s1` ever prints a MEASURED tier for any of the four while
`.var/calllint-adoption-index/` is still empty, this row's refusal has been circumvented.

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
