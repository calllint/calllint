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

**What `--gate` does today.** `scripts/gate-s0.ts:234` computes
`registryShort = censusRegistry < S0_REQUIRED_RECORDS` with `S0_REQUIRED_RECORDS = 25` at
`:45`, and `:254-256` exits `2` on a shortfall even when all five assertions pass. The
served census is **19** registry pages (`apps/web/public/trust/index.json`, cohort census
`{"fixtures":20,"mcp-registry":19}`); fixtures are excluded from the requirement on purpose
(`FIXTURE_PREFIX` at `:52`). So `--gate` exits 2 on the cohort size alone.

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

**Status:** OPEN

`package.json:42-43` wires `gate:s0` and `gate:s0:gate`; `:75`'s `ci:local` has **19**
`&&`-joined steps and includes **neither**. (The count is asserted by the reader rather than
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

---

## S0-OPEN-3 — three of S0's five assertions are GATE-VERIFIED, which reads a string

**Status:** OPEN

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
