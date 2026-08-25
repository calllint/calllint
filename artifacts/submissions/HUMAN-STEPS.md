# The four channel actions — what only you can do

ROI #1–#4 in [ROI.md](ROI.md). Everything an agent is permitted to do has been done and is
recorded below with its result; what remains is listed as numbered steps for you.

> **#1 is already done** (2026-07-20, `5bed4b6`) — see its section. Of the four rows here,
> exactly **one** is an unmade submission you can make today: **#2 `cursor`**. #3 and #4 are
> a local install and a read-only query, both gated on a 357 MB CLI that is not on this
> machine.

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

## #2 — `cursor` → `cursor-plugin` (P0, now genuinely ready) — **the actual first action**

The material gap is closed and the "tested locally" checkbox is genuinely ticked, not
assumed. Cursor's intake is a **public repo reviewed by the Cursor team** — you submit a
URL, not a pasted manifest.

1. Go to https://cursor.com/marketplace/publish (the `/marketplace` URL is the browse page).
2. Submit the repo URL: `https://github.com/calllint/calllint`
3. That is the whole submission. Name, description, category, tags, license and homepage
   are read from `plugins/calllint/.cursor-plugin/plugin.json` — there are no form fields
   to fill from MATERIALS.md.
4. Expect a review, not an instant listing: "All plugins must be open source, and we review
   each update before publishing."
5. Record the outcome in the SSOT. If it goes live, set `liveUrl` **in the same edit** —
   presence and verification are separate facts.

Detail: [cursor-plugin/SUBMISSION.md](cursor-plugin/SUBMISSION.md)

---

## #3 — `copilot-cli` → `github-copilot-plugin` (P2, one command, then decide)

**Do not open a PR yet.** Two candidate intake routes exist and neither is confirmed as
*the* intake, so the channel is `UNKNOWN`. What did get resolved is the cost question: route
A needs **no second manifest**. Four entries in `github/copilot-cli`'s own `changelog.md`
establish that `.claude-plugin/plugin.json` is discovered, those plugins load their MCP and
LSP servers, hook files are accepted with PascalCase event names alongside camelCase, and
hooks receive `CLAUDE_PLUGIN_ROOT` — so the two things that made the Cursor edge real
engineering work do not apply here, and our existing `hooks/hooks.json` should be read
as-is.

Route A is a **local install with no submission at all**:

1. Install the CLI (this is the 357 MB fetch, which is why I could not run it).
2. Run, from the repo root:

   ```bash
   copilot plugin marketplace add calllint/calllint
   copilot plugin install ./plugins/calllint
   copilot plugin list
   ```

   Then `/plugin list` inside the CLI.

3. If that works, this channel needs **no submission ever** — it becomes `AVAILABLE` with
   the install command as its evidence. Record it in the SSOT.
4. If it fails, record what failed. Do **not** fall back to route B (a PR to
   `github/copilot-plugins`) without asking first: that repo's `CONTRIBUTING.md` is the
   generic GitHub template with no plugin intake process, and its README still marks MCP
   servers *(coming soon)*. A PR to a collection that has not said it accepts this kind of
   submission is a guess.

**Do not mark this `AVAILABLE` on the strength of the changelog.** Four vendor release
entries raise the prior that route A works; they are the vendor asserting its own behavior,
not the command running. The state moves on step 2's output.

Detail: [github-copilot-plugin/SUBMISSION.md](github-copilot-plugin/SUBMISSION.md)

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

## The two rows that are not submissions at all

**#9 `kiro`** needs a discovery adapter and fixtures written. Engineering work that happens
to unlock a channel, deliberately unbuilt. Do not file it as a submission task.

**#7 `qwen-code`** converts an existing Claude/Gemini extension, so it is blocked on #1
landing upstream first.

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
