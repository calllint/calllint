# What to do next, and why in that order

The actionable shelf channels, in priority order. ROI = (host reach × priority tier) ÷
(material gap + review latency). Ranking is a judgment call; the **material gap** column is
not — it is checked against the tree. How many rows there are is counted from the SSOT in
[`CHANNEL-COUNTS.md`](CHANNEL-COUNTS.md), not typed here.

Ordered 2026-08-23. Every row is a human action (new18 §87). The numbered steps for the
first four, with every agent-safe pre-flight already run and its result recorded, are in
[`HUMAN-STEPS.md`](HUMAN-STEPS.md).

| # | Host | Channel | Tier | Material gap | Next step |
|---|---|---|---|---|---|
| 1 | `claude-code` | `claude-plugin` | P0 | **none, and the act is already made** — published 2026-07-20 (`5bed4b6`), `README.md:289-290`. Not actionable; see below | [claude-plugin/](claude-plugin/SUBMISSION.md) |
| 2 | `cursor` | `cursor-plugin` | P0 | **none, and the act is already made** — manifests validated 2026-08-25, submitted at `/marketplace/publish` and awaiting review. Not actionable; see below | [cursor-plugin/](cursor-plugin/SUBMISSION.md) |
| 3 | `copilot-cli` | `github-copilot-plugin` | P2 | **Already made 2026-08-27 — do not redo.** Submitted as [github/copilot-plugins#80](https://github.com/github/copilot-plugins/pull/80); awaiting upstream review | [github-copilot-plugin/](github-copilot-plugin/SUBMISSION.md) |
| 4 | `copilot-cli` | `mcp-registry-discovery` | P2 | none — registry entry is live | verify-only; see below |
| 5 | `windsurf` | `windsurf-mcp-marketplace` | P1 | none | [windsurf-mcp-marketplace/](windsurf-mcp-marketplace/SUBMISSION.md) |
| 6 | `gemini-cli` | `gemini-extension-gallery` | P2 | a GitHub repo topic (auto-discovery) | [gemini-extension-gallery/](gemini-extension-gallery/SUBMISSION.md) |
| 7 | `qwen-code` | `qwen-extension-conversion` | P1 | converts an existing Claude/Gemini extension — depends on #1 landing | blocked on #1 |
| 8 | `openclaw` | `openclaw-clawhub` | P3 | none | [openclaw-clawhub/](openclaw-clawhub/SUBMISSION.md) |
| 9 | `kiro` | `kiro-workspace-config` | P2 | **a discovery adapter + fixtures — unbuilt by choice** | code, not a submission |

## Four rows that are not submissions

**#1 `claude-plugin`** was listed as rank 1 with a "none" material gap, which read as *ready
to submit*. The submission was already made on **2026-07-20** in `5bed4b6` (#189): the two
install lines are live at `README.md:289-290`, and the SSOT carries
`submission.date: 2026-07-20`. `CHANNEL-COUNTS.md`, generated from the same SSOT, files it
under *submitted, listing not yet verified* and excludes it from the actionable 8 — so this
hand-maintained table disagreed with the generated projection and pointed a human at a
completed external action. Per [ADR 0002](../adr/0002-submission-records-the-act.md) a
recorded submission date ends actionability regardless of `state`. It stays `AUDIT_REQUIRED`
because there is no shelf page to record as `liveUrl` — ADR 0002's accepted arm is
structurally unreachable here, and a README anchor would be self-endorsement.

**#2 `cursor-plugin`** was submitted and is **awaiting Cursor's review**. This row said "**The
first unmade action**" for one day, and it was wrong on the day it was written: the maintainer
had already submitted the repo URL at `cursor.com/marketplace/publish`. Reported 2026-08-26 and
recorded in the SSOT as `submission.date: 2026-08-25` at `state: PENDING_UPSTREAM`, so ADR 0002
ends its actionability. Two things about this record are weaker than `cline`'s and are stated
rather than smoothed over: the date is a **lower bound** — the day `65eb719` landed the manifests
Cursor reads, hence the earliest the act could have succeeded, not an observed timestamp — and
there is **no `submissionUrl`**, because Cursor's intake is a private form review rather than a
PR, so no artifact of the act exists anywhere in or outside this repo. The schema permits that
asymmetry deliberately: arm 3 forces a date wherever a URL appears, and does **not** assert the
converse. What is still owed is the listing: when review completes, `liveUrl` and `AVAILABLE` go
in one edit.

**#3 `github-copilot-plugin`** has no verified intake. Measured 2026-08-25: Copilot CLI does
have a real plugin system, and users add a marketplace themselves with
`copilot plugin marketplace add <owner>/<repo>` — the CLI reads `.github/plugin/marketplace.json`
*and also* `.claude-plugin/marketplace.json`, which this repo already ships, so that route
needs no submission at all. The other candidate, a PR to `github/copilot-plugins`, does carry
external entries (`source: {source:"github", repo, path}`), but its `CONTRIBUTING.md` is the
generic template with no intake process and its README still marks MCP servers *coming soon*.
Two candidate routes, neither confirmed as *the* intake: that is `UNKNOWN`, and writing a
plausible route here would be the evidence-free claim the verdict vocabulary forbids.

What *did* resolve is the cost question. The open caveat was that Copilot's own bundled
plugins keep `plugin.json` at the **plugin root** while ours is under `.claude-plugin/` —
possibly a second manifest to write. The CLI's own `changelog.md` settles it: `.claude-plugin/
plugin.json` is discovered (1.0.6), `.claude-plugin/` plugins load their MCP and LSP servers
(1.0.9), hook files are accepted with **PascalCase event names alongside camelCase** (1.0.6),
and hooks receive **`CLAUDE_PLUGIN_ROOT`** — the exact two things Cursor does *neither* of,
which is why Cursor needed a second hooks file and a second script and Copilot needs neither.
Candidate A therefore costs nothing to try. It stays `UNKNOWN` because a vendor changelog is
the vendor asserting its own behavior, not the command running, and `copilot` is not installed
here.

**#4 `mcp-registry-discovery`** is verify-only, and now for a measured structural reason, not
an assumption. The Official Registry's own `registry-aggregators.mdx` describes aggregators as
downstream consumers that **scrape** its read-only REST API (~hourly); there is no push path a
publisher could take. `io.github.calllint/calllint` 0.2.0 is live there (`status: "active"`,
`isLatest: true`, published 2026-07-13) and absent from github.com/mcp, whose 219-server
registry documents no submission route anywhere. Nothing to submit; the open question is
whether Copilot CLI *consumes* the Registry. That is a GET, so an agent may do it. A host
documenting stdio MCP support is not the same fact as that host consuming the Registry — which
is exactly why this sits at `AUDIT_REQUIRED` rather than `AVAILABLE`.

Re-measured 2026-08-25: both halves still hold — the Registry entry is live (0.2.0,
`isLatest: true`) and `github.com/mcp` still returns zero `calllint` rows. The consumption
question got a **partial** answer from the CLI's cached changelog: it ships `/mcp registry`
installation, `/mcp search`, guided registry installs (1.0.25), registry lookups with
retries, and one entry naming "**external registries**" — so it consumes *a* registry and at
least one external one, but the changelog never names an endpoint, so whether
`registry.modelcontextprotocol.io` is among them is unresolved. The Registry-side check for
GitHub as a named aggregator could not be completed: the network returned `http=000` on every
retry. Recorded as an incomplete measurement rather than left silent.

**#9 `kiro`** needs a discovery adapter and fixtures written, not a form filled in. It is
engineering work that happens to unlock a channel, and it is deliberately unbuilt. Do not
file it as a submission task.

## What changed on 2026-08-23

Rank 1 was the only row with a missing artifact: the plugin was complete — hooks, a
secure-agent-install skill, three host guides — and had no shelf manifest, so nobody could
install it. `.claude-plugin/marketplace.json` now exists. The gap is closed; the submission
itself is still a human action and has not been made.

## What changed on 2026-08-25

Two **material gap** cells were wrong, and this is the column the header promises is checked
against the tree rather than judged. Both were corrected by reading the vendor's current
intake requirements and then measuring this repo against them:

- **#2 `cursor`** said "none". Cursor's published requirements call for a plugin directory
  carrying `.cursor-plugin/plugin.json` plus an `mcp.json` at the plugin root with a top-level
  `mcpServers` map, registered in a repo-root `.cursor-plugin/marketplace.json`. This repo had
  none of it — only the Claude layout, `plugins/calllint/.claude-plugin/plugin.json`, and no
  `mcp.json` anywhere in `plugins/`. The `server.json` + README + logo the old cell counted are
  real, but they are not what Cursor reads. `cursor.com/marketplace` is a browse page; intake is
  `cursor.com/marketplace/publish`, a public-repo review ("All plugins must be open source, and
  we review each update before publishing"). **All six files were then built and the tree now
  passes Cursor's own validator**, so the cell reads "none" again — this time measured. One
  non-file defect surfaced while doing it: Cursor's hook events are lowerCamel, so it would have
  read our PascalCase `hooks/hooks.json` and silently never fired. The plugin was then
  **installed and run locally** through `~/.cursor/plugins/local/` (Cursor 3.15.19 is on the
  dev machine, so this was not the user-only step this file used to call it): every manifest
  path resolves through the link, and the hook runs from Cursor's cwd with its relative command
  and exits 0. Details in [cursor-plugin/](cursor-plugin/SUBMISSION.md).
- **#3 `copilot-cli`** said "none", which read as *ready to submit*. There is no verified
  intake to submit to — see the row note above.

Neither correction is a new task: #3 becomes a verify step like #4. #2 *was* engineering work
like #9 — that work is now done, so #2 is a submission again, and the only actionable one at
P0 alongside #1. What changed is that the table no longer claims a readiness the tree does not
support.

## Re-deriving this list

The rows come from the SSOT. Regenerate rather than trusting the table:

```bash
node -e '
const j = require("./apps/web/data/distribution-surfaces.json");
const rows = [];
for (const h of j.hosts) for (const p of h.distributionPrimitives ?? [])
  if (p.kind !== "mcp-stdio" && p.state !== "AVAILABLE" && !p.blocker && p.state !== "PENDING_UPSTREAM")
    rows.push(`${h.priority}  ${h.id}  ${p.kind}  ${p.state}`);
console.log(rows.sort().join("\n"));
console.log(`--- ${rows.length} actionable`);
'
```

Compare that count against the `actionable` row in
[`CHANNEL-COUNTS.md`](CHANNEL-COUNTS.md) — which the generator writes from the same SSOT, so
the two can only disagree if this snippet has drifted from the generator's partition. If the
rows below do not match what it prints, this table is stale: fix it here, and check whether
[BLOCKED.md](BLOCKED.md) needs the same edit.
