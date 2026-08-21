# Global Agent Distribution Authority — Final Report

**Branch:** `feat/global-agent-distribution-authority` (measured at `4671854`, the 20th commit over
`origin/main`; the tree carrying this file is `0c3f2c0`, the 21st)
**Date:** 2026-08-20 (re-measured; first drafted 2026-08-19 at `d5f12df`)
**Scope:** stages G0–G9 of the A0 execution package, the Official MCP Registry Tier-0
closure items, and the telemetry-correctness work that landed alongside them.

Every number below is a measurement taken against the tree at HEAD, and every claim names the
command that produces it. Where a claim could not be measured, it says so instead of asserting
a state.

Sections A, F, H, I and J were **corrected after first drafting** against measurements that
contradicted them. The corrections are marked in place rather than silently applied, because
three of them turned a ✅ into an open item.

**Measurement point: `4671854`.** The first draft was written at `d5f12df` and re-measured at
`865f9c6` and `fda2bd5`; every number was re-taken at each move rather than carried forward —
which is the point, because several commits on this branch exist precisely because a
carried-forward claim turned out to be false. New material at `865f9c6`: section L (telemetry),
section M (the three gates that could not observe their subject), and the
`distribution-sources.json` projection in section D. Then section O (legacy URL handling) and
section P (responsive QA). New at `4671854`: section L′ (the usage observatory as a Worker), and
the re-measurement that falsified section L's own evidence for "not static-only".

A report that records its own HEAD invalidates itself the moment it is committed, so this file
names the last commit that changes a **measured surface**, not the commit that carries the file.
`4671854` is that commit: it adds the Worker's failure diagnostic, extends the telemetry boundary
guard, and changes the generator. `0c3f2c0`, which follows it, deletes a dead script and rewrites
three documents — no code, no generated projection, no gate — so no measurement below moves with
it. Anything that did would have to be re-taken, not adjusted.

---

## A. Verdict

**NOT fully closed — one item remains, and it is blocked on a repository-settings write, not on
unwritten code.** All local gates are green. Of the three items open when this section was
first written (section J), **two closed when PR #325 squash-merged as `a0076ff` on 2026-08-21**:
the watcher's cron is now armed on the default branch (`state: active`, re-measured at `4bcedb5`
on 2026-08-21 — still `active`, still `gh run list` → `[]`) and the GD-15 site fix is live.

The third item was **narrowed, not closed, by a scope correction on 2026-08-21.** It had been
recorded as one thing — "create the `mcp-v*` tag ruleset" — but `new18.md` §45 asks for two
independent controls, and AC-32's RED condition (`mcp-v tag from unrelated unreviewed branch can
publish`) is the *second* one: which commit ships, not who may tag. That half was missing from
`publish-mcp.yml` entirely and was code, not an operator action; it is now
`scripts/verify-release-ancestry.mjs`, step 2 of the publish job, negative-controlled over all
three reachability states (section H item 10b). What remains is the **tag ruleset** — a write to
repository settings. With the ancestry gate in place, its absence no longer means unreviewed code
can reach npm; it means a rogue tag can still start a run and reach the `environment: npm`
reviewer. Nothing in the distribution scope is waiting on further implementation.

Confirmed at `865f9c6` on 2026-08-20, not carried forward:

| Measurement | Command | Result |
| --- | --- | --- |
| Full local suite | `pnpm ci:local` | **exit 0**, 25 `&&`-joined steps |
| Registry readback | `node scripts/verify-registry-presence.mjs` | **exit 0**, 7/7 fields agree |
| Tag ruleset | `node scripts/verify-mcp-tag-protection.mjs` | **exit 1** — 1 ruleset, 0 targeting tags |
| Watcher on default branch | `gh api .../workflows/distribution-watch.yml` | **404** — never scheduled |
| Security semantics | `pnpm check:security-semantics` | UNCHANGED — 0 / 0 / 0 |

The two exit-1 / 404 rows are the two open items, and both are *outside* the tree. They are
reported here as failures rather than as "pending" because that is what the commands return.

Rows 1 and 5 were re-taken at `fda2bd5` after section O landed and are unchanged, and re-taken
again on **2026-08-21** in the closing pass: `ci:local` **exit 0** at 25 steps, now **243 files /
4524 passed / 1 skipped** (up from 237 / 4393 as other work landed on the branch), and
`check:security-semantics` still `UNCHANGED` — it runs inside the chain. Rows 2–4 were **not**
re-taken: each observes state on a remote — the Registry API, the repository's rulesets, the
default branch's workflow list — that no commit on this branch can move, so re-running them
would produce a new timestamp and no new information. They are dated `865f9c6` for that reason,
not upgraded to the later SHA.

Nine properties were closed *this pass* by finding them broken or unenforceable, not by
documenting them as done. One of the nine — GD-15 — was a real defect **this branch created**;
its fix was local when this line was written and is now live on production (section F, re-measured
2026-08-21 after PR #325 merged as `a0076ff`).

Two acceptance claims that earlier drafts of this report asserted do **not** hold under
measurement and are corrected here: `REGISTRY_WATCH` was not READY (section H — **this one closed
when PR #325 merged as `a0076ff`; see the post-merge note below**), and
Registry item 10 was not verified (section H). Item 10's *guard* has since been rewritten so it
can observe its subject; the underlying tag ruleset still does not exist.

The three items filed as "minor, disclosed, not blocking" in the first draft were not carried
forward as disclosures — they were fixed (section J, items 4–6). Writing the schema for item 4
immediately caught a typing error in the schema itself, which is the argument for writing it.

**Outside the distribution scope, one workstream is genuinely unimplemented** and is named here
so this report is not read as a closure claim over it: the usage-ingress service (`apps/usage-worker`,
D1 schema, the private report surface). Section L covers what landed and what did not; section N
states the boundary.

**Added in the closing pass (2026-08-21), after a re-read of new18 found four items asserted
nowhere.** All four were traceability or vocabulary gaps rather than missing implementation, and
two of them were defects in this report itself:

| new18 | gap | closed by |
| --- | --- | --- |
| §85 | the DeepSeek candidate feed had **no watcher** — 13 of 14 sources were watched, and the 14th was unreachable by construction (the watch list derives from `hosts`, and a feed is not a host) | new `candidateFeeds` array in the SSOT + schema + generator projection; `role` is a schema `const`, so a second role cannot be introduced by editing data |
| §104 | no per-claim external provenance file | [EXTERNAL_DISTRIBUTION_MATRIX.md](EXTERNAL_DISTRIBUTION_MATRIX.md) — generated; 27 claims × source + checked-at + conclusion |
| §105 | the 14-column matrix was cited to a prose file that is not that matrix | [FINAL_PLATFORM_MATRIX.md](FINAL_PLATFORM_MATRIX.md) — generated; 15 hosts × 14 columns, 210 cells, none typed |
| §93 | AC-01..AC-40 appeared **only** in `new18.md`; the controls here were numbered NC-1..NC-15, so no reader could route between them | the AC traceability table in section I — 39 of 40 mapped, AC-32 recorded as `NO CONTROL` |
| §107 | the vocabulary block printed **8 of 15** states, which reads as full coverage | all 15 now listed, including the two that do not carry the value §107 expects |
| §7 | `security-semantic-before.json` does not exist and nothing said so | section B — stated as a deliberate deviation, with the merge-base rationale |

Both matrices are generator output, not hand-typed, for the reason section M is about: a hand-typed
cell has no reader when it drifts and is erased by the next `pnpm gen:distribution`. Byte-identical
across two consecutive runs (`checkedAt` reads the SSOT's `generatedAt`, never `new Date()`), so
they cannot produce the clock-churn diff that made PR #268 read as +401/−401 of content that was
all timestamp.

Adding them to the drift gate in [distribution-watch.yml](../../.github/workflows/distribution-watch.yml)
reproduced the same fault class inside the gate extension itself.
**NC-16/NC-17, measured:** with the two paths listed but the files still **untracked**, an injected
SSOT change that visibly moved a matrix cell left the gate at **exit 0** — `git diff` cannot observe
a file git is not tracking, so the newly added paths asserted nothing. That is precisely the rule
already written into that workflow's comment (listing a path the generator does not write makes a
vacuous assertion) reappearing in a form the comment did not cover: a path the generator *does*
write, that git does not track. After `git add`, the same injection went **exit 1 = RED**, and the
revert left both files byte-clean. The gate is load-bearing only because the control was run; the
YAML edit alone would have shipped a green that meant nothing.

Writing the §104 matrix immediately caught a defect in my own generator, which is the argument for
generating it: 5 of 27 rows had rendered *"State recorded from the primary source above."* — a
sentence that asserts a conclusion exists where the SSOT records none. Those rows now read **"no
conclusion recorded — state asserted, evidence not yet summarised"**, and the count is stated in
the file body.

That makes two more instances of this repository's dominant fault class, both authored in this
closing pass by the person writing the gates: the §104 filler cell, and the vacuous drift-gate
extension above. Counting the three guards in section M and the two live catches in section I,
that is **seven** recorded instances of a claim that could not observe its subject — five found in
existing work, two written and then caught here.

---

## B. The invariant

```
MODEL IDENTITY      ⟂ SECURITY VERDICT
DISTRIBUTION CHANNEL ⟂ SECURITY VERDICT
MARKETPLACE PRESENCE ⟂ SECURITY VERDICT
```

`SECURITY_SEMANTICS = UNCHANGED`, measured on three independent channels by
`scripts/verify-security-semantic-diff.mjs`:

| Channel | Subject | Result |
| --- | --- | --- |
| DIFF | 6 verdict-deciding packages over `main..HEAD` | 0 committed, 0 worktree changes |
| FIELDS | 8 forbidden risk fields across `packages/`, `apps/`, `scripts/` | 0 of 8 present |
| COUPLING | 5 host-identity tokens inside `packages/risk-engine/src` | 0 of 5 reach it |

The measured packages are `risk-engine`, `static-analyzer`, `policy`, `types`, `fingerprint`,
`core`. `resolver` and `config-parser` are deliberately excluded: they decide what gets
scanned, not what the scan concludes, and host discovery legitimately touches them — exactly
the change this gate must permit.

The artifact `security-semantic-diff.json` is the script's *output*, not a hand-written file,
and `--check` re-measures and compares. A committed `"changed": false` costs nothing to write
and nothing to keep true; this one is falsifiable by construction.

**On §7's `security-semantic-before.json` — it does not exist, deliberately.** §7 asks for a
before-snapshot (verdict, findings, reason codes, authority, policy, evidence, digests) captured
ahead of the functional changes, to be compared against the final state later. What was built
instead measures the same invariant a different way: `verify-security-semantic-diff.mjs` diffs the
six verdict packages against the **merge-base** (`8acf297460d560b0e07e5667d82e40ae5b57e1ce`), which
*is* the before-state, read from git rather than from a committed copy of it.

The substitution is not a shortcut, and the reason is the one this report keeps running into. A
committed `before.json` is a hand-made copy of a state git already holds exactly; once committed it
can drift from, or be quietly reconciled with, the tree it claims to describe, and nothing would
red. The merge-base diff cannot be reconciled — NC-10 injected an unresolvable `--base` and the
gate went **RED** rather than silently skipping the measurement, which is the property a snapshot
file does not have. §7's stated goal ("later be compared byte/semantically against the final
state") is therefore met; the named file is not produced. Flagging it as a deliberate deviation
rather than leaving the absence to be discovered.

Reproduce: `pnpm check:security-semantics`

---

## C. The cohort

One SSOT: `apps/web/data/distribution-surfaces.json` — 15 hosts, 1 model-intent landing page.

| Support class | Count | Meaning | Public label |
| --- | --- | --- | --- |
| `NATIVE` | 8 | CallLint finds the config itself | Auto-detects |
| `CONFIG_SCAN` | 1 | Scans a path the user names | Scan config |
| `DISCOVERY_ONLY` | 3 | Documented, not yet auto-detected | Guide only |
| `DEFERRED` | 3 | Not implemented yet | Guide only |

The four classes are unchanged from the contract. No fifth class was added, and no host
carries a risk-bearing field.

---

## D. GD-05 — one SSOT, closed by migration rather than by compatibility shim

The contract forbids maintaining `harness-surfaces.json` and `distribution-surfaces.json` as
two independent truths. Both existed. The legacy file was hand-maintained with an older
ontology (`cohorts: {P0, P1}`, `calllintSupportClass`, `truthfulCommand` as a string,
`deepSeekIntegrationObserved`) and **nothing generated it and nothing compared them**.

Consequence, measured: `check-harness-distribution.mjs` read the legacy file and therefore
audited **8 of 15 hosts while exiting 0**. The 7 it never saw were every `DISCOVERY_ONLY` and
every `DEFERRED` host — precisely the classes whose claims most need checking, because those
are the ones that must NOT advertise an `--agent` command.

Closed by full consumer migration, not by generating the legacy file during a compatibility
window: the SSOT is a strict superset (15 ⊃ 8, same four classes, `truthfulCommands` carries
the `--agent` forms), so nothing was lost. Then `git rm` on both the legacy file and
`scripts/generate-harness-pages.mjs`.

The gate now audits 15 hosts and gained an anti-vacuity guard. Every assertion in it is keyed
on `supportClass === "..."`, so a renamed field would make the whole gate assert nothing while
printing checkmarks; `assertCohortShape()` makes that RED.

Reproduce: `pnpm check:harness-distribution`

### The one file that was about to become a second source of truth

The watcher needs a list of primary vendor surfaces to consult. The obvious move — commit
`scripts/distribution-sources.json` as a hand-maintained list — would have recreated the exact
defect this section is about, and in the more dangerous direction: a host *added* to the SSOT
would silently never be watched, and nothing would say so. The failure is invisible by
construction, because a watcher watching 14 of 15 hosts looks identical to one watching 15.

So it is a **generated projection**, derived from each host's `officialSources` in the same run
that writes the pages. A host that leaves the SSOT leaves this file; a host that joins it joins
this file. Measured at HEAD: 15 hosts, 20 primary source URLs, all `https://`, all distinct.

