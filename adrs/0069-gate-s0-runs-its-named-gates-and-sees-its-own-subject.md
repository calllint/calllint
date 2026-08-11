# ADR 0069 — Gate S0 runs its named gates, and the cohort slice can see whether the claimed subject survived it

- Status: Accepted (2026-08-10). Closes **S0-OPEN-3**. Files **S0-OPEN-4**. Re-measures
  **S0-OPEN-2** (still OPEN, now with a cost attached). Changes no product behaviour: no
  schema, no verdict, no served byte under `apps/web/public/**`, no MCP tool (13) or resource
  (19) count, no `packages/adoption-index/**` semantics. **Zero `src/` change** — the diff is
  one script, one new test, one amended test, one amended artifact.
- Date: 2026-08-10
- Closes: **S0-OPEN-3** (`GATE-VERIFIED` is not verification) in
  [artifacts/gate-s0/open-items.md](../artifacts/gate-s0/open-items.md), by that row's own
  first disjunct — the three probes became `EXECUTED`.
- Files: **S0-OPEN-4** — closing S0's shortfall by growing the cohort **evicts CallLint's own
  claimed page**, and the gate goes green as it happens. Measured, deliberately not fixed:
  every remedy is a served-bytes or ingest-policy change needing its own authorization. §4.
- Refutes: **S0-OPEN-3's own "not fixable cheaply"**, and its account of its own subject. §2.
- Refines: 0061 §8.5.1 (append discipline, applied to a row that closes *and* a row that is
  born OPEN in the same edit), 0064 §6.2 (normalize-then-assert-both-bounds, applied here to a
  comment stripper rather than to a CRLF slice)
- Related: 0060 (**still reserved**, §1), 0068 (the immediately prior batch, whose guard also
  could not observe its subject — the same failure class, a different layer)

## §1 Numbering: 0069, and 0060 remains reserved

Re-`ls adrs/` at authoring time rather than trusting any recorded line: `adrs/` tops out at
**0068**, so this is **0069**.

**0060 is still held**, now for the eighth consecutive numbering — reserved for the
`propertyNames` defect at `artifacts/phase-2.4/presentation-plane-audit.json:135`, which has a
gate reading the reservation.

## §2 The defect: a gate that printed `✓` on bytes where its own subject was red

`scripts/gate-s0.ts` labelled three of its five assertions `GATE-VERIFIED`. That tier grepped
*another* test file for the **text of an assertion** and concluded the assertion held. It never
ran it.

Demonstrated, not inferred. One derived character flipped in
`packages/trust-index/snapshots/adoption-index.json` makes `committed-tree.test.ts` red. On
exactly those bytes the old gate printed:

```
    [GATE-VERIFIED]  INV-R6  ✓  byte-identical derivation verified
```

The line is not merely weak evidence for its proposition. It is evidence for **a different
proposition** than the one it prints: *"a string appears in a file"*, printed as *"a derivation
is byte-identical."* This is the same shape as ADR 0068 §5 — a guard whose green survives its
own subject's failure — one layer down: 0068's guard watched the wrong layer, this one watched
the wrong *artifact kind* (prose about a test, instead of the test).

**Two claims in that row were false, and both were falsifiable by re-reading the bytes it
cited.**

*"Not fixable cheaply."* The row argued that re-running the named gates *"multiplies its
runtime by their sum and makes S0 fail for reasons that are not S0's."* Measured: one batched
`vitest run` over the three named files is **156 tests in ~25 s** — not a multiplier, because
all three files already run in `pnpm test`. And S0 failing when INV-R6 fails is not a foreign
reason; it is the entire proposition S0 was printing a tick for.

*The row understated its own subject.* It described the risk as a *rename* flipping probes to
failing, and a *delete-with-comment-left-behind* flipping them to passing. Both are real, and
both are the **cheap** cases: they need a refactor to occur. The expensive case needs nothing —
an assertion that is **present and failing** keeps the probe green forever, with no refactor,
no rename, and no deletion. That is the case the demonstration above walks through, and the row
never named it.

## §3 What replaced it: three tiers, and why the scan survives as a precondition

