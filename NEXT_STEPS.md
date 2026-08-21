# Next Steps for Usage Observatory Deployment

> **SUPERSEDED — 2026-08-20. Do not follow the procedure this file used to contain.**
>
> It described deploying the usage backend as **Cloudflare Pages Functions** to a
> project named `calllint-usage-observatory`, and exposing a public
> `/v1/public/adoption-signals` endpoint for the homepage. All three premises are
> now false:
>
> - The Pages-Functions ingress it described was never routed and has been deleted.
>   `/v1/events/usage` was left out of the `_routes.json` include list, so it returned
>   the static 404 and D1 stayed empty. (An earlier version of this note blamed a
>   "static-only" project; that was measured false on 2026-08-20 — `POST
>   /v1/events/trust` returns 204, so Functions do run here. The endpoint was
>   unrouted, not unsupported.) Background:
>   [artifacts/usage-observatory/DEPLOYMENT_STATUS.md](artifacts/usage-observatory/DEPLOYMENT_STATUS.md).
> - `calllint-usage-observatory.pages.dev` was never created. Every URL in the old
>   file pointed at a host that does not exist.
> - Public adoption counters are **DEFERRED** by new18 §30 — no public counter, no
>   homepage number, no MAU. The old "Homepage Integration" section instructed the
>   opposite.
>
> The old file also told the reader to run `./scripts/deploy-usage-observatory.sh`,
> which was deleted the same day: every step targeted something that no longer
> exists, and its success check (`grep '"status":"ok"'`) could never match a Worker
> that answers `204` with no body.

## Where the work actually lives now

| Concern | Location |
| --- | --- |
| Telemetry ingress (a **Worker**, not Pages Functions) | [apps/usage-worker/](apps/usage-worker/) |
| Aggregate schema | [apps/usage-worker/migrations/](apps/usage-worker/migrations/) |
| Private operator report generator | [scripts/generate-usage-report.mjs](scripts/generate-usage-report.mjs) |
| Daily build (artifact only, never a deploy) | [.github/workflows/usage-report.yml](.github/workflows/usage-report.yml) |
| The one remaining operator action | [artifacts/authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md](artifacts/authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md) |

## Current state

Nothing is deployed. The Worker is unpublished and its `wrangler.toml` carries a
placeholder `database_id`. The report is built daily as a **workflow artifact** and
is deliberately not published anywhere — new18 §29 is fail-closed, because
Cloudflare Access cannot be programmatically verified from CI.

Run the report locally with `pnpm usage:report --out dist/usage`. Without Cloudflare
credentials the observed-usage rows render as em dashes, never as zeros: a zero is a
claim about the world, and an unread source cannot support one (§25).
