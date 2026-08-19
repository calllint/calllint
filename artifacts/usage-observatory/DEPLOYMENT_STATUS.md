# Usage Observatory — Deployment Status

**Last updated**: 2026-08-19
**State**: backend NOT deployed; homepage surface WITHDRAWN (deliberate, not blocked)

It records the decision so the next person does not re-run the same investigation. Its
siblings in this directory are the U0-U6 build records; this file is the one that says
where the effort actually stopped and why.

---

## What actually landed

| Layer | State |
| --- | --- |
| CLI telemetry (consent, queue, transport, flush, `telemetry` commands) | Merged, shipped. Default-OFF. |
| Pages Functions source (`apps/web/public/functions/**`, `schema.sql`, admin dashboard) | Merged as source. Never executed in production. |
| D1 database `calllint-usage` | Created, schema applied, bound as `USAGE_DB` in the Pages project. Permanently empty. |
| Homepage "Adoption Signals" section | **Removed** (this cleanup). |

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

Do **not** rebuild the `calllint-www` Pages project and do **not** touch `deploy-web.yml`.
Deploy the ingress as a **separate Worker** with its own D1 binding, then point
`apps/cli/src/transport.ts` `DEFAULT_ENDPOINT` at it. The website deploy stays static and
untouched.

## Left in place on purpose

- CLI telemetry code — default-OFF, and the transport fails silently when the endpoint
  404s. Harmless.
- `apps/web/public/functions/**` — source only; landed by PR #316, unrelated to this
  cleanup.
- Tracked artifacts in this directory (`FINAL_REPORT.md`, `PROGRESS.md`,
  `homepage-adoption-preview.html`, …) — historical records of the U0-U6 PRs. They
  describe what was built at that time, and `homepage-adoption-preview.html` still shows
  the old 4-card preview. Read them as history, not as current site state.

## Privacy properties (implemented, unchanged)

Default-OFF · explicit opt-in · anonymous ID only · HMAC-SHA256 hashing · raw ID never
persisted · aggregate-only views · milestone-thresholded counts · 90-day retention.