Generation *fails* on a non-`https://` entry or a duplicate. That is stricter than formatting
hygiene on purpose: this file names what a scheduled job fetches unattended, so a downgraded
scheme is a supply-chain question. The strictness paid for itself immediately — see section M.

The file also carries its own boundary as a `$comment`: it is read-only input. The watcher may
fetch these and open at most one *internal* PR; it may never open an external PR or issue,
submit a form, or contact a maintainer. GD-11 / GD-17 in section I measure that this holds.

---

## E. GD-06 — the cartesian plane cannot regrow

`scripts/generate-harness-pages.mjs` was referenced by nothing — no `package.json` script, no
workflow. It wrote `harnesses/deepseek/<host-id>.html` for all 8 legacy cohort hosts: the exact
model × harness SEO pages that commit `79f3cb8` (on this branch) deleted. A dormant generator
that recreates a forbidden surface is a landmine, not dead code. Deleted.

`harnesses/deepseek/index.html` survives as the single model-intent landing page, which §6
preserves. It is hand-maintained and is not one of the SSOT's hosts.

Note the scope: the cartesian pages were gone from **this branch's** tree before the merge, not
from production. At the time of writing `main` still contained all 8 `.html` files and served
them (section F). **This has since changed by merge:** `main` now ships only
`harnesses/deepseek/index.html` — measured 2026-08-21, `git ls-tree -r main -- .../deepseek/`
returns exactly one path. GD-06 is closed in the sense the contract asks — no generator can
recreate the plane — and the plane is now removed from the tree that deploys.

---

## F. GD-15 — this branch broke the sitemap; the fix has since landed on `main`

This is the most serious finding of the pass, and it was found by writing a guard for a
property assumed to hold. The first draft of this report described it backwards, so the
sequence is stated here in the order the commits actually occurred.

`apps/web/public/harnesses/sitemap.xml` was hand-maintained. On `main` it was **correct**: 9
URLs under `/harnesses/deepseek/`, and all 9 resolved, because `main` still ships
`deepseek/<host>.html` for 8 hosts.

Commit `79f3cb8` (9th of the 11 commits on this branch, *not* a commit on `main`) deleted all 8
cartesian pages and added the 15 canonical host directories — and **did not touch the
sitemap**. That single omission produced, in the branch tree:

- 9 URLs, all under `/harnesses/deepseek/`
- **8 of them resolving to nothing** — the pages `79f3cb8` had just deleted
- **0 of the 15 canonical host pages** listed
- `robots.txt` advertising it the whole time: `Sitemap: https://calllint.com/harnesses/sitemap.xml`

So the defect is this branch's, not an inherited one. A sitemap is a promise to crawlers about
what exists; deleting the pages without updating the promise is what broke it.

Fixed at the root cause: the sitemap is now generated from the SSOT by
`generate-distribution-surfaces.mjs`. A host that leaves the SSOT leaves the sitemap in the
same run that deletes its page. Nothing in the generator can invent a URL the SSOT does not
name. Measured in the working tree after the fix: **17 URLs, 0 dead, 15/15 hosts present**
(`grep -c "<loc>"` → 17; `pnpm check:agent-surface` resolves each one against the served tree).

**The fix was local only when this section was written. It is now live.** The table below records
both readings, because the before-state is the evidence that GD-15 was real. Left column measured
2026-08-20 (pre-merge, unchanged from the 2026-08-19 reading because nothing had been pushed);
right column re-measured 2026-08-21 after PR #325 merged as `a0076ff` and `deploy-web` succeeded
for that SHA, each URL fetched with `?cachebust=a0076ff`:

| URL | Pre-merge (2026-08-20) | Live now (2026-08-21) |
| --- | --- | --- |
| `https://calllint.com/harnesses/sitemap.xml` | 200 — still the 9-URL `main` version | **200 — 17 `<loc>` entries**, the generated version |
| `https://calllint.com/harnesses/deepseek/claude-code` | 200 — `main`'s cartesian page, still served | **301 → `/harnesses/claude-code/`**, the legacy forward from `fda2bd5` |
| `https://calllint.com/harnesses/claude-code/` | **404** — no canonical host page is live | **200** |
| `https://calllint.com/agent-surfaces.json` | **404** — the machine surface §19 points at is not live | **200** — `agents[]` holds **15**, matching the SSOT's 15 hosts |
| `https://calllint.com/schemas/agent-surfaces.v1.json` | **404** — the schema written this pass is not live either | **200** |

Production was self-consistent before the merge (it served `main`) and is self-consistent after
it. The GD-15 violation was real in the branch, was fixed at the root cause in the branch, and
has now reached production. The `$schema` pointer in the served `agent-surfaces.json` resolves to
a 200 rather than dangling, which is the property section J item 4 claimed and could not
demonstrate off `main`.

---

## G. §19 / §20 — the agent and human contracts now have a gate

Both were true by hand and enforced by nothing. The §20 fix lives in a Handlebars template and
a generator string — two places one careless edit re-breaks.

**§19 (agent).** An agent must discover the cohort from `/llms.txt` without scraping HTML.
Measured gap: the `agent-surfaces.json` pointer was present in `llms.txt` and `llms-full.txt`
but **missing from `agent-instructions.md`** — the one document an agent is most likely to be
handed directly. Added a "Machine-Readable Surface" section to the generator. Now 3 of 3.

**§20 (human).** The internal ontology is a codebase enum, not public copy. Introduced
`PUBLIC_SUPPORT_LABELS`, a mapping that is **total by construction**: `publicSupport()` throws
on an unmapped class rather than falling back to printing the raw enum. A silent fallback would
leak for whichever class was added last — the one nobody is looking at.

The internal enum is retained as the CSS hook (`class="badge badge-NATIVE"`), so stylesheets
needed no change, and the hint rides in `title=`:

```html
<span class="badge badge-DEFERRED" title="Support is not implemented yet — this page
documents what we can observe today.">Guide only</span>
```

Measured: 0 internal-ontology tokens in visible text across 17 human pages; 15/15 host pages
carry a public label.

The label requirement is scoped to SSOT hosts, not to the directory listing. The intent landing
page documents a model drivable through several harnesses, so it has no single support class and
must not be made to fake one. The *leak* check still covers it.

Reproduce: `pnpm check:agent-surface`

---

## H. Official MCP Registry — Tier-0 identity

`io.github.calllint/calllint` / `calllint-mcp@0.2.0`, state LIVE, tier 0.

| Acceptance | State | Evidence |
| --- | --- | --- |
| `REGISTRY_PRESENCE = LIVE` | ✅ | `GET /v0/servers?search=calllint` → 200, entries for 0.1.1 and 0.2.0, both `status=active` |
| `REGISTRY_IDENTITY = CANONICAL` | ✅ | name, version, package identifier, package version, transport, repository all read back and asserted |
| `REGISTRY_PUBLISH = OIDC` | ✅ | `publish-mcp.yml` job permissions `{contents: read, id-token: write}`; `environment: npm` requires 1 reviewer (`GET /repos/.../environments/npm` → `required_reviewers: 1`) |
| `REGISTRY_VALIDATE = PASS` | ✅ | `mcp-publisher validate server.json` runs before publish (`publish-mcp.yml:94-96`) |
| `REGISTRY_READBACK = PASS` | ✅ | post-publish step at `publish-mcp.yml:115-120`, below |
| `REGISTRY_WATCH = READY` | ✅ **CLOSED by the merge** | `distribution-watch.yml` existed only on the feature branch, and was measured **404 on the default branch** on 2026-08-20 (0 runs). PR #325 squash-merged as `a0076ff` on 2026-08-21; re-measured immediately after: `gh api .../workflows/distribution-watch.yml` → `{"name":"distribution-watch","state":"active"}`. The cron is now armed. **It has still never executed** — `gh run list --workflow=distribution-watch.yml` returns `[]`, because the first weekly trigger (Mondays 09:00 UTC) has not arrived. |

`state: active` is the strongest fact available before Monday, and it is the fact §107 asks for
(a schedule that exists). It is **not** evidence the job passes. Reading `active` as "the monitor
runs" would repeat, one step removed, the very error corrected below — the first draft read
`schedule: cron` that way. What changed at merge is that the workflow became *capable* of running;
whether its four steps go green is unmeasured, and step 3 is `verify-mcp-tag-protection.mjs`,
which exits 1 today (item 2 of section J). **The first scheduled run is therefore expected to
fail**, for that reason and no other.

`REGISTRY_WATCH` was asserted READY in an earlier draft of this report on the strength of the
file's `schedule: cron` block. That was the defect this pass was written to catch: the
existence of a monitor's source is not evidence the monitor runs.

The cron itself moved from daily to **weekly (Mondays 09:00 UTC)** in `b6c0f2b`. Every fact this
job observes — a Registry entry, a tag ruleset, a generator's output for unchanged input —
changes on the order of weeks, so a daily schedule bought no earlier detection of anything and
spent 7× the Actions minutes re-asserting the same measurement. `workflow_dispatch` covers
"answer now". Now that the file is on `main` this cron is armed (`state: active`), so the row
above reads ✅ — but it has not fired yet, and a weekly schedule means the first firing is up to
seven days out.

**Items 5 and 6 — publish exit-0 is not sufficient.** `scripts/verify-registry-presence.mjs`
was found to be **structurally incapable of failing**: every control path ended in
`process.exit(0)`, one of them printing `State: LIVE` from a string literal. The registry could
go dark and the guard stayed green. It also called `verifyState()`, a function that **was never
defined** — no `ReferenceError` ever fired because the branch was unreachable.

Its docblock premise was also false. It claimed the Registry API does not return CallLint; the
old code queried `/v0.1/servers` with no query parameter and read page 1 of a paginated global
list. `?search=calllint` returns both versions.

Rewritten as a field-level readback and wired after `publish` with propagation retries
(`--retries 6 --retry-delay-ms 20000`). Retry fires **only** while the entry is not yet
visible — never on a mismatch, because a defect must not be waited out. An unreachable
registry exits 1: a monitor that cannot observe its subject reports failure, not health.

Only `--expect-version` is overridable; identity fields always come from the SSOT.

**Item 10 — `mcp-v*` tag protection: the guard is fixed, the protection still does not exist.**
An earlier draft claimed this was closed by `verify-mcp-tag-protection.mjs` in the watcher.
Measured:

```
$ node scripts/verify-mcp-tag-protection.mjs   # exit 1
gh: Not Found (HTTP 404)   →  GET repos/calllint/calllint/tags/protection
```

The failure was not a permissions problem — `gh api repos/calllint/calllint` reports
`admin: true`. The **legacy tag-protection endpoint the script queried no longer exists**;
GitHub replaced it with rulesets. Queried directly, the repo has exactly one ruleset:

```
17728504  "Protect main"  target=branch  enforcement=active  include=[~DEFAULT_BRANCH]
```

`target=branch`. There is **no tag ruleset**, so `mcp-v*` is unprotected: any collaborator with
write access can create the tag that triggers `publish-mcp.yml`. The `environment: npm`
reviewer gate still stands between a rogue tag and an npm publish, but the MCP Registry publish
step is in the same job, so that gate is the only thing holding.

