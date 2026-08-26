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

**Who can move it: the user only** (Cloudflare dashboard).

The 502 is fixed — see [U-2](#u-2-the-502-is-resolved-and-why-it-was-invisible-for-so-long) —
but fixing it exposed the next fault. Measured 2026-08-26 from an unauthenticated machine:

```
200  https://calllint-usage-report.pages.dev/   2666 bytes
     <title>CallLint Usage — private</title>
     all 3 report row labels present: "CLI package downloads", "MCP servers observed",
                                      "Recorded preflights"
302  https://usage.calllint.com/                → cloudflareaccess.com/cdn-cgi/access/login
```

Cloudflare Access binds to a **hostname**, and the policy covers only the custom domain. So
the report that new18 §29 requires to be private is world-readable at the `pages.dev` address
the moment a deploy lands — which is now, for the first time.

**Severity: privacy, not secrets.** No credentials and no raw identifiers are in the artifact
(those never leave the Worker). What leaks is operator-facing figures. §29 nonetheless makes
"public" the violation, which is why this is an error rather than a note.

Remediate either way:
- add the `usage.calllint.com` Access policy to `*.pages.dev`, **or**
- disable the `pages.dev` subdomain on the Pages project (Settings → Build & deployments →
  pages.dev domain).

The `usage-report.yml` probe already checks for exactly this and calls it out with both
remediations (`usage-report.yml:198-205`). It did not fire on the run that produced the
measurement above for the reason in T-2 below.

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

### T-2. The Access probe races the Pages alias

**Who can move it: me** (small, safe, not yet done).

On run `32975124276` the deploy succeeded and the probe still failed:

```
13:36:19.16  ✨ Deployment complete! → https://197a21a9.calllint-usage-report.pages.dev
13:36:19.66  ##[error]Origin has no live deployment (HTTP 522 at .../pages.dev/)
```

Half a second apart. The deployment-specific hostname was live; the production alias had not
finished routing. Re-measured minutes later from an unauthenticated machine: **200, 2666
bytes, both hostnames**. So the 522 was a propagation artifact, and the probe currently reports
a transient as a permanent fault — the *opposite* of the defect `c9553a2` fixed, and equally a
guard that cannot observe its subject.

Worth fixing with a bounded retry (the probe should distinguish "not yet routed" from "nothing
deployed"). Left open rather than patched blind, because the fix must not become a sleep that
hides a genuinely empty origin. Note that this same race is why U-1's ungated-content check did
not fire on that run: the leak branch is evaluated against a body the probe never received.

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

**`cline` / `cline-marketplace-pr` does NOT belong in this table — it is waiting on US.**
Measured 2026-08-26 against `cline/marketplace` (the `submissionUrl` in the SSOT; an earlier
check used `cline/mcp-marketplace`, which does not exist):

```
state=OPEN  draft=true  created=2026-08-18T10:42:30Z  updated=2026-08-18T10:42:30Z
title=Add CallLint MCP server
```

**The PR is a draft, and has not been touched since it was opened.** A draft PR is not in
any maintainer's review queue — GitHub excludes it from review requests by default. So the
8 days of silence are not upstream latency; nobody has been asked yet. The SSOT note ("open,
verified 2026-08-23") is literally true and materially incomplete: `open` and
`awaiting-review` are not the same state, and `PENDING_UPSTREAM` asserts the second.

**Who can move it: the user** — marking a PR ready for review is an outward-facing act on a
third party's repository, so it needs explicit authorization (`gh pr ready 49 --repo
cline/marketplace`). The SSOT note should also be corrected to say `draft`. Still true, and
still worth keeping: **do not create a duplicate.**

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
