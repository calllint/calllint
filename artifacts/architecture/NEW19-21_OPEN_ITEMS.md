# new19–21 open items — what is left, and who can move it

- **Date:** 2026-08-26.
- **Source plans:** `docs/new19.md`, `docs/new20.md`, `docs/new21.md`. `docs/` is gitignored
  (`.gitignore:44`) as local-only planning notes, so this file is the tracked record of what
  those plans still owe. Same reason [`NEW21_SEQUENCING_PLAN.md`](NEW21_SEQUENCING_PLAN.md)
  and [`NEW20_CLOSURE_REPORT.md`](NEW20_CLOSURE_REPORT.md) live here.
- **Scope:** the six-row blocker table from the 2026-08-26 audit, plus two items that surfaced
  while closing it. This is a *tracker*, not a plan: every row names its blocker and who can
  act, so a later reader can tell "nobody has done this" from "nobody can do this yet".

## Why a tracker and not a phase document

Four of the six rows were engineering work and are closed. What remains is almost entirely
**not** engineering: one row waits on a third party's review queue, one needs a 357 MB install
on a machine that is not CI, one needs a product judgement that no amount of code can
substitute for, and one turned out to be waiting on *us* (E-1). Recording those as "TODO" in a
plan would misrepresent them — a TODO implies someone could pick it up. The columns below say
who actually can.

## Closed 2026-08-26

All four landed and are merged; each was verified able to fail before being trusted.