That 404 is worth naming precisely, because it is this repo's dominant fault class in its purest
form: **"endpoint removed" and "tag unprotected" produced the identical failure.** A guard whose
red is indistinguishable from the condition it detects carries no information either way.

Both the script and the artifact `mcp-tag-protection.md` (which documented the same dead
endpoint and an expected response shape the API no longer produces) have now been rewritten
against `/repos/{owner}/{repo}/rulesets`. The rewritten verifier:

```
$ node scripts/verify-mcp-tag-protection.mjs --explain   # exit 1
Rulesets on calllint/calllint: 1 total, 0 targeting tags
  17728504  "Protect main"  target=branch  enforcement=active
FAIL: no active tag ruleset restricts creation of mcp-v*.
```

Same exit code, entirely different epistemic status: it now reports the measured ruleset
inventory and fails for the true reason. Re-measured at HEAD on 2026-08-20 — unchanged:

```
$ node scripts/verify-mcp-tag-protection.mjs   # exit 1
Rulesets on calllint/calllint: 1 total, 0 targeting tags
  17728504  "Protect main"  target=branch  enforcement=active
FAIL: no active tag ruleset restricts creation of mcp-v*.
```

PASS requires all five of `target: tag`,
`enforcement: active`, an `include` covering the whole `mcp-v*` space, no `exclude` carving it
back out, and a `creation` rule — tags are created, not pushed to, so a ruleset restricting only
`update`/`deletion` would leave the release trigger open. `mcp-v1.*` is deliberately **rejected**
as partial coverage. Pattern predicate unit-checked over 10 inputs, all correct.

Creating the ruleset is a write to shared repository settings and is left to the maintainer;
`--explain` prints the UI path and the equivalent `gh api` call. Still OPEN in section J — but
open on an unattended-write policy, not on code, and **not** on a missing permission: the
account has `admin: true`, so "I lack the permission" was an unqueried guess and is false. The
runnable form is recorded at `mcp-tag-ruleset.json`, field-checked against the verifier's own
`coversMcpTags` predicate.

**Item 10b — the ruleset was never the whole of AC-32, and the other half is now code.**
Re-reading `new18.md` §45 against this item exposed a scope error in the sentences above. §45
audits `mcp-v*` tag protection *and* asks, separately and unconditionally, for a code-level
control:

```
Implement a code-level release ancestry gate regardless:

    tagged commit must be reachable from current protected main
```

AC-32's RED condition is `mcp-v tag from unrelated unreviewed branch can publish` — a claim
about **which commit** the tag points at. A tag ruleset governs **who** may create the tag.
These are different properties, and the ruleset does not imply the other: an admin, or any
actor holding a ruleset bypass, can still tag an arbitrary side-branch commit. Measured on
`publish-mcp.yml` before this pass: **no ancestry check of any kind** (grep for
`merge-base|is-ancestor|reachable|ancestry` → 0 hits), so `git tag mcp-v9.9.9 <any-sha>` would
have published unreviewed code to npm (immutable) and to the Official MCP Registry (public).

`scripts/verify-release-ancestry.mjs` now closes that half, wired as **step 2** of
`publish-mcp.yml` — before install, before build, before either publish. It asks the GitHub
compare API rather than `git merge-base`, because `actions/checkout` is depth-1: `main` is not
in the runner's local history, and an authentic commit would look unreachable. That precise
shape has produced false forgery accusations in this repository before.

Negative control run before the green was trusted, over all three reachability states:

```
$ node scripts/verify-release-ancestry.mjs --sha 4bcedb5…   # main tip
  compare main...4bcedb56b21d → status=identical   ahead_by=0  behind_by=0
  PASS                                                          → exit 0

$ node scripts/verify-release-ancestry.mjs --sha a0076ff     # an already-merged commit
  compare main...a0076ff → status=behind
  PASS                                                          → exit 0

$ node scripts/verify-release-ancestry.mjs --sha 3abb3dfe…   # PR #268 head, never merged
  compare main...3abb3dfe54a0 → status=diverged   ahead_by=1  behind_by=2
  FAIL: NOT reachable from main                                 → exit 1
```

The `behind` case matters as much as the red one: a release tag is normally cut at or before
the current tip, so a gate that only accepted `identical` would be unusable and would be
weakened at the first real release. All three verdicts were taken by redirecting to a file and
reading `$?` unpiped.

AC-32 is therefore **no longer `NO CONTROL`**. The code-level half §45 asks for exists and is
enforced in the publish path; the account-level half — the ruleset — remains an operator action.

**Item 10c — the same gap existed on the bigger package, and AC-32's own wording hid it.**
AC-32 names `mcp-v*` tags, so closing it left the question "which *other* workflows publish
without an ancestry check?" unasked. Deriving the guarded class from the enforcer instead of
from AC-32's filename — the method §M argues for — meant measuring all 17 workflows for
publish operations against ancestry checks:

```
deploy-web.yml    publish_ops=1  ancestry=1   ← the 1 hit is a COMMENT, and the workflow is
                                                 workflow_dispatch-able → REAL GAP (see below)
publish-mcp.yml   publish_ops=5  ancestry=4   ← closed above
release.yml       publish_ops=4  ancestry=0   ← REAL GAP
```

`release.yml` publishes the flagship `calllint` CLI — the far more widely installed of the two
packages — to npm with provenance, on `release: published`. A GitHub Release can be created
against **any** target, so `gh release create v9.9.9 --target <side-branch-sha>` published
unreviewed code under the calllint identity, irreversibly. Same property, same script, larger
blast radius, and outside AC-32's literal scope.

`deploy-web.yml` deserves its own note, because the first version of this section got it
wrong. It scored `ancestry=1` and was written up as "safe by construction, the hit is only a
comment." The comment part is true — line 100 matches `merge-base --is-ancestor` in prose, and
a text-keyed scan would have read it as covered while it ran no gate. **The "safe by
construction" half was false.** Its triggers are `push: branches: [main]` *and*
`workflow_dispatch`, and the deploy step passes `--branch=main`, so a manual dispatch from any
ref publishes that ref's tree to the **production** Pages deployment. That was caught by the
guard below, not by re-reading — the assertion asserting the exemption failed. Gated on the
same script; on a `push` run it is a no-op costing one API call (`identical`).

Closed by wiring the **same** `scripts/verify-release-ancestry.mjs`, unchanged, as step 2 of
`release.yml` and of `deploy-web.yml` — before the full gate, before the version check, before
the publish. Re-measured after the edit: `release.yml  publish_ops=4  ancestry=4`. Both
controls re-run against the live compare API on 2026-08-21, unpiped, reading `$?`:

```
$ node scripts/verify-release-ancestry.mjs --sha 6ef7b12…   # main tip
  compare main...6ef7b12fe4db → status=identical  ahead_by=0  behind_by=0   → exit 0
$ node scripts/verify-release-ancestry.mjs --sha 3abb3dfe…  # PR #268 head, never merged
  compare main...3abb3dfe54a0 → status=diverged   ahead_by=1  behind_by=3   → exit 1
```

Two corrections the reuse forced, both in the script rather than left to rot: its failure text
asserted every rejected publish would have hit "npm and the Official MCP Registry," which is
false on the `release.yml` and Pages paths, and its docblock named `publish-mcp.yml` as its
sole subject. A guard's scope claim is part of its claim.

The floating alias tags (`v1`, `v2`) that refresh the Marketplace listing are deliberately
covered too. They publish nothing to npm — the version guard skips them green — but a
Marketplace refresh pointing at a side branch would still advertise unreviewed code, and the
gate runs before that branch of the logic is reached. Verified by parsing the workflow and
asserting step order: ancestry at index 1, full gate at 5, publish at 7.

**And the finding itself is now guarded, because it was found by hand.**
`tests/invariants/release-ancestry-coverage.invariants.test.ts` derives the publishing set from
the workflows — any step whose `run:` performs `npm publish`, `mcp-publisher publish` or a
Pages deploy — and requires each to run the gate before its first publish, or to be
push-to-main-only. A sixth publish workflow cannot be added ungated. Per ADR 0089 D2 the set is
never a list of filenames: a guard that names its subjects is the fault class it guards.
Coverage is keyed on an executed `run:` step, so prose cannot satisfy it, and the exemption
predicate is mutation-tested over five trigger shapes. Three negative controls, each reverted:

```
strip the gate from release.yml      → RED  "publish irreversibly with no ancestry gate"
strip the gate from deploy-web.yml   → RED  same assertion
move publish-mcp.yml's gate AFTER the publish → RED  "a gate after the irreversible act is not a gate"
restored                             → GREEN 8/8
```

**Item 11** — the next-release description in
`next-release-registry-description.txt` is byte-identical to the SSOT's current description.
**Item 12** — registry presence changes no verdict; measured directly: 0 occurrences of
`mcpRegistry` / `registryPresence` / `io.github.calllint` / `marketplace` in
`packages/risk-engine/src`, `packages/static-analyzer/src`, `packages/policy/src`.
Section B covers the same property on three broader channels.

---

## I. Negative controls

Each was applied to a green tree, measured, then reverted. A gate that has never been red is
not a gate.

| # | Injected defect | Result |
| --- | --- | --- |
| NC-1..3 | Registry: SSOT version mismatch / package rename / simulated outage | RED |
| NC-4 | `--expect-version=v0.1.1` moves the package assertion to `calllint-mcp@0.1.1` in lockstep | Proves the override is real, not cosmetic |
| NC-5..8 | Harness gate: renamed `supportClass` field, DEFERRED advertising a command, CONFIG_SCAN advertising `--agent`, unregistered `--agent` id | RED |
| NC-9 | Forbidden risk field added | RED on two channels at once |
| NC-10 | Unresolvable `--base` ref | RED — a missing range cannot silently skip the measurement |
| NC-11 | Host page reverted to printing `NATIVE` | RED on two channels (leak + missing label) |
| NC-12 | `agent-surfaces.json` pointer removed from `agent-instructions.md` | RED |
| NC-13 | Public label stripped from a host page | RED — silent removal is caught |
| NC-14 | Sitemap URL pointed at a deleted cartesian page | RED on two channels (dead URL + host absent) |
| NC-16 | Two generated matrices added to the drift gate while still **untracked**; SSOT change injected | **exit 0 — gate was vacuous.** `git diff` cannot observe an untracked file |
| NC-17 | Same injection after `git add` | RED (exit 1); revert left both files byte-clean |

After every control the tree was verified byte-identical to generator output — no residue.

**Two live catches, not injected.** These are listed separately because they are weaker evidence
than a negative control in one respect and stronger in another: nobody chose the defect, so the
gate was not aimed at it — but the defect was real and already committed, which an injected one
never is.

| Gate | Caught | Status |
| --- | --- | --- |
| source generation `https://` assertion | `kiro` → `officialSources: ["Internal Anthropic documentation"]`, rendering `<a href="Internal Anthropic documentation">` on a live page, vendor misattributed to Anthropic | FIXED (section M) |
| `check:agent-surface` §20 leak check | my own remediation note leaking `DEFERRED` into rendered prose | FIXED (section M) |

The second is the more useful of the two: the gate caught the author of the gate, in the same pass,
introducing exactly the class of defect the gate exists to prevent.

**NC-15 — duplicate source, injected and measured.** The `https://` branch was validated by the
live catch above; the duplicate branch had never been exercised, so it was controlled explicitly.
Injected `https://code.claude.com/` (already owned by `claude-code`) into `claude-desktop`:

```
$ node scripts/generate-distribution-surfaces.mjs   # exit 1
Error: claude-desktop: duplicate officialSource https://code.claude.com/ — one owner per source
```

Reverted; regeneration exits 0 and `git status` is clean — no residue. Exit code measured
directly, not through a pipe, for the reason section K notes.

**GD-11 / GD-17** — the watcher takes no external action: 0 matches for
`gh pr create` / `gh issue create` / `git push` / `npm publish` / `mcp-publisher publish`.
The two scripts it calls are read-only: every `publish` token in
`verify-registry-presence.mjs` is prose in a comment or an error string, and the single `POST`
in `verify-mcp-tag-protection.mjs` is inside a `console.error` remediation hint, not an
executed request.

