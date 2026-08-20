# Global Agent Distribution Authority — Final Report

**Branch:** `feat/global-agent-distribution-authority` (measured at `fda2bd5`, 18 commits over `main`)
**Date:** 2026-08-20 (re-measured; first drafted 2026-08-19 at `d5f12df`)
**Scope:** stages G0–G9 of the A0 execution package, the Official MCP Registry Tier-0
closure items, and the telemetry-correctness work that landed alongside them.

Every number below is a measurement taken against the tree at HEAD, and every claim names the
command that produces it. Where a claim could not be measured, it says so instead of asserting
a state.

Sections A, F, H, I and J were **corrected after first drafting** against measurements that
contradicted them. The corrections are marked in place rather than silently applied, because
three of them turned a ✅ into an open item.

**Measurement point: `fda2bd5`.** The first draft was written at `d5f12df` and re-measured at
`865f9c6`; every number was re-taken at each move rather than carried forward — which is the
point, because several commits on this branch exist precisely because a carried-forward claim
turned out to be false. New material at `865f9c6`: section L (telemetry), section M (the three
gates that could not observe their subject), and the `distribution-sources.json` projection in
section D. New since: section O (legacy URL handling) and this section P.

A report that records its own HEAD invalidates itself the moment it is committed, so this file
names the last commit that changes a **measured surface**, not the commit that carries the file.
`fda2bd5` is that commit. The two that follow it move an artifact directory and add this
document; neither touches code, a generated projection, or a gate, so no measurement below moves
with them. Anything that did would have to be re-taken, not adjusted.

---

## A. Verdict

**NOT fully closed — but every remaining item is now blocked on an action outside the working
tree, not on unwritten code.** All local gates are green. Three items remain open (section J):
two require a merge to `main`, one requires an admin write on the repository. Nothing in the
distribution scope is waiting on further implementation.

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

Rows 1 and 5 were re-taken at `fda2bd5` after section O landed and are unchanged (`ci:local`
still exit 0 at 25 steps; `check:security-semantics` runs inside it). Rows 2–4 were **not**
re-taken: each observes state on a remote — the Registry API, the repository's rulesets, the
default branch's workflow list — that no commit on this branch can move, so re-running them
would produce a new timestamp and no new information. They are dated `865f9c6` for that reason,
not upgraded to the later SHA.

Nine properties were closed *this pass* by finding them broken or unenforceable, not by
documenting them as done. One of the nine — GD-15 — was a real defect **this branch created**,
and the fix exists only locally: nothing has been pushed, so the live site still serves the
broken state (section F).

Two acceptance claims that earlier drafts of this report asserted do **not** hold under
measurement and are corrected here: `REGISTRY_WATCH` is not READY (section H), and
Registry item 10 was not verified (section H). Item 10's *guard* has since been rewritten so it
can observe its subject; the underlying tag ruleset still does not exist.

The three items filed as "minor, disclosed, not blocking" in the first draft were not carried
forward as disclosures — they were fixed (section J, items 4–6). Writing the schema for item 4
immediately caught a typing error in the schema itself, which is the argument for writing it.

**Outside the distribution scope, one workstream is genuinely unimplemented** and is named here
so this report is not read as a closure claim over it: the usage-ingress service (`apps/usage-worker`,
D1 schema, the private report surface). Section L covers what landed and what did not; section N
states the boundary.

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

Note the scope: the cartesian pages are gone from **this branch's** tree, not from production.
`main` still contains all 8 `.html` files and still serves them (section F). GD-06 is closed in
the sense the contract asks — no generator can recreate the plane — but the plane itself is
removed from the public site only on deploy.

---

## F. GD-15 — this branch broke the sitemap, and the fix is not deployed

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

**The fix is local only.** Re-measured against production on 2026-08-20 (unchanged from the
2026-08-19 reading, because nothing has been pushed):

| URL | Live status |
| --- | --- |
| `https://calllint.com/harnesses/sitemap.xml` | 200 — still the 9-URL `main` version |
| `https://calllint.com/harnesses/deepseek/claude-code` | 200 — `main`'s cartesian page, still served |
| `https://calllint.com/harnesses/claude-code/` | **404** — no canonical host page is live |
| `https://calllint.com/agent-surfaces.json` | **404** — the machine surface §19 points at is not live |
| `https://calllint.com/schemas/agent-surfaces.v1.json` | **404** — the schema written this pass is not live either |

