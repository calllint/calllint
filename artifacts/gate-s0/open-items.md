# Gate S0 — carried open items, in committed bytes

Gate S0 is `scripts/gate-s0.ts`, wired as `gate:s0` (report), `gate:s0:gate` (enforcing),
`gate:s0:regression` (the mode `ci:local` and `ci.yml` run) and `gate:s0:identity`.
`--gate` is **deliberately outside `ci:local`**, and the reason CHANGED on 2026-08-28 rather
than merely being restated. The original argument (`scripts/gate-s0.ts:7-16`, kept verbatim
there as a record) was that the cohort was short, so a `--gate` run was *expected to fail* and
a permanently-red gate teaches a team to ignore it. Measured 2026-08-28: `pnpm gate:s0:gate`
exits **0** — five assertions ✓, cohort 150 against a requirement of 25. S0-OPEN-1 closed
2026-08-13, so that reason had been expired for a fortnight while the docblock still asserted
it. The current reason is the opposite one: `--gate` enforces a REQUIREMENT the cohort now
exceeds, which makes it a milestone rather than a per-PR regression check — green for as long as
the milestone holds, and therefore silent about the thing CI needs to watch. `--regression`
watches that.

Until this file existed, **S0's status lived only in `docs/gate-s0-next.md`**, which is
gitignored. So the status of a gate that decides whether the registry-expansion axis can
proceed existed on exactly one machine, in bytes no reader and no other clone could see.
Workstream M hit this same defect and named it: a correction only reaches the copy that
something reads (`artifacts/mcp-2026-07-28/open-items.md`, M-OPEN-2). This file is the S-side
answer, and `tests/invariants/gate-s0-claims.invariants.test.ts` is its first machine reader.

**Append discipline (ADR 0061 §8.5.1).** A falsified claim stays verbatim and gains a nested
amendment. Overwriting a stale value destroys the record of what was believed and why it was
wrong, which is the history that makes a finding worth anything.

---

## S0-OPEN-1 — `--gate` mode cannot pass, and the recorded reason was false