| Tier | Meaning | Assertions |
|---|---|---|
| **MEASURED** | computed here from committed bytes | INV-R5, INV-R4 |
| **EXECUTED** | the named gates are RUN; S0's verdict is that run's verdict | INV-04, INV-R7, INV-R6 |
| **SCANNED** | the subject is SOURCE, so reading it *is* the measurement | DEP-8 |

`GATE-VERIFIED` was not renamed — it was **split**, because one name covered two different
epistemic situations. DEP-8 asserts that `apps/cli/src/commands/trust.ts` declares three
`--expect-*` flags. Its subject *is* source text, so reading the source is a direct measurement
and no run could improve on it. INV-04/R7/R6 assert behaviour, where reading text about the
behaviour is not a measurement of it. A single label spanning both made the weaker case borrow
the stronger one's credibility.

**The string scan survives as a PRECONDITION, not as a substitute.** The two catch opposite
things, which is why replacing one with the other would have traded a known hole for an unknown
one:

```
scan without run  → green while the assertion is present and FAILING   (the defect, §2)
run without scan  → green after the assertion is RENAMED OR DELETED, since the file still passes
```

Four properties, each with its own failure mode:

1. **Key on the parsed JSON report**, never the child's exit status or stdout. The child prints
   failing-test output, so a stream reader cannot distinguish `1 failed` from a fixture that
   prints the word `FAIL` on purpose — this repo has one
   ([[subprocess-negative-control-prints-fail]]).
2. **Absence is its own outcome.** A missing report, unparseable JSON, a named file the runner
   never collected, and `total === 0` (VACUOUS) each red with the reason named, rather than
   defaulting into either verdict ([[absence-must-not-become-a-category]]).
3. **`--no-run` is REFUSED under `--gate`** (exit 2). A flag that turns enforcement off would
   restore §2's defect with a CLI switch instead of a grep. In report mode a skip prints `–`,
   never `✓`, and does not satisfy `allOk`.
4. **Per-gate status is printed per file**, so `INV-R6` failing is not absorbed into a batched
   row.

### §3.1 The anchor must be matched against code, not prose about the code

This is the part worth transferring, because it was **wrong in the first implementation and in
the artifact sentence documenting it, in the same direction, for the same reason.**

The first version carried `NamedGate.anchorIsComment`, a per-gate boolean, and the artifact
said *"All three occurrences in `committed-tree.test.ts` are in comments; the string appears in
**no** `it()` title."* Re-measured: `control #117` occurs **three** times — `:50` and `:116` in
comments, **`:145` in the `it()` title.** The value was false.

But a corrected boolean would still have been the wrong repair, and this is the general lesson.
The field asked *"is this anchor in a comment"* when what decides whether a scan can see a
deletion is *"does a comment **also** carry it."* Under a raw-text match, two comments are
enough to keep the precondition green after the test is gone — the prose about the assertion
satisfies the probe for the assertion. **That is §2's defect again, at one further remove: a
probe agreeing with a claim's description instead of the claim.**

So the boolean is gone, `stripComments` runs before the match, and a comments-only survivor is
reported as `anchor present only in COMMENTS` rather than as absent — a rename that left its
docs behind needs a different repair than a file that lost the string entirely.

**Why the prose and the boolean agreed:** they were written together, from one reading, and
nothing read either. Two copies of a claim are not two measurements of it. The artifact records
the correction rather than replacing the sentence, because the shape of the mistake is this
batch's own subject.

### §3.2 The stripper is guarded two-sidedly, and the guard was itself falsified

`stripComments` has two opposite failure modes, and a naive guard buys one by surrendering the
other:

```
under-strip → a deleted test stays "present" via its own trailing comment   (the defect above)
over-strip  → a `https://` inside a test title reads as a comment, and a LIVE gate reports absent
```

`assertStrips` pins both over a synthetic fixture, reported through the same `scanFailures`
channel so a broken stripper reds the EXECUTED tier **by name** instead of silently turning the
precondition into a coin flip.

The guard's first version was **invalid, and a negative control proved it**. Control #169
loosened the line-comment pattern from `^[ \t]*//` to `//` anywhere, and the guard stayed
**green**: every fixture line either began with the comment marker or contained no `//` at all,
so leading-only and anywhere-on-the-line were indistinguishable. The fixture had no line where
**code preceded the marker** — which is the only case that separates them.