Production is therefore self-consistent (it serves `main`), and none of this branch's surfaces
exist there yet. The GD-15 violation is real in the branch and is fixed in the branch; it
reaches production only when this work is pushed and deployed, which has not happened.

The last row is worth stating rather than omitting: section J item 4 reports the `$schema`
pointer as CLOSED, and it is — *in the branch*. On the live site that pointer still 404s. Both
statements are true and neither substitutes for the other.

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
| `REGISTRY_WATCH = READY` | ❌ **OPEN** | `distribution-watch.yml` exists **only on this branch**. Re-measured 2026-08-20: `gh api .../workflows/distribution-watch.yml` → **404 — not found on the default branch**, and `gh run list` reports the same 404. A scheduled workflow does not schedule until it is on the default branch. |

`REGISTRY_WATCH` was asserted READY in an earlier draft of this report on the strength of the
file's `schedule: cron` block. That is the same defect this pass was written to catch: the
existence of a monitor's source is not evidence the monitor runs. It has never executed once.

The cron itself moved from daily to **weekly (Mondays 09:00 UTC)** in `b6c0f2b`. Every fact this
job observes — a Registry entry, a tag ruleset, a generator's output for unchanged input —
changes on the order of weeks, so a daily schedule bought no earlier detection of anything and
spent 7× the Actions minutes re-asserting the same measurement. `workflow_dispatch` covers
"answer now". This changes nothing about the row above: a workflow that is not on the default
branch runs neither daily nor weekly.

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

Creating the ruleset is an admin write on the shared repository and is left to the maintainer;
`--explain` prints the UI path and the equivalent `gh api` call. Still OPEN in section J — but
open on an admin action, not on code.

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

---

## J. Open items and deliberate exclusions

### Open — must close before this can be called closed

1. **`REGISTRY_WATCH` is not READY.** `distribution-watch.yml` is not on the default branch, so
   its `schedule` has never fired: `gh api .../workflows/distribution-watch.yml` → 404, 0 runs.
   Closes on merge to `main`, not before. Section H.
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
   **What remains is not a code change.** Creating the tag ruleset is an admin write on the
   shared repository; `--explain` prints the exact UI steps and the equivalent `gh api` call.
   Until it exists, any collaborator with write access can trigger a release, with the
   `environment: npm` single-reviewer gate as the only remaining barrier — and both the npm and
   Registry publishes sit in the same job behind it. Section H.
3. **Nothing is deployed.** GD-15's fix, all 15 host pages, and the machine surface exist only
   in this branch. Production still serves `main`: the 9-URL sitemap, the 8 cartesian pages, and
   404 on both `/harnesses/claude-code/` and `/agent-surfaces.json`. Section F.

### Closed after the first draft

These three were filed as "minor, disclosed, not blocking" in the first draft. They were then
fixed rather than carried, because each was cheap and each was the kind of defect this report
exists to name. All three are local changes and need no admin action or deploy.

4. **The dangling `$schema` pointers — CLOSED.** Two different fixes, because the two pointers
   answer to different consumers:
   - The **published** one now resolves. `apps/web/public/schemas/agent-surfaces.v1.json` is a
     real draft-07 schema, and because the Pages project is static-only, a file under `public/`
     *is* its URL (`_routes.json` routes Functions paths only and deliberately does not list
     it). The schema also encodes the invariant: `additionalProperties: false` plus an explicit
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
  can clear. It belongs to the watcher, which runs it weekly — once the watcher is on `main`.
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
one path. `apps/usage-worker/` indeed does not exist — but the ingress was never going to be
there. It is on `main`, as **Pages Functions under `apps/web/public/functions/`**, and has been
since `e72f837`:

| path (under `apps/web/public/`) | bytes | live |
| --- | ---: | --- |
| `functions/v1/events/usage.ts` | 3882 | `/v1/events/usage` → **404** |
| `functions/v1/events/trust` (routed) | — | `/v1/events/trust` → **405** on GET |
| `functions/v1/public/adoption-signals.ts` | 2084 | `/v1/public/adoption-signals` → **404** |
| `functions/v1/admin/usage.ts` | 2466 | not routed |
| `functions/v1/admin/dashboard.{ts,html}` | 618 / 4416 | not routed |
| `functions/_middleware/hmac.ts` | 1292 | — |
| `functions/schema.sql` | 1444 | — |