**GD-02** — 45 `--agent` occurrences across `apps/web/public/`, resolving to exactly 8 distinct
agent ids (`claude-code`, `claude-desktop`, `cursor`, `openclaw`, `qwen-code`, `vscode`,
`windsurf`, `workbuddy`). That set is **identical** to the SSOT's 8 `NATIVE` hosts, and all 8
are members of the 14-member `AgentType` union in `packages/discovery/src/types.ts`. 0
unsupported ids, and no bare `--agent` without an id. (An earlier draft said 44; the count is
45 — `grep -c` per file: 8+8+9+8 in the four machine/agent docs, 4 in the intent page, 1 each on
the 8 NATIVE host pages.)

**GD-09** — exactly 1 `submissionUrl` in the SSOT (Cline PR #49, `cline-marketplace-pr`, state
`PENDING_UPSTREAM`); the two Tencent `tencent-mcp-market` entries are `READY_NOT_SUBMITTED`.
Full second-primitive state histogram: `{AUDIT_REQUIRED: 10, READY_NOT_SUBMITTED: 2,
PENDING_UPSTREAM: 1}`. Within `MAX_NEW_EXTERNAL_SUBMISSIONS = 3`, and no submission was
fabricated.

**GD-20** — measured, not assumed: of the 13 non-`mcp-stdio` primitives across 15 hosts, **0
are in state `AVAILABLE`**, so no host ships a second primitive alongside a working
`mcp-stdio`. No `plugin` / `marketplace` / `extension` / `adapter` package exists under
`packages/`.