**Status:** **CLOSED 2026-08-13** — `1115639` put `count: 25` on `main` and `gate:s0:gate` exits 0
there; the `inputs:` half was discharged the same day. See the closing section at the end of this
row for the measurements, and for the scar it hands S0-OPEN-4 (the self page was evicted at cohort
**25**, by alphabetical rank, before ADR 0075's reservation existed).

**What `--gate` does today.** `scripts/gate-s0.ts:498` computes
`registryShort = censusRegistry < S0_REQUIRED_RECORDS` with `S0_REQUIRED_RECORDS = 25` at
`:59`, and the `--gate` block below it exits `2` on a shortfall even when all five assertions
pass. The served census is **19** registry pages (`apps/web/public/trust/index.json`, cohort
census `{"fixtures":20,"mcp-registry":19}`); fixtures are excluded from the requirement on
purpose (`FIXTURE_PREFIX` at `:66`). So `--gate` exits 2 on the cohort size alone.

> **Line pointers corrected 2026-08-10 (S batch 1).** These read `:234` / `:45` / `:52`
> when written. S batch 1's EXECUTED tier added imports and a ~90-line runner, moving every
> line below the docblock. The drift was caught by `assertPointer`, which asserts each line's
> **content** rather than its existence — the third consecutive batch to find a rotted pointer
> this way (M26-3 found `server.ts:61` on a blank line; M26-8 found `:173` for `:175`). The
> exit-block pointer is now named by its variable rather than by a line range, because a range
> rots faster than a name and nothing was reading the range.
>
> The shortfall pointer then drifted **again inside this same batch**, `:401` → `:498`, when
> `stripComments` became string-aware. Recorded because one line number moving twice in one
> sitting is the case for content-addressed pointers over numeric ones: what made both moves
> harmless is that the assertion carries the expected **content**, so each failure printed the
> line it actually found. A pointer asserting only that line 401 exists would have passed both
> times, and the record would now cite a docblock.

**The recorded reason, verbatim, and why it is false.** `docs/gate-s0-next.md:64` records:

> `VERDICT: BLOCKED — cohort size 19/25, cannot satisfy S0's 25-record requirement`

framed as an upstream limit — upstream has only 19, so nothing in this repo can fix it. The
**number 19 is correct**. The **framing is false**, and it is false in a way that made the
whole registry-expansion axis look unsolvable. Upstream holds **19_739** `active` + `isLatest`
names, measured 2026-08-04 by a walk that ran to `reason=exhausted`
(`packages/adoption-index/src/identity/resolveIdentity.ts:16`), out of **65_235** total records
across **653** pages in **7090s** (`packages/adoption-index/src/operations/refreshFromMirror.ts:56`).
19 is not upstream's size. It is **our own projection's** size.

**Where the 19 actually comes from — and the first answer was wrong too.** The obvious
culprit is `DEFAULT_MAX_ENTRIES = 25` at `packages/trust-index/src/fetchRegistry.ts:19`, with
`.slice(0, max)` applied *after* the name sort at `:109`. That is a real cap and it does select
alphabetically rather than by consideration. But it is **not what produced the 19**, for two
reasons that had to be measured rather than assumed:

1. `fetchRegistrySnapshot` has **no production caller**. The scheduled ingest runs
   `packages/trust-index/src/refreshSnapshot.ts`, whose step 1 calls `refreshFromMirror`
   (`:330-339`) — the cursor-paginated path in `@calllint/adoption-index`. `fetchRegistry.ts`
   does a **single un-paginated `GET`** (`:100`, no cursor handling anywhere in
   `packages/trust-index/src/`), so a 25-entry cap on it could never be the binding constraint
   on a 19_739-name source.
2. A cap of 25 cannot produce 19. `.slice(0, 25)` over ≥25 live entries yields exactly 25. The
   snapshot holds 19, so **fewer than 25 live entries reached the slice** — the cap never
   bound at all.

**What actually bound.** The committed snapshot is frozen at
`fetchedAt: 2026-07-17T00:00:00.000Z`, `count: 19`
(`packages/trust-index/snapshots/official-mcp-registry.json`, last touched `49af7d4`,
2026-07-22, #200). It is stale because **the pipeline that would refresh it has not completed
since**, and the failure was ours:

| When | What | Where |
|---|---|---|
| 2026-07-27 | ingest **succeeded**, produced `count: 18` — one *fewer* than committed | PR #234, still open |
| 2026-08-03 | ingest **failed**: `MirrorIncompleteError: mirror read stopped at the record cap (1000/1000)` | `DEFAULT_MIRROR_MAX_ENTRIES = 1000`, `DEFAULT_MAX_PAGES = 40` |
| 2026-08-05 | caps raised to `100_000` / `1000` — **two days after the failure** | `e24f6a0` (#256) |
| since | **no run has completed**, so the fix is unexercised in production | `trust-ingest.yml` last run 2026-08-03 |

So the blocker is a **stale projection behind a pipeline whose fix landed after the failure it
fixes and has not been exercised since** — not an upstream shortage. The remedy is a completed
ingest, which is a run, not a code change.

**A second, independent blocker the false reason concealed.** Even a completed ingest cannot
reach 25 today. `resolveMaxEntries` (`refreshSnapshot.ts:144-150`) caps the *served* cohort at
`DEFAULT_MAX_ENTRIES = 25`, and its own docblock at `:137-143` states the knob is
`TRUST_INGEST_MAX_ENTRIES`, described as *"the ONLY knob for 37 → 100+"* and as a
**"workflow_dispatch input"**. Measured against `.github/workflows/trust-ingest.yml`:
`workflow_dispatch:` at `:20` has **no `inputs:` block**, and the ingest step at `:73` sets
**no `env:`**. The same claim recurs at `:69-72`, which says
`TRUST_INGEST_MIRROR_MAX_ENTRIES` / `TRUST_INGEST_MIRROR_MAX_PAGES` are settable
*"HERE or as a workflow_dispatch input without a code change"* and calls a remedy naming an
unavailable knob *"not a remedy"* — while naming three knobs the workflow does not expose.
So all three env knobs are reachable only by editing the workflow, i.e. by a code change.
That is the asymmetry `:71` claims to have closed, still open.

> **DISCHARGED 2026-08-13.** `workflow_dispatch:` now carries an `inputs:` block (three optional
> `string` inputs) and the ingest step now carries the matching `env:`, so each of the three knobs
> reads `github.event.inputs.*`. The paragraph above is preserved verbatim because the *shape* of
> the defect is the finding: a comment asserted a capability, and the assertion was load-bearing
> in a remedy, for as long as nothing read the workflow to check. `:73` is now `:112`.
>
> Typed `string` rather than `number` deliberately: an empty `number` input coerces to `0`, and
> `0` is a value every resolver **rejects** (`n <= 0` → default). That still fails safe, but it
> reaches the default via the "invalid" branch instead of the "absent" branch on every unfilled
> run. `string` keeps absence absent, so an unfilled dispatch is byte-identical to the scheduled
> run — verified behaviourally at `100 / 100_000 / 1000`, with `"0"` rejected and `"500"` honoured.
>
> The guard that pinned this row's *absence*
> (`tests/invariants/gate-s0-claims.invariants.test.ts`) was inverted in the same change, on that
> test's own instruction, and its negative control was run: reverting the workflow reds exactly 2
> assertions, each naming the missing `inputs:` / `env:`. A ledger guard that cannot red when its
> subject regresses would be [[a-green-negative-control-must-be-diagnosed]] again.

25 is also exactly the boundary: `censusRegistry < 25` fails, so the cohort must reach 25
served registry pages, and the cap that selects them is 25. A completed ingest over 19_739
live names would emit exactly 25 and satisfy the gate — but only because the cap and the
requirement are the same number, which is a coincidence worth recording rather than relying
on. Raising either without the other moves the gate.

**Why this row is OPEN and not fixed here.** Three separate authorizations, none given:
- running or re-running the scheduled ingest (a network action on the sole scanner),
- adding `inputs:` to `trust-ingest.yml` (workflow surface change),
- any expansion step 25 → 100 → 500, which ADR 0061 §11 authorizes for **no** batch yet, and
  which `artifacts/adoption-index-v1/current-gaps.md:137-146` records as a *deliberate,
  gated* absence: *"Recording it as a gap is not a request to close it."*

> **2026-08-13 — the second of the three was granted, and only the second.** The `inputs:` change
> is authorized and landed (see the discharge note above). The first and third are **still not
> given**: no ingest has been run or re-run from this batch, and no expansion step was taken —
> `DEFAULT_MAX_ENTRIES` stayed where ADR 0074 put it and `S0_REQUIRED_RECORDS` is untouched at 25.
> Recording which one moved matters because the `inputs:` block makes 100/500 a *form field*: the
> capability to expand now exists without a code change, and that is precisely not the same thing
> as authorization to use it.

**What would make this row false.** A completed `trust-ingest` run whose snapshot carries
`count >= 25`, together with `gate:s0:gate` exiting 0. Either alone is insufficient: a passing
gate with a stale snapshot would mean the requirement was lowered, and a fresh snapshot with a
red gate would mean one of the five assertions broke.

**Do not merge PR #234 to close this.** Its head snapshot carries `count: 18`, measured
2026-07-27, which is *fewer* than the committed 19. Merging it shrinks the cohort and moves
this row further from false while appearing to be progress.

### Amendment 2026-08-10 — the run happened, and it satisfies this row's own falsification test

Everything above was measured on 2026-08-09 and is left verbatim. Within a day, three of its
statements became false. Recorded as an amendment rather than an edit, because *what changed
them* is the finding.

**The pipeline completed.** `trust-ingest` run `31368307622` started 2026-08-10T08:02:07Z and
succeeded at 08:11:12Z, all 11 steps green. So the table row above reading
*"since | **no run has completed**, so the fix is unexercised in production"* is now false:
`e24f6a0`'s raised caps ran in production for the first time, five days after landing, and held.
The mirror read **69_327** records and stored **20_852** current subjects — no
`MirrorIncompleteError`, and far past the old `1000` cap that produced the 2026-08-03 failure.

**The snapshot reached exactly 25.** `snapshot: 25 entry(ies) @ 2026-08-10T08:02:29.262Z`.
Confirmed on the PR head rather than trusted from the log: `count: 25`, `entries: 25`,
`fetchedAt: 2026-08-10T08:02:29.262Z`. This is the 25/25 coincidence above behaving exactly as
predicted — 20_852 live subjects projected through `DEFAULT_MAX_ENTRIES = 25` emit 25, not more.
It also settles the number the false reason got wrong: upstream's size is five digits, and the
19 was only ever our own projection's.

**`gate:s0 --gate` exits 0 on those bytes.** Measured in a throwaway worktree at the PR head,
not inferred from the count:

```
Registry:  25 / 25 required (met)      Fixtures: 20 (excluded by design)      Total: 45
[MEASURED]      INV-R5    ✓  reconciles 45 = 25 snapshot + 20 fixtures
[MEASURED]      INV-R4    ✓  44/45 judgeable; SAFE+UNKNOWN found 5, all fixture-anchor
[GATE-VERIFIED] INV-04+R7 ✓     [GATE-VERIFIED] INV-R6 ✓     [GATE-VERIFIED] DEP-8 ✓
✓ All assertions passed, cohort meets the requirement          EXIT=0
```

That is **both** halves of *"What would make this row false"* above, and in the order the row
required: the requirement was **not** lowered (`S0_REQUIRED_RECORDS` is still 25 — the cohort
rose to meet it), and no assertion broke to get there.

**Why this row is nevertheless still OPEN.** The 25 entries live on
`trust-ingest/registry-refresh`, not on `main`. On this checkout's served bytes the gate still
reports `Registry: 19 / 25 required (SHORTFALL)`. A gate that passes on an unmerged branch has
not passed. Merging #234 is a served-bytes change under `apps/web/public/**` and needs its own
authorization, which is not given here — so this row closes when those bytes are on `main`, and
not before.

**The "do not merge #234" warning above is now wrong about its reason, and right about its
conclusion.** `trust-ingest.yml` **force-pushes the same branch** rather than opening a new PR,
so #234's head is no longer the 2026-07-27 commit: it is a single commit `9ca5c7e` dated
2026-08-10T08:11:03Z, and the `count: 18` snapshot that made merging it *harmful* no longer
exists anywhere. The warning's conclusion survives on the unrelated ground that merging is an
authorization decision, not on the ground it was written on. Both statements are kept: the
falsified reason is the record of why a PR's identity cannot be inferred from its title and
creation date — #234 still *presents* as a 2026-07-27 PR titled for a July refresh.

**AMENDED 2026-08-11 (S batch 5, ADR 0074) — the boundary paragraph above is now stale in its
premise, and its conclusion changed sign.**

That paragraph says *"the cap that selects them is 25"* and closes *"Raising either without the other
moves the gate."* S batch 5 raised exactly one of them: `DEFAULT_MAX_ENTRIES` is **100**,
`S0_REQUIRED_RECORDS` is **unchanged at 25**. So the gate did move — **deliberately, and in the
direction this row wanted**:

- The requirement is untouched, so *"`censusRegistry < 25` fails, so the cohort must reach 25"*
  remains exactly true. **This row's own boundary is unaffected.** Nothing here got easier to satisfy.
- What is no longer true is *"only because the cap and the requirement are the same number."* A
  completed ingest now emits up to 100, not exactly 25, so satisfying this row no longer depends on a
  coincidence between two unrelated constants.
- The coincidence was not neutral. At 25 == 25, the cohort size satisfying this row was the size at
  which the cap began evicting `io.github.calllint/calllint` — see S0-OPEN-4 for the arithmetic and
  ADR 0074 for the decision. Closing this row and deleting this project's own trust page were the
  same action. They are now separable.

**PR #234's `count: 25` head is unaffected by the cap raise**, and this is the one place a reader
could be misled: 25 ≤ 100, so a 25-entry snapshot is emitted whole under either cap. Merging it would
still satisfy this row. What changed is that it is no longer the *only* size that does — and the next
ingest after such a merge no longer evicts at 26.

### CLOSED 2026-08-13 — the bytes are on `main`, and the separation ADR 0074 promised arrived two days late

**Status above is now `CLOSED`.** Both halves of *"What would make this row false"* hold on `main`,
each measured on this checkout rather than inferred:

- `git merge-base --is-ancestor 1115639 main` → **yes**. PR #234 merged as `1115639`; the snapshot
  carries `count: 25`, `entries: 25`, `fetchedAt: 2026-08-10T08:02:29.262Z`.
- `pnpm gate:s0:gate` → **EXIT 0**, `Registry: 25 / 25 required (met)`, `ratchet floor 25 (held)`,
  all five assertions green (`INV-R5`, `INV-R4`, `INV-04+R7+R6` over 174 tests, `DEP-8`).

The order the row demanded is satisfied: `S0_REQUIRED_RECORDS` is **still 25**, so the cohort rose
to meet the requirement rather than the requirement dropping to meet the cohort, and no assertion
broke to get there. The clause *"On this checkout's served bytes the gate still reports 19 / 25
required (SHORTFALL)"* is false as of `1115639`; the served census is now
`{"calllint-fixtures":20,"mcp-registry":25}`, total 45.

**The scar, and it belongs to S0-OPEN-4.** The ADR 0074 amendment above closes with *"Closing this
row and deleting this project's own trust page were the same action. They are now separable."* That
separation is real in the code and **arrived two days after the fetch that needed it**. Measured:

| What | When | Consequence |
|---|---|---|
| the ingest fetch that produced these 25 entries | 2026-08-10T08:02Z | `main` was `439829c`: `DEFAULT_MAX_ENTRIES = 25`, a bare `.slice(0, max)` after the name sort |
| ADR 0074 raised the cap 25 → 100 | 2026-08-12 (`07f9b22`, #290) | too late to affect the 08-10 selection |
| ADR 0075 added `selectCohortEntries` + `RESERVED_COHORT_NAMES` | 2026-08-12 (`08d65fe`, #291) | the reservation mechanism **did not exist** at fetch time |

So `io.github.calllint/calllint` was not retained, and it was not retained for the reason 0074
predicted: **113 live upstream names sort before it**, so it is outside both cap 25 and cap 100 on
alphabetical rank alone. It is **not** absent upstream — `?search=calllint` returns v0.2.0,
`active` + `isLatest`, published 2026-07-13T02:58:25Z, before the fetch. The earlier 19-entry
snapshot carried it as its last entry with only 18 predecessors, i.e. it had been **injected**, not
selected. Nothing in `apps/web/public/trust/mcp-registry/` or
`apps/web/public/install/mcp-registry/` now names it, and
`artifacts/phase-2.4/presentation-lock.json` retains three orphaned references (`:61`, `:62`,
`:657`).

**This row closes anyway, and deliberately.** Its falsification test never mentioned the self page —
that is S0-OPEN-4's subject (*"observation clause — cohort ≥ 26, verify CallLint page retained"*),
and folding a second requirement into this row at closing time would be moving the goalposts in the
direction of keeping a row open. What this closure hands S0-OPEN-4 is a sharper subject than it had:
its trigger is written as *cohort ≥ 26*, and the eviction it exists to catch **already happened at
cohort 25** by a mechanism its trigger cannot observe. Two guards were weakened toward that absence
(`tests/invariants/registry-cohort-retention.invariants.test.ts:166`,
`packages/trust-index/test/self-claim-dogfood.test.ts:98`) — each now returns early with a single
`it.skip` when the name is missing from the snapshot, so **22 assertions and 2 of 3 tests do not
run**, and the suite is green *because* the only checks that could see the regression are switched
off. Re-arming them requires deciding whether the reserved list should inject an absent-from-cohort
name or whether this project accepts not being in its own index — a product judgement, unresolved,
and tracked in S0-OPEN-4 rather than here.

---

## S0-OPEN-2 — `gate:s0` is outside `ci:local`, so nothing runs it on any schedule

**Status:** **CLOSED 2026-08-10** (S batch 2, ADR 0070) — but by **neither** of the two disjuncts
this row wrote for itself, and that is the finding. Its first disjunct was *measured and refused*.
See the second amendment at the end of the row. Everything between here and there is the
2026-08-09/2026-08-10 text, left verbatim, including the runtime figure the close corrects.

`package.json:42-43` wires `gate:s0` and `gate:s0:gate`; `:75`'s `ci:local` has **19**
`&&`-joined steps and includes **neither**. (Both counts moved when this row closed: a third
script `gate:s0:regression` was added and `ci:local` now has **20** steps, the twentieth being
that mode. The 2026-08-09 figures are left as written — see the closing amendment.) (The count is asserted by the reader rather than
trusted here — an earlier draft of this line said 18, which is the kind of number that rots
quietly.) The exclusion is argued and correct (`scripts/gate-s0.ts:5-7`). The
consequence is not addressed: no workflow, no cron, and no test invokes either script, so the
five assertions S0 measures are re-measured only when a human remembers to type the command.

`vitest.config.ts:35` includes only `packages/**`, `apps/**`, `tests/**`, so `scripts/` is out
of test scope with no exclude entry needed — the gate cannot be reached by the suite either.

**Distinct from S0-OPEN-1.** That row is about a value the gate reads (the cohort). This one is
about the gate never being read. Fixing the cohort would leave this untouched: a passing gate
nobody runs is the same as a failing one.

**What this file does about it.** Nothing, and that is deliberate — the reader added alongside
this file asserts over **S0's committed source and this artifact**, not over a gate run. It
cannot execute `gate:s0`, because doing so would read `apps/web/public/trust/index.json` and
make a test depend on baked bytes. What it does assert is that the five assertion IDs and the
`S0_REQUIRED_RECORDS` value this file cites still exist in `scripts/gate-s0.ts` — so this
record cannot silently drift from the gate it describes.

**What would make this row false.** Either a scheduled invocation of `gate:s0` in report mode
(measuring is useful even when the gate would fail), or a recorded decision that manual
invocation is sufficient, with the reason stated. The second is a legitimate close; an
unstated status is not.

### Amendment 2026-08-10 (S batch 1) — re-measured, still OPEN, and now with a cost attached

Re-measured rather than restated: `grep -rn "gate:s0"` across `.github/workflows/**`,
`package.json`, and `scripts/**` returns **two** hits, both the script *definitions* at
`package.json:42-43`. No workflow, no `ci:local` step, no test, no cron. So the row's claim
holds verbatim: **the gate's exit code has no consumer at all.**

That reframes S0-OPEN-3's fix (below) more sharply than either row anticipated. This batch made
`--gate` unable to report success while its named tests fail — but a corrected exit code that
nothing reads changes nothing about what CI enforces. The two rows are therefore **sequential,
not independent**: S0-OPEN-3 was a prerequisite for this one being worth closing, because
scheduling a gate that cannot see its own failure would have scheduled a false green.

**A cost this row did not previously carry.** `gate:s0` now spawns vitest over three files
(**156 tests**, ~25s wall clock), so a scheduled report-mode invocation is no longer free. That
is an argument about *where* it runs, not whether: `--no-run` exists for a caller that has
already run `pnpm test`, and is **refused under `--gate`** so the cheap path can never be
mistaken for enforcement.

**What would make this row false — unchanged**, plus one addition: if the answer is a scheduled
run, it must state whether it runs with `--no-run` and why, since that choice decides whether
the EXECUTED tier is evidence or decoration.

### Amendment 2026-08-10 (S batch 2, ADR 0070) — CLOSED, by refusing this row's own first remedy

The row is closed by a **third** mode, `--regression`, wired into both `ci:local` and
`.github/workflows/ci.yml`. Neither of the two disjuncts above is what closed it. The first was
measured and found to carry the exact defect S batch 1 had just removed from `--gate`; the second
was available but would have been a worse answer once the first was understood.

**Why the first disjunct — "a scheduled invocation of `gate:s0` in report mode" — was refused.**
Measured before implementing, by breaking report mode's subject and observing its exit code:
DEP-8's flag scan was pointed at a token that does not exist in the source, and report mode
printed `✗` beside DEP-8 and **exited 0**. Report mode exits 0 *unconditionally*; it has no
failing mode at all. So scheduling it would have added a CI step that cannot fail — a step whose
green says nothing about the bytes it read. That is ADR 0069 §2's defect wearing a workflow file:
the previous batch stopped `--gate` printing `✓` over red bytes, and this row's own suggested
remedy would have reintroduced it one level up, as a scheduled green over any bytes whatsoever.
The parenthetical justifying it — *"measuring is useful even when the gate would fail"* — is true
of a human reading output and false of CI, which reads only the exit code.

**Why not `--gate`.** It exits 2 on `main` today for the cohort shortfall (19 < 25, S0-OPEN-1),
and only merging the registry expansion can clear that. Wiring it would pin the required check red
for a reason **no PR under review can fix**, which is a different way of making CI's signal
meaningless. The reader asserts `gate:s0:gate` never appears in `ci.yml` or `ci:local`, so this
cannot be "fixed" later by wiring the enforcing mode without that assertion going red first.

**What `--regression` enforces, and the one thing it does not.** Exit 2 if any of the five
assertions fails, or if the registry cohort **shrinks** below a floor derived from HEAD. The
25-record requirement is reported as census — the number is printed, never enforced. This is the
split the row could not see while treating "the gate" as one thing: the 25-record *requirement*
is what cannot pass today, but the five *assertions* all pass on `main` right now, and a passing
assertion nothing runs is not a measurement. Two failing modes, separated:
`registryShort` (true on `main`, not a regression) and `cohortRegressed` (false on `main`, a real
defect if it ever goes true). Blending them into one boolean is what made the gate unwireable.

**The floor cannot be edited slack.** `S0_REGRESSION_FLOOR` is asserted `<= S0_REQUIRED_RECORDS`
at load time — incoherent constants exit 2 before any measurement — and pinned by the reader
against `packages/trust-index/snapshots/official-mcp-registry.json`, the **input** the gate
reconciles against under INV-R5, not the served bytes. A future batch that lowers the floor to
make a red CI green reds the pin instead. Anchoring to the upstream snapshot rather than
`apps/web/public/trust/index.json` is deliberate and is this row's own rule applied to itself: a
test must not depend on baked bytes.

**`--no-run` is refused under `--regression`**, as it already was under `--gate`, so the addition
this row asked for is answered by construction rather than by prose: CI runs the full form, and
the cheap path can never be mistaken for enforcement. The two modes are also mutually exclusive —
asking for both exits 2 rather than silently preferring one.

**The cost, re-measured — the figure above is wrong.** This row's first amendment says
**~25s wall clock**, and ADR 0069 §5 and §11 repeat it. Measured three times on this machine:
**7s / 9s / 9s**, 156/156 tests passing, EXIT=0. The `**156 tests**` figure is correct; the
seconds are out by roughly 3×, and the corrected number is what made "where does it run" a
non-question — at ~8s it goes in the main matrix, not on a schedule. Both figures are kept: the
overstatement is the record of a cost estimated rather than timed, which is what turned a
one-line wiring decision into a paragraph of scheduling deliberation.

**What is NOT closed by this.** S0-OPEN-1 is untouched: the cohort is still 19/25 and
`--regression` deliberately does not enforce that. S0-OPEN-4 is untouched and is now the one that
matters most, because closing S0-OPEN-1 by expanding the cohort **evicts CallLint's own claimed
page** at cohort 26 — and would do so while going green. `--regression`'s floor does not see that
either: it counts records, and an eviction that adds a record while removing the self-claim
holds any floor. That is S0-OPEN-4's business, and its three remedies each need their own
authorization.

**What would make this closure false.** If `ci:local` or `ci.yml` stops invoking
`gate:s0:regression`, or if `--regression` ever exits 0 with an assertion red. Both are asserted
by the reader in `tests/invariants/gate-s0-claims.invariants.test.ts`, in both files, so the
closure is guarded rather than declared.

**Measured side by side, since this row's refusal rests on it.** With `INV-R6`'s anchor pointed at
a token that does not exist, on the same bytes in the same working tree:

```
report mode (the refused remedy)   ✗ INV-R6: anchor absent …          EXIT=0
--regression (what CI runs)        ❌ one or more assertions FAILED   EXIT=2
```

Both **print** the failure. Only one **reports** it. That is the whole difference between the
remedy this row prescribed and the one that closed it.

**A fourth consumer of `ci:local`'s script string, found by it going red.** Appending a step to
`ci:local` red `pnpm ci:local` itself, at **Gate 2.4-H**, not at the new step:
`artifacts/phase-2.4/gate-H-no-regression.json` embeds that `&&`-joined string **verbatim** and
byte-compares it. Regenerated with `pnpm eval:phase-2.4:gates:write`; the diff is exactly one line,
the appended step. Recorded because this row's own first amendment enumerated the consumers of
`ci:local` (`package.json:75`, the reader's step count, and this row's prose) and **missed this
one** — so the next batch that edits `ci:local` should expect a drift-checked artifact to move with
it, and should not mistake that red for a defect in its own step.

**One control changed the reader rather than confirming it.** Control #174 swapped `ci.yml`'s step
to `gate:s0:gate` — the precise mistake the exclusion assertion exists to catch — and the red read
*"expected … to contain 'pnpm gate:s0:regression'"*: true, but it names a **missing step** instead of
the hazard, because the presence assertion sat before the exclusion and short-circuited it. The
exclusion never ran. The order is now exclusion-first, and the swap reds on the swap.
[[assertion-order-decides-falsifiability]] — inside the file that cites it, and in the same batch
where the `ci:local` half of the very same test already had the order right. Getting the principle
right once in a file does not propagate it to the next assertion in that file.

### Amendment 2026-08-11 (S batch 2, post-push) — the closing evidence was a text match, and the remote falsified it

Everything above was verified locally and pushed as `d825330`. **The workflow it added never ran.**

The step went in unquoted:

```yaml
- name: Gate S0 (regression: assertions + cohort ratchet)
```

An unquoted `: ` inside a YAML scalar makes the **whole file** unparseable. GitHub reported *"This
run likely failed because of a workflow file issue"*, the `test` job never started, and the failure
mode is **worse than a red build**:

| | observed |
|---|---|
| `gh pr checks 286` | **six green**, `build-and-test` **absent from the list** |
| `gh pr view --json mergeable` | `MERGEABLE` / `BLOCKED` |
| `gh run list` | `.github/workflows/ci.yml  completed  failure` — **zero jobs** |

A workflow that does not parse contributes **no check runs at all**, so the required check does not
go red — it stops existing. The rollup showed only the six independent workflows, all green.

**The 22 assertions this row calls its closing evidence all passed on those bytes**, because the
reader read `ci.yml` as text:

```ts
expect(ci, "ci.yml must run it").toContain("pnpm gate:s0:regression")
```

That is true of a file no runner can execute. The assertion's subject is *"a string is present"*;
the claim is *"CI runs the step."* **This is ADR 0069 §2's defect — a probe agreeing with the
description of a claim instead of the claim — reproduced inside the batch that closes the row about
it, in the very evidence offered for the closure.** The batch measured report mode's exit code
rather than trusting its output, then trusted its own reader's `toContain` without asking what it
would accept.

**Repair, and why it is a parse rather than a better regex.** No regex distinguishes an executable
workflow from an unparseable one; only a parser does. So `ci.yml` is now parsed, and Gate S0's step
is looked up as a **structure** — a `run:` value inside `jobs.test.steps` — with `build-and-test`
asserted to survive in the parsed job graph, because an **absent** required check is not a failing
one. A second test parses **all fifteen** workflows: nothing in this repo could have caught this in
any of them.

`yaml@2.8.2` is now a pinned root devDependency. It was **not** declared before, and
`require.resolve("yaml")` on this machine returned `D:\my-web-app\node_modules\yaml` — a package
**outside the repository**, hoisted from a parent directory. A test importing it would have passed
here and been missing in CI: [[lockfile-crlf-unpinned]]'s local-green/remote-red shape, arriving
through the module resolver instead of through line endings. Control #179 confirms the declaration
is load-bearing.

**Three more controls, each restored byte-identical:**

| # | mutation | required failure |
|---|---|---|
| 177 | remove the quotes — the exact bytes that were pushed | both new assertions red, naming the **file and the parser's line** (`ci.yml: Nested mappings are not allowed … at line 152`), not `expected false to be true` |
| 178 | comment out one workflow's `jobs:` key — still valid YAML | only the **shape** assertion reds, printing `[ 'action-selftest.yml' ]`; the parse assertion stays green, so the two bounds are independent |
| 179 | drop `yaml` from `devDependencies` | `pnpm install --frozen-lockfile` — CI's first step — refuses by name, so an undeclared parser cannot reach the suite |

**What this says about the closure.** The row is still CLOSED, and by the same reasoning: the
refusal of report mode was measured, and control #175's side-by-side exit codes stand. What was
wrong was not the decision but the **evidence that the decision had been applied**. A row closed by
*"CI runs it"* needs a reader that can tell whether CI **can** run it, and until this amendment it
had one that could only tell whether the bytes mentioned it.

Kept by append, not corrected in place: the sequence *local green → pushed → the remote had no
opinion at all* is the reusable part, and a reader that silently gained a parser would leave no
record that it once had none.

### Amendment 2026-08-14 (Workstream P Batch 8, ADR 0080) — 20 → **21** steps, and the step is a ledger

**Still CLOSED. `ci:local` now has **21** `&&`-joined steps.** The twenty-first is
`pnpm ledger:presentation:validate`, added by ADR 0080 alongside a `ledger-authenticity` job in
`ci.yml`. The count above is left as written, for the reason this row already gives about its own
18/19/20 sequence: a figure that rots quietly is worth keeping visible, and the reader in
`tests/invariants/gate-s0-claims.invariants.test.ts` is what makes the live number binding.

**Why a ledger check belongs in the chain this row is about.** `scripts/presentation-ledger.ts`
splits validation in two: `validateOffline` recomputes every recorded digest from each entry's
stored document, and `validate` adds the git layer — each commit is an ancestor of HEAD, and the
stored document is byte-identical to the document at that commit. Only the git layer decides
*authenticity*; the offline layer, by construction, reports zero faults for a self-consistent
forgery. And the git layer had **no automated reader anywhere**: `ci.yml`'s `test` matrix checks out
at depth 1, so historical shas are unknown objects and `historyIsReachable()` stands the layer down.
The fault class it exists to catch — a squash-merge rewriting the sha an entry recorded — has fired
**twice** (#249, #293), both times found by a human running the suite on a full clone.

**`remoteOnly: false` is the honest column, which is what forces the count to move.** The new
`REGRESSION_CHECKS` row could have been marked `remoteOnly` — the job it binds to is remote, and
that would have left `ci:local` at 20 and this row's number untouched. It would also have been
false: `remoteOnly` means a local run *cannot* prove the check, and this fault class is fully
local-reproducible. Both times it fired, a local run is exactly what proved it. So the row is
`remoteOnly: false`, membership in `ci:local` follows, and 20 → 21 follows from that.

**The number moved because the honest value of a different field required it** — not to satisfy a
count. Recording that direction matters: the tempting edit was the one that kept this row's figure
stable by mislabelling the check.

### Amendment 2026-08-18 (Harness Distribution Surface, H0-H8) — 21 → **22** steps

**Still CLOSED. `ci:local` now has **22** `&&`-joined steps.** The twenty-second is
`pnpm check:harness-distribution`, added as a truth gate for the H0-H8 harness distribution
surface batch. This gate validates that public harness pages advertise only CLI commands that
exist in the shipped product, and that support-class claims match registered extractors.

The count above is left as written, for the same reason this row gave for its 18/19/20/21
sequence: numbers that rot quietly are worth keeping visible, and the reader in
`tests/invariants/gate-s0-claims.invariants.test.ts` is what makes the live number binding.

### Amendment 2026-08-19 (Global Agent Distribution Authority, G3.5) — 22 → **23** steps

**Still CLOSED. `ci:local` now has **23** `&&`-joined steps.** The twenty-third is
`pnpm check:web-structure`, added as a validation gate for the G3 Global Agent Distribution Authority
batch. This gate validates that the website's public surface structure matches the expected layout,
ensuring that agent-facing distribution surfaces and harness pages are properly organized.

The count above is left as written, continuing the 18/19/20/21/22 sequence pattern: numbers that rot
quietly are worth keeping visible, and the reader in
`tests/invariants/gate-s0-claims.invariants.test.ts` is what makes the live number binding.

### Amendment 2026-08-19 (Global Agent Distribution Authority, G7 closure) — 23 → **25** steps

**Still CLOSED. `ci:local` now has **25** `&&`-joined steps.** The two added are
`pnpm check:agent-surface` and `pnpm check:security-semantics`.

Both were added for the same reason, and it is the reason this row exists: the properties they
measure were TRUE and UNENFORCEABLE. Neither was a new feature.

- `check:agent-surface` covers §19 (every agent-facing document must point at
  `agent-surfaces.json`, so an agent never has to scrape `/harnesses/` HTML), §20 (a human page
  must render the public support label — Auto-detects / Scan config / Guide only — never the
  internal `NATIVE`/`CONFIG_SCAN`/`DISCOVERY_ONLY`/`DEFERRED` enum), and GD-15 (the sitemap must
  promise exactly the pages that exist). GD-15 was not merely unguarded, it was VIOLATED:
  `harnesses/sitemap.xml` was hand-maintained and had drifted to 9 URLs, all under
  `/harnesses/deepseek/`, 8 of them the model × harness cartesian pages that `79f3cb8`
  deliberately deleted — so `robots.txt` was advertising a sitemap that submitted 8 dead URLs to
  crawlers, on precisely the SEO plane the distribution contract forbids, while listing none of
  the 15 canonical host pages. The sitemap is now generated from the SSOT.
- `check:security-semantics` runs `verify-security-semantic-diff.mjs --check`, which asserts the
  committed `artifacts/authority-distribution-closure/security-semantic-diff.json` still agrees with a live
  three-channel measurement (verdict-package diff, forbidden risk fields, host-identity coupling
  into the risk engine). A committed `"changed": false` is otherwise an unfalsifiable claim.

`check:registry-presence` was deliberately NOT added: it queries the live Official MCP Registry
API, so wiring it here would red `ci:local` on any offline machine for a reason no local change
can clear. It belongs to `distribution-watch.yml`, which already runs it.

The count above is left as written, continuing the 18/19/20/21/22/23 sequence pattern: numbers that
rot quietly are worth keeping visible, and the reader in
`tests/invariants/gate-s0-claims.invariants.test.ts` is what makes the live number binding.

---

### Amendment 2026-08-22 (Agent Discovery v2, new19 Phase 1) — 25 → **26** steps

**Still CLOSED. `ci:local` now has **26** `&&`-joined steps.** The one added is
`pnpm check:distribution-drift`.

It exists because the two gates added in the previous amendment could both pass on stale bytes.
`check:agent-surface` and `check:harness-distribution` read the GENERATED tree
(`apps/web/public/harnesses/**`, `agent-surfaces.json`, the sitemap), but nothing asserted that
tree still matched what `apps/web/data/distribution-surfaces.json` projects. Editing the SSOT and
forgetting to run the generator therefore left both gates green while the served pages described
an older cohort — the projection was unenforced in exactly the way §19/§20 were before G7.

`check:distribution-drift` is `generate-distribution-surfaces.mjs --check`: the same code path as
the write mode, routed through a single `emit()` so a green means "the tree is current" rather
than "two generators agree". It is ordered BEFORE both consumers deliberately; a stale tree must
be named as stale, not inherited by whichever gate happens to read it first.

Two failure modes, both proven by negative control rather than argued: a 1-byte edit to a
generated page reds it with that page named, and a DELETED generated page reds it with the reason
`absent from the working tree`. The second is the case `git diff` structurally cannot observe —
an untracked file is invisible to it — which is how the previous drift check read green while a
generated file was missing entirely.

The 25 above stays as the measurement at `cd0837c`. Two dated figures coexisting is the point of
this list: overwriting the older one would convert a history into a claim.

### Amendment 2026-08-22b (Agent Discovery v2, new19 §19 watcher) — 26 → **27** steps

**Still CLOSED. `ci:local` now has **27** `&&`-joined steps.** The one added is
`pnpm check:published-schema`.

It exists because new19 §19 lists "schema changes" among the watcher's five weekly checks, and
nothing observed them at all. The schemas under `apps/web/public/schemas/` are what an external
consumer resolves and switches on, and three of their properties are contracts rather than
details: `$id` (the URL a consumer resolves), `schemaVersion.const` (the identifier it switches
on — deliberately distinct from the Safe-install bake's `calllint.discovery.v1`, and the two
documents becoming confusable is what already dropped `resources[]` once on this workstream), and
`additionalProperties: false` (the only reason validation catches an invented field, so flipping
it to `true` turns every downstream validator into a no-op while every test still passes).

Ordered BEFORE `check:distribution-drift`, which is itself before the two gates that read the
generated tree. The reason is the same one that put drift first, one level up: drift compares
regenerated bytes against disk, and the schema contract decides what those bytes are allowed to
be. A broken contract with a passing drift check reports that the tree matches a projection nobody
should trust.

Deliberately NOT asserted: the schemas' field sets. Adding an optional field is backward
compatible and normal; a gate that red on it would be routed around within a month. Only the three
properties above red.

The 25 and the 26 above both stay. Three dated figures now coexist in this row, which is what
makes the sequence readable as a history of when CI grew and why, rather than as a single current
claim with its provenance discarded.

### Amendment 2026-08-28 (Gate S1) — 27 → **28** steps, and the step is the gate one level up

**Still CLOSED. `ci:local` now has **28** `&&`-joined steps.** The one added is
`pnpm gate:s1:regression`.

Every previous amendment in this row added a *check*. This one adds a *gate*, and it is here
because of what closing S0-OPEN-1 did not do. That row's blocker was the 25-record shortfall; it
closed 2026-08-13 when the cohort reached 25. The cohort then kept going — 100, then 150, driven by
ADR 0086's auto-growth — and crossed **Gate S1's own 100-record threshold** with nothing on the
other side. `docs/new15-execution-status.md` still lists S1 as ⬜ and names its seven measures, but
that file is gitignored (`.gitignore:44`), so S1's entire status lived on one machine. No script, no
`gate:s1` npm script, no CI step. The seven measures new15 says to take at 100 were never taken.

The fault class is the one this artifact exists to make visible, one rung purer than usual. The
repo's recurring defect is *a guard that cannot observe its subject*; S1 was **a threshold with no
guard at all**. Nothing red when the cohort crossed it, because there was nothing to red — and the
proof the crossing really happened is `S0_REGRESSION_FLOOR = 150`, a ratchet that followed the
growth up while the gate meant to grade it did not exist.

`--regression`, not `--gate`, for a reason measured rather than assumed: four of the seven measures
(adapter-failure-rate, processing-time mean/p95, cas-dedup-rate, disk-growth) have **no data source
today** — `.var/calllint-adoption-index/` is empty in all ten data tables, and CAS and dead-letter
are empty directories. So `--gate` REFUSES those four and exits 2 by design. Wiring it here would
pin the required check red for a reason no PR under review can clear, which is verbatim the hazard
the 2026-08-10 closure refused report mode over — the opposite failure, but the same rule.

The four are REFUSED rather than computed. That distinction is the whole reason this gate is worth
having: a rate over an empty denominator renders as **a perfect score**, and that is not
hypothetical — it is the defect `gate-s0.ts`'s own first INV-R4 shipped, reading a nonexistent
sidecar path, `continue`-ing 39 times, and printing "0 dangerous false-SAFE" as PASS from zero
observations. A `0/0` here would have printed a flawless S1.

The 25, 26 and 27 above all stay. Four dated figures now coexist.

**One pointer inside this row's 2026-08-09 text is now stale, and is left stale deliberately.**
That text cites `scripts/gate-s0.ts:5-7` for the exclusion argument. Those three lines still
hold the argument's *opening*, but the argument itself now spans `:7-16` and is explicitly
marked as expired prose kept for the record — the live reason is the amendment at the foot of
that docblock. Renumbering the citation inside verbatim 2026-08-09 text would make the row read
as though it always pointed at a corrected argument. The file header carries the current
pointer and the current reason; this row keeps what it said when it said it.

---

## S0-OPEN-3 — three of S0's five assertions are GATE-VERIFIED, which reads a string

**Status:** **CLOSED 2026-08-10** (S batch 1, ADR 0069) — by this row's own first disjunct: the
three became EXECUTED. See the amendment at the end of this row. Everything below is the
2026-08-09 text, left verbatim, including the two claims the close falsified.

`scripts/gate-s0.ts` splits its five assertions by provenance, and prints the split
(`:243-247`):

| Assertion | Provenance | What it does |
|---|---|---|
| INV-R5 terminal state + reconciliation | **MEASURED** | derives the expected total; never hardcodes it |
| INV-R4 no dangerous SAFE+UNKNOWN | **MEASURED** | set-equality domain check + vacuity guard |
| INV-04 + INV-R7 | GATE-VERIFIED | reads two gate files' assertion text |
| INV-R6 (`control #117`) | GATE-VERIFIED | reads for the control's identifier |
| DEP-8 three CLI flags | GATE-VERIFIED | reads for three `--expect-*` flags |

GATE-VERIFIED means the gate greps another file for the *text of an assertion* and concludes
that assertion holds. It does not re-run it. The split is honestly labelled — which is why
this is a recorded limit rather than a defect — but a labelled limit that nothing reads decays
the same way an unlabelled one does. A refactor that renames an assertion string flips three of
five assertions to failing without any behaviour changing; a refactor that *deletes* one while
leaving its comment flips them to passing while the property is gone.

**Not fixed here, and not fixable cheaply.** Re-running INV-04/INV-R7/INV-R6/DEP-8 for real
means invoking four other gates from inside S0, which multiplies its runtime by their sum and
makes S0 fail for reasons that are not S0's. The honest intermediate step is what the reader
does: assert the three GATE-VERIFIED probes still find their targets, so a rename reds *here*
with a name on it rather than silently downgrading the gate.

**What would make this row false.** Either the three become MEASURED, or a recorded decision
that string-verification is the accepted contract for cross-gate assertions, naming the risk it
accepts.

### Amendment 2026-08-10 (S batch 1) — CLOSED, and two of this row's own sentences were false

**The row understated its own subject, and the understatement was the reason it stayed open.**
The text above says a delete-with-comment-left-behind *"flips them to passing while the property
is gone"* — correct, and filed under refactor hygiene. It does not say the same thing happens
when the test is **present and FAILING**, which needs no refactor at all and is reachable on any
red suite. Demonstrated on `main`, not argued: the byte-identical re-derive assertion inside
`committed-tree.test.ts` was broken while the grepped `control #117` comment was left untouched.
That run went `1 failed | 123 passed`, and the gate printed

```
[GATE-VERIFIED]  INV-R6  ✓  byte-identical derivation verified
```

on those same bytes. A tier whose green survives its own subject's failure is not weaker
evidence than MEASURED — it is evidence of **a different proposition** than the one it prints.

**`control #117` is carried by comments as well as by its test.** MEASURED: three occurrences in
`committed-tree.test.ts` — `:50` and `:116` in comments, `:145` in the `it()` title. A raw-text
probe is therefore satisfiable by the prose *about* the test, so renaming or deleting the test
leaves the probe green. The row's *"assert the three probes still find their targets"* intermediate
step was, for this gate, satisfiable without any target existing.

> **Correction, same batch (S batch 1).** This paragraph first read *"All three occurrences … are
> in comments; the string appears in **no** `it()` title"* — false, and falsified by re-running the
> grep it claimed to rest on. It was written alongside a `NamedGate.anchorIsComment: true` field in
> `scripts/gate-s0.ts` carrying the same error. Recorded rather than quietly replaced because the
> shape of the mistake is the batch's own subject: a sentence asserting something *about* a probe,
> with nothing reading it. The prose and the boolean agreed with each other for one run and with the
> corpus never — two copies of a claim are not two measurements of it.
>
> The repair is not a corrected boolean. The field asked the wrong question: what decides whether a
> scan can see a deletion is not *"is this anchor in a comment"* but *"does a comment ALSO carry
> it."* So `anchorIsComment` is gone, the scan strips comments before matching (`stripComments`), and
> a comments-only survivor is reported as `anchor present only in COMMENTS` rather than as absent —
> the two need different repairs. **Control #168** renames the `it()` title away, leaves both
> comments, and now reds by that exact wording; it was green before this correction. The stripper is
> itself guarded two-sidedly from inside the gate (`assertStrips`), because **control #169** loosened
> its line-comment pattern and the guard stayed **green** until the fixture gained a `https://` line
> — the guard's fixture had no line where code preceded the marker, so leading-only and
> anywhere-on-the-line were indistinguishable. Adding that line also red the real stripper on the
> opposite side (a trailing `// … control #X` was not stripped), so `stripComments` became
> string-aware rather than regex-only. One under-strip and one over-strip, both now pinned.

**The "not fixable cheaply" claim was false, and its arithmetic was never done.** The row argued
re-running the gates *"multiplies its runtime by their sum and makes S0 fail for reasons that are
not S0's."* Measured: one batched `vitest run` over the three named files is **156 tests in ~25s**
— not a multiplier on anything, because the three files were always going to run in `pnpm test`
anyway. The second half is also backwards: S0 failing when INV-R6 fails is not a foreign reason,
it is the entire proposition S0 was printing a tick for.

**What replaced it.** `scripts/gate-s0.ts` now has a three-tier provenance split:

| Tier | Meaning | Assertions |
|---|---|---|
| **MEASURED** | computed here from committed bytes | INV-R5, INV-R4 |
| **EXECUTED** | the named gates are RUN; S0's verdict is that run's verdict | INV-04, INV-R7, INV-R6 |
| **SCANNED** | the subject is SOURCE, so reading it *is* the measurement | DEP-8 |

Four properties, each with its own failure mode, because the obvious single check has holes on
both sides:

1. **The string scan survives as a PRECONDITION**, not as a substitute. Scan-without-run is green
   while the assertion is present and failing; run-without-scan is green after the assertion is
   *renamed or deleted*, since the file still passes. They catch opposite things.
2. **Keyed on the parsed JSON report**, never on the child's exit status or stdout — per
   `[[subprocess-negative-control-prints-fail]]`. Concretely: the child prints failing-test output,
   so a caller reading the stream cannot distinguish `1 failed` from a fixture that prints `FAIL`.
3. **Absence is its own outcome.** A missing, empty, or unparseable report, a file the runner never
   collected, or a file that collected **0 tests**, each returns not-ok with the reason named — per
   `[[absence-must-not-become-a-category]]`. A two-way ok/not-ok split over a possibly-absent report
   would let a crashed runner sort itself into whichever branch the falsy value satisfied.
4. **`--no-run` is refused under `--gate`.** A flag that turns enforcement off would restore this
   exact defect with a command-line switch instead of a grep. In report mode a skip prints `–`,
   never `✓`, and does not satisfy `allOk`.

**DEP-8 stayed a scan, and the relabel is the point.** Its subject is `apps/cli/src/commands/trust.ts`
— **source, not a test**. There is nothing to run, so reading the source for its three `--expect-*`
flags *is* the measurement. Calling that GATE-VERIFIED alongside two test-file probes was the
labelling error underneath this row: one name covered two different epistemic situations, so
fixing the tests' tier would have silently downgraded DEP-8's honest name or dragged a source scan
into a runner that has no test to execute.

**Controls that validated the close** (numbering continues from #162, ADR 0068 §8; each applied to
**source or artifact, never to a test**, run, observed to fail naming its own subject, rolled back
and confirmed byte-identical):

| # | Mutation | Observed failure |
|---|---|---|
| 163 | flip one derived character in `snapshots/adoption-index.json` | `GATE RED: 2/156 test(s) failed: …committed-tree.test.ts → failed`, per-file `INV-R6 ✗`. **Same bytes the old tier printed `✓` on** |
| 164 | rename the anchor in `NAMED_GATES` to a string not in the gate file | `PRECONDITION FAILED: INV-R6: anchor absent — "control #99999-renamed"` — the delete/rename direction the run alone cannot see |
| 165 | `gate:s0 --gate --no-run` | refused, EXIT=2: *"enforcement cannot be asked to skip itself"* |
| 166 | `gate:s0 --no-run` (report mode) | prints `–  SKIPPED (--no-run); the named gates were not run, so this is not a pass` — never `✓` |

**#163 is the one that matters**, and it is worth stating why: it is not merely a red control. It
is the *same mutation* that produced the false green above, re-run against the new tier. A control
that only turned red would show the new code works; this one shows the old code was wrong, on
identical bytes.

**What is NOT closed by this.** The corrected exit code still has no consumer — see S0-OPEN-2's
amendment. `--gate` remains red on `main` for the cohort shortfall (S0-OPEN-1), which is the
correct verdict and unrelated to this row.

---

## S0-OPEN-4 — closing S0's shortfall evicts CallLint's own claimed page, and the gate goes green as it happens

**Status:** **OPEN, and its subject changed on 2026-08-13 from a future hazard to a PRESENT absence**
(filed 2026-08-10, S batch 1, ADR 0069). Both authorizable remedies have landed: the cap raise
(2026-08-11, ADR 0074) and the reserved-retention selection rule (2026-08-12, ADR 0075) — the eviction
is gone from the *rule* at every cohort size, which is what those two amendments measured and still
holds. What they could not do is retroactively protect a snapshot fetched **before** the rule existed,
and that is what `main` now serves: the self page is **absent from the served tree today**, at cohort
**25**. See the 2026-08-13 amendment at the end, which measures the absence, refutes the "upstream
deleted us" reading of it, and narrows what remains to a single authorization. Everything below is the
original text, left verbatim, including the census sentence the 2026-08-12 amendment measures as **false
in all three of its clauses**, and the two 2026-08-11 clauses the 2026-08-13 amendment measures as
stale (*"today's `main` carries 19"*).

**The arithmetic, over two constants that are the same number by coincidence.**
`S0_REQUIRED_RECORDS` (`scripts/gate-s0.ts`) == `DEFAULT_MAX_ENTRIES`
(`packages/trust-index/src/fetchRegistry.ts`) == **25**. The requirement is satisfiable only once
the cohort reaches 25; the cap begins evicting at 26. Both numbers are read from their declaring
files by the guard, never restated, so a batch that moves one alone reds:

| Cohort size | S0 `--gate` | CallLint's own page |
|---|---|---|
| 19…24 | SHORTFALL (red) | present |
| **25** | **MET (green)** | **present** ← the only size satisfying both |
| 26+ | MET (green) | **EVICTED** |

S0-OPEN-1 already recorded the 25/25 coincidence as *"worth recording rather than relying on."*
This row is what it costs: **the action that closes S0's shortfall by growing the cohort is the
same action that deletes this project's own trust page**, and the gate reports success while it
happens. Not a slippery-slope argument — arithmetic.

**Why the claimed subject is first in line, measured.** `io.github.calllint/calllint` sits at index
**18 of 19** — dead last. Prefix census of the committed cohort: `{ ac: 2, ag: 2, ai: 14, io: 1 }`.
Upstream names are reverse-DNS and this is the **only** `io.*` entry, so sorting last is
**structural**, not a coincidence of today's 19 names. Derived headroom is **6**: a seventh
alphabetically-earlier upstream name evicts it. Simulated through the real `projectSnapshot`, not a
reimplementation — `+6 → cohort 25, retained 25, PRESENT`; `+7 → cohort 26, retained 25, EVICTED`.

**Why the existing tests could not see it.** `snapshot-projection.test.ts:208` and
`refresh-from-mirror.test.ts:602` both pin `["io.example/alpha", "io.example/mike"]` over synthetic
fixtures. Both are correct and both are blind here: a **mechanism** test says *"the cap slices after
the sort."* It cannot say *"and the entry that sorts last is the one page this project claims about
itself."* Three tests asserted the mechanism; none asserted the consequence.

**What eviction costs, censused rather than asserted as harm:**
- `apps/web/public/trust/index.json` carries exactly **one** row for
  `mcp-registry/io.github.calllint-calllint` — `status: "baked"`, `verdict: "SAFE"`, real
  `pageDigest`. Eviction removes the row, so the bake stops emitting the page.
- `artifacts/phase-2.4/presentation-lock.json` holds **three** references keyed to that slug:
  `contentPlane.overriddenSlots[34]`, `[35]`, and `semanticContract.resources[18].canonicalSlug`.
  `resources[18]` is the *same last index* the subject holds in the cohort — the lock's resource
  list is in cohort order, so the eviction boundary and the lock's tail are the same boundary.
- **No second copy exists.** `claims/claim-store.json` has 2 keys, none matching;
  `snapshots/adoption-index.json` has 0 subjects. The served snapshot is its only home.

**The production chain, corrected — three locations, not the one previously recorded.**
S0-OPEN-1 names `fetchRegistry.ts:19` + `:109` as the cap, then correctly observes
`fetchRegistrySnapshot` has no production caller. The cap that actually binds the served cohort is
reached by a different path, and it must be written down or the next batch re-derives it:

```
refreshSnapshot.ts:144  resolveMaxEntries(env)   → DEFAULT_MAX_ENTRIES, raisable via TRUST_INGEST_MAX_ENTRIES
refreshSnapshot.ts:331  refreshFromMirror({ snapshotMaxEntries: maxEntries, … })
                        → snapshotProjection.ts:113   ← the slice that evicts
```

`snapshotProjection.ts:15-19` already flags the shape in its own docblock: *"Step 3 caps AFTER step
2, so the retained 25 are the 25 alphabetically first — NOT the 25 most recent. That is a
surprising property and it is load-bearing."* Load-bearing was right; what it bears is this row.

**Why this row is OPEN rather than fixed.** Every candidate remedy is a decision this batch is not
authorized to take, and they are not equivalent:
- **Pin the claimed subject into the cohort unconditionally** — changes `snapshotProjection.ts`
  semantics, i.e. `packages/adoption-index/**`, and makes the projection non-uniform in the
  subject's favour. That is a product judgement about self-dealing in a trust index, not a bug fix.
- **Raise `DEFAULT_MAX_ENTRIES` above `S0_REQUIRED_RECORDS`** — decouples the two constants and
  buys headroom, but ADR 0061 §11 authorizes no expansion step (25 → 100 → 500) for any batch yet,
  and `artifacts/adoption-index-v1/current-gaps.md:137-146` records the absence as *deliberate and
  gated*.
- **Replace alphabetical slicing with a considered selection** — the honest fix, and the largest.

**What would make this row false.** A recorded decision on which of the three applies, *plus* a
cohort at ≥26 on `main` with the claimed subject's served page still present. A cohort at exactly
25 does not close it: 25 is the single size where the hazard is invisible, so passing there is the
one outcome that proves nothing.

**Interaction with S0-OPEN-1 that a reader must not miss.** PR #234's head carries `count: 25` —
*exactly* the overlap size. Merging it would satisfy S0 **and** retain the page, and would tell you
nothing about size 26. The next ingest run after that merge is where this row bites.

**AMENDED 2026-08-11 (S batch 5, ADR 0074) — the second remedy was authorized and applied. This row
stays OPEN, and the reason it stays open is the finding.**

`DEFAULT_MAX_ENTRIES` is now **100** (`fetchRegistry.ts:34`). `S0_REQUIRED_RECORDS` is **unchanged at
25** — the requirement did not move, only the cap. The equality this row was built on is gone:

```
                        before (25 == 25)        after (100 > 25)
cohort 19..24           SHORTFALL, self present  SHORTFALL, self present
cohort 25               MET, self present  ←only MET, self present
cohort 26..100          MET, self ** EVICTED **  MET, self present     ← 76 sizes, was 1
cohort 101+             —                        MET, self ** EVICTED **
```

The single overlap size became a 76-size interval `[25..100]`, so *closing S0's shortfall* and
*deleting this project's own trust page* are no longer the same action. That was the whole defect
this row named, and it is defused.

**What the cap did NOT do, measured rather than assumed.** It did not remove the eviction; it moved
it. The slice is still alphabetical and `io.github.calllint/calllint` is still the only `io.*` name,
so it still sorts last and is still the first entry the cap reaches. At **any** cap the claimed
subject is evicted at cohort `cap + 1` — measured through the real projection: 25 → evicts at 26,
100 → at 101, 500 → at 501. **Headroom was bought, not safety.** The third remedy above (a
considered selection instead of alphabetical slicing) remains the only one that removes the hazard,
and it remains unauthorized.

**So this row's closing condition is unchanged and still unmet.** It requires a cohort at ≥26 **on
`main`** with the served page present. Today's `main` carries 19. The cap raise makes that outcome
*reachable* — before it, any cohort ≥26 evicted the page by construction — but reaching it needs an
ingest run, which is a network action on the sole scanner and needs its own authorization.

**One correction to this row's own census.** The prefix table above records `{ ac: 2, ag: 2, ai: 14,
io: 1 }`. Measured on the committed snapshot it is `{ ac: 2, ag: 1, agency: 1, ai: 14, io: 1 }` — the
row collapsed `agency.` into `ag`. The conclusion is unaffected (one `io.*` entry, sorting last), but
a census that miscounts its own buckets is worth correcting where it stands.

**Where the inequality is now enforced,** so a revert reds by name rather than silently restoring the
coincidence:
- `tests/invariants/registry-cohort-retention.invariants.test.ts` — asserts `cap > required`, and
  asserts the overlap interval's endpoints are `[required, cap]`. Its scan bound is **derived from
  the cap**; the previous hardcoded `extra <= 12` was accidentally correct at 25 and would have
  reported 7 of the 76 satisfying sizes here — a truncated answer that reads as data.
- `tests/invariants/gate-s0-claims.invariants.test.ts` — the former "these are the SAME number"
  assertion is inverted to the inequality, with the requirement's literal pinned *after* the
  relationship (order is load-bearing) and the cap's literal deliberately **not** pinned, since ADR
  0074 expects it to move again.
- `fetchRegistry.ts:19-33` — the docblock states the never-equal rule and the defer-not-remove
  arithmetic at the declaration itself.

**AMENDED 2026-08-12 (S batch 6, ADR 0075) — the THIRD remedy was authorized and applied. This row is
now CLOSED IN CODE and stays OPEN only on its `main`-cohort clause, which no code change can reach.**

**What changed.** The hazard is **removed at the selection rule**, not deferred by headroom.
`selectCohortEntries`
(`fetchRegistry.ts:86`, duplicated verbatim at `snapshotProjection.ts`) retains every name in
`RESERVED_COHORT_NAMES` (`fetchRegistry.ts:68`) against the cap, then fills the remaining budget
alphabetically, then re-sorts so the output stays in **name order**. The reserved name takes a slot,
never an extra one — the cap remains an absolute ceiling, asserted as `count === cap`.

```
                        after ADR 0074 (cap 100)   after ADR 0075 (this row)
cohort 19..25           SHORTFALL/MET, self present  same
cohort 26..100          MET, self present            same
cohort 101+             MET, self ** EVICTED **      MET, self ** PRESENT **   ← the row's defect, gone
```

Measured through the real projection: there is now **no cohort size** at which the claimed subject is
evicted, probed at the old boundary, at `boundary + 1`, and at `boundary + 1 + 4 × cap`.

**Why the reserved list is keyed on the REGISTRY name and never the slug.** `registryCanonicalName`
lowercases and maps every `[^a-z0-9._-]` run to `-`, so `io.github.calllint-calllint`,
`IO.GITHUB.CALLLINT/CALLLINT` and `io.github.calllint/CALLLINT` **all collide** onto the one slug
`mcp-registry/io.github.calllint-calllint`. `-` (45) sorts before `/` (47), so the first impostor lands
*ahead of* the real name. Exact equality over the original reverse-DNS name is the only unimpersonable
form — the same defence `claim.ts:166-173`'s `namespaceCovers` already applies. Guarded by
`registry-cohort-retention.invariants.test.ts`, which probes the reserved list **directly** rather than
probing survival: uppercase `I` (73) sorts before lowercase `a` (97), so an uppercase impostor enters the
alphabetical prefix on its own and *survives without being exempted*. Survival cannot tell the two apart.

**Why the list is a static in-code constant and not a claim-store lookup.** `refreshFromMirror.ts:290-296`
records that feeding any part of resolved identity into `projectSnapshot`'s input breaks the byte gate:
the projection must stay a function of `records` alone. An active verified claim for exactly this subject
**does** exist (see the census correction below), and it still cannot be the source.

**Why the rule is duplicated rather than imported.** trust-index depends on adoption-index; adoption-index
has **zero** imports of trust-index and the import-boundary gate keeps it that way
(`snapshotProjection.ts:21-26`). So both copies carry the rule and their equivalence is asserted
*behaviourally* — `snapshot-projection.test.ts` byte-compares the two paths on a payload where the cap
binds **and** a reserved name would have been evicted, and asserts the two lists hold identical members.
That case had to be written: every pre-existing byte-equivalence fixture is `io.example/*`, so both sides
agreed by **never running the reserved branch**.

**Correction to this row's own census, the second one.** The 2026-08-11 line above reads *"**No second
copy exists.** `claims/claim-store.json` has 2 keys, none matching; `snapshots/adoption-index.json` has 0
subjects."* **Every clause of that is false, and both halves failed the same way — the probe read a field
name that does not exist.** Measured at `packages/trust-index/`:

| claim | measured |
|---|---|
| claim-store "has 2 keys, none matching" | the 2 keys are the top-level `schema` + `records`; `records` holds **2 claim records, BOTH** for `mcp-registry/io.github.calllint-calllint` — one `revoked` (`installationId` 147742681), one **`active`** (148693982, `verifiedAt` 2026-07-24T09:44:55.534Z) |
| adoption-index "has 0 subjects" | the field is `entries`, not `subjects`; it holds **19**, of which **1** is this subject (`identityStatus: PROVISIONAL`, `canonicalName: io.github.calllint/calllint`) |
| "the served snapshot is its only home" | **refuted** — there are three copies: the served index, the adoption-index projection, and an active verified claim |

The row's *conclusion* still stood on its own (eviction removes the served page, and the page is what the
bake emits), which is exactly why the wrong census survived two batches unchallenged. The served-index
half of the census was re-measured and **is correct**: `apps/web/public/trust/index.json` carries exactly
**one** row for the slug, `status: "baked"`, `verdict: "SAFE"`, and within the 19-row `mcp-registry`
cohort it sits at **index 18 — the last**, which is the ordering fact the whole row rests on.

**And a third census correction, in the opposite direction — this row was RIGHT where the guard was
wrong.** The `presentation-lock.json` count of **three** is correct, but the three do not share a key
form, and that is why the sibling census in
`tests/invariants/registry-cohort-retention.invariants.test.ts` recorded only **two**:

```
contentPlane.overriddenSlots[34]   overrides.resources.mcp-registry__io.github.calllint-calllint.displayName
contentPlane.overriddenSlots[35]   overrides.resources.mcp-registry__io.github.calllint-calllint.reason
semanticContract.resources[18]     canonicalSlug = "mcp-registry/io.github.calllint-calllint"
```

The first two key the subject as a **flat dotted path with `__` where the slug has `/`**; only the third
holds the slug verbatim. An exact-string search for the slug returns **1**; a search for the `__` form
returns **2**. Both censuses were built by searching one key form and reporting the total — the same
failure mode as the claim-store clause above, and the same one as
[[assert-which-source-answered]]: **a census inherits the blind spots of its key form.** `resources[18]`
is also the *same last index* the subject holds in the cohort, because the lock's resource list is in
cohort order — so the eviction boundary and the lock's tail were always the same boundary.

**What is still OPEN, precisely.** Only the closing condition's *observation* clause: a cohort at ≥26 **on
`main`** with the served page present. That needs an ingest run — a network action on the sole scanner,
with its own authorization — and today's `main` carries 19. What ADR 0074 made *reachable*, this batch
makes **unconditional**: the outcome no longer depends on where the cap sits relative to the cohort.

**Where the retention rule is enforced,** so a revert reds by name:
- `tests/invariants/registry-cohort-retention.invariants.test.ts` — the former "names the EXACT cohort
  size at which the subject is evicted" test is **inverted** to "there is NO such size", keeping the
  `count === cap` ceiling half; plus the slug-impostor test. Its overlap-interval upper endpoint was
  re-derived: it used to be set **by eviction**, and with retention nothing closes the interval, so the
  top is now the scan bound's own last step, asserted with a contiguity check rather than a literal.
- `packages/adoption-index/test/snapshot-projection.test.ts` — the cap-binds-with-a-reserved-name byte
  case and the two-list equality assertion.
- `tests/invariants/gate-s0-claims.invariants.test.ts` — the `.slice(0, max)` pointer is **retired**
  (that string no longer exists) and re-aimed at the reserved list, the selection function, and its call
  site. Fifth consecutive batch to move a pointer in that test; caught only because `assertPointer`
  matches line **content**, not line existence.

> **AMENDED 2026-08-13 — the hazard this row was filed against ARRIVED, before its trigger could fire,
> and two guards were weakened toward it rather than reporting it.**
>
> **What is true on `main` today, measured.** `1115639` landed the 2026-08-10 registry refresh, so the
> cohort is **25** and Gate S0 exits **0**. The self page is **gone**:
>
> | measure | value |
> |---|---|
> | `official-mcp-registry.json` → `count` / carries `io.github.calllint/calllint` | **25** / **no** |
> | `apps/web/public/trust/index.json` → rows for the self slug | **0** (of 45 entries) |
> | `apps/web/public/trust/mcp-registry/io.github.calllint-calllint.json` | **absent** |
> | `claims/claim-store.json` → records for the self slug | **2** (`revoked`, `active`) — the claim outlived the page |
> | `RESERVED_COHORT_NAMES` names the subject | **yes** |
>
> **Why the trigger could never have caught this.** This row's closing condition waits for a cohort
> **≥26** on `main`, on the reasoning that 25 is the one size where the hazard is invisible. That
> reasoning was sound for the cap-equality defect and **wrong for the arriving snapshot**: the eviction
> landed *at* 25, by alphabetical rank, in a fetch that ran against `439829c` where the cap was 25 and
> `selectCohortEntries` **did not exist yet**. A row watching for `≥26` cannot see a loss that happens
> at 25. The condition was keyed to the mechanism, not to the subject — so it went on waiting while the
> thing it protects disappeared.
>
> **The "upstream deleted us" reading is REFUTED, by direct read-only query.** `GET
> /v0/servers?search=calllint` returns **two** records for `io.github.calllint/calllint`: `0.1.1`
> (`isLatest: false`) and **`0.2.0`, `status: active`, `isLatest: true`, published 2026-07-13**. The
> ingest keeps exactly `active` + `isLatest` (`fetchRegistry.ts:154`), so the live registry **does**
> supply this name, and a re-ingest under today's code would see it. An earlier probe that walked 200
> pages and reported the name absent was **truncated, not conclusive** — pagination is not alphabetical,
> so a partial walk cannot establish absence. Consequence: nothing here requires the reserved list to
> *inject* a name upstream does not publish, and no product judgement about self-dealing is on the table.
> The list only has to retain a name that IS in its input, which is what ADR 0075 made it do.
>
> **Why the rule is what retains it, and alphabetical slicing never would.** Counted live: **121**
> `active`+`isLatest` names sort before `io.github.calllint/calllint` within the first 3 pages alone
> (the walk was stopped there — 121 already decides both caps; a full walk exceeds the local budget and
> is the scheduled job's business, `timeout-minutes: 300`). So under plain alphabetical selection the
> subject is outside cap 25 **and** outside cap 100. The 2026-08-11 "headroom was bought, not safety"
> line was right, and the live corpus is the proof: only `RESERVED_COHORT_NAMES` retains this page now.
> Proven offline at caps **25 / 100 / 500** over a 600-name synthetic corpus, with `count === cap` held
> as a ceiling, and with the negative control that an absent name is never fabricated
> (`registry-cohort-retention.invariants.test.ts`).
>
> **The two guards that were weakened toward this absence, now re-armed.** Both had been changed to
> return early with a single `it.skip` when the name is missing from the snapshot — so the suite went
> green *because* the only checks that could observe the regression were switched off: **22 assertions
> and 2 of 3 tests did not run.**
>
> | guard | was | now |
> |---|---|---|
> | `tests/invariants/registry-cohort-retention.invariants.test.ts` | 1 `it.skip`, 22 assertions off | **2 tests run**: the retention rule proved synthetically at 25/100/500, plus a case-(a) test that ASSERTS the absence's shape |
> | `packages/trust-index/test/self-claim-dogfood.test.ts` | 1 `it.skip`, 2 of 3 tests off | **4 tests run**, 2 corpus-gated: the lifecycle 1→0→1 is pure over two Maps, so it runs on a synthetic snapshot through the shipped `registryRepoIndex`; only the served-byte comparisons stay gated, and their precondition is asserted |
>
> Each re-arm was negative-controlled: emptying `RESERVED_COHORT_NAMES` reds **both** retention tests
> (including the exemption branch, which previously could observe nothing); mutating `SELF_CLAIM.canonicalName`
> reds the new precondition test *and* collapses the lifecycle to 0→0→0; planting an orphan served sidecar
> reds the absence-shape test. The distinction the re-arms encode: absence because **upstream never
> published** is honest to skip, absence because **our projection dropped it** must red — and the guards
> now assert which one they are in rather than assuming.
>
> **What remains OPEN, and it is one authorization, not a decision.** The served page returns when a
> re-ingest runs under today's code: `trust-ingest.yml` fetches, `selectCohortEntries` retains the
> reserved name, the bake emits the page, and the workflow opens a PR a human reviews before anything
> serves. That is a **network action on the sole scanner** and needs its own authorization; it has not
> been given, and nothing in this repo may self-trigger it. Until then `main` serves 25 pages without
> ours. The next scheduled run (Mondays 06:17 UTC) would also do it, so the choice is *authorize now* or
> *wait for the schedule* — no code change is pending either way.
>
> **What would now make this row false.** Unchanged in substance but re-anchored to the subject rather
> than the mechanism: the served tree carries `mcp-registry/io.github.calllint-calllint.json` again, on
> `main`, at a cohort **≥26** so retention is proved past the cap-equality size. Both halves, and the
> `≥26` clause is now the *second* half rather than the trigger — because this row has already proved
> that waiting for 26 let the loss happen at 25.

> **Amendment 2026-08-13 (b) — a THIRD consumer of the absence, and it is human-recorded evidence.**
> Measured while landing the branch above: the absence does not only cost a served page, it invalidates
> **Gate 2.4-B's entire human panel**, and it did so on `main` before this branch existed.
>
> `1115639` (#234) replaced the 19-entry snapshot with the 25-entry one. Every served install page's
> bytes changed, and `artifacts/phase-2.4/five-second-panel-store.json` records, per response, the
> `sha256` of the page the participant was **actually shown**. So all **10 of 10** responses are now
> `stale` and excluded from the rates by design (`phase-2.4-eval.ts:99-102`: *"A response whose page has
> since changed is not weaker evidence about the new page — it is none."*). Consequences, each measured
> on a pristine `origin/main` worktree, not inferred:
>
> | measure | on `main` today |
> |---|---|
> | `human-five-second-test.json` committed status | `PASSED`, `staleResponses: 0`, `responses: 10` |
> | what the code actually derives from committed bytes | `PENDING_HUMAN_PANEL`, `staleResponses: 10`, `responses: 0` |
> | `gate-H-no-regression.json` committed | `closed: true`, `openGates: []` |
> | what it derives | `closed: false`, `openGates: [2.4-B]` |
> | `pnpm eval:phase-2.4:panel:validate` | **EXIT 1** — 3 subjects "not a served install page" |
>
> So `main` has been claiming a **closed** new14 release boundary on recognition evidence that no longer
> exists. That is the same failure shape as this row's original finding — a gate reporting success about
> a subject it can no longer see — reached through a different consumer.
>
> **Three of the ten panel subjects have no served page at all**, and ours is one:
> `mcp-registry/ac.tandem-docs-mcp`, `mcp-registry/ac.inference.sh-mcp`, and
> `mcp-registry/io.github.calllint-calllint` (participants 7, 8, 10). The first two left with the
> 19→25 refresh; the third is **this row's subject**. So the re-ingest that restores the page also
> restores the only panel subject we control — while the other two stay unserved regardless.
>
> **What was done, and what was deliberately NOT done.** The three drift artifacts were regenerated, so
> the committed bytes now state `PENDING_HUMAN_PANEL` / `closed: false` — the honest state. This weakens
> no enforced gate: all four Phase 2.4 steps in `ci.yml` run `--check` (drift-only) and **none** runs
> `--gate` (`phase-2.4-eval.ts:233`: *"A pending gate is a state, not a break."*).
> `five-second-panel-store.json` was **not touched** — it is data only a human writes (ADR 0053 §4), and
> deleting three real responses to green `panel:validate` would discard evidence to satisfy a check,
> which is the inversion this ledger exists to catch. Dropping them would not even close the gate: 7
> remaining < the 10-response threshold, so 2.4-B stays `PENDING_HUMAN_PANEL` either way.
>
> **Therefore `pnpm eval:phase-2.4:panel:validate` is EXPECTED RED on `main` and on this branch**, and it
> is red for a true reason. It cannot go green by any code change: it asserts that recorded sessions point
> at pages we actually publish, and three of them do not. Closing it requires **re-running those panel
> sessions against the current pages** — ten human five-second sessions — which no CI run and no agent
> can supply. Tracked here rather than as a new row because the root cause is this row's absence plus
> #234's refresh, not an independent defect.
>
> **Confirmed on CI, not only locally** (run `31683159184`, head `1ad3fbf`). All three matrix legs fail on
> exactly one step — `Phase 2.4 human-panel store validation` — naming the same three responses `[6] [7]
> [9]`; `build-and-test` fails only as *"Require all matrix legs to have succeeded"*, i.e. it relays.
> The `pnpm eval:phase-2.4` drift red that also failed these legs on `main` is **gone**, so the artifact
> regeneration did what it claimed. The six auxiliary jobs (`facts`, `schema-compatibility`,
> `distribution-smoke`, `evidence-fixtures`, `telemetry-boundary`, `agent-integration-smoke`) all pass.
>
> **This branch introduces none of it, measured by byte compare rather than by argument.** `origin/main`
> and this branch each serve **25** install pages, the same 25; all three subjects are absent from both;
> and `git diff origin/main...HEAD -- apps/web/public/install` is **empty** — the PR does not touch a
> single served page. The red arrived with `1115639`.
>
> **The finding worth carrying forward: two mechanisms read the same absence and only one read it
> correctly.** A missing page reaches Gate 2.4-B twice.
> 1. `partitionPanelFreshness` compares `shownDigest` against the digest served **today**, and reports a
>    removed page as `currentDigest === null` → the response is `stale`, excluded, and the gate falls to
>    `PENDING_HUMAN_PANEL`. **Fail-closed, and it worked** — this is what the regenerated artifact records.
> 2. `validate()` (`phase-2.4-panel.ts:217`) tests `existsSync` on the served page and pushes an
>    **integrity error**, which exits 1 and fails the leg.
>
> Both are defensible in isolation; together they classify one event as two different kinds of thing. (1)
> treats "the page is gone" as *evidence expiring* — a state. (2) treats it as *the record being
> malformed* — a break. But the record is not malformed: those sessions genuinely happened, against pages
> we genuinely served on 2026-07-30, and the store faithfully says so. What changed is the world, not the
> file. The docblock above `validate` states its own scope — *"about the RECORD, never about whether an
> answer was right"* — and the `existsSync` check is the one rule in it that is **not** about the record;
> it is about current serving state, which is (1)'s job and which (1) already does better, because it
> distinguishes *page removed* from *page edited* while `existsSync` collapses both.
>
> No change is made here: correcting it means moving a rule out of a validator that CI runs, which is a
> gate-strength change and needs its own ADR — and the honest red is more useful than a silent
> reclassification while this row is open. Recorded so a future batch fixes the **classification** rather
> than deleting the human data, and so nobody reads the green half as proof the absence was handled.

---

## S0-OPEN-5 — Gate 2.4-H asserts 18 checks are "wired" by matching text, so it cannot see that the runner rejects the file

**Status:** **CLOSED 2026-08-11** (S batch 3, ADR 0071) — by this row's own falsification
condition, both halves. See the amendment at the end of this row, which also records that **this
row's second reason for staying OPEN was measured false**. Everything below is the original
2026-08-11 text, left verbatim, including that falsified sentence.

Filed because the defect it describes **already fired once, in this batch**, one layer up: see
S0-OPEN-2's 2026-08-11 amendment. Gate 2.4-H itself belongs to Phase 2.4, so repairing it is that
phase's authorization, not this row's.

**The subject, at `path:line`.** `observeGateH()` in `scripts/phase-2.4-gates.ts:711-731` decides
whether each regression check is wired to CI with two regexes over the workflow's **text**
(`:717-719`):

```ts
const bound =
  new RegExp(`run: pnpm ${escapeRe(c.script)}\\s*$`, "m").test(wfSrc) &&
  new RegExp(`^  ${escapeRe(c.job)}:$`, "m").test(wfSrc)
```

`REGRESSION_CHECKS` (`:637`) has **19 rows**, all naming `workflow: "ci.yml"`, of which **2** are
`remoteOnly` (`pack:smoke`, `pack:smoke:mcp`). `artifacts/phase-2.4/gate-H-no-regression.json`
records **18 bound** (`ci.yml#test`) and **1 null** — `ci:local`, which is the chain itself and has
no workflow step by design.

**Measured, on the exact bytes GitHub refused.** The pushed `ci.yml`
(`git show HEAD:.github/workflows/ci.yml`, the unquoted `- name: Gate S0 (regression: …)` form) is
unparseable: `yaml@2.8.2` reports *"Nested mappings are not allowed in compact mappings at line 150,
column 15"*, and GitHub started **zero jobs** from it. Gate H's regexes applied to those same bytes:

| probe | result on the unparseable file |
|---|---|
| distinct `run: pnpm <script>` lines seen | **23** |
| of those, `workflowBinding` = BOUND | **23** |
| the 18 rows the artifact records as bound | **18 still bound — none lost** |
| `gate:s0:regression` bound? | **true** |
| `^  build-and-test:$` present? | **true** |
| the runtime's own verdict | **parse FAILED, zero jobs** |

So Gate 2.4-H would have reported all 18 checks wired, and the required-check aggregator present, on
a file no runner will execute. This is not a hypothetical: it is a re-run of the state `main`'s
sibling branch was actually in.

**Why this is worth its own row rather than a note.** The mistake is not "someone forgot to parse
YAML." It is that the assertion's *subject* and the gate's *claim* are different propositions:

```
subject: the string `run: pnpm X` appears in ci.yml, and a line reads `  test:`
claim:   check X runs in CI
```

Every failure mode that lives **between** those two — an unparseable file, a step under a job that
`if:`-skips, a job with no `runs-on`, a step inside a job the aggregator does not `need` — is
invisible. ADR 0069 §2 named this shape for a different gate (a probe agreeing with a claim's
*description* instead of the claim); [[assertion-order-decides-falsifiability]] and
[[source-scan-must-read-code-not-prose]] are the same family. Gate H is the **largest** remaining
instance in the repo by row count: 18 claims resting on one text match.

**Why this row is OPEN rather than fixed.**
- Gate 2.4-H is a **drift-checked** gate: `artifacts/phase-2.4/gate-H-no-regression.json` must stay
  byte-identical to a fresh run, so changing how `workflowBinding` is computed changes the committed
  artifact and needs Phase 2.4's regeneration path, not an S-batch edit.
- It reads the same `REGRESSION_CHECKS` list four other gates key off. A parse-based binding may
  legitimately produce a *different* answer for a row (e.g. a step guarded by `if:`), and deciding
  what that answer should be is a Phase 2.4 judgement about what "wired" means.
- This batch already carries its own correction (S0-OPEN-2's amendment). Fixing a second gate in the
  same push would put two unrelated repairs behind one CI result.

**Shape of the fix, for whichever batch takes it.** Do not add a second regex. Parse the workflow
once with the pinned `yaml` devDependency (already declared at root as `yaml@2.8.2` — added by this
batch, see S0-OPEN-2's amendment for why it was previously resolving from *outside* the repository),
then look each check up **structurally**: `jobs[c.job].steps[].run` must contain `pnpm <script>` as a
whole token, `jobs[c.job]` must exist as an object, and the required aggregator must survive in
`Object.keys(jobs)`. Keep the text match as a *precondition* rather than replacing it, for the reason
ADR 0069 §3 gives: a parse alone goes green when a step is renamed away, and a scan alone goes green
when the file cannot run. Two probes, two failure modes, both named.

**What would make this row false.** `observeGateH` resolving `workflowBinding` from a parsed workflow
graph, **plus** a control that applies the pushed unparseable bytes and observes Gate 2.4-H red
naming the parse failure — not merely a comment claiming the parse happens. A green Gate H on valid
YAML proves nothing here: valid YAML is the case the current regex already handles.

**Not blocked by anything, and blocking nothing.** Independent of S0-OPEN-1 (cohort size) and
S0-OPEN-4 (the eviction boundary). The narrow instance that mattered to Workstream S — Gate S0's own
step — is already parsed structurally by
`tests/invariants/gate-s0-claims.invariants.test.ts`, which also sweeps **all 15** workflow files for
parseability. So the hole is bounded to Gate H's own 18 rows, and the repository is no longer blind
to an unparseable workflow in general.

### Amendment 2026-08-11 (S batch 3) — CLOSED, and this row's own second reason was false

**Closed by both halves of its own falsification condition, in that order.** `observeGateH` now
resolves `workflowBinding` from a parsed workflow graph (`bindCheck`, `scripts/phase-2.4-gates.ts:783`,
one parse per file via `readWorkflowGraph` at `:733`), **and** a control applies the exact bytes
GitHub refused — `d825330`'s `- name: Gate S0 (regression: …)` fragment, inlined rather than fetched —
and observes the gate red *naming the parse failure*, not reciting "bound to no workflow job" 18
times. The control asserts the message's **content** (that it names a nested mapping), because a
control satisfied by any thrown error would also be satisfied by the wrong error.

**Four things the fix does that this row's "shape of the fix" did not fully specify.**

1. **The two probes' disagreement is its own fault.** The row said keep the text match as a
   precondition (ADR 0069 §3), which is done. What it did not say: when the structural and textual
   probes *differ*, neither answer may be adopted. A disagreement means one probe is reading
   something the runner does not, and that is a third independent failure mode — so `bindCheck`
   returns `null` with a fault naming the disagreement itself.
2. **The fault travels.** `WiredCheck` gained a **required** `bindingFault: string | null`
   (`packages/trust-index/src/phase24Gates.ts:493`). Required, not optional: an optional field lets a
   construction site stay silent and still typecheck ([[optional-field-defeats-source-guards]]), and
   silence is precisely the defect — 18 rows recited a true sentence that named the wrong cause. This
   is a **deviation** from the plan's "leave `WiredCheck`'s shape alone"; recorded in ADR 0071 §4
   with the reason.
3. **The aggregator is asserted by `needs`, not by survival.** The row's shape said *"the required
   aggregator must survive in `Object.keys(jobs)`"*. Measured: `build-and-test` carries
   `if: always()` and `needs: [test]`, so it runs **even when `test` is red** and then fails itself
   by reading `needs.test.result`. Asserting it "runs unconditionally" would assert something false
   about today's bytes. The new `wired/aggregator-reachable` measure
   (`phase24Gates.ts:553`) therefore asserts presence **plus** `needs` covering every job any check
   binds to — a bound job the required check does not wait on blocks nothing.
4. **The denominator moved with the measure.** `decideGate(measures, 4 + …)` → `5 + …`
   (`phase24Gates.ts:711`). A denominator feeding only `<` has no failing mode of its own, so a
   short count would have read green forever ([[miscounted-denominator-is-a-false-green]]). Pinned in
   the same edit that added the measure. `measures` went 30 → 31.

   **And the control written to guard it could not fire.** Negative control #189 reverted `5 +` to
   `4 +` and expected red; it stayed **green**, because that revert lowers the floor from 31 to 30 and
   `31 < 30` is false either way — the mutation has no observable effect on today's inputs. What
   discriminates is a **short measure list** (at 31 a dropped measure is refused; at 30 it passes
   silently), now asserted in both directions by *"refuses a SHORT measure list"* in
   `packages/trust-index/test/phase24-gates.test.ts`. Recorded because the lesson is recursive:
   [[miscounted-denominator-is-a-false-green]] applies to the control as much as to the code, and a
   green negative control must be diagnosed, never filed as a pass. ADR 0071 §8.

**This row's second OPEN reason was measured false, and that is worth recording.** The text above
says a parse *"may legitimately produce a different answer for a row (e.g. a step guarded by `if:`),
and deciding what that answer should be is a Phase 2.4 judgement about what 'wired' means."* On
today's bytes it produces **no** different answer: parse and regex agree on **all 19 rows**
(`differing: 0`; only `ci:local` is false on both, by design), because `jobs.test` has **27 steps and
zero step-level `if:`**, and no job-level `if:` either. There was no judgement to make. The
substitution is behaviour-equivalent, and the artifact's **18 bound / 1 null** split is byte-identical
across the change — verified by digest, not by eye. What did move is +1 measure and the new
`bindingFault` / `requiredAggregator` evidence.

The first reason (drift-checked artifact ⇒ needs Phase 2.4's regeneration path) was correct and was
honoured: regenerated with `pnpm eval:phase-2.4:gates:write`. The third (two unrelated repairs behind
one CI result) was correct when written and no longer applies — S batch 2 merged as `07b08fa` (#286).

**A row's own reason for staying open can be wrong.** S0-OPEN-3's close recorded that two of its
sentences were false; this one records that a reason for *deferral* was false. Both are the same
lesson: the text of a row is a claim like any other, and it is measured, not trusted. An honest close
says which of its own sentences did not survive.

**What this close does NOT claim.** The structural probe reads `jobs[job].steps[].run`; it does not
evaluate `if:` expressions, `runs-on` availability, matrix exclusions, or reusable-workflow
indirection. Control #186 adds `if: false` to `jobs.test` and the gate stays **green** — the probe is
weaker than "the step will run", and ADR 0071 §6 records that gap as measured rather than assumed.

### Amendment 2026-08-11 (S batch 4) — the citations above moved, and the layer that noticed is the point

**Still CLOSED. This amendment changes no claim; it re-anchors five line numbers.** S batch 4 inserted
`readToolNameSources()` into `scripts/phase-2.4-gates.ts` and a sixth roll-up measure into
`evaluateNoRegression`, which pushed every anchor below the insertion point down. The amendment above
is preserved **verbatim**, including its now-stale numbers, for the same reason S0-OPEN-3's pre-close
text is: rewriting history on every reflow destroys the record of what was true when it was written.
The live pointers are here.

| What the 2026-08-11 (S batch 3) amendment cites | Live line | Anchor content |
|---|---|---|
| `scripts/phase-2.4-gates.ts:783` (`bindCheck`) | **792** | `function bindCheck` |
| `scripts/phase-2.4-gates.ts:733` (`readWorkflowGraph`) | **742** | `function readWorkflowGraph` |
| `packages/trust-index/src/phase24Gates.ts:493` (`bindingFault`) | **493** | `readonly bindingFault` — unmoved |
| `phase24Gates.ts:553` (`aggregatorMeasure`) | **565** | `function aggregatorMeasure` |
| `phase24Gates.ts:711` (the denominator) | **759** | `6 + checks.length + served.length` |
| `scripts/phase-2.4-gates.ts:637` (`REGRESSION_CHECKS`, cited in the pre-close text) | **641** | `const REGRESSION_CHECKS` |

**One of those was already wrong before this batch.** The pre-close text's `REGRESSION_CHECKS` (`:637`)
did not point at the list even at `dc32827`: line 637 was ` */`, the end of a docblock, and the
declaration sat at 640. So that citation was off by three when written and nothing noticed, because no
reader asserted it — the six pointers the test *does* assert were all correct at HEAD and drifted only
under this batch. A citation with no reader is not a weaker guarantee than one with a reader; it is no
guarantee at all.

**And 640 is now a BLANK line.** A single `import` added at the top of the script pushed the
declaration to 641 and left 640 empty. An existence-addressed pointer — one asserting only that the
line number is within the file — would still resolve at 640 today and point at nothing. That is the
exact defect `assertPointer` was written for after M26-3 found `server.ts:61` blank with the real
location at 171, reproduced here on this repository's own bookkeeping.

**The denominator's value changed too, not just its address.** `5 + checks.length + served.length` →
`6 + …`, because S batch 4 added `mcp-tool-names-agree`; `measures` went 31 → 32. The S batch 3
amendment's §4 recorded `5 +` correctly for its own batch and is left saying so. A pointer asserted by
**content** catches this where a pointer asserted by line number alone would not: had the assertion
only checked that line 711 exists, it would still pass today, pointing at an unrelated statement.

**Why this is an append and not an edit.** Five stale `path:line` citations are exactly the defect
`assertPointer` exists to catch, and it caught them — the batch could not reach its own verification
sequence until they resolved. The repair is a new amendment carrying live numbers, never a silent
in-place renumber of preserved text, which would leave no evidence that the drift occurred.

**A pointer's line number rots faster than its claim.** Every sentence in the S batch 3 amendment is
still true. Only its addresses expired, and they expired because of an edit in a *different*
workstream that had no interest in this row. That is the argument for content-addressed pointers over
existence-addressed ones, and for keeping the assertions in a test rather than in prose: prose cannot
notice its own rot.

### Amendment 2026-08-14 (Workstream P Batch 8, ADR 0080) — **20 rows**, and the 20th proves a bound job is not yet a gate

**Still CLOSED. `REGRESSION_CHECKS` now has **20 rows**, all naming `workflow: "ci.yml"`, of which
**2** are `remoteOnly` (`pack:smoke`, `pack:smoke:mcp` — unchanged).** The artifact records **19
bound** and **1 null**, that null still being `ci:local`, which is the chain itself and has no
workflow step by design. `measures` went 32 → **33**. The pre-close text's *"19 rows … 18 bound / 1
null"* is left verbatim, as is every earlier figure in this row.

**The 20th row is the first bound to a job other than `test`**, and the reason it exists is this
row's own `wired/aggregator-reachable` measure rather than the ledger it names:

```
{ id: "ledger:presentation:validate", ... workflow: "ci.yml", job: "ledger-authenticity" }
```

**Measured, not predicted.** With the `ledger-authenticity` job present in `ci.yml` **and** wired
into `build-and-test`'s `needs`, deleting it from that `needs` list left Gate 2.4-H **PASSED**.
`aggregatorMeasure` computes `boundJobs` from these rows, so a job that no row names contributes
nothing to `unreached` — the new job was a *status the required check happened to wait on*,
indistinguishable from one it did not. Adding the row is what puts `ledger-authenticity` into
`boundJobs`, which is what makes dropping it from `needs` a FAILING measure. Three controls now red
with three distinct messages: dropped from `needs`, job deleted, removed from `ci:local`.

**This is the S batch 3 amendment's §3 arriving at its second instance.** That §3 replaced *"the
aggregator must survive in `Object.keys(jobs)`"* with *"presence **plus** `needs` covering every job
any check binds to"*, on the argument that **a bound job the required check does not wait on blocks
nothing**. Until this batch every row bound to the same job, so the coverage half of that measure had
exactly one job to cover and could not distinguish a real answer from a vacuous one. The first job
that was genuinely new found the remaining gap: coverage is computed over jobs **the rows name**, so
an unnamed job is outside the quantifier rather than uncovered by it. The measure was right; its
domain was supplied by the very list this row is about.

**What this amendment does NOT claim.** `boundJobs` is still derived from `REGRESSION_CHECKS`, so a
future job that no row names will be invisible to `wired/aggregator-reachable` in exactly the way
`ledger-authenticity` was before this row existed. That is a property of deriving the domain from a
hand-maintained list, and it is recorded as measured rather than fixed — closing it means enumerating
`ci.yml`'s jobs and asserting every one is either needed or deliberately excluded, which is a
different gate than this row's.

**Live pointers, re-anchored again.** The S batch 4 amendment's table drifted under this batch and
under S batches 5–7:

| Anchor | S batch 4 said | Live line |
|---|---|---|
| `readWorkflowGraph` (`scripts/phase-2.4-gates.ts`) | 742 | **758** |
| `bindCheck` (`scripts/phase-2.4-gates.ts`) | 792 | **808** |
| `REGRESSION_CHECKS` (`scripts/phase-2.4-gates.ts`) | 641 | **641** — unmoved |
| the 20th row itself | — | **690** |
| `bindingFault` (`packages/trust-index/src/phase24Gates.ts`) | 493 | **493** — unmoved |
| `aggregatorMeasure` (`phase24Gates.ts`) | 565 | **565** — unmoved |
| the denominator (`phase24Gates.ts`) | 711 → `6 + …` | **759**, still `6 + checks.length + served.length` |

The denominator's **form** did not change this time even though `measures` did: the new measure is a
per-check `wired/*` entry, so it is already counted by `checks.length`. A batch that added a
roll-up measure would have had to move the `6`, which is the case S batch 4's §4 recorded.