The 405 is the load-bearing measurement: a Function is running and rejecting `GET`, so this Pages
project is **not** static-only. I had carried "static-only, no Functions" forward as a premise and
it is false. What is true is narrower: `_routes.json` includes only `/v1/public/*`,
`/v1/events/trust` and `/trust/*`, so `/v1/events/usage` is **written but unrouted**, which is why
it 404s. `8acf297` added that file to withdraw the Adoption Signals surface; the usage endpoint
was left out of the include list.

So the honest statement is not "unbuilt" but **built, unrouted, and incorrect where it matters**.
Three defects, read from the source rather than inferred:

1. **`batch_id TEXT UNIQUE` is on the events table.** `usage.ts` binds the same `batch.batchId` to
   every event in a batch and submits them through one `D1Database.batch()`, which is
   transactional. Any batch carrying two or more events violates the constraint and aborts the
   whole insert — the endpoint returns 500 for its ordinary case and succeeds only for
   single-event batches. This is precisely why new18 specifies idempotency in a separate
   `usage_ingested_batches` table rather than as a column constraint on the events.
2. **`hashed_installation_id TEXT NOT NULL`, but the code can bind `null`.** `hashedId` stays
   `null` when an event carries no `anonymousInstallationId`, so such an event fails the same
   transaction and takes its batch with it.
3. **Two guarantees in the file header have no mechanism.** "Rate limited per IP" — `ip` is read
   into a variable that is never used again, and `RATE_LIMIT_PER_MINUTE = 100` is never
   referenced. "No sensitive fields allowed (enforced by sanitizer at client)" states the trust
   boundary backwards: a server that trusts a client-side sanitizer is not enforcing anything.
   new18 requires server-side re-sanitization for exactly this reason.

A fourth gap is design, not defect: `usage_events` retains raw event rows forever. The
`usage_aggregates` and `active_installations` **views** filter to 90 and 30 days, but a view that
filters reads is not retention — the rows are still there. No deletion job exists.

None of this has ever run in production, because the route was never opened. That is the only
reason these are defects and not incidents.

The client-side boundary that *is* enforced: `check-telemetry-boundary.mjs` asserts the telemetry
packages import no filesystem or network module, which is why the queue sink lives in
`apps/cli/src/queueSink.ts` rather than inside `packages/telemetry-emit`.

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

- **Usage ingress** — written, unrouted, and defective in three specific ways (section L). It is
  Pages Functions on `main`, not the `apps/usage-worker/` this report once looked for and did not
  find. The root `wrangler.toml` is a Pages config (`pages_build_output_dir`), naming the
  *observatory* project rather than the website.
- **Deployment** — nothing on this branch has been pushed. Production serves `main` (section F).
- **The `mcp-v*` tag ruleset** — an admin write on the shared repository (section H, J item 2).

The first is written code that does not run. The second and third are not code at all. Keeping the
three apart is the reason this section exists: a report that lists them together under "remaining
work" invites the reading that they are all one push away, and only two of them are.

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

### The one exception, recorded rather than fixed

