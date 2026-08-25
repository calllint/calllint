# What to do next, and why in that order

The actionable shelf channels, in priority order. ROI = (host reach × priority tier) ÷
(material gap + review latency). Ranking is a judgment call; the **material gap** column is
not — it is checked against the tree. How many rows there are is counted from the SSOT in
[`CHANNEL-COUNTS.md`](CHANNEL-COUNTS.md), not typed here.

Ordered 2026-08-23. Every row is a human action (new18 §22).

| # | Host | Channel | Tier | Material gap | Next step |
|---|---|---|---|---|---|
| 1 | `claude-code` | `claude-plugin` | P0 | **none** — `.claude-plugin/marketplace.json` now exists and passes `claude plugin validate . --strict` | [claude-plugin/](claude-plugin/SUBMISSION.md) |
| 2 | `cursor` | `cursor-plugin` | P0 | **none** — `.cursor-plugin/` manifests, `mcp.json`, logo and Cursor hook wiring all added and validated 2026-08-25 | [cursor-plugin/](cursor-plugin/SUBMISSION.md) |
| 3 | `copilot-cli` | `github-copilot-plugin` | P2 | `UNKNOWN` — see #3 below | [github-copilot-plugin/](github-copilot-plugin/SUBMISSION.md) |
| 4 | `copilot-cli` | `mcp-registry-discovery` | P2 | none — registry entry is live | verify-only; see below |
| 5 | `windsurf` | `windsurf-mcp-marketplace` | P1 | none | [windsurf-mcp-marketplace/](windsurf-mcp-marketplace/SUBMISSION.md) |
| 6 | `gemini-cli` | `gemini-extension-gallery` | P2 | a GitHub repo topic (auto-discovery) | [gemini-extension-gallery/](gemini-extension-gallery/SUBMISSION.md) |
| 7 | `qwen-code` | `qwen-extension-conversion` | P1 | converts an existing Claude/Gemini extension — depends on #1 landing | blocked on #1 |
| 8 | `openclaw` | `openclaw-clawhub` | P3 | none | [openclaw-clawhub/](openclaw-clawhub/SUBMISSION.md) |
| 9 | `kiro` | `kiro-workspace-config` | P2 | **a discovery adapter + fixtures — unbuilt by choice** | code, not a submission |

## Three rows that are not submissions

**#3 `github-copilot-plugin`** has no verified intake. Measured 2026-08-25: Copilot CLI does
have a real plugin system, and users add a marketplace themselves with
`copilot plugin marketplace add <owner>/<repo>` — the CLI reads `.github/plugin/marketplace.json`
*and also* `.claude-plugin/marketplace.json`, which this repo already ships, so that route
needs no submission at all. The other candidate, a PR to `github/copilot-plugins`, does carry
external entries (`source: {source:"github", repo, path}`), but its `CONTRIBUTING.md` is the
generic template with no intake process and its README still marks MCP servers *coming soon*.
Two candidate routes, neither confirmed as *the* intake: that is `UNKNOWN`, and writing a
plausible route here would be the evidence-free claim the verdict vocabulary forbids.

**#4 `mcp-registry-discovery`** is verify-only, and now for a measured structural reason, not
an assumption. The Official Registry's own `registry-aggregators.mdx` describes aggregators as
downstream consumers that **scrape** its read-only REST API (~hourly); there is no push path a
publisher could take. `io.github.calllint/calllint` 0.2.0 is live there (`status: "active"`,
`isLatest: true`, published 2026-07-13) and absent from github.com/mcp, whose 219-server
registry documents no submission route anywhere. Nothing to submit; the open question is
whether Copilot CLI *consumes* the Registry. That is a GET, so an agent may do it. A host
documenting stdio MCP support is not the same fact as that host consuming the Registry — which
is exactly why this sits at `AUDIT_REQUIRED` rather than `AVAILABLE`.

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
  read our PascalCase `hooks/hooks.json` and silently never fired. Details in
  [cursor-plugin/](cursor-plugin/SUBMISSION.md).
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