Adding a `https://` line made #169 red by name. It also **red the real stripper from the other
side**: a trailing `const x = 1 // … control #X` was not being stripped at all. Both directions
were live defects, found by strengthening one fixture. `stripComments` is now string-aware
(character scan tracking quote state) rather than regex-only, because no single regex holds both
bounds — the §6.2 rule from ADR 0064, applied to a stripper instead of a CRLF slice.

## §4 S0-OPEN-4: the shortfall and the claimed subject are satisfiable together at exactly one cohort size

The other half of this batch. `S0_REQUIRED_RECORDS` (`scripts/gate-s0.ts:59`) and
`DEFAULT_MAX_ENTRIES` (`packages/trust-index/src/fetchRegistry.ts:19`) are both **25**, by
coincidence rather than by reference. The consequence is arithmetic, not argument:

| cohort | S0's requirement | `io.github.calllint/calllint` |
|---:|---|---|
| 19–24 | SHORTFALL (red) | present |
| **25** | **MET (green)** | **present** ← the only size satisfying both |
| 26+ | MET (green) | **EVICTED** |

`fetchRegistry` slices **after** the name sort, upstream keys are reverse-DNS, and the claimed
subject is the corpus's **only** `io.*` entry (prefix census `{ac:2, ag:2, ai:14, io:1}`). It
sits at index **18 of 19** — dead last, so the cap reaches it *first*. Headroom is **6**.

Measured through the real `projectSnapshot` (in-process, no socket — INV-M4): `+6 → 25`
retains it; `+7 → 26` evicts it. So **closing S0's shortfall by growing the cohort is the same
action that deletes this project's own trust page, and the gate turns green as it happens.**

Two tests already pinned the slice mechanism (`snapshot-projection.test.ts:208`,
`refresh-from-mirror.test.ts:602`) over synthetic `io.example/*` fixtures. Both are correct and
both are blind to this: a mechanism test says *"the cap slices after the sort."* It cannot say
*"and the entry that sorts last is the one page this project claims about itself."* That gap is
why `tests/invariants/registry-cohort-retention.invariants.test.ts` asserts over the **real
committed corpus**, deriving the index and the headroom rather than restating them.

What eviction costs, as a census rather than as a harm claim: one served row in
`apps/web/public/trust/index.json` (`status: "baked"`, `verdict: "SAFE"`, real `pageDigest`);
**three** references in `artifacts/phase-2.4/presentation-lock.json`, of which
`semanticContract.resources[18].canonicalSlug` sits at the *same last index* the subject holds
in the cohort; and **no second copy** — `claims/claim-store.json` (2 keys) and
`snapshots/adoption-index.json` (0 subjects) do not carry the self-claim, so the served snapshot
is its only home.

**Not fixed here.** The three candidate remedies — raise the cap, exempt the self-claim from the
slice, or seed the cohort from a pinned list — are each an ingest-policy or served-bytes change
requiring its own authorization. The row records them with the production chain
(`refreshSnapshot.ts:143` → `:330` → `snapshotProjection.ts:113`) so the next batch repairs
rather than re-derives.

**Its falsification test is stated in the row, and it is not the obvious one:** a cohort of 25
with the page present proves *nothing*, because 25 is the single size at which the hazard is
invisible. The row is falsified only by **≥26 on `main` with the page still served.**

## §5 S0-OPEN-2 re-measured: the corrected exit code has no consumer

`grep -rn "gate:s0"` returns **two** hits, both script *definitions* in `package.json:42-43`.
No workflow, no `ci:local` step, no test, no cron. **Nothing invokes this gate**, so the exit
code §3 just made honest is currently read by no one.

This changes S0-OPEN-2 from independent to **sequential**: scheduling a gate that could not see
its own failure would have scheduled a false green, so the order was forced. It also attaches a
cost that did not exist before — the gate now spawns vitest over 156 tests, ~25 s — which is an
input to *where* it gets wired, not an argument against wiring it. The row stays **OPEN**.

## §6 Negative controls

Applied to **source or artifact, never to a test**; backed up with `cp`, restored from that
copy, each verified byte-identical afterwards. A positive control ran first, so a red could not
be a broken importer.

