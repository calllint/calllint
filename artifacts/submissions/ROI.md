# What to do next, and why in that order

Nine actionable shelf channels. ROI = (host reach × priority tier) ÷ (material gap + review
latency). Ranking is a judgment call; the **material gap** column is not — it is checked
against the tree.

Ordered 2026-08-23. Every row is a human action (new18 §22).

| # | Host | Channel | Tier | Material gap | Next step |
|---|---|---|---|---|---|
| 1 | `claude-code` | `claude-plugin` | P0 | **none** — `.claude-plugin/marketplace.json` now exists and passes `claude plugin validate . --strict` | [claude-plugin/](claude-plugin/SUBMISSION.md) |
| 2 | `cursor` | `cursor-plugin` | P0 | none — `server.json` + README + logo all present | [cursor-plugin/](cursor-plugin/SUBMISSION.md) |
| 3 | `copilot-cli` | `github-copilot-plugin` | P2 | none | [github-copilot-plugin/](github-copilot-plugin/SUBMISSION.md) |
| 4 | `copilot-cli` | `mcp-registry-discovery` | P2 | none — registry entry is live | verify-only; see below |
| 5 | `windsurf` | `windsurf-mcp-marketplace` | P1 | none | [windsurf-mcp-marketplace/](windsurf-mcp-marketplace/SUBMISSION.md) |
| 6 | `gemini-cli` | `gemini-extension-gallery` | P2 | a GitHub repo topic (auto-discovery) | [gemini-extension-gallery/](gemini-extension-gallery/SUBMISSION.md) |
| 7 | `qwen-code` | `qwen-extension-conversion` | P1 | converts an existing Claude/Gemini extension — depends on #1 landing | blocked on #1 |
| 8 | `openclaw` | `openclaw-clawhub` | P3 | none | [openclaw-clawhub/](openclaw-clawhub/SUBMISSION.md) |
| 9 | `kiro` | `kiro-workspace-config` | P2 | **a discovery adapter + fixtures — unbuilt by choice** | code, not a submission |

## Two rows that are not submissions

**#4 `mcp-registry-discovery`** is verify-only. Nothing is submitted: the registry entry is
already live, and the open question is whether Copilot CLI *consumes* the Official MCP
Registry. That is a GET, so an agent may do it. A host documenting stdio MCP support is not
the same fact as that host consuming the Registry — which is exactly why this sits at
`AUDIT_REQUIRED` rather than `AVAILABLE`.

**#9 `kiro`** needs a discovery adapter and fixtures written, not a form filled in. It is
engineering work that happens to unlock a channel, and it is deliberately unbuilt. Do not
file it as a submission task.

## What changed on 2026-08-23

Rank 1 was the only row with a missing artifact: the plugin was complete — hooks, a
secure-agent-install skill, three host guides — and had no shelf manifest, so nobody could
install it. `.claude-plugin/marketplace.json` now exists. The gap is closed; the submission
itself is still a human action and has not been made.

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

If that count is not 9, this file is stale — fix it here, and check whether
[BLOCKED.md](BLOCKED.md) needs the same edit.
