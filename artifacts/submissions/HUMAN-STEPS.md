# The channel actions — what only you can do

ROI #1–#4 in [ROI.md](ROI.md). Everything an agent is permitted to do has been done and is
recorded below with its result; what remains is listed as numbered steps for you.

> **#1 and #2 are both already done.** #1 was published 2026-07-20 (`5bed4b6`); #2 was
> submitted at `cursor.com/marketplace/publish` and is **awaiting Cursor's review** (reported
> 2026-08-26). Do not resubmit either — a duplicate external write is the harm §87 names.
>
> **Updated 2026-08-27, and the count is now zero.** That 357 MB CLI is installed, the audits it
> gated are resolved, and the one submission that remained — #3, the PR to
> `github/copilot-plugins` — **has been opened on your behalf** as
> [#80](https://github.com/github/copilot-plugins/pull/80). **Nothing on this page is a human
> to-do any more.** What is left everywhere else is either upstream's queue or our own
> engineering. Everything that looked like a submission was audited and is not one: `windsurf`
> documents no public path (its docs 307-redirect to `docs.devin.ai`, so the host ships as Devin
> Desktop), `qwen-code` has no shelf at all and installs from ours, `openclaw` cost a relicence
> and **you declined it — settled, not pending**, and `gemini-cli` and `kiro` are engineering on
> our side. The count fell 29 → 7 → 3 → 0 human acts, every step derived from the SSOT in
> [CHANNEL-COUNTS.md](CHANNEL-COUNTS.md) rather than typed here.
>
> §89's quota (`MAX_NEW_EXTERNAL_SUBMISSIONS = 3`) is now **spent**: cline 2026-08-18, cursor
> 2026-08-25, copilot 2026-08-27. A fourth needs a new authorization, not a new audit.

Why the split: new18 **§87** (`NO CONTINUOUS EXTERNAL SPAM`) says the weekly watcher must never
open an external PR or issue, submit a form, email or tag a maintainer, request a reviewer, or
retry a rejected contribution. So the *automated* watcher publishes nothing; pre-flight
validation, local installs, and read-only registry checks are mine.

> **Two corrections to an earlier version of this line, 2026-08-25.**
>
> 1. **It cited "§22", which is the wrong section.** new18 §22 is `PRIVATE USAGE FACT SEMANTICS`
>    (npm downloads ≠ users). The rule is §87, with §90 `EXTERNAL WRITE RULE` giving the
>    eligibility test. A wrong citation is worse than none: it reads as governed when nobody has
>    checked the governing text.
> 2. **"Read-only toward the outside world" overstated it.** §87 binds the *watcher*, not the
>    repository. §89 `A9 — BOUNDED EXTERNAL NATIVE PRESENCE` sets
>    `MAX_NEW_EXTERNAL_SUBMISSIONS = 3` and §5 diagrams "一次 bounded external write" as the
>    intended endpoint, so bounded external submission is **permitted** once §90's eight
>    conditions are all true (official public channel exists, CallLint is a legitimate primitive,
>    install command proven, schema/validation passes, no duplicate, no invented
>    personal/legal/company assertion, minimal diff, no promotional issue). The steps below stay
>    human actions — but because they need a browser session, an account, or a 357 MB install that
>    is not on this machine, not because a rule forbids automating them. §89 also records that
>    Cline PR #49 is **not** a new submission and does not consume the quota.

Measured 2026-08-25. Identity, copy and assets for every field below:
[MATERIALS.md](MATERIALS.md) — cite it, do not retype it.

---

## Already done for you (do not redo)

| Check | Command actually run | Result |
|---|---|---|
| #1 marketplace manifest | `claude plugin validate . --strict` | **Validation passed** |
| #1 version resolution | `claude plugin tag plugins/calllint --dry-run` | **0.1.0 (from plugin.json)**, `plugins[0]`, tag `calllint--v0.1.0` |
| #2 Cursor manifests | Cursor's own `validate-template.mjs` | **Validation passed**, and confirmed it reads *our* tree by breaking the manifest `name` and watching it reject |
| #2 local install | NTFS junction into `~/.cursor/plugins/local/` | every manifest path resolves through the link; hook runs at cwd = plugin dir, **exit 0** |
| #4 registry entry live | `GET registry.modelcontextprotocol.io/v0/servers?search=calllint` | `io.github.calllint/calllint` **0.2.0**, `status: active`, `isLatest: true`, published 2026-07-13 (and 0.1.1, `isLatest: false`) |
| #4 aggregator pickup | `GET github.com/mcp` | **not listed** — 0 occurrences of `calllint` with no query param (the 3 hits under `?query=calllint` are the query echoed into `og:url` and login links, not a result row) |

Claude Code 2.1.195 and Cursor 3.15.19 are on this machine. `copilot` is not — `@github/copilot`
is a ~13 KB loader that fetches a 357 MB platform binary, so #3's run stays yours.

---

## #1 — `claude-code` → `claude-plugin` (P0) — **ALREADY DONE, do not redo**

**There is no marketplace to submit to.** Claude Code distribution is users adding this
repo as a marketplace, so "submitting" means publishing the install line where people see
it. No form, no review queue, no waiting.

> **Corrected 2026-08-25: this row was listed as "the one to do first" and it had already
> been done.** The SSOT records `submission.date: 2026-07-20`, and the act is verifiable
> independently of that claim: the two install lines are live at `README.md:289-290`,
> published in `5bed4b6` (#189). `CHANNEL-COUNTS.md` — generated from the same SSOT — had it
> right the whole time, filed under *submitted, listing not yet verified* and excluded from
> the actionable 8. This file and `ROI.md` disagreed with the generated projection, which is
> the direction of error that matters: a hand-maintained page told you to redo a completed
> external action. Per [ADR 0002](../adr/0002-submission-records-the-act.md), a channel with
> a recorded submission date is not actionable work no matter what its `state` says.
>
> It stays `AUDIT_REQUIRED` rather than `AVAILABLE` for a structural reason, not a missing
> step: there is no shelf page to record as `liveUrl`, so ADR 0002's accepted arm is
> unreachable here. A README anchor would be self-endorsement — the exact defect found in
> `cursor-plugin` on 2026-08-23.

Steps 1–2 below are kept as the **record of what was published**, not as a to-do:

1. The two-line install block, published in the README:

   ```
   /plugin marketplace add calllint/calllint
   /plugin install calllint@calllint
   ```

2. Published in the `owner/repo` form, not a raw URL to `marketplace.json`. A relative
   `source` resolves against the marketplace root, which works when the whole repo is
   fetched. Point someone at the bare JSON file and only that file is fetched — the plugin
   source will not resolve.

Trap worth knowing: `--strict` does **not** look inside the `source` object, so a passing
validation is not evidence the source resolves. And never add a `version` field to the
marketplace entry — when it disagrees with `plugin.json`, `plugin.json` wins **silently**.

Detail: [claude-plugin/SUBMISSION.md](claude-plugin/SUBMISSION.md)

---

## #2 — `cursor` → `cursor-plugin` (P0) — **ALREADY SUBMITTED, awaiting review, do not redo**

> **Corrected 2026-08-26.** This section used to head "the actual first action". The
> submission has been made: the maintainer reported submitting the repo URL at
> `cursor.com/marketplace/publish`, and it is with Cursor's reviewers. The SSOT now records
> `submission.date: 2026-08-25` at `state: PENDING_UPSTREAM`, so per
> [ADR 0002](../adr/0002-submission-records-the-act.md) this channel is **not actionable
> work**. The date is the day the manifests Cursor reads landed (`65eb719`) — the earliest the
> act could have succeeded, so a lower bound, not an observed timestamp. There is no
> `submissionUrl` because the intake is a private form review rather than a PR, which is the
> one structural difference from `cline-marketplace-pr`.
>
> The steps below are kept as the record of *what was done*, not as a queue. The only thing
> still owed here is step 5: when the listing appears, set `liveUrl` and flip to `AVAILABLE`
> in the same edit.

The material gap is closed and the "tested locally" checkbox is genuinely ticked, not
assumed. Cursor's intake is a **public repo reviewed by the Cursor team** — you submit a
URL, not a pasted manifest.

1. ~~Go to https://cursor.com/marketplace/publish~~ — done (the `/marketplace` URL is the
   browse page; `/publish` is intake).
2. ~~Submit the repo URL: `https://github.com/calllint/calllint`~~ — done.
3. That was the whole submission. Name, description, category, tags, license and homepage
   are read from `plugins/calllint/.cursor-plugin/plugin.json` — there were no form fields
   to fill from MATERIALS.md.
4. A review, not an instant listing: "All plugins must be open source, and we review
   each update before publishing." **This is the state it is in now.**
5. **Still owed.** Record the outcome in the SSOT when review completes. If it goes live, set
   `liveUrl` **in the same edit** — presence and verification are separate facts, and
   schema arm 1 refuses a `liveUrl` under any state but `AVAILABLE`.

Detail: [cursor-plugin/SUBMISSION.md](cursor-plugin/SUBMISSION.md)

---

## #3 — `copilot-cli` → `github-copilot-plugin` — ✅ **SUBMITTED 2026-08-27, do not redo**

**Opened on the user's behalf as [github/copilot-plugins#80](https://github.com/github/copilot-plugins/pull/80)** —
`+24/−0`, one file, `.github/plugin/marketplace.json`. Nothing is left for a human here; it is
upstream's queue now. The steps below are kept as the record of what was done and why, not as a
to-do. **Two things measured during the submission that the plan below got only half right:**

1. `.claude-plugin/marketplace.json` is a **git symlink** (mode `120000` → `../.github/plugin/marketplace.json`,
   added upstream in PR #24). On Windows Git checks it out as a literal one-line text file
   containing that path, which is exactly the trap described below — confirmed, not theorised.
   The near-miss worth recording: GitHub's contents API *resolves* the symlink and serves the
   target's bytes, so comparing the two API responses reports them byte-identical and the symlink
   invisible. Only the tree mode or a real checkout shows it.
2. The odds are worse than "zero precedent, no evidence either way," which is what this page said.
   Measured on the live PR list: **29 merged PRs, and every `Add …` among them is first-party**
   (GitHub or Microsoft). Meanwhile ~7 third-party plugin-add PRs sit open, and the oldest open PR
   dates to **2026-01-24**. The queue demonstrably does not move for outsiders. Opening was still
   correct — direct installs are deprecated in favour of `plugin@marketplace`, so this is the
   eventual only supported route — but nobody should expect a merge.

**Audit resolved 2026-08-27 (E-2), and it inverted this section's advice.** The previous
version said *do not open a PR yet* on the grounds that route A (a local install) might mean
no submission was ever needed, and that `github/copilot-plugins` had shown no intake process.
Both halves were measured, on `copilot` 1.0.80 with the 357 MB platform binary installed:

| Question | Measured answer |
|---|---|
| Does route A work? | **Yes.** `copilot plugin install ./plugins/calllint` → `copilot plugin list` reports `calllint (v0.1.0)` |
| Does the MCP server come up? | **Yes, but only after a fix.** `copilot mcp list` reports `calllint (local)` under Plugin servers — see the defect below |
| Is route A durable? | **No.** Direct path/repo/URL installs print a deprecation warning that only `plugin@marketplace` installs will be supported |
| Does the repo accept entries? | **Yes** — 20 live entries, all first-party |

So route A is not an alternative to the PR; it is a local test of the artifact the PR points
at, and it is scheduled for removal. That makes this PR the eventual **only** supported route,
which is why it moved from "do not" to "the one submission left."

**A defect this audit found, which you are shipping the fix for.** Our plugin installed and
reported `enabled` on Claude Code while `claude mcp list` said *No MCP servers configured* —
the MCP server, which is the entire product, was silently absent on both Claude Code and
Copilot CLI. Cause: the manifest was `mcp.json`, which is **Cursor's** filename; Claude Code
and Copilot CLI both read `.mcp.json`. Fixed additively by adding `plugins/calllint/.mcp.json`
(byte-identical, Cursor's copy untouched), and `scripts/probe-claude-plugin-install.mjs` now
asserts `✔ Connected` so the availability claim rests on the product being reachable rather
than merely installed.

### Blocking precondition — do not open the PR before this is true

The PR points at `calllint/calllint@main`. `.mcp.json` must be **on `main`** first, or a
reviewer installing from your entry gets the defect above. Verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://raw.githubusercontent.com/calllint/calllint/main/plugins/calllint/.mcp.json
```

`200` means go. `404` means the fix has not landed yet — wait for it.

Detail: [github-copilot-plugin/SUBMISSION.md](github-copilot-plugin/SUBMISSION.md)

### The steps

Links, in the order you need them:

- Fork: <https://github.com/github/copilot-plugins/fork>
- The file you edit: `.github/plugin/marketplace.json` — **not** `.claude-plugin/marketplace.json`,
  which is a one-line pointer to it. Editing the pointer is the mistake to avoid.
- PR compare: <https://github.com/github/copilot-plugins/compare>
- Their process: `CONTRIBUTING.md` — fork, branch, change, PR. It asks you to keep the change
  as focused as possible, which one entry is.

```bash
gh repo fork github/copilot-plugins --clone --remote
cd copilot-plugins
git checkout -b add-calllint
# edit .github/plugin/marketplace.json — append the entry below to the "plugins" array
git commit -am "Add calllint plugin"
git push -u origin add-calllint
gh pr create --title "Add calllint plugin" --body-file pr-body.md
```

### The content to paste

Append to the `plugins` array. The shape is copied from the live `workiq` entry, so every
field here is one the repo already uses — nothing is invented:

```json
{
  "name": "calllint",
  "description": "Preflight risk linting for MCP & agent tools. Before you add or edit an agent-tool config, CallLint recommends scanning the blast radius — SAFE / REVIEW / BLOCK / UNKNOWN with evidence. Advisory and non-blocking; never executes the server it judges.",
  "version": "0.1.0",
  "author": { "name": "saintL", "url": "https://calllint.com" },
  "homepage": "https://calllint.com",
  "keywords": ["mcp", "security", "audit", "preflight", "agent-tools"],
  "license": "Apache-2.0",
  "repository": "https://github.com/calllint/calllint",
  "source": { "source": "github", "repo": "calllint/calllint", "path": "plugins/calllint" }
}
```

Two fields are worth checking rather than trusting: `version` must equal the `version` in
`plugins/calllint/.claude-plugin/plugin.json` (`0.1.0` today — this is the **plugin's**
version, not the npm package's), and `path` must be the directory holding `.claude-plugin/`,
not the `.claude-plugin/` directory itself.

### Expectation to hold, stated before you spend the effort

All 20 current entries are Microsoft or GitHub first-party. **Zero** third-party submissions
have been accepted, because none is visible. That is not evidence of rejection — it is
absence of evidence either way, and it means the acceptance odds for an outside contributor
are unknown, not high. The PR is worth opening because the deprecation makes it the eventual
only route, not because a precedent says it will merge. If it sits unreviewed, that is the
expected shape of the outcome and it becomes `PENDING_UPSTREAM`, exactly like Cline #49.

---

## #4 — `copilot-cli` → `mcp-registry-discovery` (P2, nothing to submit)

**Structurally there is no submission path**, so this is not a task with a form at the end.
The Official Registry's own `registry-aggregators.mdx` describes aggregators as downstream
consumers that scrape its read-only REST API roughly hourly; a publisher has no push route.
Our entry is already live there (verified above), and `github.com/mcp` has not picked it up
(also verified above) — which is the aggregator's schedule, not a missing action on our
side.

The open question is narrower than "should we submit": **does Copilot CLI consume the
Official MCP Registry?**

Partial answer, from the cached changelog: the CLI ships `/mcp registry` installation,
`/mcp search`, guided registry installs (1.0.25), registry lookups with retries and
timeouts, and one entry reading "`/mcp search` works correctly with **external
registries**". So it consumes *a* registry and at least one external one. **The changelog
never names an endpoint**, so whether `registry.modelcontextprotocol.io` is among them is
still unresolved. I attempted to check the Registry's aggregator doc for GitHub as a named
consumer and the network was down (`http=000` on every retry) — stating that rather than
leaving the gap silent.

Your step, once the CLI is installed for #3 anyway:

```
/mcp search calllint
```

A hit means the consumption question is answered and the channel can move. A miss is
ambiguous — could be the aggregator's schedule, could be a different registry — so record
the miss, not a conclusion.

---

## The rows that are not submissions at all

**#9 `kiro`** needs a discovery adapter and fixtures written. Engineering work that happens
to unlock a channel, deliberately unbuilt. Do not file it as a submission task.

**#7 `qwen-code`** — **the earlier claim here was wrong and is corrected.** It said this row
was "blocked on #1 landing upstream first." Two errors: #1 (the Claude Code marketplace) has
been published since 2026-07-20, so nothing was pending; and Qwen Code has no shelf to submit
to at all. Audited 2026-08-27: Qwen installs *from* other hosts' shelves and converts inbound
— `qwen extensions install <marketplace>:<plugin>` reads a Claude Code marketplace and
converts the manifest to `qwen-extension.json`, and `/extensions explore` browses the Gemini
and Claude galleries. So the channel is derivative of shelves we already publish, and there is
no act a human can perform on it. Now `BLOCKED` with that recorded. One command on a machine
with Qwen Code (`qwen extensions install calllint/calllint`) would turn it into an
evidence-backed availability claim; until someone runs it, reachability is inferred, and
ADR 0007 admits only observed acts.

**`windsurf`** — audited 2026-08-27, now `BLOCKED`: no public submission path is documented.
Installing from the marketplace, hand-editing `mcp_config.json`, and deep-linking an existing
listing are all documented; getting listed is not. The blue check is described as belonging to
the parent service company with no path to obtain one. Two side facts: the Windsurf docs now
307-redirect to `docs.devin.ai`, so this host ships as Devin Desktop, and enterprise teams may
point it at a custom registry that must follow the official MCP registry schema — which
CallLint is already published to, making the host reachable per-team by a mechanism that is
not a public listing.

---

## The one decision that is yours, not a step

**`openclaw` → ClawHub is one command away, and it costs a licence.** Audited 2026-08-27.
ClawHub hosts skills, code plugins, and bundle plugins — no MCP servers — but a skill is just
a folder carrying `SKILL.md`, and we already ship `skills/secure-agent-install/SKILL.md`. So
`clawhub skill publish skills/secure-agent-install --dry-run` and then the same without the
flag would list us, with no new artifact to build.

The cost: **publishing a skill to ClawHub releases it under `MIT-0`**, and this repository is
Apache-2.0. MIT-0 drops the attribution requirement and carries no patent grant, so the act
relicenses a shipped artifact on strictly weaker terms than the repo it came from. It also
needs `clawhub login` (browser OAuth, `--device`, or a `clh_` token), which is your account.

**DECIDED 2026-08-27: declined.** The owner will not relicense, and asked whether any other
route existed before settling it. There is none, and this was checked rather than assumed:
ClawHub's skill format documents no `license` field and states that it *"does not support
per-skill license overrides"*, with *"All skills published on ClawHub are licensed under
`MIT-0`"*. So the channel is closed on a term we decline, which is a finished answer, not a
queue — nobody upstream is reviewing anything and re-auditing reaches this same sentence.

One route stays deliberately unexplored rather than quietly dismissed: ClawHub also hosts
**code plugins**, licensed separately from skills, so an OpenClaw plugin built against their
SDK (`openclaw.compat.pluginApi`, `openclaw.build.openclawVersion`) might preserve Apache-2.0.
That is a new artifact and a new maintenance surface, not a submission, and it should be
decided on its own merits if it is ever wanted — adopting it as a workaround for a licence
term would be how a channel quietly becomes a product commitment.

How many channels exist in total, and how the shelf actions partition across
`BLOCKED` / `PENDING_UPSTREAM` / actionable, is counted from the SSOT in
[CHANNEL-COUNTS.md](CHANNEL-COUNTS.md). This file deliberately states no total: a
hand-typed count cannot fail when a channel is added, it just quietly under-reports the
work left.

---

## Recording any outcome

Same for all four. Edit **only** the SSOT; never hand-edit a projection.

```bash
# 1. edit apps/web/data/distribution-surfaces.json  (state, and liveUrl if it went live)
node scripts/generate-distribution-surfaces.mjs   # rewrites every projection
pnpm check:distribution-drift                     # must report N/N, none missing
pnpm check:harness-distribution                   # HD-05: blocker <=> BLOCKED
```

A channel with a recorded submission date is no longer actionable work no matter what its
`state` says — submitting again would duplicate. See
[ADR 0002](../adr/0002-submission-records-the-act.md).