| item | commit | evidence |
|---|---|---|
| `trust-ingest.yml` missing `pnpm build` — cohort 100 stuck 2 weeks | `c9553a2` (#338) | **Not yet exercised by a real run** — see [Open: T-1](#t-1-the-trust-ingest-fix-is-unverified-by-any-run) |
| watcher `[BODY]` noise — per-request tokens read as product changes | `f85bb50` (#339) | 12 normalization rules, each derived from a byte diff of two fetches of the *same* URL ~1.5s apart; convergence verified on 3 real pairs |
| four dead `officialSources` URLs | `f85bb50` (#339) | separate commit to the SSOT; per-URL measurement recorded in [`REGISTRY-CONSUMPTION-AUDIT.md`](../submissions/REGISTRY-CONSUMPTION-AUDIT.md) |
| `kiro` discovery tests | `f85bb50` (#339) | 15 tests. The extractor already shipped working — **the gap was coverage, not function** |

Verification for #339: `pnpm test` 4926 passed / 1 skipped (264 files, up from 4911/263),
`pnpm typecheck` and `pnpm build` clean, invariants 559 passed, all 7 gates PASS locally,
CI 11/11 green. 10 negative controls, each redding exactly its target and reverted
byte-for-byte.

## Open items

### U-1. `usage.calllint.com` is served UNGATED at its `pages.dev` hostname

**Who can move it: the user only** (Cloudflare dashboard). The decision on 2026-08-26 was to
*disable* the `pages.dev` subdomain — the custom domain already works, so an unused hostname is
pure exposure. **That instruction was wrong and is corrected here: Cloudflare has no switch to
disable or delete a Pages project's `pages.dev` hostname.** Verified against the Pages docs the
same day; the `Settings → Build & deployments → pages.dev domain → Disable` path this file
previously named does not exist. The
[Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/#disable-access-to-pagesdev-subdomain)
page frames the whole task as two *workarounds*, and after a custom domain is removed a project
"will only be accessible through the `*.pages.dev` subdomain" — that hostname persists by
construction.

So the intent stands and the mechanism changes. Two options, both the user's:

| Option | What it does | Cost |
| --- | --- | --- |
| **Bulk Redirect** (recommended) | Account-level redirect `calllint-usage-report.pages.dev/*` → `https://usage.calllint.com/`, so the only way in is the gated domain | Account-level feature; one rule |
| Second Access application | Covers `*.pages.dev` with the same single-email policy | A second app to keep in sync with the first; the docs warn a policy on one hostname without a match on the other yields a login page that renders but does not work |

One trap, from the same docs: `Pages → Settings → General → "Enable access policy"` looks like
the answer and is not. It protects **preview** deployments (`<hash>.<project>.pages.dev`) and
explicitly "not your `*.pages.dev` domain or custom domain." Enabling it would leave this finding
open *and* break the probe's liveness check, which reads a per-deployment hostname inside that
same preview wildcard.

Measured 2026-08-26, all three hostnames:

| Hostname | Result |
| --- | --- |
| `calllint-usage-report.pages.dev` | **200, no `x-robots-tag`** — the finding |
| `197a21a9.calllint-usage-report.pages.dev` | 200 + `x-robots-tag: noindex` (preview wildcard) |
| `usage.calllint.com` | 302 → `cloudflareaccess.com/cdn-cgi/access/login` — correct |

The missing `x-robots-tag` on the production hostname is worth noting: that header ships on
preview hostnames only, so on the exposed one the in-page `noindex` meta is the *sole* crawler
backstop, not a second layer.

CI deliberately cannot do this. An Access policy — and the project's domain configuration — are
account-level objects, and per
[`CLOUDFLARE_ACCESS_ACTION.md`](../authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md)
the token this pipeline holds is scoped below that on purpose: *"the report is not worth that
token."* Granting the workflow authority to enumerate or edit account identity configuration so
it could self-heal would be a worse trade than the exposure it fixes. The local
`CLOUDFLARE_API_TOKEN` on the maintainer's machine was checked and is invalid
(`code: 1000`), so there is no side door either.

**The probe had to be fixed first, and was** (`c5fb5af`) — see
[T-2](#t-2-the-access-probe-measured-a-hostname-that-is-about-to-stop-existing). Remediating
before that commit would have turned the daily cron red *because the configuration became
correct*: the old check read a redirect or a non-answer on this hostname as "no live deployment".
That ordering hazard is now gone either way, since check 4 objects only to content.

The measurement that opened this item:

```
200  https://calllint-usage-report.pages.dev/   2666 bytes
     <title>CallLint Usage — private</title>
     all 3 report row labels present: "CLI package downloads", "MCP servers observed",
                                      "Recorded preflights"
302  https://usage.calllint.com/                → cloudflareaccess.com/cdn-cgi/access/login
```

Cloudflare Access binds to a **hostname**, and the policy covers only the custom domain. So the
report that new18 §29 requires to be private became world-readable at the `pages.dev` address
the moment a deploy landed — which was 2026-08-26, for the first time ever.

**Severity: privacy, not secrets.** No credentials and no raw identifiers are in the artifact
(those never leave the Worker). What is exposed is operator-facing figures. §29 nonetheless
makes "public" the violation, which is why this is an error rather than a note.

**The §29 backstops are holding, which bounds the urgency.** Measured on the exposed hostname:

```
robots.txt → User-agent: *   Disallow: /
<meta name="robots" content="noindex, nofollow, noarchive" />
```

So the exposure is to someone who knows the exact URL, not to search. Those two backstops were
written for "the day Access is misconfigured"; this is that day, and they worked.

### U-2. The 502 is resolved — and why it was invisible for so long

**Status: CLOSED as of run `32975124276`, 2026-08-26 13:36Z.** `✨ Success! Uploaded 3 files`
→ `✨ Deployment complete!`. Recorded here rather than deleted because the *shape* of this
failure is the repo's dominant fault class and worth keeping.

The report host 502'd after email verification because **it had never actually been deployed**.
Three faults stacked:

1. `CLOUDFLARE_API_TOKEN` was invalid — `Authentication error [code: 10000]` on the Pages and
   D1 endpoints, `Invalid access token [code: 9109]` on `/accounts`. `/accounts` is the most
   basic endpoint there is, so this was a dead token, not a permissions gap.
2. Before `c9553a2` the workflow **never reached the deploy step**, so the dead token was
   never exercised. Proven quantitatively: `grep -c "pages deploy"` over the run logs returned
   **0** for 2026-08-25 and **1** for 2026-08-26. The 08-25 run carried the *identical* D1
   `code: 10000` error and was recorded `success`, because D1 failure is only a warning.
3. The Access probe could not observe an empty origin, so a gate in front of nothing looked
   healthy. Fixed in `c9553a2` (`usage-report.yml:185-212`): *"Gated" and "dead" must not look
   alike.*

**A trap for whoever rotates this next.** The org (`calllint`) *also* holds
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` (both `2026-06-17`), and **repo-level secrets
win over org-level**. Updating only the org copy changes nothing for this workflow. Confirm the
repo-level timestamp actually moved:

```
gh secret list --json name,updatedAt --jq '.[] | select(.name|test("CLOUDFLARE"))'
```

The first rotation attempt on 2026-08-26 did not take — the repo-level timestamp still read
`2026-08-18T13:28:56Z` and the errors were byte-identical to the previous run. That identity
was the evidence, not the assumption.

### T-1. The `trust-ingest` fix is unverified by any run

**Who can move it: me, on request** (`gh workflow run trust-ingest.yml`).

`c9553a2` added the missing `pnpm build`. But `trust-ingest` is **weekly**
(`cron: "17 6 * * 1"`, Monday 06:17 UTC), and its last run was 2026-08-24 07:17Z — two days
*before* the fix landed (2026-08-26 05:37Z). So the repair is merged and unexercised; the next
automatic verification is Monday.

Earlier status notes described the cohort-100 blockage as fixed. The precise claim is: **the
fix is committed, not yet demonstrated.**

### T-2. The Access probe inferred liveness from a hostname it does not control

**Status: FIXED 2026-08-26 (`c5fb5af`, hardened in the same PR).** Kept here because the fix had
to land *before* U-1's dashboard action, and because the fault is instructive.

Two defects, one root cause — the probe inferred liveness from a hostname it does not control.

**a) It raced the alias.** On run `32975124276` the deploy succeeded and the probe still failed:

```
13:36:19.16  ✨ Deployment complete! → https://197a21a9.calllint-usage-report.pages.dev
13:36:19.66  ##[error]Origin has no live deployment (HTTP 522 at .../pages.dev/)
```

Half a second apart. The deployment-specific hostname was live; the production alias had not
finished routing. Re-measured minutes later: **200, both hostnames.** So it reported a transient
as a permanent fault — the inverse of the defect `c9553a2` fixed, and equally a guard that
cannot observe its subject.

**b) It would have gone red when the configuration became CORRECT.** Whichever U-1 remediation
lands, this hostname stops answering with the report — a Bulk Redirect makes it a 301, an Access
app makes it a 302 — and the old check 3 read any of `000`/`404`/`522` as "no live deployment",
reporting the intended end state as the very 502 it existed to catch. (The first draft of this
item assumed the hostname would become NXDOMAIN; it cannot, per U-1. The hazard was the same
either way, which is why the fix does not depend on which remediation is chosen.)

**Why the fix is not a retry.** Two facts, both measured 2026-08-26, rule out probing a hostname
at all. The gated host cannot testify about its own origin: Access 302s to the login endpoint
*before* authenticating, and returns an identical 302 for a path that cannot exist. And a
bounded retry on the alias would only trade a false red for a sleep that also hides a genuinely
empty origin.

So liveness now comes from the deploy step itself: it tees `wrangler`'s output, asserts
`Deployment complete` is **present** (positively — an empty log satisfies "no error appeared",
which is how guards here have failed before), publishes the immutable deployment URL as a step
output, and check 3 fetches that URL. It is created by the deploy, so it is immune to alias
propagation. Check 4 keeps the §29 exposure test but no longer infers liveness from it — it
objects to **content** and to nothing else, so every non-content response is a pass.

**Two limits, stated rather than hidden.** The deployment URL proves *this deployment* serves, not
that the production alias does; observing the gated custom domain would need a credential the
pipeline deliberately does not hold, so that gap is accepted, not closed. And the per-deployment
hostname sits inside the `*.{project}.pages.dev` preview wildcard, so enabling the preview Access
policy would make check 3 read a 302. That policy is off today and U-1 must not use it.

Verified before being trusted: the extracted decision logic was driven through 9 controlled
cases, 9/9 landing as intended. All 4 expected-PASS land `fail=0` — including **both real U-1 end
states** (301 from a Bulk Redirect, 302 from a second Access app), each of which the old logic
would have failed. All 5 expected-FAIL land `fail=1`, including the original empty-origin 502 and
the case that matters most: *redirect in place but content still served* → `ERR:UNGATED`. So the
probe does not buy green by forgiving the fault it exists to catch, and it does not stop looking
once a remediation appears to be in place. Marker detection and URL parsing were replayed against
the real logs of both runs: `32975124276` (success) parses to the right URL; `32972641297` (bad
token) and an empty log are both rejected.

The matrix was rebuilt on 2026-08-26: its predecessor's headline case was NXDOMAIN, a state that
cannot occur, so it was verifying the wrong end state — correct logic, wrong world.

**Not verified:** behaviour on a real post-remediation run, which cannot exist until U-1 lands.
The matrix covers both end states in logic, not in the world.

Four assertions in
[`private-usage-deploy-gate.invariants.test.ts`](../../tests/invariants/private-usage-deploy-gate.invariants.test.ts)
now hold this shape in place, each with a negative control that reds exactly its target: the
deploy must publish the URL, the probe must fetch *that* URL, `Deployment complete` must be
asserted positively, and check 4 must not treat a non-answer as a fault. The predecessor pinned
the literal string `no live deployment` and broke on a reworded diagnostic while the property was
intact — a test measuring prose, not behaviour.

### D-1. `claude-plugin` → `AVAILABLE` needs a product judgement

**Who can move it: the user** (an ADR decision, not code).

The instrument is done and measured: `scripts/probe-claude-plugin-install.mjs` reproduces the
install and observes all four steps on `claude` 2.1.195 (marketplace add → appears in list →
install → `plugin list` reports **enabled**). Built around one finding: **`claude plugin` exits
0 on failure**, so every step is judged on output, and success is asserted *positively* (the
`✔` marker must be present) since empty output satisfies the weaker test.

What the probe deliberately does **not** do is move the channel. Reaching `AVAILABLE` needs
four things, in this order:

1. an **ADR** establishing that a reproducible local act can serve as evidence for a public
   claim;
2. a **schema field** to carry it — `definitions.primitive` is `additionalProperties: false`,
   so the evidence is not currently representable;
3. an **HD-07 third arm** (`scripts/check-harness-distribution.mjs:389-489`);
4. the **SSOT state flip**.

Why the order matters: HD-07's two existing arms are structurally unreachable here.
`upstream: officialMcpRegistry` is the wrong subject (that arm is about our *server*; this
channel ships a *plugin*), and there is no shelf to point `liveUrl` at — the only URL available
is our own README, which is precisely the self-endorsement defect of 2026-08-23 that HD-07
exists to catch. Making a probe result count as public evidence changes what `AVAILABLE` means
to every consumer of the 31 projections, so the ADR belongs *ahead* of the change, not behind
it. Until then `AUDIT_REQUIRED` is the honest state.

### E-1. Channels waiting on someone else

**Who can move them: nobody here** — except the one that turned out to be waiting on us.

| channel | state | submitted | note |
|---|---|---|---|
| `cursor` / `cursor-plugin` | `PENDING_UPSTREAM` | 2026-08-25 | private form review, so no `submissionUrl` exists to record |
| `roo-code` / `mcp-stdio` | `PENDING_UPSTREAM` | — | |

**`cline` / `cline-marketplace-pr` was NOT waiting on upstream — it was waiting on us.**
Measured 2026-08-26 against `cline/marketplace` (the `submissionUrl` in the SSOT; an earlier
check used `cline/mcp-marketplace`, which does not exist):

```
state=OPEN  draft=true  created=2026-08-18T10:42:30Z  updated=2026-08-18T10:42:30Z
title=Add CallLint MCP server
```

**It was a draft, untouched since it was opened.** A draft PR is excluded from review requests
by default, so the 8 days of silence were not upstream latency — nobody had been asked yet. The
SSOT note ("open, verified 2026-08-23") was literally true and materially incomplete: `open`
and `awaiting-review` are different states, and `PENDING_UPSTREAM` asserts the second.

**RESOLVED 2026-08-26** with the user's explicit authorization (marking a PR ready is an
outward-facing act on a third party's repository): `gh pr ready 49 --repo cline/marketplace` →
`state=OPEN draft=false updated=2026-08-26T13:55:51Z`. The SSOT note now records the draft
period, so the row's `PENDING_UPSTREAM` is honest from that date rather than from 08-18. That
note renders on the public host page, so it names the delay as ours rather than implying an
upstream queue. Still true: **do not create a duplicate.**

### E-2. Copilot CLI needs the user's machine

**Who can move it: the user only.**

`copilot-cli` / `mcp-registry-discovery` and `copilot-cli` / `github-copilot-plugin` both sit
at `AUDIT_REQUIRED` behind a 357 MB install that cannot run on an Actions runner.

### A-1. The 13-channel registry-consumption audit stays closed-negative

**Who can move it: only new primary-source evidence.**

[`REGISTRY-CONSUMPTION-AUDIT.md`](../submissions/REGISTRY-CONSUMPTION-AUDIT.md) measured 13
`mcp-stdio` channels and reached **`0 of 13 CONSUMES`**. Four dead links in it were repaired on
2026-08-26 and two rows re-measured on corrected URLs, which turned an unmeasured absence into
a confirmed one. **No verdict changed.** The honest outcome is that these 13 remain
`AUDIT_REQUIRED`; that is a finding, not a backlog.

`https://code.claude.com/` is deliberately **left alone**: it is unreachable from the
maintainer's machine, and `docs.claude.com` resolves into Meta's range (31.13.94.41). That is
DNS interference on one network, not a fact about Anthropic — editing the SSOT on that basis
would write the observer's blindness down as a vendor fact.

## Two records that were checked and found accurate

Both were on a list to "correct" and should **not** be touched:

- `artifacts/agent-discovery-v2/FINAL_REPORT.md:422` — *"no run has yet diffed a real upstream
  change"* is still literally true. `distribution-watch` has exactly two successful runs
  (2026-08-22 dispatch, 2026-08-24 schedule), neither of which detected a change.
- The `codebuddy` row in the audit stands on its own terms: its 29 KB page was real when read
  and `0× "mcp"` is a fact about it. The URL has since 404'd, and the replacement
  (`product/acc`, 56 KB, 2× "mcp", 0× "registry") does not change the verdict.

One record **is** stale: `memory/STATUS.md` shows new21 Steps 1–4 as not started, but they
landed in `3b64404` (#334). That file is local memory, not a tracked artifact.

## Current distribution totals

31 primitives across 18 hosts; **28 non-`AVAILABLE`**. Derived from
`apps/web/data/distribution-surfaces.json` (the SSOT — `scripts/distribution-sources.json` and
30 other surfaces are *generated* from it by `pnpm gen:distribution` and byte-compared by
`pnpm check:distribution-drift`). Do not hand-count from a projection; derive from the SSOT, or
you will send a human to redo an external act.
