# new19–21 open items — what is left, and who can move it

- **Date:** 2026-08-26, updated 2026-08-27 (U-1 closed in-repo — see [U-1](#u-1-usagecalllintcom-is-served-ungated-at-its-pagesdev-hostname); [O-1](#o-1-usage-observability-closure--distribution--observed-usage-has-no-fact-chain) registered; [O-2](#o-2-the-consent-prompt-has-no-published-copy--and-cannot-have-one-from-docs) closed ahead of the release, and its own measurement corrected).
- **Source plans:** `docs/new19.md`, `docs/new20.md`, `docs/new21.md`. `docs/` is gitignored
  (`.gitignore:44`) as local-only planning notes, so this file is the tracked record of what
  those plans still owe. Same reason [`NEW21_SEQUENCING_PLAN.md`](NEW21_SEQUENCING_PLAN.md)
  and [`NEW20_CLOSURE_REPORT.md`](NEW20_CLOSURE_REPORT.md) live here.
- **Scope:** the six-row blocker table from the 2026-08-26 audit, plus two items that surfaced
  while closing it, plus **O-1** (usage observability closure, handed over 2026-08-27). This is a
  *tracker*, not a plan: every row names its blocker and who can act, so a later reader can tell
  "nobody has done this" from "nobody can do this yet".

## Why a tracker and not a phase document

Four of the six original rows were engineering work and are closed. Of what the six left behind,
almost none is engineering: one row waits on a third party's review queue, one needs a 357 MB
install on a machine that is not CI, one needs a product judgement that no amount of code can
substitute for, and one turned out to be waiting on *us* (E-1). Recording those as "TODO" in a
plan would misrepresent them — a TODO implies someone could pick it up. The columns below say
who actually can.

**O-1 is the exception and does not change that rule.** It is mostly engineering, it is mostly
mine to do, and it is here anyway — because it arrived as an execution plan whose first two
premises were false, and a tracker's job is to hold the corrected facts until the work is
scheduled. It is registered, not started.

**One caution this tracker earned the hard way.** U-1 sat here for a day as "the user only,
Cloudflare dashboard" and was then closed in-repo with no dashboard action at all. The
classification was wrong because the *mechanisms surveyed* were both account-level, and no one
asked whether a third mechanism existed inside the deploy. "Who can move it" is a claim about
the world, not a property of the item — when it says *the user only*, that is the sentence to
attack first.

## Closed 2026-08-26

All four landed and are merged; each was verified able to fail before being trusted.

| item | commit | evidence |
|---|---|---|
| `trust-ingest.yml` missing `pnpm build` — cohort 100 stuck 2 weeks | `c9553a2` (#338) | **Not yet exercised by a real run** — see [Open: T-1](#t-1-the-trust-ingest-fix-is-unverified-by-any-run) |
| watcher `[BODY]` noise — per-request tokens read as product changes | `f85bb50` (#339) | 12 normalization rules, each derived from a byte diff of two fetches of the *same* URL ~1.5s apart; convergence verified on 3 real pairs |
| four dead `officialSources` URLs | `f85bb50` (#339) | separate commit to the SSOT; per-URL measurement recorded in [`REGISTRY-CONSUMPTION-AUDIT.md`](../submissions/REGISTRY-CONSUMPTION-AUDIT.md) |
| `kiro` discovery tests | `f85bb50` (#339) | 15 tests. The extractor already shipped working — **the gap was coverage, not function** |

## Closed 2026-08-27

| item | how | evidence |
|---|---|---|
| **U-1** — the report served ungated at `calllint-usage-report.pages.dev` | `apps/usage-worker/src/pages-entry.js` ships as the deployment's `_worker.js`; every non-canonical host 301s to the gated domain | 10 tests drive the shipped file (4/4 mutations red), 3 new invariants (3/3 red), generator validates before writing and was proven to exit 1 writing nothing, emitted file `cmp`-identical to source, check-3 matrix 10/10. **Not yet exercised by a real deploy** — weekly cron |

Verification for #339: `pnpm test` 4926 passed / 1 skipped (264 files, up from 4911/263),
`pnpm typecheck` and `pnpm build` clean, invariants 559 passed, all 7 gates PASS locally,
CI 11/11 green. 10 negative controls, each redding exactly its target and reverted
byte-for-byte.

## Open items

### U-1. `usage.calllint.com` is served UNGATED at its `pages.dev` hostname

> **CLOSED 2026-08-27, in-repo.** `apps/usage-worker/src/pages-entry.js` now ships as the
> deployment's `_worker.js` (Pages advanced mode): every hostname other than
> `usage.calllint.com` gets a 301 to it and no report bytes, and `robots.txt` alone is still
> served so the hostname keeps a `Disallow`. This needed **no dashboard action and no
> account-level token** — it rides the `Pages:Edit` scope CI already has. The two options
> below remain available at the edge and now act as a redundant first layer, not as the fix.
> Covered by 10 tests driving the shipped file (`apps/usage-worker/test/pages-entry.test.ts`)
> plus 3 invariants; the generator validates the bytes *before* writing them, so a bad copy
> cannot reach a deployment. See the "How it was closed" section at the end of this item.

**Who could move it, before the in-repo fix: the user only** (Cloudflare dashboard). The decision on 2026-08-26 was to
*disable* the `pages.dev` subdomain — the custom domain already works, so an unused hostname is
pure exposure. **That instruction was wrong and is corrected here: Cloudflare has no switch to
disable or delete a Pages project's `pages.dev` hostname.** Verified against the Pages docs the
same day; the `Settings → Build & deployments → pages.dev domain → Disable` path this file
previously named does not exist. The
[Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/#disable-access-to-pagesdev-subdomain)
page frames the whole task as two *workarounds*, and after a custom domain is removed a project
"will only be accessible through the `*.pages.dev` subdomain" — that hostname persists by
construction.

So the intent stands and the mechanism changes. Two options were put to the user, both
account-level and both theirs — **and a third was missed, which is the one that shipped**:

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

#### How it was closed (2026-08-27)

**The missed third option.** Both options above are account-level objects, so both were blocked
on a credential the pipeline deliberately does not hold — and the maintainer's local token was
invalid (`code: 1000`). Presenting only those two framed a fixable defect as permanently
user-blocked. The redirect can instead ship *inside the deployment*, where `Pages:Edit` — the
scope CI already has — is sufficient.

`apps/usage-worker/src/pages-entry.js` is copied byte-for-byte to `dist/usage/_worker.js`
(the same pattern `usage.css` already used), putting the project in Pages **advanced mode** so
the platform routes every request through it.

| Request | Answer |
| --- | --- |
| `usage.calllint.com/*` | served unchanged, via `env.ASSETS.fetch` |
| `calllint-usage-report.pages.dev/*` | **301** → `https://usage.calllint.com/*`, empty body |
| `<hash>.calllint-usage-report.pages.dev/*` | **301**, same — the preview wildcard is covered too |
| any non-canonical `/robots.txt` | served, **not** redirected |

Four decisions worth their reasons:

- **`_worker.js`, not `_redirects`** — `_redirects` rules match *paths*; the subject here is the
  *host*, so there is no rule to write. Advanced mode also guarantees no request bypasses it.
- **301, not 403** — permanent, so it is browser-cached hard, and an old bookmark still lands
  somewhere useful (the Access sign-in) rather than on an error.
- **`robots.txt` exempt** — redirecting it would leave this hostname with *no* `Disallow` at
  all, and per the measurement above there is no `x-robots-tag` here to fall back on. Serving
  it replaces the `noindex` meta the redirect removes.
- **The redirect carries `x-calllint-report: present|absent`** — because it broke check 3. That
  check fetched `$DEPLOYMENT_URL`, itself a `*.pages.dev` name, and read HTTP 200 as "something
  is live"; after this change it reads a 301, and a redirect alone proves only that code *ran*.
  The header is derived by asking the asset server for the document, so check 3 now
  distinguishes gated-from-dead on the redirect path — **stronger than the 200 it replaced**,
  since "301 + absent" is exactly the 502 state U-2 records. A plain 200 there is now an
  **error**: it means the entry did not run, i.e. this finding is reopened on the wildcard.

**Verification.** 10 tests drive the shipped file itself (not a re-implementation) —
`apps/usage-worker/test/pages-entry.test.ts`; 4/4 mutations of it turn those tests red. 3 new
invariants pin check 3's new shape and that the entry is wired into the build; 3/3 mutations red.
The generator validates the bytes **before** writing, and was proven to exit 1 leaving the output
directory empty. Emitted `_worker.js` is `cmp`-identical to the source. Check 3's branch logic ran
as a 10-case matrix, 10/10 as intended. Full suite 4941 passed / 1 skipped (265 files); typecheck
clean, including the entry — `allowJs`/`checkJs` were turned on for the worker project precisely
so this file is not the one Workers-runtime file nothing typechecks.

**One behaviour change to know about.** Check 3's old `*)` branch printed a `::warning` and
treated any unknown code as live. It is an error now. Concretely: switching on
`Pages → Settings → General → "Enable access policy"` makes that read a 302 and turns this step
red — intended, because a red saying "come look" beats a green that hides that liveness is no
longer observable from there.

**Not verified:** behaviour on a real deploy. The workflow is a weekly cron plus
`workflow_dispatch`, so the first live exercise of the entry is the next run.

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
to land *before* U-1's remediation, and because the fault is instructive. Extended again on
2026-08-27 when U-1 shipped in-repo: the entry made `$DEPLOYMENT_URL` a 301, so check 3 was
re-cut to require the redirect **and** a `x-calllint-report: present` header. Same root cause,
one layer further in — a redirect is evidence that code ran, not that anything is behind it.

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
policy would make check 3 read a 302. That policy is off today, and U-1 did not need it — the
in-repo entry covers the wildcard directly. Since 2026-08-27 that 302 is an **error** rather than
a warning-shaped pass, so the limit is now announced by CI instead of living only in this file.

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

Re-run on 2026-08-27 for check 3's new shape: a 10-case matrix, 10/10 as intended, with "301 +
absent" (gated but dead) and "200" (the entry did not run) both landing `fail=1`.

**Not verified:** behaviour on a real run. U-1's remediation has landed in the repo, but the
workflow is a weekly cron plus `workflow_dispatch`, so the entry has not yet been exercised
against Cloudflare. The matrix covers the end states in logic, not in the world.

Seven assertions in
[`private-usage-deploy-gate.invariants.test.ts`](../../tests/invariants/private-usage-deploy-gate.invariants.test.ts)
now hold this shape in place, each with a negative control that reds exactly its target: the
deploy must publish the URL, the probe must fetch *that* URL, `Deployment complete` must be
asserted positively, check 4 must not treat a non-answer as a fault, liveness must require both
the 301 and the report header, a plain 200 must be an error, and the shipped entry must exist and
be wired into the generator ahead of its validation block. The predecessor pinned
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

### E-2. Copilot CLI — ✅ **RESOLVED 2026-08-27**, and it found a shipped defect

Was: both `copilot-cli` rows sat at `AUDIT_REQUIRED` behind a 357 MB install that cannot run on
an Actions runner. The user authorized the install; it ran on `copilot` 1.0.80. Four results,
each measured rather than inferred:

1. **`mcp-registry-discovery` → `BLOCKED`.** Copilot CLI does not consume the Official MCP
   Registry: `copilot mcp add` takes a command or URL with no registry lookup, `mcp list/get`
   expose no search flag, and `registry.modelcontextprotocol.io` appears nowhere in the shipped
   `app.js` — against a positive control on the same search that finds `mcp-config.json` in that
   same file. The row previously carried `upstream: officialMcpRegistry`, a claim about a
   mechanism that does not exist; it is **removed** rather than relabelled, because `upstream` is
   an evidence arm HD-07 accepts and a false arm is worse than none.
2. **`github-copilot-plugin` → `READY_NOT_SUBMITTED`**, the first record ever to use that state.
   A real PR target exists and was not previously documented: `github/copilot-plugins`, whose
   marketplace is a GitHub repo carrying `.claude-plugin/marketplace.json` — the same format this
   repo already publishes. The entry to paste is written out in
   [HUMAN-STEPS.md](../submissions/HUMAN-STEPS.md) #3. Two cautions recorded there: the real file
   is `.github/plugin/marketplace.json` (the `.claude-plugin` path is a one-line pointer to it),
   and all 20 live entries are Microsoft/GitHub first-party, so third-party acceptance odds are
   *unknown*, not good.
3. **Route A works but is deprecated.** `copilot plugin install ./plugins/calllint` succeeds and
   `copilot plugin list` reports `calllint (v0.1.0)`, but direct path/repo/URL installs warn that
   only `plugin@marketplace` installs will be supported. So the local install is a test of the
   artifact, not an alternative to the PR, and the PR is the eventual only route.
4. **A shipped defect, found by accident and fixed.** Our plugin installed and reported `enabled`
   on Claude Code while `claude mcp list` said *No MCP servers configured* — the MCP server, the
   whole product, was silently absent on both Claude Code and Copilot CLI. Cause: the manifest was
   `mcp.json`, which is **Cursor's** filename; Claude Code and Copilot CLI read `.mcp.json`. Fixed
   additively (`plugins/calllint/.mcp.json`, byte-identical, Cursor's copy untouched), and
   `scripts/probe-claude-plugin-install.mjs` gained a fifth step asserting `✔ Connected`, so the
   availability claim now rests on the product being reachable rather than installed. The first
   four probe steps were all true while the product was unreachable — which is the
   guard-blind-to-its-subject fault class, in the probe that was supposed to be the evidence.

On disk the server records `type: "local"` despite the `--transport stdio` flag, worth knowing
before anyone greps the config for `stdio`.

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

### O-1. Usage observability closure — `Distribution → Observed Usage` has no fact chain

**Who can move it: mostly me; a subset is the user's.** Handed over 2026-08-27 as a 22-section
execution plan. **Registered rather than executed**: it asks for production mutation (Worker
deploy, a zone Configuration Rule) and its first two premises are falsified below, so
transcribing it as a task list would write two wrong facts into the backlog.

Reduced to the four questions it actually asks:

1. what are the ~3k Worker invocations/24h?
2. why does the report read `no telemetry ingested yet`, `Recorded preflights = 0`,
   `Active installations = 0`?
3. can product usage be observed without polluting the marketing site's Web Analytics?
4. all of it at **zero new Cloudflare recurring cost**.

#### Two premises were falsified before this item was written

**(a) `telemetry.calllint.com` is LIVE and is serving the ingress Worker.** Measured 2026-08-27
from the maintainer's machine:

```
GET https://telemetry.calllint.com/                 → 404, content-type: application/json,
                                                       cache-control: no-store
GET https://telemetry.calllint.com/v1/events/usage  → 405
    {"schema":"calllint.usage-api.error.v0","code":"method_not_allowed",
     "message":"This endpoint accepts POST only."}
```

Those two headers are exactly what the Worker's `json()` helper sets, and that `schema` string
exists **only** in `apps/usage-worker/src/index.ts` — so the responder is our Worker, not a
Cloudflare edge default. Control: `calllint.com` → 200, `usage.calllint.com` → 302, so the
instrument was working.

Therefore [`apps/usage-worker/wrangler.toml`](../../apps/usage-worker/wrangler.toml) is **stale**
at its custom-domain block: it states `NOT YET CLAIMED — blocked on one token permission` and
leaves `[[routes]]` commented, under a heading claiming this is the only endpoint that works and
that enabling it is "the activation switch". The route exists in the world regardless of that
file. **Correcting that comment belongs to this item, not to a drive-by edit** — the same comment
warns that an uncommented block makes `wrangler deploy` fail *outright* when the permission is
absent, and whether the live route was bound by dashboard or by token is unmeasured. Guessing
there risks breaking every redeploy.

**(b) The plan conflates two deployments.** `usage.calllint.com` is the *static gated report*
(Pages `calllint-usage-report`; 302 → Access login). `telemetry.calllint.com` is the *ingress*
(Worker `calllint-usage-ingress`, `workers_dev = false`). No invocation count on the report host
can be telemetry ingestion. The 3k figure came from the dashboard and **is not verified here**;
it must be attributed per host before it carries meaning.

#### Root cause of `no telemetry ingested yet`: THE FEATURE WAS NEVER PUBLISHED

Measured 2026-08-27 against the real npm tarball (`calllint@1.8.0`, 446 KB `dist/index.js`):

| probe | hits | | control | hits |
|---|---:|---|---|---:|
| `"telemetry"` (command name) | **0** | | `calllint` | 312 |
| `enableTelemetry` | **0** | | `UNKNOWN` | 102 |
| `flushTelemetry` | **0** | | `"scan"` | 4 |
| `queueSink` | **0** | | `"integrate"` | 1 |
| `telemetry.calllint.com` | **0** | | `"trust"` | 2 |
| `v1/events/usage`, `telemetryEnabled` | **0** | | | |

The controls are there so the zeros are not confused with a bad path — the classic fault in this
repo. And the decisive one is a **positive** control: the *same* strings grepped with the *same*
command against a `pnpm build` of HEAD (`apps/cli/dist/index.js`, 506.8 KB) return
`telemetry.calllint.com` **1**, `telemetryEnabled` **13**, `v1/events/usage` **1**,
`flushTelemetry` **6**, `queueSink` **3**. So the instrument detects these strings when they are
present, and the published zeros are not minification, mangling or a wrong path — they are a
missing feature. The 60 KB size gap is that feature.

The timeline closes it:

```
calllint@1.8.0 published   2026-08-18 03:26Z
consent wiring + endpoint  2026-08-21 13:08   a0076ff (#325) — three days LATER
latest tag                 v1.8.0             — no release since
```

`a0076ff` is an ancestor of HEAD, so **the whole `emit → queue → POST → D1` chain exists only in
the repository.** The 16 `telemetry` strings that *do* ship are contract/emit/sanitize/gate — the
"wired, dark" skeleton, with no network end.

**So `no telemetry ingested yet` is not a defect. It is a correct reading of the world**, and it
needs no further explanation. Ranked candidates, corrected:

1. **The published artifact carries no delivery path** — necessary *and* sufficient. No Cloudflare
   access was needed to establish this.
2. **`telemetryEnabled` defaults to false** ([`state.ts`](../../apps/cli/src/state.ts),
   `consented: telemetryState.telemetryEnabled === true`) — true at HEAD, and it becomes the
   operative constraint only *after* a release ships the field.
3. **The 5s transport timeout** — inapplicable to 1.8.0, which has no transport.

An earlier version of this item ranked (3) first and called it "the best free lead". That was
wrong twice over: the probe hit the `405` method gate, which returns *before* validation, HMAC or
any D1 access, so it cannot implicate the ingest path at all; and it was three samples from one
network. Kept as an open reliability question, not as a root cause:

> `6.7s`, `11.6s`, and once no answer at all (curl `000` at a 23s ceiling) for a constant JSON
> error. Worth layered re-measurement (DNS / connect / TLS / TTFB) from at least two networks.

**Why latency cannot explain a zero, independent of any measurement.**
[`flush.ts`](../../apps/cli/src/flush.ts) removes events **only** on a confirmed 2xx and otherwise
leaves the queue intact, and `createBatch` derives a stable id so a retry after an ambiguous
failure can be de-duplicated server-side. Delivery therefore retries on every subsequent run. To
produce *exactly zero* ingestion, latency would have to be both persistent and universal — one
successful flush by one consented user makes it non-zero. Only (1) or "nobody opted in" yields a
true zero.

#### The RUM sub-item is smaller than the plan assumes

The plan's remedy — a free-tier Configuration Rule setting `disable_rum = true` on
`usage.calllint.com` instead of buying Web Analytics Rules — is sound on Cloudflare's published
limits, and is the user's to create (account/zone scope; per U-1 and
[`CLOUDFLARE_ACCESS_ACTION.md`](../authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md)
this pipeline deliberately holds no such credential). But **the premise that beacon injection is
happening here is unverified**: no Web Analytics or RUM snippet is referenced anywhere in this
repo, and automatic injection is a zone setting nobody has read. Measure before rule-writing —
otherwise this buys a rule against a beacon that may not exist. Note also that since U-1 shipped,
`usage.calllint.com` *does* run a Worker on every request (`_worker.js`, Pages advanced mode), so
that host now contributes Worker invocations by construction.

#### What is left is a release decision and a policy decision — both the user's

The engineering root-cause search mostly dissolves with the finding above. Two acts remain, and
neither is a bug fix:

1. **A release.** The telemetry chain reaches users only when a version ships. This is the single
   gating action and it needs no Cloudflare permission.
2. **A telemetry-policy freeze.** Three options were put forward: (A) keep the hidden opt-in,
   (B) first-run explicit consent, (C) privacy-safe default ON with disclosure and easy opt-out.

**(C) is not a free product choice — it is a documented non-goal of this project.** The Blueprint's
numbered prohibition list (items 8–17: pay-to-improve verdicts, public shaming, …) contains:

```
15. Collecting private local CLI telemetry by default.
```

Reinforced by two more standing constraints: new11 §2.6 fixes the four-tier model at
`local CLI = opt-in default-off`, and `docs/privacy/telemetry.md` is a published privacy document.
`security-boundary.yml` also carries a `telemetry-boundary` job. Choosing (C) means reversing a
recorded non-goal and needs an **ADR first**, per CLAUDE.md.

**(B) is compatible with all of it**, because an explicit user choice is not "by default" — and it
fixes the real defect in (A), which is not conservatism but that *the opt-in channel does not exist
in any published build*, so the command cannot be discovered at all. The selection-bias concern
about (A) is real; its cause is one layer deeper than "users don't find the command".

Recommended shape if (B) is chosen, which also answers the CI-friction objection:

```
non-TTY / CI / CALLLINT_TELEMETRY=0  → OFF, no prompt
interactive TTY, first run           → prompt once, persist the answer
```

**Not decided here.** This tracker records the constraint, not the choice.

#### Constraints this item inherits

- **Zero new recurring Cloudflare cost is a gate, not a preference.** Storage is the one variable
  that cannot be pre-declared free: D1 is already bound and migrated, so reuse it — the plan's own
  warning against `1 event = 1 KV write` applies, since the KV free tier allows 1k writes/day
  against a claimed ~3k events/day. Stop at `COST_GATE_BLOCKED` rather than upgrade.
- **No historical backfill.** npm downloads stay `Distribution Signals`; usage chronology starts at
  the first credible event. This is already the shipped page's contract.
- **No new truth source.** D1 + the existing aggregation path, not a second pipeline.
- Privacy posture is already strong in code (IP/UA never persisted, installation IDs HMAC'd at
  ingestion, no raw event log) — the closure must not weaken it to gain a metric.

**Still not verified:** the 3k figure and its composition (needs the Cloudflare *service name* that
produced it before it can be split by path/method/status/trigger), the plan/quota baseline, whether
any RUM beacon is injected at all, and whether D1 currently holds rows. `3k` currently supports
none of "3k telemetry events", "3k report pageviews", or "3k users".

**Answered since registration:** whether a shipped build emits — it does not, and that needed no
account access. Recorded because the first version of this item listed it as unverifiable-for-now
alongside the genuinely account-gated facts. It was neither; it was one `npm view` away.

**Sequencing.** Gates in dependency order: published-artifact reality (**done**) → consent policy
freeze (**done 2026-08-27** — first-run prompt on an interactive TTY; see O-2) → published
disclosure for that prompt (**done 2026-08-27**, O-2 closed early so the release does not carry
it) → `CHANGELOG` entry for the 33 unreleased commits (**done 2026-08-27**, under `[Unreleased]`;
the version bump and the dated heading are part of the release act, not a prerequisite of it) →
release (**user; deferred 2026-08-27** to ship with other features, so the prompt reaches nobody
until then) → controlled end-to-end test under an isolated `HOME`
(`telemetry enable` → run → queue → POST → 204 → D1 row) → layered latency from ≥2 networks → 3k
service attribution → RUM beacon check, and **only if a beacon is found**, a `disable_rum` rule.
The last two are independent sub-gates and do not block the chain above.

### O-2. The consent prompt has no published copy — and cannot have one from `docs/`

> **CLOSED 2026-08-27, ahead of the release rather than at it.** `README.md` and
> `apps/cli/README.md` now carry the disclosure (opt-in / off by default, the
> `CALLLINT_TELEMETRY` kill-switch, `telemetry status|disable`, the allowlisted field
> list, and the never-sent list), and `pnpm check:public-copy` **check 26** holds it
> there. The requirement is *derived*, not hardcoded: with `apps/cli/src/consent.ts`
> absent the check reports "no disclosure owed", so the gate tracks the behaviour
> instead of asserting a fixed sentence. Each concept accepts several spellings, so a
> rewording does not red it while the property holds — the predecessor failure mode
> was a test measuring prose.
>
> **Closed early on purpose.** This item said "due at release, not now". That framing
> made the debt fall due at exactly the moment it would be most expensive — a release
> is already the step with the most irreversible parts (immutable npm versions), and
> a *published* behaviour with no published explanation cannot be fixed after the
> fact for the users who already have it. Writing the copy first removes the debt
> from the release's critical path.
>
> **Two things this turned up, neither of them the item's subject:**
>
> 1. **The measurement in this item was produced by a command that never ran.**
>    `git grep -lin telemetry -- '*.md' …` exits **129** on this machine (`-lin` is
>    parsed as an unknown option), so "returns **zero** tracked files" was read off a
>    usage error. Re-measured correctly: **33** tracked `.md` files mention telemetry.
>    **The conclusion survives** — `README.md` 0, `apps/cli/README.md` 0,
>    `apps/web/**` 1 (a test file) — so all 33 are ADRs, artifacts and governance
>    docs, and the user-visible surface really was empty. Right answer, broken
>    instrument: the repo's dominant fault class, this time in a measurement rather
>    than a guard.
> 2. **`apps/cli/README.md` was not in the public-copy gate's governed set at all**
>    (`EXTRA_PUBLIC_FILES = ["README.md"]`). That is the file npm renders on the
>    package page — the most-read surface this project has, and the least governed.
>    It is in the set now, which immediately failed check 2 on a pre-existing
>    overclaim (`guaranteed safe`, in a negated sentence the substring check cannot
>    see). Fixed by rewording *our copy*, not by narrowing the rule.
>
> Verified before being trusted: 3 negative controls, each redding exactly its target
> and reverted byte-for-byte — removing the kill-switch mention, removing the
> never-sent disclosure, and moving `consent.ts` aside (which correctly flips the
> check to "nothing owed"). Full suite 4973 passed / 1 skipped (266 files) at the
> baseline; typecheck, `check:public-copy` and `check:web-structure` green after.

**Who could move it: me. Originally scoped as due at release.** The consent policy was frozen 2026-08-27 as a
first-run prompt on an interactive TTY (`apps/cli/src/consent.ts`). That is the first
**user-visible** telemetry behaviour this product will have. Its written explanation currently
lives at `docs/privacy/telemetry.md`, which `.gitignore:44` excludes — `docs/` is deliberately
local-only (ADRs, roadmap, threat model, plans). So the explanation is real, reviewed, and
**unreachable**: not in the repo, not in CI, not in the tarball.

Measured 2026-08-27: `git grep -lin telemetry -- '*.md' '*.html' '*.astro' '*.mdx' '*.json'`
returns **zero tracked files**. There is no published telemetry copy on any surface —
`README.md`, `apps/cli/README.md`, and `apps/web` all omit it. `pnpm check:public-copy` passes,
which places this outside what that gate observes; the gate is not wrong, the surface is absent.

Why this is registered rather than fixed now: nothing is owed while nothing ships. Collection is
opt-in and default-off, and the published `calllint@1.8.0` has no delivery path at all (O-1), so
today there is no user to inform. Inventing a published privacy surface ahead of the release that
needs it would be speculative architecture. **The debt falls due the moment a build carrying
`consent.ts` is published** — at that point a user can see the prompt, and a prompt whose only
explanation is a gitignored file is a prompt with no explanation.

Precedent for why this is written down instead of remembered: `scan --config` was advertised on
eight surfaces while nothing read it. The mirror-image failure — shipping behaviour that no
surface describes — is the same defect with the arrow reversed.

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
