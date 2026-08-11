# Gate S0 — carried open items, in committed bytes

Gate S0 is `scripts/gate-s0.ts`, wired as `gate:s0` (report) and `gate:s0:gate` (enforcing).
It is **deliberately outside `ci:local`**, argued at `scripts/gate-s0.ts:5-7`: the cohort is
short today, a `--gate` run is expected to fail, and a permanently-red gate in `ci:local`
teaches a team to ignore it.

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

**Status:** OPEN

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
reach 25 today. `resolveMaxEntries` (`refreshSnapshot.ts:143-149`) caps the *served* cohort at
`DEFAULT_MAX_ENTRIES = 25`, and its own docblock at `:137-142` states the knob is
`TRUST_INGEST_MAX_ENTRIES`, described as *"the ONLY knob for 37 → 100+"* and as a
**"workflow_dispatch input"**. Measured against `.github/workflows/trust-ingest.yml`:
`workflow_dispatch:` at `:20` has **no `inputs:` block**, and the ingest step at `:73` sets
**no `env:`**. The same claim recurs at `:69-72`, which says
`TRUST_INGEST_MIRROR_MAX_ENTRIES` / `TRUST_INGEST_MIRROR_MAX_PAGES` are settable
*"HERE or as a workflow_dispatch input without a code change"* and calls a remedy naming an
unavailable knob *"not a remedy"* — while naming three knobs the workflow does not expose.
So all three env knobs are reachable only by editing the workflow, i.e. by a code change.
That is the asymmetry `:71` claims to have closed, still open.

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

**Status:** OPEN (filed 2026-08-10, S batch 1, ADR 0069). **Now guarded** by
`tests/invariants/registry-cohort-retention.invariants.test.ts` — the guard is what makes this row
a *tracked* hazard rather than a latent one, and it does not resolve it.

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
refreshSnapshot.ts:143  resolveMaxEntries(env)   → DEFAULT_MAX_ENTRIES, raisable via TRUST_INGEST_MAX_ENTRIES
refreshSnapshot.ts:330  refreshFromMirror({ snapshotMaxEntries: maxEntries, … })
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

---

## S0-OPEN-5 — Gate 2.4-H asserts 18 checks are "wired" by matching text, so it cannot see that the runner rejects the file

**Status:** OPEN (filed 2026-08-11, S batch 2 post-push correction, ADR 0070 §10). Filed because
the defect it describes **already fired once, in this batch**, one layer up: see S0-OPEN-2's
2026-08-11 amendment. Gate 2.4-H itself belongs to Phase 2.4, so repairing it is that phase's
authorization, not this row's.

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
