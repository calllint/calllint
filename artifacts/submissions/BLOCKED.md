# Do not attempt these

Five shelf channels must not be submitted to. Four carry a recorded blocker in the SSOT;
one has an open PR upstream. This file exists so the reason survives in version control
rather than being rediscovered by someone who tries anyway.

## `BLOCKED` — a recorded blocker makes it impossible or explicitly rejected

`BLOCKED` is **not a to-do**. It says nobody should queue work against this channel.

| Host | Channel | Recorded blocker |
|---|---|---|
| `workbuddy` | `tencent-mcp-market` | Third-party MCP submissions not currently accepted |
| `codebuddy` | `tencent-mcp-market` | Third-party MCP submissions not currently accepted |
| `codex` | `openai-plugin` | Do not create remote MCP just for public listing eligibility |
| `deepseek-harness` | `dsh-plugin` | The harness is in vendor-declared developer preview with breaking changes expected. Do not build a plugin against an unstable interface for listing eligibility alone. |

Two of these are external facts that could change — the Tencent shelves may open to
third-party submissions later. Two are **our own decisions**, and the distinction matters:
standing up a remote MCP server purely to become listable, or building against a preview
interface expected to break, are costs we declined. Re-verifying an upstream policy is
cheap; reversing a decision needs a reason, not a re-check.

## Why these four were previously mis-stated

Until 2026-08-23 these channels were recorded as `READY_NOT_SUBMITTED` / `AUDIT_REQUIRED`,
which the projections print as "Not yet submitted" / "Listing not yet verified" — both of
which read as *pending*. The blocker text was on the host pages, so a human reading the
whole row got the truth. But `state` is the field machines consume, and
`agent-discovery-index.json` did not carry `blocker` at all, so an agent saw "unverified"
with no way to learn "impossible".

`HD-05` in `scripts/check-harness-distribution.mjs` now enforces agreement in both
directions: a channel with a blocker must be `BLOCKED`, and a `BLOCKED` channel must record
a blocker. The second direction matters as much as the first — `BLOCKED` without a reason
is the same evidence-free claim pointed the other way.

## `PENDING_UPSTREAM` — already in flight, do not duplicate

| Host | Channel | Why not |
|---|---|---|
| `cline` | `cline-marketplace-pr` | [PR cline/marketplace#49](https://github.com/cline/marketplace/pull/49) is open (verified 2026-08-23). A second would be a duplicate. |

The PR URL lives in that record's `submissionUrl`, not `upstream`. The correct verification
is to check whether the existing PR moved — not to open another.

`roo-code`'s `mcp-stdio` channel is also `PENDING_UPSTREAM`, for an unrelated reason
recorded in its `auditNote`: the upstream repository reads `archived: true` with last push
2026-05-15 while roocode.com still serves, so product continuity is unresolved and no
distribution work is planned against it. It is not a shelf action and has no package here.

## Verifying this list is current

Derive it, don't trust the tables above. The reason lives in a different field depending on
the record, so print all three:

```bash
node -e '
const j = require("./apps/web/data/distribution-surfaces.json");
for (const h of j.hosts) for (const p of h.distributionPrimitives ?? [])
  if (p.blocker || p.state === "PENDING_UPSTREAM")
    console.log([
      h.id, p.kind, p.state,
      p.blocker ?? p.note ?? p.auditNote ?? "",
      p.submissionUrl ?? "",
    ].join(" | "));
'
```
