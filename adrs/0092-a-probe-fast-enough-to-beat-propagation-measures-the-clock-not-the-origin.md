# ADR 0092 — A probe fast enough to beat propagation measures the clock, not the origin

- **Status**: Accepted
- **Date**: 2026-08-28
- **Supersedes**: nothing
- **Amends**: the liveness probe in `.github/workflows/usage-report.yml` (the deployment-URL check
  added 2026-08-26), and the claim in its own comment that that hostname cannot race

## Context

`usage-report` has been red on and off for three days. The failure is always the same line:

```
::error::the deployment URL from this run is not serving (HTTP 404).
         wrangler reported success, so this is a genuine origin fault.
```

The comment above that branch explained why 404 there had to be real:

> The deployment-specific hostname is created by the deploy itself, so unlike the alias it is not
> subject to alias propagation. A failure here after "Deployment complete" is a real fault, not a
> race.

**That claim is false, and it is now measured.** Run 33100499211 (scheduled, 2026-08-27) read 404
from `https://ceb7e7a0.calllint-usage-report.pages.dev`. Re-probed by hand on 2026-08-28:

```
ceb7e7a0.calllint-usage-report.pages.dev   HTTP 301  report=present  loc=https://usage.calllint.com/
5810cbe6.calllint-usage-report.pages.dev   HTTP 301  report=present  loc=https://usage.calllint.com/
```

`ceb7e7a0` is the run that failed. `5810cbe6` is the run that passed. **They are indistinguishable.**
The deployment was live; the probe was early — by 0.14 seconds, measured from wrangler's own
"Deployment complete" timestamp to the curl.

Two things had been hiding the diagnosis:

1. **The trigger looked like the variable.** The 10:58 `workflow_dispatch` passed and the 17:50
   `schedule` failed, which invites "scheduled runs are broken". Across the last 20 runs: 2 failures
   on `schedule`, **3 on `workflow_dispatch`**, 5 successes on `schedule`, 1 on `workflow_dispatch`.
   The trigger was never the variable. Intermittency was.
2. **The gap between deploy and probe was identical in both.** Failing run 0.14s, passing run 0.11s.
   Nothing about the workflow's timing distinguished them; only Cloudflare's edge did.

This is the same fault class as ADR 0091 and the repo's dominant one: **a guard that cannot observe
its subject.** Here the guard was not reading the wrong number — it was reading the right hostname
at a moment when that hostname could not yet answer, and reporting "does not exist" as "is broken".

## Decision

### D1 — Bounded retry, on the not-yet-there codes only

`000`, `404`, `522` are retried: 6 attempts, 5s apart, ~30s of window. Every other code breaks the
loop on the first read.

**This is not the sleep the old comment rejected**, and the distinction is the whole decision. That
comment was about probing `$ORIGIN` (the production alias), where a retry genuinely can hide a
permanently empty project. This retry can hide nothing:

- A deployment that never serves returns 404 for all six attempts and **still sets `fail=1`**, with
  the message now stating the window that was given. The retry bounds the wait; it does not forgive
  the outcome.
- The **exists-but-wrong** codes are excluded by construction and still red on the **first** read:
  `200` means `pages-entry.js` did not run (U-1 reopened on the preview wildcard), and `301` with
  `x-calllint-report: absent` is the gated-but-dead 502 state that this check exists to catch.
  Retrying *those* is precisely what "a sleep that hides a fault" means, and the loop must never
  reach them.

The attempt count is printed on success. Propagation getting slower is a fact the log should carry,
not smooth away — if this starts reporting attempt 4 or 5 routinely, the window is the next thing to
re-measure, and the log will have said so.

### D2 — The retry loop may not be a second `case "$dcode"`

The first draft of D1 was written as a nested case-statement. Three assertions in
`private-usage-deploy-gate.invariants.test.ts` locate the verdict block by
`probeBody.indexOf('case "$dcode"')`, so the new one **captured the anchor** and those assertions
began reading the retry loop instead of the verdict. Two went red immediately; had the shapes been
closer they would have gone quietly green against the wrong subject.

The loop is an if-chain, and an invariant now pins **exactly one** occurrence of that construct in
the file — *including in comments*, since the anchor is a byte match and a comment sits above the
code it describes. The first fix for this ADR reproduced this ADR's fault class inside the fix. That
is worth a guard, not a note.

### D3 — The loop's semantics are exercised, not just its text

The invariants pin the loop's *shape*. Shape is not behaviour, so nine cases were run against the
extracted loop with a stubbed curl: `404→301` retries and lands on 301 at attempt 2; `404×3→301`
lands at attempt 4; `200` and `302` return at attempt 1 unretried; `404`/`000`/`522` forever exhaust
to attempt 6 and hand back the bad code; `404→200` stops at 200.

The **first version of that harness was itself blind**: `fake_curl` ran inside `$(...)`, so its
subshell increment never reached the parent and every call returned the first code. It "passed" the
three cases whose expected answer is the first code anyway — a blind instrument certifying that a
guard is not blind, which is this repo's signature failure appearing for the third time in one task.
The counter is now file-backed.

### D4 — The ingest's write scope is asserted, not disclosed

ADR 0091 made `trust-ingest.yml` write **source** for the first time: `scripts/gate-s0.ts`, a gate.
That ADR's mitigation was a PR-body bullet asking the reviewer to confirm the floor was rising. A
sentence addressed to a human is not a guard, and `create-pull-request` runs with no `add-paths`, so
the commit's scope was decided by whatever happened to be dirty.

A step now asserts the boundary before the PR opens: inside `scripts/`, only `gate-s0.ts` may change;
inside `gate-s0.ts`, only the floor declaration may change; and the floor must **rise**. `add-paths`
was rejected as the mechanism — a legitimate run dirties hundreds of generated files across four
trees, so enumerating them would duplicate the generator's output contract and be wrong the first
time a page is added.

The rise check is unreachable via `advanceRatchetFloor` (it is `Math.max`). It is asserted anyway: the
claim worth defending is that *nothing* reaches that state, not that one caller promises not to.

**The first version of this guard read `git diff`, and was blind.** `git diff` compares the working
tree to the index, so a `git add`ed file is invisible to it and an untracked file doubly so — while
`create-pull-request` commits staged, unstaged, and untracked alike. A staged `scripts/sneaky.ts`
passed the step exit-0 in testing. It reads `git status --porcelain` now, and every case is exercised
twice, unstaged and staged. Third instance in this task of a guard watching a smaller set than the one
that ships.

## Consequences

- `usage-report` should stop failing intermittently. It will still fail, correctly, if a deploy
  genuinely serves nothing for 30 seconds — and the message will say the window was given.
- The job gets up to ~30s slower in the worst case, and 0s in the common one (the loop does not sleep
  before its first read).
- **A 404 that persists past the window is now a much stronger signal than it was.** Before this
  change the message cried "genuine origin fault" on a race; it now says that only after propagation
  has had its chance. If it fires, believe it.
- One limit is unchanged and still accepted, per the 2026-08-26 note: `$DEPLOYMENT_URL` is a
  per-deployment hostname, so this proves *this deployment* serves — not that the production alias
  does. Cloudflare offers no way to observe the gated custom domain without a credential the pipeline
  deliberately does not hold.
