# Usage Observatory — Deployment Status

**Last updated**: 2026-08-20
**State**: SUPERSEDED as a plan; kept as the record of why the Pages-Functions
approach was abandoned. The work was resumed on 2026-08-20 along exactly the line
this file recommended — a separate Worker — see
[artifacts/authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md](../authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md)
and [apps/usage-worker/](../../apps/usage-worker/).

It records the decision so the next person does not re-run the same investigation. Its
siblings in this directory are the U0-U6 build records; this file is the one that says
where the effort actually stopped and why.

---

## What actually landed

| Layer | State |
| --- | --- |
| CLI telemetry (consent, queue, transport, flush, `telemetry` commands) | Merged, shipped. Default-OFF. |
| Pages Functions source (`apps/web/public/functions/**`, `schema.sql`, admin dashboard) | **Deleted** 2026-08-20. Was never executed in production; superseded by `apps/usage-worker/`. |
| D1 database `calllint-usage` | Created, schema applied, bound as `USAGE_DB` in the Pages project. Empty. The Worker's own migrations in `apps/usage-worker/migrations/` are now the schema of record. |
| Homepage "Adoption Signals" section | **Removed** (this cleanup). Public usage is DEFERRED by new18 §30. |
| Private operator report | Built daily as a **workflow artifact only** (new18 §29 fail-closed). Not deployed. |

## Why the backend is not deployed

The Cloudflare Pages project `calllint-www` was created as a **pure static site**.
Static-mode Pages projects do not support Pages Functions at all: every Function route
is served the static `apps/web/public/404.html` instead of executing. That 404 page
contains example JSON (`"code":"not_found"`), which is why the failure looked like an API
error rather than a missing runtime.

Confirmed by deploying a zero-dependency `/health` Function — it also returned the static
404. The D1 binding and `_routes.json` being present made no difference; neither is read
in static mode.

Four hypotheses were tried and were all wrong: `wrangler.toml` location, `_routes.json`
contents, wrangler `name` mismatch, `pages_build_output_dir`. None of them was the cause.
`wrangler pages deploy` also does not apply `wrangler.toml` bindings — Pages bindings come
from the Dashboard or CLI flags.

## Why the surface was withdrawn rather than fixed

The homepage was the tail of the chain, not the load-bearing part. The load-bearing part
is the `/v1/events/usage` **ingress** Function. With no Functions there is no ingress, so
D1 stays empty no matter what the homepage renders. A permanent "Adoption metrics coming
soon" placeholder also conflicts with the project's own honesty principles (§ product
principle: evidence is mandatory; UNKNOWN is not SAFE).

Additionally, "adoption signals" is semantically *third-party* data. For self-only usage
it degrades to a local counter, which needs none of the D1 / HMAC / milestone-threshold
architecture.

## If this is resumed later

**This was resumed on 2026-08-20 and the advice below was followed as written.** It is
kept in the imperative because it is still the correct instruction for anyone tempted to
undo it.

Do **not** rebuild the `calllint-www` Pages project and do **not** touch `deploy-web.yml`.
Deploy the ingress as a **separate Worker** with its own D1 binding, then point
`apps/cli/src/transport.ts` `DEFAULT_ENDPOINT` at it. The website deploy stays static and
untouched.

What now exists: [apps/usage-worker/](../../apps/usage-worker/) is that Worker, and
`DEFAULT_ENDPOINT` points at `https://telemetry.calllint.com/v1/events/usage`. Neither is
deployed yet — the Worker is unpublished and its `wrangler.toml` still carries a
placeholder `database_id`.

## Left in place on purpose

- CLI telemetry code — default-OFF, and the transport fails silently when the endpoint
  404s. Harmless.
- Tracked artifacts in this directory (`FINAL_REPORT.md`, `PROGRESS.md`,
  `homepage-adoption-preview.html`, …) — historical records of the U0-U6 PRs. They
  describe what was built at that time, and `homepage-adoption-preview.html` still shows
  the old 4-card preview. Read them as history, not as current site state.

## Removed since

- `apps/web/public/functions/**` and the duplicate root `functions/**` — deleted
  2026-08-20. They were source-only, never executed, and describing a Pages-Functions
  ingress that the project had already abandoned made them actively misleading.
- `scripts/deploy-usage-observatory.sh` — deleted 2026-08-20. Every step targeted
  something that no longer exists: the deleted `functions/schema.sql`, a Pages project
  never created, the `/v1/public/adoption-signals` endpoint (DEFERRED by §30), a
  `"status":"ok"` body the Worker never returns (it answers 204 with no body), and a
  `batchId` of `test-deployment-<epoch>` that the ingress validator rejects for not being
  a 64-hex digest. It would have reported failure against a correct deployment.

## Privacy properties (implemented, unchanged)

Default-OFF · explicit opt-in · anonymous ID only · HMAC-SHA256 hashing · raw ID never
persisted · aggregate-only views · milestone-thresholded counts · 90-day retention.