| # | Mutation | Observed failure |
|---|---|---|
| 163 | flip one derived char in `snapshots/adoption-index.json` | `GATE RED: 2/156 test(s) failed: …committed-tree.test.ts → failed`, `INV-R6 ✗`, EXIT=2 — **the same bytes the old tier printed `✓` on** |
| 164 | rename the `NAMED_GATES` anchor | `PRECONDITION FAILED: INV-R6: anchor absent — …` — the delete/rename direction a run alone cannot see |
| 165 | `--gate --no-run` | refused, EXIT=2 |
| 166 | `--no-run` in report mode | `–  SKIPPED …; the named gates were not run, so this is not a pass` |
| 167 | remove the claimed subject from `official-mcp-registry.json` (19→18) | 5 failed / 1 passed, every message naming `io.github.calllint/calllint` and printing the observed value; the lock-reference test correctly stayed **green** |
| 168 | rename INV-R6's `it()` title away, **leave both comments** | `anchor present only in COMMENTS — "control #117" no longer names a test`. **Green before §3.1** — this is the control that falsified `anchorIsComment` |
| 169 | loosen `stripComments`'s line-comment pattern | **GREEN at first** — the guard's fixture could not distinguish the two patterns. After adding a `https://` line: `OVER-STRIPPED: an it() title containing "https://" did not survive` |

Two of the seven falsified this batch's own work rather than confirming it (#168 the boolean and
its artifact sentence, #169 the guard's fixture), which is the reason the controls are run
against source instead of against the tests that assert over it.

**#168 and #169 also corrected the per-gate report line.** Under #168 the tier red on the
precondition while the per-file line still printed `INV-R6 ✓`, because the *file* passed. A
per-gate tick that contradicts its own tier is the §2 defect in miniature, so the tick now
requires both the run passing **and** no precondition naming that gate, printing
`passed (but its named assertion is missing)`.

## §7 What this batch deliberately did not do

- **PR #234 untouched.** Merging it is the action that closes S0-OPEN-1 (its 25 records would
  land on `main`), and it is a served-bytes change under `apps/web/public/**` needing its own
  authorization. Independently measured unsafe: `gate:s0 --gate` exited 0 while 37 tests were
  red, which is exactly the defect §3 removes.
- **No remedy for S0-OPEN-4.** Filed with its production chain and its falsification test. §4.
- **`gate:s0` not wired into CI.** §5 measures the gap; wiring it is a CI-spend decision.
- **The original `GATE-VERIFIED` table stays verbatim** in the artifact, with the correction
  appended beneath it. ADR 0061 §8.5.1: a falsified claim keeps its bytes, because the record of
  having been wrong is the part that stops the next batch re-deriving it.

## §8 Correction 2026-08-10 (S batch 2, ADR 0070) — the runtime figure in §2 and §5 is wrong

§2 and §5 both state the batched `vitest run` over the three named gate files costs **~25 s**.
Measured three times on the S batch 2 machine, via `pnpm gate:s0:regression` end to end:
**7 s / 9 s / 9 s**, 156/156 passing, EXIT=0. The **156 tests** figure is right; the seconds are
out by roughly 3×.

The overstatement was never timed — it was estimated while arguing that the cost was an input to
*where* the gate runs. At ~8 s that question dissolves: it goes in the main matrix as one more
step, which is what S batch 2 did. So the figure did not merely misreport a number, it sustained a
scheduling deliberation that the measured number does not support. Both figures stay in place, here
and in the artifact, because "estimated a cost, then reasoned from the estimate" is the reusable
part.

§7's last bullet — *"`gate:s0` not wired into CI … wiring it is a CI-spend decision"* — is now
resolved and no longer describes the repository. It was correct as of this ADR. S batch 2 wired a
**third** mode, `--regression`, into `ci:local` and `ci.yml`, and closed S0-OPEN-2 by explicitly
**refusing** that row's own first remedy: report mode was measured to exit 0 unconditionally (with
DEP-8's scan token deliberately broken it still printed `✗` and exited **0**), so scheduling it
would have reinstated one level up the exact defect §2/§3 removed. `--gate` stays out of CI, since
it is red on `main` for the cohort shortfall alone. See ADR 0070 and S0-OPEN-2's closing amendment.