`/functions/v1/admin/dashboard.html` overflows by 57px at a 240px viewport only, from a fixed
250px `.metric-card`; it is clean at 320 and above. It is pre-existing, internal, unlinked from any
navigation, carries no external stylesheet, and belongs to the Usage Observatory that §106 D
reports as `NOT_READY`. Fixing it here would be scope creep into a surface this pass is not
closing; it is recorded so the 244/245 figure is not read as 245/245.

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
| A | Git — base/main/branch SHA, commits | **PRESENT** | header; measured at `fda2bd5`, 18 commits over `main` |
| B | Security — semantic changed? expected NO | **UNCHANGED** | §A table: 0 added / 0 removed / 0 changed, 6 verdict packages |
| C | Private telemetry — consent, one pipeline, lossless, retry, privacy | **CLOSED (client side)** | §L: consent flag now read; 4 queue defects fixed; rotate no longer prints the new id |
| D | Private usage — Worker, D1, retention, Access, refresh | **NOT READY** | §L: written as Pages Functions, unrouted, 3 defects + no retention job |
| E | Distribution SSOT — one SSOT, migration, generator, drift gate | **CLOSED** | §D, §O; generator + drift gate + SSOT schema, all negative-controlled |
| F | Registry — identity, live, OIDC, validate, readback, watcher | **LIVE, watcher not scheduled** | §H: 7/7 field readback PASS; watcher 404s until merge to `main` |
| G | Platform coverage — complete matrix | **PRESENT** | 15 hosts, 4 support classes; `platform-audit-G3.md` |
| H | Native presence — PRESENT / SUBMITTED / READY_NOT_SUBMITTED / … | **PRESENT** | SSOT `distributionPrimitives`, 4 states across 13 kinds |
| I | Human discovery — hub, canonical pages, **legacy URL handling** | **CLOSED** | §O — the last of the three; hub and canonical pages closed earlier in §D |
| J | Agent discovery — agent-surfaces, llms, llms-full, well-known, sitemap, drift = 0 | **CLOSED** | all six present; drift gate green; `.well-known/` carries `calllint.json` + `security.txt` |
| K | Public reality — Team / pricing / free-forever / roadmap removed, governance | **CLOSED** | §K: 0 hits across 45 tool descriptions and 23 public files; the 4 "pricing" hits are third-party registry descriptions |
| L | Visual — malformed CSS, card alignment, scenarios, **responsive QA** | **CLOSED** | §P: all 245 served pages rendered, 676 checks, 244/245 clean at slack 0; 1 recorded exception (`/functions/…/dashboard.html`, 240px only) |
| M | Continuous watch — schedule, sources, no-change behavior, no spam | **READY, NOT SCHEDULED** | §H: weekly `0 9 * * 1`, read-only, 15 hosts / 20 https sources; GitHub reports the workflow as 404 until it lands on `main` |
| N | Tests — targeted, typecheck, test, ci:local | **GREEN** | §K: 237 files / 4393 passed / 1 skipped; `ci:local` 25 steps, exit 0 |
| O | External writes — exact list, at or under the maximum, no duplicates | **ONE** | the npm publish of `calllint-mcp@0.2.0`, already reflected in the live Registry. No new external write in this pass |
| P | Operator actions — only the unavoidable | **TWO** | (1) create the `mcp-v*` tag ruleset — repository admin; (2) Cloudflare Access and `USAGE_HASH_KEY` — required only when §106 D is taken up |

`OPERATOR_ACTION_REQUIRED = 2`, both in the unavoidable categories §106 P allows (protected GitHub
ruleset; credential/environment setting). Neither is in the working tree, and neither blocks the
distribution closure this report covers.

Against §107's vocabulary, and claiming no state the evidence above does not carry:

```
SECURITY_SEMANTICS            = UNCHANGED
PUBLIC_WEBSITE_REALITY        = CLOSED
WEBSITE_VISUAL_SYSTEM         = CLOSED          (245 pages rendered, 676 checks, 1 exception)
PRIVATE_USAGE_OBSERVATORY     = NOT_READY        (written, unrouted, 3 defects)
PUBLIC_ADOPTION_SIGNALS       = DEFERRED
GLOBAL_DISTRIBUTION_AUTHORITY = READY
HUMAN_DISCOVERY               = READY
AGENT_DISCOVERY               = READY
```

One of these sits below the state §107 anticipates. `PRIVATE_USAGE_OBSERVATORY` is `NOT_READY`
rather than `READY_NOT_DEPLOYED` because `READY_NOT_DEPLOYED` means the code is correct and merely
unshipped, and §L item 1 shows the ordinary multi-event batch returns 500. Reporting it as
`READY_NOT_DEPLOYED` would be the exact error this report exists to stop making.

`WEBSITE_VISUAL_SYSTEM` moved from `PARTIAL` to `CLOSED` in this pass, and the earlier `PARTIAL`
is worth keeping visible rather than editing away: its stated evidence counted media blocks in
`styles.css`, which does not style the 99 install pages at all. The claim was not merely
incomplete, it was scoped to the wrong file — the §M fault class turned on this report. `CLOSED`
here means what §P measured and no more: every served page rendered at 240/320/390/1280 with
`scrollWidth === clientWidth` exactly, one recorded exception, and a guard that pins the three
fixed mechanisms while explicitly not claiming to be responsive QA itself.