One qualification on GD-20, disclosed rather than glossed: the repo contains a **`marketplace`
gitlink** (`160000 ab352b90`, `@cline/marketplace`) with **no `.gitmodules` entry**, so it is an
unregistered submodule — `git submodule update` cannot restore it on a fresh clone. It is
inherited, not introduced here: the same gitlink is present on `main`, added by `ec9d27c`
(PR #314, the Cline submission). It is the upstream fork used to raise PR #49 and is not a
CallLint-authored marketplace package, so it does not violate GD-20. The dirty worktree marker
on it is a single untracked `package-lock.json` inside the fork; its HEAD matches the recorded
gitlink exactly.

### §93 AC-01..AC-40 — the prompt's own control ids, mapped

The controls above were numbered NC-1..NC-15 as they were run, which left §93's forty AC ids
with no route into this report: a reader holding new18 could not tell which of them had a gate.
That is a traceability gap, not necessarily a coverage gap, and the two are separated here.

Each AC is a defect that must go **RED**. `INJECTED` means the defect was applied to a green tree
and observed red. `STANDING` means a gate in `ci:local` (25 steps) or the schema forecloses it, but
this pass did not inject it. `NO CONTROL` means exactly that — no gate would catch it today.

| AC | defect that must go RED | control | where |
| --- | --- | --- | --- |
| AC-01 | model/vendor identity changes verdict | INJECTED (NC-9) | `check:security-semantics`; 8 forbidden fields × 5 identity tokens over 6 verdict packages |
| AC-02 | marketplace/Registry presence changes verdict | INJECTED (NC-9) | same gate — `marketplace` is one of the 5 `IDENTITY_TOKENS` |
| AC-03 | telemetry changes verdict/output/exit | STANDING | §L counting semantics; emitter is post-verdict. Not injected — see the residue note below |
| AC-04 | default local CLI phones home | STANDING | §L: consent flag now actually read (`telemetryEnabled` was written and never consumed) |
| AC-05 | raw installation ID persisted server-side | STANDING | `USAGE_HASH_KEY` hashing in [apps/usage-worker/](../../apps/usage-worker/); §L′ schema |
| AC-06 | failed POST loses events | INJECTED | §L "four queue defects, each one a silent loss" — all four were live defects, found and fixed |
| AC-07 | retry changes batchId / double-counts | INJECTED | §L, same four; batchId now stable across retry |
| AC-08 | one scan recorded by duplicate telemetry paths | STANDING | §L one-pipeline invariant |
| AC-09 | `scan --auto` scans N configs, records 0 or 1 | STANDING | §L counting semantics |
| AC-10 | queue overflow empties the queue | INJECTED | §L, same four |
| AC-11 | config/path/command/prompt/evidence enters telemetry | STANDING | §L telemetry boundary, extended at `4671854` |
| AC-12 | npm download called a user | STANDING | §N scope boundary; `PUBLIC_ADOPTION_SIGNALS = DEFERRED` |
| AC-13 | old historical preflight usage inferred | STANDING | §L′ — retention is a real `DELETE` |
| AC-14 | private usage in public nav/sitemap/llms | STANDING | `check:agent-surface` — 17 sitemap URLs all resolve; no usage route among them |
| AC-15 | usage site publishes without Access | STANDING | §29 fail-closed: artifact-only until an operator verifies Access ([CLOUDFLARE_ACCESS_ACTION.md](CLOUDFLARE_ACCESS_ACTION.md)) |
| AC-16 | daily metrics committed into git | STANDING | §L′ — D1, not a committed file |
| AC-17 | unsupported `--agent` appears publicly | INJECTED (NC-5..8) | `check:harness-distribution`; GD-02 measured 45 occurrences → exactly the 8 NATIVE ids |
| AC-18 | nonexistent `--config` option appears publicly | INJECTED (NC-7) | CONFIG_SCAN advertising `--agent` went red |
| AC-19 | CLI help differs from extractor reality | INJECTED (NC-8) | unregistered `--agent` id vs the 14-member `AgentType` union |
| AC-20 | two manually maintained distribution SSOTs | INJECTED (NC-5) | §D — renaming `supportClass` reds; §D.2 records the file that was *about* to become the second SSOT |
| AC-21 | llms / machine JSON drifts from SSOT | INJECTED (NC-12) | `git diff --exit-code` in [distribution-watch.yml](../../.github/workflows/distribution-watch.yml) |
| AC-22 | model × harness canonical page explosion | INJECTED (NC-14) | §E — sitemap + host-presence, red on two channels |
| AC-23 | marketplace SUBMITTED represented as PRESENT | STANDING | schema `state` enum + GD-09 histogram; §Q row H now reads `PARTIAL`, not `PRESENT` |
| AC-24 | watcher opens external PR/issue | STANDING | GD-11/GD-17 — 0 matches for `gh pr create` / `gh issue create` / `git push` / `npm publish` / `mcp-publisher publish` |
| AC-25 | duplicate per-platform package where a primitive works | STANDING | GD-20 — 0 of 13 non-stdio primitives `AVAILABLE`; no such package under `packages/` |
| AC-26 | OpenAI remote MCP invented for listing eligibility | STANDING | recorded as the `openai-plugin` blocker verbatim; nothing built |
| AC-27 | Tencent submission fabricated while blocked | STANDING | GD-09 — exactly 1 `submissionUrl` repo-wide; both Tencent entries `READY_NOT_SUBMITTED` |
| AC-28 | duplicate Registry publication identity | INJECTED (NC-1..3) | §H — SSOT version mismatch / package rename / simulated outage all red |
| AC-29 | publish runs without official validation | STANDING | `mcp-publisher validate server.json` at `publish-mcp.yml:94-96` |
| AC-30 | successful publish assumed without readback | INJECTED (NC-1..3) | §H 7/7 field readback; `publish-mcp.yml:115-120` |
| AC-31 | watcher republishes a Registry version | STANDING | GD-11/GD-17, same 0-match scan |
| AC-32 | `mcp-v*` tag from an unreviewed branch can publish | **CODE CONTROL, account-level OPEN** | `verify-release-ancestry.mjs` at `publish-mcp.yml` step 2 rejects a tag whose commit is not reachable from `main` (`diverged` → exit 1, negative-controlled over `identical`/`behind`/`diverged`) — this is the code-level gate §45 asks for "regardless". The `mcp-v*` **tag ruleset** (who may create the tag) is still absent: operator action §106 P (1). `environment: npm` adds 1 reviewer |
| AC-33 | `/team` remains publicly linked | STANDING | `check:public-copy` — 0 hits across 45 tool descriptions and 23 public files |
| AC-34 | unlaunched $99 pricing remains public copy | STANDING | same gate; the 4 residual `pricing` hits are third-party registry descriptions |
| AC-35 | "free forever" promise remains | STANDING | same gate |
| AC-36 | removal replaced by "Coming soon" | STANDING | same gate |
| AC-37 | a new top-level page escapes copy governance | STANDING | `check:public-copy` + `check:web-structure` enumerate the served set rather than a hand list |
| AC-38 | malformed CSS brace survives | INJECTED | §P — the brace was a live defect; §M records that the original guard counted media blocks in the wrong stylesheet |
| AC-39 | cards align only because copy was artificially shortened | STANDING | §P "the command rules are load-bearing, and that is measured, not asserted" |
| AC-40 | tablet cards remain cramped/overflowing | INJECTED | §P — 245 pages × 240/320/390/1280, `scrollWidth === clientWidth` at slack 0 |

**40 of 40 now have a control; 1 of them is partial.** AC-32 was previously recorded here as
`NO CONTROL` on the reasoning that a `mcp-v*` tag ruleset needs repo-admin write. That reasoning
conflated two properties. AC-32's RED condition is a tag *from an unreviewed branch* publishing —
a claim about **which commit** ships. A ruleset governs **who** may create a tag. `new18.md` §45
asks for both, and asks for the ancestry half "regardless" of account configuration; that half was
missing and is code, not an operator action. It now exists (`verify-release-ancestry.mjs`, step 2
of `publish-mcp.yml`, negative-controlled — item 10b in section H).

What remains open on AC-32 is narrower than the earlier text claimed: with the ancestry gate in
place, a rogue `mcp-v*` tag on a side branch **fails the publish job**, so the unreviewed-code
path is closed. The absent ruleset means such a tag can still be *created* and can still start a
run — it reaches the `environment: npm` reviewer, burns Actions minutes, and appears in the run
history. That is a real gap and it is still operator action §106 P (1); it is no longer the
difference between reviewed and unreviewed code reaching npm.

Two further limits on this table, stated rather than left for a reader to find. First, `STANDING`
is weaker evidence than `INJECTED`: it means a gate exists and passes, not that it has been seen
to fail — and §M of this report is three cases of a gate that passed while unable to observe its
subject. Second, AC-03 is `STANDING` on a structural argument (the emitter runs after the verdict
is computed) rather than an injected control, so it is the weakest row here.

---

## J. Open items and deliberate exclusions

### Open — must close before this can be called closed

1. ~~**`REGISTRY_WATCH` is not READY.**~~ **CLOSED 2026-08-21 by the merge itself.** It was open
   because `distribution-watch.yml` was not on the default branch, so its `schedule` had never
   fired (404, 0 runs). PR #325 merged as `a0076ff` and the workflow now reports
   `state: active` — measured, not inferred from the merge succeeding. Two things stay true and
   are not this item: the job has **0 runs** until Monday 09:00 UTC, and its step 3 exits 1
   (item 2), so its first run is expected red. Section H.
2. **`mcp-v*` tag protection is absent. The verifier now proves it instead of 404-ing.**
   The measurement is unchanged — the repository has exactly one ruleset,
   `17728504 "Protect main" target=branch`, and no tag ruleset — but the *guard* is fixed:
   `scripts/verify-mcp-tag-protection.mjs` was rewritten against `/repos/{o}/{r}/rulesets`, and
   `mcp-tag-protection.md` was rewritten with it. It now prints the real ruleset inventory and
   exits 1 for the true reason. Five conditions must all hold before it reports PASS
   (`target: tag`, `enforcement: active`, an `include` covering the whole `mcp-v*` space, no
   `exclude` carving it back out, and a `creation` rule) — each one a way the old check could
   have read green while the tag stayed open. Notably `mcp-v1.*` is **rejected**: it protects
   some release tags and leaves `mcp-v2.0.0` open, and a partial guard reported as green is the
   failure mode this file exists to prevent. The pattern predicate was unit-checked over 10
   inputs, all correct.
   **What remains is not a code change.** Creating the tag ruleset is a write to shared
   repository settings; `--explain` prints the exact UI steps and the equivalent `gh api` call.
   (An earlier wording called this "an admin write" and read it as a *permission* blocker. That
   was never measured and is false — `gh api repos/calllint/calllint --jq .permissions` returns
   `admin: true`. What this project does not do unattended is the write itself, which is a
   different fact with a different remedy; see §H.) Until it exists, any collaborator with write
   access can trigger a release. **The `environment: npm` single-reviewer gate is no longer the
   only remaining barrier:** since #327 an ancestry gate runs before the publishes and rejects a
   tag that does not point at a commit reachable from `main`. Section H.
3. **Nothing is deployed — no longer true; superseded by merge.** When written, GD-15's fix, all
   15 host pages, and the machine surface existed only in this branch. All three have since
   landed on `main` — measured 2026-08-21: `harnesses/sitemap.xml` carries **17** `<loc>`
   entries, `harnesses/` holds **18** files including `claude-code/index.html`, and both
   `agent-surfaces.json` and `_redirects` are tracked. What remains unmeasured is the *deploy*,
   not the tree. Section F.

### Closed after the first draft

These three were filed as "minor, disclosed, not blocking" in the first draft. They were then
fixed rather than carried, because each was cheap and each was the kind of defect this report
exists to name. All three are local changes and need no admin action or deploy.

4. **The dangling `$schema` pointers — CLOSED.** Two different fixes, because the two pointers
   answer to different consumers:
   - The **published** one now resolves. `apps/web/public/schemas/agent-surfaces.v1.json` is a
     real draft-07 schema, and a file under `public/` *is* its URL because `_routes.json` lists
     only Functions paths and deliberately does not include it — so the request is served as a
     static asset. (An earlier wording gave the reason as "the Pages project is static-only";
     that premise is false — see §L — but the routing fact that carries this claim is not.) The schema also encodes the invariant: `additionalProperties: false` plus an explicit
     note that no risk, popularity, demand or SEO score for any harness, model, platform or
     marketplace may appear, so the forbidden-field list is now structural for this surface.
   - The **SSOT** one now points at a relative path (`./distribution-surfaces.schema.json`)
     instead of a public URL it never had any reason to promise. The SSOT is an internal file;
     advertising an absolute `calllint.com` URL for it was the mistake.
   - **That second bullet was half a fix, and this report called it closed. It was not.** The
     pointer was made relative; the file it pointed at was never written. A relative `$schema`
     is worse than an absolute one in exactly one way: an absolute one 404s where someone might
     see it, while a relative one dangles in silence, because nothing fetches it. The SSOT read
     as schema-governed and was governed by nothing — the same class of defect as section M, and
     this document was itself the guard that could not observe its subject. Closed properly on
     2026-08-20: `apps/web/data/distribution-surfaces.schema.json` now exists, and
     `check:agent-surface` asserts the pointer resolves *and* the SSOT validates against it.
   - Writing the schema caught a real mismatch on its first execution: I had typed `priority`
     as `integer`, and the actual values are the tier strings `P0`/`P1`. The schema was wrong,
     not the data; corrected to `^P[0-9]$`, with a note that the field orders CallLint's own
     work and is not a signal about the host.
   - Writing the *SSOT* schema caught two more of mine, and this is the argument for schemas as
     such: I wrote `authoritySurfaces` from memory as 6 values and the real set is 12, which ajv
     reported as 13 violations across 9 hosts; and I typed `liveUrl` as string-only, when
     `PENDING_UPSTREAM` primitives carry an explicit `null` beside a `submissionUrl`. An
     explicit `null` says "no live URL yet" — a missing key cannot distinguish that from an
     oversight, so the schema now admits it deliberately. In both cases the schema was wrong and
     the data was right; the value of writing it was learning that I could not state the shape
     from memory.
   - `additionalProperties: false` at every level of the SSOT schema makes the orthogonality
     invariant structural for the source file too, not only for the published projection: a
     risk-, popularity-, demand- or SEO-bearing field cannot be added to a host without failing
     validation. Negative-controlled — adding `riskScore: 9` to a host → red.
   - `check:agent-surface` now asserts both halves — the pointer resolves to a served file, and
     the surface validates against it. Separate assertions on purpose: a served-but-wrong
     schema and a correct-but-404 schema are different bugs. Both were negative-controlled
     (removing the schema file → red; deleting one `coverageBoundary` → red; restore → green).
5. **All 15 hosts now carry `coverageBoundary` — CLOSED.** The 7 `NATIVE` hosts were filled in
   from a *measured* CallLint-side fact rather than invented per-host copy:
   `findServerMap()` in `packages/config-parser/src/normalizeMcpServers.ts` extracts only the
   MCP server map, and nothing under `packages/static-analyzer/src/` mentions skills at all. So
   each boundary says CallLint scans MCP server entries only and names what in that same file
   is *not* covered. The field is now required by the published schema, so a new host cannot
   ship without one — the template's `{{#if coverageBoundary}}` fallback ("Full MCP
   configuration discovery and scanning.") is no longer reachable for a published host.
6. **The `marketplace` gitlink — CLOSED by untracking.** `git rm --cached marketplace` plus a
   `/marketplace/` ignore rule. It is a scratch clone of a *fork* of `cline/marketplace` used
   once to open upstream PR #49, referenced by no script, build, gate or workflow. Registering
   it as a real submodule would force every CallLint clone to fetch a fork of someone else's
   marketplace in order to build nothing; the alternative — leaving a `160000` gitlink with no
   `.gitmodules` — is the one submodule state git cannot restore. The local clone and the
   upstream PR are untouched, and the SSOT still records `cline` / `PENDING_UPSTREAM`.

### Deliberately not done

- **`check:registry-presence` is not in `ci:local`.** It queries the live Registry API, so
  wiring it locally would red `ci:local` on any offline machine for a reason no local change
  can clear. It belongs to the watcher, which runs it weekly. The watcher is now on `main` and
  `state: active` (measured 2026-08-21); `gh run list` returns `[]`, because a weekly cron is
  up to 7 days out — `active` is not evidence it has run. Its first run is expected **red** at
  the tag-protection step for as long as no `mcp-v*` ruleset exists.
- **No model × harness pages.** Section E.
- **No new external submissions.** Section I, GD-09.
- **Cline PR #49 is not duplicated.**

---

## K. Reproducing this report

```bash
pnpm check:harness-distribution     # 15 hosts, 4 support classes
pnpm check:agent-surface            # §19 + §20 + GD-15
pnpm check:security-semantics       # §18, three channels
pnpm check:public-copy              # no overclaim on any public surface
pnpm gen:distribution               # idempotent: same SSOT in, same bytes out
pnpm ci:local                       # full suite, 25 steps
```

All six were re-run against `865f9c6` for this revision, and `ci:local` was re-run again at
`fda2bd5` after section O landed — still **exit 0** (25
`&&`-joined steps; the two `✗` lines in its log are inside `tests/facts/deriveFacts.test.ts` and a
receipt test that *assert failure closes* — both files pass). `pnpm test`: **236 files, 4387
passed, 1 skipped** at that run, and **237 files, 4393 passed, 1 skipped** after section P added
one invariant file with six tests — the delta is exactly that file, and nothing counts
`tests/invariants/`, so `ci:local` stays at 25 steps.
`gen:distribution` idempotency was verified by md5 over `sitemap.xml`,
`agent-surfaces.json`, `llms.txt`, and `agent-instructions.md` across two consecutive runs:
identical. `_redirects` did not exist at that run; its idempotency was verified separately during
section O's negative controls — after each of the nine controls the tree was restored and
regenerated, and `diff` reported the file byte-identical every time.

The step count is itself gated. `tests/invariants/gate-s0-claims.invariants.test.ts` asserts
`ci:local` has exactly 25 `&&`-joined steps, so adding a gate to `package.json` without
acknowledging it fails the suite — and, more to the point, silently *removing* one does too.

Registry readback requires network:

```bash
pnpm check:registry-presence        # exit 0 at HEAD — 7/7 fields agree with the SSOT
```

The two open verification commands, and what they currently report:

```bash
node scripts/verify-mcp-tag-protection.mjs        # exit 1 — no tag ruleset exists (measured, not a dead endpoint)
gh api repos/calllint/calllint/rulesets           # one ruleset, target=branch; no tag rule
gh api repos/calllint/calllint/actions/workflows/distribution-watch.yml   # 404 — not on main
```

The first line's comment is the whole point of `b6c0f2b`. It used to read "queries a dead GitHub
endpoint": same command, same exit 1, and no information about the property. It now fails for the
measured reason.

Note when reproducing exit codes: `node script.mjs 2>&1 | head` reports *`head`'s* status, not
the script's. `verify-mcp-tag-protection.mjs` looks like it exits 0 through a pipe and exits 1
when run directly. Measure the script, not the pipeline.

---

## L. Telemetry correctness — what landed, and what did not

Commit `37d7388`. This is not distribution work, but it landed on this branch and the report
would be misleading without it, in both directions: it closes real defects, and it leaves an
entire service unbuilt.

### The consent flag was written and never read

`calllint telemetry enable` persisted `telemetryEnabled: true` to state. Nothing consumed it.
`buildCliEmitter` was constructed without reference to state, so the answer to "is telemetry on"
came from somewhere other than the user's recorded decision. The failure mode is symmetric and
both halves are bad: a user who opted in produced nothing, and the code path that decided
otherwise was not the one holding their consent. Now read explicitly, defaulting to off if state
cannot be loaded:

```ts
let telemetryState = { telemetryEnabled: false }
try { telemetryState = await loadState() } catch { /* stay off */ }
```

A `try/catch` that swallows an error and proceeds is usually a smell. Here the swallow *is* the
policy: an unreadable state file must mean off, never on.

### Four queue defects, each one a silent loss

| Defect | Consequence |
| --- | --- |
| `save()` wrote 2-space-indented JSON while the cap measured compact | file 1.22× the size the cap believed; eviction fired ~22% early |
| `pushMany()` did read-modify-write per event | an N-event append could interleave and lose events |
| `trim()` recomputed total bytes only once | a single oversized event could drain the whole queue |
| `take()` removed events *before* delivery was confirmed | a failed POST lost the batch |

The byte-accounting fix tracks framing explicitly, because a JSON array's commas and brackets are
part of what the cap measures:

```ts
const framing = (n) => 2 + Math.max(0, n - 1)   // "[" + "]" + (n-1) commas
```

Delivery is now ACK-safe: `peek(count)` → content-derived `batchId` → POST → `removeDelivered(n)`
only on confirmed success. The id is a SHA-256 over the serialized events, so a retry of the same
batch is recognizable as the same batch server-side, which is what makes at-least-once delivery
safe to combine with idempotent ingestion.

16 tests in `apps/cli/test/telemetry-queue.test.ts` cover boundedness (byte cap vs whole-queue
drain, count cap, multi-byte characters measured in *bytes* not characters, push/pushMany
agreement), ACK-safe delivery (peek does not remove, exact-prefix removal, appends during
delivery survive, corrupt file degrades rather than throws), and `createBatch` determinism.

### Counting semantics

One successful config preflight now emits exactly one `preflight_completed` *and* one
`decision_<verdict>`. `scan --auto` over 5 configs emits 5 of each, not 1. `CommandResult.telemetry`
was widened from one signal to one-or-many, and the `try/catch` around emission was moved *inside*
the loop so one malformed signal cannot silence the rest of the batch.

### One disclosure removal

`calllint telemetry rotate` printed a 16-character prefix of the **new** installation id. The
command's purpose is to make the old identity unlinkable; printing the new one to the terminal —
where it may land in a shell log, a screen recording, or a pasted bug report — undercuts that
while appearing careful about the old value. It now prints only `Installation identity rotated.`

### What did NOT land — and a correction to an earlier draft of this section

An earlier draft of this section said "**The ingress service does not exist.** There is no
`apps/usage-worker/`, no D1 schema, no `POST /v1/events/usage` …". That was wrong, and wrong in
the direction this report is least entitled to be wrong in: I asserted an absence after checking
one path.

A second draft then corrected it in the other direction and got the *evidence* wrong. It claimed
"the 405 is the load-bearing measurement: a Function is running and rejecting `GET`". That
inference does not hold, and the control is what shows it. Measured 2026-08-20, each path
cachebusted, against a path that certainly has no handler:

| request | status | content-type | bytes |
| --- | --- | --- | ---: |
| `POST /v1/events/trust` | **204** | — | 0 |
| `POST /v1/definitely-not-a-route-<rand>` (control) | 405 | — | 0 |
| `GET /v1/definitely-not-a-route-<rand>` (control) | 404 | text/html | 6067 |
| `POST /v1/events/usage` | 405 | — | 0 |
| `GET /v1/events/usage` | 404 | text/html | 6067 |

`POST → 405` and `GET → 404` with a 6067-byte HTML body are what a **nonexistent** route returns
on this project. Every 405 the earlier draft cited is therefore consistent with no Function at
all, and proves nothing. The load-bearing measurement is the one that **differs from the
control**: `POST /v1/events/trust` → `204` with an empty body. That is
[apps/web/functions/v1/events/trust.ts](../../apps/web/functions/v1/events/trust.ts) executing —
its `onRequest` answers 405 to non-POST and 204 on every POST outcome, and `/v1/events/trust` is
the one events path in the `_routes.json` include list (`/v1/public/*`, `/v1/events/trust`,
`/trust/*`).

So the conclusion of the second draft survives while its reasoning does not: this Pages project
**does** execute Functions, and "static-only, no Functions" — carried forward as a premise from
the U0-U6 investigation — is false as stated. What is true is narrower, and is a routing fact
rather than a runtime one: `/v1/events/usage` was never in the include list, so it is **unrouted**,
which is why it returns the static 404. `8acf297` added `_routes.json` to withdraw the Adoption
Signals surface and left the usage endpoint out.

The ingress that now exists is nonetheless a **separate Worker**, [apps/usage-worker/](../../apps/usage-worker/),
not a Pages Function — see section L′ below. That choice no longer rests on "Functions cannot run
here"; it rests on the reasons in
[artifacts/usage-observatory/DEPLOYMENT_STATUS.md](../usage-observatory/DEPLOYMENT_STATUS.md):
the static site deploy stays untouched, and the ingress carries its own D1 binding and its own
deploy lifecycle.

The Pages-Functions sources this table described (`apps/web/public/functions/**`, including
`schema.sql` and the admin dashboard) were **deleted on 2026-08-20**. They were source-only and
never executed. Confirmed not served, same measurement run: `/functions/v1/events/usage.ts`,
`/functions/schema.sql`, `/v1/admin/dashboard` and `/v1/admin/usage` each return the 6067-byte
static 404 — byte-identical to the control, so no source or admin surface is exposed.

So the honest statement about that code is not "unbuilt" but **built, unrouted, incorrect where it
mattered, and now deleted**. Four defects, read from the source at the time rather than inferred.
They are kept here because each one is the reason the replacement is shaped the way it is:

1. **`batch_id TEXT UNIQUE` was on the events table.** `usage.ts` bound the same `batch.batchId` to
   every event in a batch and submitted them through one `D1Database.batch()`, which is
   transactional. Any batch carrying two or more events violated the constraint and aborted the
   whole insert — the endpoint returned 500 for its ordinary case and succeeded only for
   single-event batches. This is precisely why new18 specifies idempotency in a separate
   `usage_ingested_batches` table rather than as a column constraint on the events.
2. **`hashed_installation_id TEXT NOT NULL`, but the code could bind `null`.** `hashedId` stayed
   `null` when an event carried no `anonymousInstallationId`, so such an event failed the same
   transaction and took its batch with it.
3. **Two guarantees in the file header had no mechanism.** "Rate limited per IP" — `ip` was read
   into a variable never used again, and `RATE_LIMIT_PER_MINUTE = 100` was never referenced. "No
   sensitive fields allowed (enforced by sanitizer at client)" states the trust boundary backwards:
   a server that trusts a client-side sanitizer is not enforcing anything. new18 requires
   server-side re-sanitization for exactly this reason.
4. **Retention was a view, not a deletion.** `usage_events` kept raw event rows forever. The
   `usage_aggregates` and `active_installations` **views** filtered to 90 and 30 days, but a view
   that filters reads is not retention — the rows were still there, and no deletion job existed.

None of this ever ran in production, because the route was never opened. That is the only reason
these are defects and not incidents.

The client-side boundary that *is* enforced: `check-telemetry-boundary.mjs` asserts the telemetry
packages import no filesystem or network module, which is why the queue sink lives in
`apps/cli/src/queueSink.ts` rather than inside `packages/telemetry-emit`. That guard was extended
on 2026-08-20 — see L′.

---

## L′. The observatory as it now stands — a Worker, and an artifact that is not published

Commit `4671854`, with the documentation retirement in `0c3f2c0`. This is the resumption of the
work section L left as "unbuilt", and it answers each defect above in the schema rather than in
review comments.

| L defect | how the Worker forecloses it |
| --- | --- |
| `batch_id UNIQUE` on events | idempotency moved to its own `usage_ingested_batches` table (new18 §21) |
| `NOT NULL` column bound `null` | events with no installation id are counted without one; nothing binds `null` to a `NOT NULL` column |
| rate limit named but absent | no unreferenced constant claims a control that does not exist |
| retention as a view | `enforceRetention` issues real `DELETE`s (installation hashes 90 days, batch ids 30), and `002_drop_usage_events.sql` removes the raw-events table outright |
| client-side sanitizer trusted | `validate.ts` re-validates server-side and rejects a `batchId` that is not a 64-hex digest |

**The report is deliberately not deployed.** new18 §29 is fail-closed: Cloudflare Access cannot be
programmatically verified from CI, so [.github/workflows/usage-report.yml](../../.github/workflows/usage-report.yml)
builds the HTML daily and stops at `upload-artifact`. A workflow artifact is readable only by
someone who can already read this repository's Actions, so it needs no Access policy of its own. A
green cron means "the artifact built", never "the host is protected". The one unavoidable operator
action is recorded in [CLOUDFLARE_ACCESS_ACTION.md](CLOUDFLARE_ACCESS_ACTION.md), and reading the
artifact from Actions indefinitely is a legitimate permanent end state rather than a deferral.

**Absent data renders as an em dash, never as zero** (§25). A zero is a claim about the world and
an unread source cannot support one. Measured at `4671854` on a deliberately degraded run — no D1
credentials — the report emits **9 em dashes, 0 occurrences of `<td>0</td>`, 0 `NaN` and 0
`undefined`**, while npm's real figures survive intact (4,544 and 743 downloads over 64 days) and
the registry count is read from disk (99 audited servers). The degradation is reported on stderr
and in the run summary, never silently. The generator validates before writing and exits non-zero
rather than emit a report that carries `noindex` incorrectly, contains a `<script>`, or references
an off-host resource.

**Two guards were extended so they can observe their subject** — the fault class section M is
about, found again here:

- `check-telemetry-boundary.mjs` had no rule covering `apps/usage-worker/src`, which is the only
  place in the repository that writes telemetry to a database. It now scans that directory under a
  scoped rule forbidding outbound `fetch()` in the ingress and forbidding `USAGE_HASH_KEY` from
  reaching a log line. Both rules were negative-controlled: an injected
  `fetch("https://example.com/exfil")` in `retention.ts` and an injected
  `console.log("dbg", env.USAGE_HASH_KEY)` in `hash.ts` were each flagged with file and line, and
  the guard exited 1. Both injections were reverted.
- The D1 failure diagnostic printed `execFileSync`'s `"Command failed: <the whole argv>"`, which
  names no cause and echoes the interpolated SQL into a CI log. wrangler reports failures as a JSON
  envelope on **stdout**, so a line scan of stderr found nothing.
  [wrangler-failure.ts](../../apps/usage-worker/src/wrangler-failure.ts) parses that envelope and
  now yields `A request to the Cloudflare API (/memberships) failed. — Authentication failed
  (status: 400) [code: 9106]`. It lives in the Worker package, not inline in the untested `.mjs`,
  so it is unit-tested: 16 tests, negative-controlled by deleting the two envelope-parsing lines
  (5 failed, 11 passed) and restoring them (16 passed).

Nothing is deployed. The Worker is unpublished and its `wrangler.toml` carries a placeholder
`database_id`. Worker suite 131/131 across 6 files; `tsc -p apps/usage-worker/tsconfig.json
--noEmit` exit 0.

---

## M. The three gates that could not observe their subject

Commit `b6c0f2b`. Section H covers two of these in their Registry context; this section states
the shared shape, because it is this repository's dominant fault class and it recurred three
times in one area.

**A guard that cannot fail is worse than no guard**, because its green is indistinguishable from
a real pass. `verify-registry-presence.mjs` had no failing path at all: every control path ended
in `process.exit(0)`, one of them printing `State: LIVE` from a string literal, and it called a
`verifyState()` that **was never defined** — no `ReferenceError` fired because the branch was
unreachable. The Registry could have gone dark under a green check.

**A guard that cannot pass is equally uninformative.** `verify-mcp-tag-protection.mjs` queried a
GitHub endpoint that no longer exists, so its red meant "endpoint removed" and "tag unprotected"
identically. A red carrying no information is not a safe default; it trains the reader to ignore it.

**A guard whose subject list is hand-maintained decays silently.** `check-harness-distribution.mjs`
read the legacy data file and audited 8 of 15 hosts while exiting 0 — and the 7 it skipped were
every `DISCOVERY_ONLY` and `DEFERRED` host, i.e. exactly those that must not advertise a command
they cannot honor (section D).

All three are now able to fail for the true reason, and one of them proved the point on its first
run. Adding the `https://` assertion to source generation immediately caught a **false published
fact**: the `kiro` SSOT entry listed `officialSources: ["Internal Anthropic documentation"]`,
which the template rendered as `<a href="Internal Anthropic documentation">` — a broken relative
link on a live page — and attributed the vendor to Anthropic. **Kiro is an AWS product.**
Corrected against primary sources: vendor `AWS`, sources `kiro.dev/docs/mcp/configuration/` and
`github.com/kirodotdev/Kiro`, and the two literal documented config paths
(`.kiro/settings/mcp.json`, `~/.kiro/settings/mcp.json`) in place of "requires verification".

Its `mcp-stdio` primitive dropped from `AVAILABLE` to `AUDIT_REQUIRED` on a distinction worth
keeping: Kiro documents stdio MCP support, but **supporting MCP is not the same fact as consuming
the Official MCP Registry**, and no primary source confirms the latter. Support class stays
unimplemented — a documented config path makes an adapter *evaluable*, not built.

Then the correction was itself caught. My rewritten note ended "…DEFERRED until a discovery
adapter exists…", which the template rendered into visible prose — a §20 violation introduced by
the fix for a different defect. `check:agent-surface` went red on it. Reworded to "Support stays
unimplemented until a discovery adapter exists and is fixture-covered."

Two rounds, two real defects, both caught by gates written in the same pass. That is the argument
for writing the strict version first.

---

## N. Scope boundary of this report

This report closes **distribution authority**. It does not close, and must not be read as
closing:

- **Usage ingress deployment** — the ingress is now [apps/usage-worker/](../../apps/usage-worker/),
  a separate Worker whose schema forecloses the four defects the old Pages-Functions version had
  (section L′). It is **unpublished**: `wrangler.toml` carries a placeholder `database_id`, and the
  daily report stops at `upload-artifact` because §29 is fail-closed on Cloudflare Access. Code
  state is `READY_NOT_DEPLOYED`; deployment is an operator action, not unwritten code.

  On the `database_id` specifically: a candidate value (`98626b00-…`) is recoverable from the root
  `wrangler.toml` this Worker's config replaced, and it is recorded in a comment there with its
  provenance. It is deliberately **not** substituted for the placeholder. That root config was a
  *Pages* config, and `wrangler pages deploy` never applies `wrangler.toml` bindings — so the id
  names a binding that has never been exercised, and no credential available here can check it
  (the account API answers `code: 9106`). Pasting an unobserved value into the live field would
  make the file read as verified on evidence nobody has, which is the fault class section L′
  exists to correct. The placeholder is what forces the operator to confirm it deliberately.
- **Deployment** — **closed 2026-08-21.** This was written pre-merge; PR #325 landed as `a0076ff`
  and production now serves the generated tree (section F carries the before/after measurement).
- **The `mcp-v*` tag ruleset** — a write to repository settings (section H item 10, J item 2).
  Narrowed on 2026-08-21: the *code-level* half of AC-32 that §45 asks for "regardless" is no
  longer missing (`verify-release-ancestry.mjs`, section H item 10b), so this is now the
  who-may-create-a-tag half alone.

The first is written code that does not run. The third is not code at all, and the second is now
history rather than a pending item. Keeping them apart is the reason this section exists: a report
that lists them together under "remaining work" invites the reading that they are all one push
away, and that was never true of all of them.

---

## O. Legacy URL handling — the other half of the promise GD-15 half-kept

GD-15 (section F) fixed the sitemap: this branch had deleted 8 cartesian pages and gone on
advertising them. The fix stopped us **pointing at** pages we removed. It did nothing about
everyone already pointing at them.

Measured against production on 2026-08-20, before any change:

| URL | live status | note |
| --- | --- | --- |
| `/harnesses/deepseek/claude-code` | **200** | live and indexable today |
| `/harnesses/deepseek/claude-code.html` | **308** → clean form | Pages normalizes; the 308 exists only while the asset does |
| `/harnesses/deepseek/` | **200** | preserved model-intent landing page |
| `/harnesses/claude-code/` | **404** | the replacement is not deployed yet |

**Re-measured against production 2026-08-21, after the merge and deploy** (`curl -sSL` + browser
UA + `?cachebust`, against a known-nonexistent control that returned **404**, so these 200s are
not the static default):

| URL | live status | note |
| --- | --- | --- |
| `/harnesses/claude-code/` | **200** | the replacement is deployed; the row above is now historical |
| `/agent-surfaces.json` | **200** | machine surface live |
| `/harnesses/sitemap.xml` | **200**, 17 `<loc>` | the 9-URL sitemap is gone |
| `/harnesses/deepseek/gemini-cli.html` | **404** | cartesian plane removed, as intended |
| `/harnesses/__nope__/` | **404** | negative control |

Read together those four rows are the whole problem. The replacement 404s and the thing it
replaces returns 200, so the deploy flips both at once: 8 URLs that work today stop working, with
no forwarding, and every inbound link and search result aimed at them breaks. Deleting a page and
retiring the links to it are two obligations, and only the first had been met.

**What was missing:** `apps/web/public/_redirects` did not exist.

**Where it had to go.** Cloudflare Pages parses `_redirects` only at the **root of the build
output directory** — the same rule that governs `_headers` and `_routes.json`. My first version
wrote it to `apps/web/public/harnesses/_redirects`, next to the pages it forwards, which is where
every other projection in the generator writes. That file is not a redirect set; it is a text file
served at `/harnesses/_redirects`, redirecting nothing. It is the same fault as section M in a new
costume — an artifact that cannot observe its subject — and it would have passed any review that
checked the rules and not the path. The output root is established by measurement, not by reading
docs: `/harnesses/deepseek/claude-code` returns 200 and that file lives at
`apps/web/public/harnesses/deepseek/claude-code.html`, so `apps/web/public` **is** the deployed
root. The gate now asserts both the presence of the real file and the *absence* of the inert one.

**How it is modelled.** A per-host optional `legacyPaths` in the SSOT, projected by
`generateRedirects()`. The asymmetry is the design:

- **Sources are frozen history.** `legacyPaths` records what a past release actually served, so
  the set cannot grow when a host is added. This is also why the rules are enumerated rather than
  written as one `/harnesses/deepseek/*` splat: a splat would forward paths that never existed,
  manufacturing history and sending a typo to a real page.
- **Targets are derived.** Each is the host's `canonicalPath`. A host that leaves the SSOT takes
  its redirects with it in the same run that deletes its page, so a redirect cannot outlive its
  destination — the failure GD-15 was about, structurally prevented rather than remembered.
- **One fact, two rules.** Pages served each page under both a clean and a `.html` spelling, and
  the 308 between them is generated *because the asset exists*. Delete the asset and `.html` stops
  being forwarded and starts 404ing. The SSOT records where the page lived; the generator handles
  how Pages spelled it. 8 entries produce 16 rules, against a Pages ceiling of 2,000.
- **301, not 302.** 302 is the Pages default when no code is given, and a temporary redirect leaves
  the search index pointing at the dead URL indefinitely.
- **`/harnesses/deepseek/` is deliberately absent.** It is a preserved model-intent landing page,
  not legacy. The generator throws if a landing page ever appears as a redirect source.

**Seven new assertions in `check:agent-surface`, and nine negative controls.** Every one was
injected, measured red for the right reason, and reverted; the tree was then regenerated and
confirmed byte-identical, so no control left residue.

| control | injected fault | exit | failed on |
| --- | --- | ---: | --- |
| A | copy `_redirects` into `harnesses/` | 1 | inert copy outside the output root |
| B | delete `_redirects` | 1 | legacy URLs would 404 with no forwarding |
| C | drop one rule | 1 | 1 SSOT legacyPath has no redirect |
| D | retarget a rule at a page that is not served | 1 | 2 redirects target a page that is not served |
| E | 301 changed to 302 | 1 | 16 redirects are not 301 |
| F | add a rule for `/harnesses/deepseek` | 1 | clobbers a preserved landing page |
| G | add a rule whose source is a live page | 1 | shadows a page that is still served |
| H | point the SSOT `$schema` at a missing file | 1 | pointer does not resolve |
| I | add `riskScore: 9` to a host | 1 | violates its own schema |

Controls D and G are worth separating. A redirect **into** a 404 is worse than the 404 it replaced:
it costs a round trip and launders the failure into something that looks intentional. A redirect
**from** a live page is worse still — Pages applies redirects before serving static assets, so the
rule shadows the page rather than falling through to it, and the page silently becomes
unreachable while its file sits right there.

Control I is the orthogonality invariant made structural at the source. `additionalProperties:
false` at every level of the SSOT schema means a risk-, popularity-, demand- or SEO-bearing field
cannot be added to a host without failing validation. Until this pass that was true of the
published projection and not of the file it is projected from.

`_redirects` is now in the drift list in `.github/workflows/distribution-watch.yml`, listed
separately from `apps/web/public/harnesses/` because it is the one projection whose correct
location is not beside the pages it describes.

---

## P. Responsive QA — the audit that had been scoped to the wrong stylesheet

An earlier draft of this report recorded §106 L as `PARTIAL` with the evidence "`styles.css`
brace-balanced, 6 `@media` blocks; responsive QA **not performed**". The honest part of that was
"not performed". The misleading part was the evidence line: it named *one* stylesheet, and the
install surface — 99 of the 245 served pages, the surface this whole branch exists to ship — is
not styled by it. It is styled by `apps/web/styles/tokens.css`, which contains **zero** media
blocks. Counting media blocks in the sheet that does not style the pages at issue is the
repository's dominant fault class (§M) applied to itself: an audit that could not observe its
subject.

This pass performed the QA. Below is the method, because the numbers mean nothing without it.

### Method

A throwaway static server (`d:\tmp\`, deliberately not repository content) serves
`apps/web/public/` with the same directory→`index.html` resolution Cloudflare Pages uses, so the
bytes measured are the bytes a visitor receives. Each page is loaded in a sized iframe and probed:

* **Viewport** is `documentElement.clientWidth`, not the iframe width. A vertical scrollbar
  consumes 15px, so comparing against the iframe would make every check 15px lenient — it would
  hide a real 14px overflow.
* **Overflow** is `scrollWidth > clientWidth` at the document element, reported with the exact
  slack in pixels rather than as a boolean.
* **Offending text runs** are located with `document.createRange()` + `range.getClientRects()`
  over a `TreeWalker(SHOW_TEXT)`. An element's box can fit while the text inside it does not;
  element-level rects cannot see that, and the defect found here was exactly that shape.
* **Scroll containers are excluded.** A `pre` with `overflow-x: auto` is *supposed* to be wider
  than its box. Counting it would have produced 99 false positives and buried the real one.
* **A/B is non-destructive**: inject a `<style>`, measure, `.remove()`, measure again. No file is
  edited to take a measurement.
* **Every sweep prints `checked` and `total` and refuses to report clean when they disagree.**

That last rule is not defensive writing. The first sweep in this pass reported `overflows: 0`
having examined `checked: 0` pages — a slug-harvest regex over the index page matched nothing, so
the sweep was vacuous and its green was indistinguishable from a real pass. It was caught only
because the counts were printed. Slugs were re-harvested from disk afterwards, and every
subsequent sweep carries a hard non-vacuity gate (`if (slugs.length !== 99) return FATAL`) plus a
check that the probe returns a measurable number at all.

### Inventory and coverage

All 245 served HTML pages, no sampling:

| cohort | pages | viewports | checks |
| --- | --- | --- | --- |
| install (`/install/mcp-registry/*`) | 99 | 240 | 99 |
| Trust registry (`/trust/mcp-registry/*`) | 99 | 240 / 320 / 390 | 297 |
| remaining styled (21 other Trust, 17 harness, 7 root) | 45 | 240 / 320 / 390 / 1280 | 180 |
| no external stylesheet (`/embed/example.html`, `/functions/v1/admin/dashboard.html`) | 2 | 240 / 320 / 390 / 1280 | 8 |
| **sweep total** | **245** | | **584** |
| ladder — 4 representative pages × 23 widths, 200→1440 | 4 | 23 | 92 |

**676 measured checks.** Result: **244 of 245 pages clean across the swept range, with slack
exactly 0 at every width** — not "within tolerance"; `scrollWidth === clientWidth` exactly.

### What was actually wrong

Three distinct mechanisms, all of them *floors* on page width rather than oversized content:

1. **A fixed `auto-fit` track minimum.** `repeat(auto-fit, minmax(220px, 1fr))` stops shrinking a
   track at 220px, so below that the track — and the page — stops fitting. At a 240px viewport
   (225px real, 185px of content) both install CTAs rendered 220px wide with their right edge at
   259px: **34px of sideways scroll on all 99 install pages, and page width pinned at exactly
   259px for every viewport below 280 regardless of content.** Fix: `minmax(min(220px, 100%), 1fr)`,
   which differs from the original only when the container is under 220px.
2. **An unbreakable token setting a min-content floor.** Long single tokens are the norm on this
   surface — a registry name, an obligation key, a digest. At a 305px viewport the widest served
   name measured 577px and made the page 597px wide. Fix: `main { overflow-wrap: anywhere }`.
   `anywhere` and not `break-word`: only `anywhere` participates in min-content sizing, and
   `break-word` measured as **no change at all** on this plane.
3. **`min-width: auto` on grid items.** A grid item's automatic minimum is its min-content size, so
   a code block's longest line floored its column at 401px (`.ci-inner > *`) and 372px
   (`.scenario-card`), widening the page below 400px and 392px respectively. Fix: `min-width: 0` on
   the item, leaving the `pre` to scroll as it already did.

Nine declarations changed across the two stylesheets: six `min()` wrappings and two `min-width: 0`
rules plus a `body` wrap policy in `styles.css`; one `min()` wrapping and the `main` wrap policy in
the token plane. `.install-fallback code { overflow-wrap: normal }` and `.install-provenance code`
predate this pass; `.install-command-full code { overflow-wrap: normal }` was added by it.

The token plane exists in two copies — `apps/web/styles/tokens.css` is the source, deliberately
outside `public/`, and `sync-assets.mjs` projects it to `apps/web/public/styles/tokens.css`, the
byte a visitor receives. **Only the source was edited**, the projection regenerated, and `cmp`
confirms the two are byte-identical.

### The command rules are load-bearing, and that is measured, not asserted

Everything on an install page may break to fit. A command a human is asked to copy and run may
not: a command that cannot be read cannot be checked before it is run. Under the `main` net the
full command re-fractured. Measured text-run widths, same command, same viewport:

```
with    overflow-wrap: normal   [179, 135, 7, 247, 127, 179, 112, 7, 531, 7, 52]
without overflow-wrap: normal   [179, 135, 7, 224, 150, 179, 112, 7, 224, 224, 142]
```

The 531px digest run is chopped into 224/224/142, and `--contract` had already been observed
splitting as `- -contract`. So the two opt-outs are a correctness requirement, not defensive
symmetry — which is why a test now fails by name if a future tidy-up deletes them as redundant.

### The one exception — recorded, then removed by deletion

`/functions/v1/admin/dashboard.html` overflowed by 57px at a 240px viewport only, from a fixed
250px `.metric-card`; it was clean at 320 and above. It was pre-existing, internal, unlinked from
any navigation, carried no external stylesheet, and belonged to the abandoned Pages-Functions
observatory. Fixing it would have been scope creep into a surface that pass was not closing, so it
was recorded rather than fixed — which is why the figure above is 244/245 and not 245/245.

It was then **deleted on 2026-08-20** along with the rest of `apps/web/public/functions/**` (section
L′), for reasons unrelated to the overflow: the sources were never executed and described an
architecture the project had abandoned. `find apps/web/public -name '*.html' | wc -l` now returns
**244**, so the served set carries no recorded exception. The measurement above is left at its
original 245/244-clean rather than restated as 244/244, because that is what was actually measured;
the exception is closed by removal of its subject, not by a re-run.

### A bounded model/reality divergence, found and not papered over

`predictCtaColumns` grades CTA reflow from an *arithmetic* model over `CTA_REFLOW_RULES`; it does
not parse the stylesheet. The browser flips the install CTA row to one column at viewport 530; the
model flips at 492. The unseen chrome is `section.install-disposition`'s `padX 36 + bordX 1.6 =
37.6px` — the model computes from `vp − 40`, reality is `vp − 77.6`. **Divergence window: `vp ∈
[492, 529]`, 38px wide.** All three graded viewports (390 / 768 / 1280) agree between model and
browser, so `reflow/crosses-boundary` remains correct, and column count measured *identical*
before and after this pass's edit at 240/480/491/492/493/540/768/1280 — proving the edit neither
caused nor widened it. The constant is left at a readable `220`: re-deriving a resolved 0.8px
border width would relocate the error rather than remove it. Recorded, bounded, not fixed.

### What could observe the change, and what could not

Both preview artifacts were regenerated. `presentation-lock.json` moved by exactly one line — its
`visualDigest` — and `preview-snapshot.json` diffed **zero bytes**, because it records check
results and constant-derived predictions with no CSS digest. `visualDigest` is therefore the
*only* committed observer of a stylesheet change on this plane. That the lock can observe it was
confirmed by negative control: run without `--write`, it correctly reported drift.

### A gate that failed on a comment, and was left fail-closed

`audit:preview:gate` failed on this pass's own work: `gradeVisualRegression`'s
`no-media-queries` check counts the literal at-rule token with a plain regex and does not strip
comments, so it fired on a *prose mention* of the name inside a CSS comment explaining why the
plane has no media queries. The grader was **not** loosened. Its over-breadth cannot let a real
at-rule through — it is fail-closed, and `nonClassRuleHeads` set-equality already forbids one
structurally — so the comment was reworded and a note added recording that the token can never
appear in that file, even in prose. Both copies now contain zero occurrences and the gate passes.

### The guard, and what it does not claim

The class had already been fixed seven times by hand across two stylesheets. Nothing forbade the
eighth, which is the only reason there was a seventh, so
`tests/invariants/responsive-width-floors.invariants.test.ts` (6 tests) now pins all three
mechanisms: no bare `auto-fit` floor in either sheet or the projection, the `main`/`body` wrap
policy present, and both command opt-outs present. Writing it immediately surfaced one instance the
by-hand pass had missed. All three layers were negative-controlled: baseline green → reintroduce a
bare floor → red; weaken the `main` policy → red; delete a command opt-out → red; restore → green,
with `cmp` proving byte-identical restoration.

Its non-claims are written into the file, because a guard trusted for more than it measures is
worse than no guard. **It is not responsive QA**: it opens no browser, renders nothing, and measures
no width — it asserts the presence of two CSS constructs and the absence of one. It therefore
cannot catch a *new* blowout mechanism (a fixed `width`, a `white-space: nowrap`, a new
`min-width` floor outside `main`); those are found by rendering. And `.hero-inner`'s
`minmax(120px, 180px) 1fr` is deliberately **not** covered: it is an explicit two-track grid rather
than `auto-fit`, and it measured clean at 240px. Forbidding it would forbid a construct with no
measured defect — which is how a guard starts costing more than it catches.

`pnpm test` is 237 files / 4393 passed / 1 skipped, up from 236 / 4387 by exactly this file's one
file and six tests. Nothing counts `tests/invariants/`, so `ci:local` stays at 25 steps.

---

## Q. §106 conformance

new18 §106 mandates sections A–P by topic. This report's own sections are lettered independently
and predate that mapping, so renumbering them would churn every cross-reference in the document
for no gain. This table is the mapping: each mandated topic, its state, and where the evidence is.
A topic with no definite state is listed as such rather than being inferred from an adjacent one.

| §106 | topic | state | evidence |
| --- | --- | --- | --- |
| A | Git — base/main/branch SHA, commits | **PRESENT** | header; measured at `4671854` (20th over `origin/main`), carried by `0c3f2c0` (21st) |
| B | Security — semantic changed? expected NO | **UNCHANGED** | §A table: 0 added / 0 removed / 0 changed, 6 verdict packages |
| C | Private telemetry — consent, one pipeline, lossless, retry, privacy | **CLOSED (client side)** | §L: consent flag now read; 4 queue defects fixed; rotate no longer prints the new id |
| D | Private usage — Worker, D1, retention, Access, refresh | **READY_NOT_DEPLOYED** | §L′: Worker + D1 migrations + real `DELETE` retention; 131/131; artifact-only by §29 fail-closed |
| E | Distribution SSOT — one SSOT, migration, generator, drift gate | **CLOSED** | §D, §O; generator + drift gate + SSOT schema, all negative-controlled. Per-claim external provenance (§104) in [EXTERNAL_DISTRIBUTION_MATRIX.md](EXTERNAL_DISTRIBUTION_MATRIX.md) — 27 claims, source + checked-at each, with the 5 that carry no recorded conclusion marked as such rather than papered over |
| F | Registry — identity, live, OIDC, validate, readback, watcher | **LIVE, watcher armed, never run** | §H: 7/7 field readback PASS; watcher was 404 on `main` until PR #325 merged as `a0076ff` and now reports `state: active` — 0 runs until Mon 09:00 UTC |
| G | Platform coverage — complete matrix | **PRESENT** | [FINAL_PLATFORM_MATRIX.md](FINAL_PLATFORM_MATRIX.md) — 15 hosts × all 14 §105 columns, generated from the SSOT so no cell is typed; `platform-audit-G3.md` carries the prose analysis |
| H | Native presence — PRESENT / SUBMITTED / READY_NOT_SUBMITTED / … | **PARTIAL** | SSOT `distributionPrimitives`, 4 states across 13 kinds. §107 admits `PARTIAL \| READY \| LIVE` here, and `PARTIAL` is the only one the evidence carries: 3 of 15 primitives are `AVAILABLE` (all `mcp-stdio`), 0 of the 13 non-stdio kinds are, 2 are `READY_NOT_SUBMITTED` behind a vendor that does not accept third-party submissions, and 1 is `PENDING_UPSTREAM`. An earlier draft said `PRESENT`, which is not in the §107 vocabulary at all |
| I | Human discovery — hub, canonical pages, **legacy URL handling** | **CLOSED** | §O — the last of the three; hub and canonical pages closed earlier in §D |
| J | Agent discovery — agent-surfaces, llms, llms-full, well-known, sitemap, drift = 0 | **CLOSED** | all six present; drift gate green; `.well-known/` carries `calllint.json` + `security.txt` |
| K | Public reality — Team / pricing / free-forever / roadmap removed, governance | **CLOSED** | §K: 0 hits across 45 tool descriptions and 23 public files; the 4 "pricing" hits are third-party registry descriptions |
| L | Visual — malformed CSS, card alignment, scenarios, **responsive QA** | **CLOSED** | §P: measured over 245 served pages, 676 checks, 244/245 clean at slack 0. The single exception was `/functions/…/dashboard.html` (240px only), deleted 2026-08-20 with the Pages-Functions sources — the served set is now **244 pages with no exception** |
| M | Continuous watch — schedule, sources, no-change behavior, no spam | **SCHEDULED, NEVER RUN** | §H: weekly `0 9 * * 1`, read-only, 15 hosts / 20 https sources. GitHub reported the workflow 404 on `main` until PR #325 merged as `a0076ff`; re-measured after: `state: active`, so the cron exists. `gh run list` returns `[]` — the first firing is up to 7 days out, and step 3 exits 1 today (§J item 2), so expect it red |
| N | Tests — targeted, typecheck, test, ci:local | **GREEN** | re-measured 2026-08-21 at the closing pass: **243 files / 4524 passed / 1 skipped**; `ci:local` 25 steps, **exit 0**. (§K records 237 / 4393 at `fda2bd5`; the delta is other work landing on the branch, not this pass) |
| O | External writes — exact list, at or under the maximum, no duplicates | **ONE** | the npm publish of `calllint-mcp@0.2.0`, already reflected in the live Registry. No new external write in this pass |
| P | Operator actions — only the unavoidable | **TWO** | (1) create the `mcp-v*` tag ruleset — a repository-settings write. Narrowed 2026-08-21: the code-level ancestry half of AC-32 is now enforced in `publish-mcp.yml` step 2 (§H item 10b), so this is the who-may-tag half only; (2) Cloudflare Access + `USAGE_HASH_KEY` + the real `database_id` — needed only to *deploy* the observatory; the artifact-only pipeline in §L′ needs none of them, per [CLOUDFLARE_ACCESS_ACTION.md](CLOUDFLARE_ACCESS_ACTION.md) |

`OPERATOR_ACTION_REQUIRED = 2`, both in the unavoidable categories §106 P allows (protected GitHub
ruleset; credential/environment setting). Neither is in the working tree, and neither blocks the
distribution closure this report covers.

Against §107's vocabulary, and claiming no state the evidence above does not carry:

```
SECURITY_SEMANTICS            = UNCHANGED
PUBLIC_WEBSITE_REALITY        = CLOSED
WEBSITE_VISUAL_SYSTEM         = CLOSED          (245 pages rendered, 676 checks, 1 exception)
PRIVATE_USAGE_OBSERVATORY     = READY_NOT_DEPLOYED (Worker unpublished; placeholder database_id)
PUBLIC_ADOPTION_SIGNALS       = DEFERRED
GLOBAL_DISTRIBUTION_AUTHORITY = READY
HUMAN_DISCOVERY               = READY
AGENT_DISCOVERY               = READY
CONTINUOUS_COVERAGE_WATCH     = READY           (cron armed on `main`; 0 runs until Mon 09:00 UTC)
REGISTRY_IDENTITY             = CANONICAL
REGISTRY_PRESENCE             = LIVE
REGISTRY_PUBLISH              = OIDC
REGISTRY_VALIDATE             = PASS
REGISTRY_READBACK             = PASS
NATIVE_PRESENCE               = PARTIAL         (3 of 15 primitives AVAILABLE; 0 of 13 non-stdio)
```

All fifteen §107 names now appear, and one of them does not carry the value §107 expects. Listing
it anyway is the point: a vocabulary block that silently omits the states the evidence cannot
support is the same unfalsifiable claim this report was written to stop making. An earlier draft
printed eight of the fifteen, which read as full coverage.

`CONTINUOUS_COVERAGE_WATCH` was the one outright miss against §107 at the time this section was
written, and it **closed when PR #325 merged as `a0076ff`** — by that merge alone, with no further
edit, exactly as this paragraph predicted before the fact. The workflow is correct (weekly
`0 9 * * 1`, read-only, 15 hosts and 21 https sources, and it drift-gates the two new §104/§105
matrices), and `gh api` now reports `state: active` where it reported **404 on the default branch**
on 2026-08-20. The claim is `READY` in the §107 sense — a schedule that exists — and deliberately
not stronger: `gh run list` returns `[]`, so the job has never executed, and step 3
(`verify-mcp-tag-protection.mjs`) exits 1 today, so its first run should be expected to fail. That
is item 2 of §J, not a defect in the watcher.

**This correction is itself an instance of the class.** The sentences above previously asserted a
404 that the merge had already falsified. A report on `main` describing a state its own subject no
longer has cannot observe that subject — the same fault the report catalogues elsewhere, committed
by the report about itself. It is corrected here rather than left to be read as current.

`NATIVE_PRESENCE = PARTIAL` is a legal §107 value, not a miss.

`PRIVATE_USAGE_OBSERVATORY` was `NOT_READY` in the earlier pass, and the reason is worth keeping
visible rather than editing away: `READY_NOT_DEPLOYED` means the code is correct and merely
unshipped, and §L item 1 showed the ordinary multi-event batch returning 500. Reporting that as
`READY_NOT_DEPLOYED` would have been the exact error this report exists to stop making.

It is `READY_NOT_DEPLOYED` now because the subject changed rather than the standard: the defective
Pages-Functions ingress was deleted and replaced by [apps/usage-worker/](../../apps/usage-worker/),
whose schema forecloses each of those four defects (§L′ table), with 131/131 tests and `tsc` exit 0.
`READY_NOT_DEPLOYED` is the correct terminal state here rather than a way-station: the Worker is
unpublished, its `wrangler.toml` carries a placeholder `database_id`, and §29 keeps the report an
artifact until an operator verifies Cloudflare Access. Neither the operator action nor the
deployment is something this repository can perform.

Both remaining operator actions are unchanged in kind: `OPERATOR_ACTION_REQUIRED` is still 2.

`WEBSITE_VISUAL_SYSTEM` moved from `PARTIAL` to `CLOSED` in this pass, and the earlier `PARTIAL`
is worth keeping visible rather than editing away: its stated evidence counted media blocks in
`styles.css`, which does not style the 99 install pages at all. The claim was not merely
incomplete, it was scoped to the wrong file — the §M fault class turned on this report. `CLOSED`
here means what §P measured and no more: every served page rendered at 240/320/390/1280 with
`scrollWidth === clientWidth` exactly, one recorded exception, and a guard that pins the three
fixed mechanisms while explicitly not claiming to be responsive QA itself.
