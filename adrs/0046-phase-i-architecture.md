# ADR 0046: Phase I Architecture — Git-Store, Actions-Ingestion, Same-Origin CDN Serving

**Status**: Accepted
**Date**: 2026-07-16
**Phase**: I (Public Trust Index & Partner, → v1.6.0) — Milestone I0 (freezes the *mechanism* before any Phase-I code)
**Supersedes**: none
**Related**: [0038 Public Trust Index Boundaries](./0038-public-trust-index-boundaries.md), [0037 Host Adapter Safety Contract](./0037-host-adapter-safety-contract.md), [0035 Automated Trust Gateway & Authority Manifest](./0035-automated-trust-gateway-authority-manifest.md), [0034 Evidence Provider Envelope](./0034-evidence-provider-envelope.md), [0047 Maintainer-Claim Trust Model](./0047-maintainer-claim-trust-model.md)
**Drives**: `docs/phase-i-design.md` §0–§5, `new8-execution-roadmap.md` I1/I2

## Context

ADR 0038 froze the **boundaries** of the Public Trust Index (Registry-as-input,
"observed at digest" language, pages-never-scan, no private evidence, small +
kill-gated). It deliberately did **not** pick the mechanism. Phase I cannot begin
code until the mechanism is equally locked, because the single invariant that
makes the public surface safe — **serving is decoupled from scanning** (ADR 0038
§3) — is an *architecture* property: it holds or fails based on what is deployed
where, not on discipline.

Four forks were open. The user chose them on 2026-07-16, and they compose into
one coherent shape. This ADR freezes that shape so no Phase-I implementation can
quietly re-couple serving to scanning, add infrastructure the kill gate does not
justify, or cross a boundary ADR 0038 drew.

The gate to *start* Phase I is met: Phase G shipped, and there are **3 Tier-A
hosts** (Claude Code + Cursor + Windsurf, v1.5.1).

## Decision

### 1. Two planes, two deployables — the decoupling invariant made structural

Phase I is exactly two planes, and they **must not share a deployable that can
trigger a scan from a request** (ADR 0038 §3):

- **Ingestion plane** (offline, batch, write) — the *only* thing that ever scans.
- **Serving plane** (online, read-only, CDN) — serves pre-computed artifacts; has
  **no scanner in its deployable**.

The decisions below are chosen specifically so this invariant is *structural*
(enforced by where code runs) rather than *disciplinary* (enforced by reviewers
remembering it).

### 2. Store = the Git repository (snapshots start in Git, escalate to R2 only on overflow)

Baked Trust Pages are small, digest-addressed static artifacts (HTML + a JSON
sidecar). They are **committed to the repository** and served as static files.
Raw snapshots (ADR 0038 §1 retention) also start in Git — at the fixtures /
100–1,000-resource scale they are small — and move to an object store (**R2**)
**only if** they outgrow Git.

Rationale: zero new infrastructure for I1, native reproducibility (a committed
page *is* the audit trail; a re-bake that changes bytes shows up as a diff), and
free. This is why the reproducibility criterion (ADR 0038 §5) becomes a CI
assertion rather than a runtime promise (§4 below).

### 3. Ingestion = a scheduled GitHub Actions workflow that bakes and commits

The ingestion pipeline (Registry cursor → raw snapshot → validate → canonical
identity → resolve → digest → **scan** → evidence → Authority Manifest → baked
page) runs as a **scheduled GitHub Actions workflow**. It is the **sole scanner**
in Phase I. Its output is a commit of baked pages + snapshots.

This makes §1 structural: Actions is the only place a scan runs; the serving
plane (§4) only ever reads committed files; the two **cannot** share a deployable
because one is a CI job and the other is a CDN. A Cloudflare Cron Trigger is the
escalation path only if volume outgrows Actions — not an I1 dependency.

### 4. Serving = the existing Cloudflare Pages project; reproducibility enforced in CI

The committed static pages are served by the **existing CF Pages project**
(`calllint-www`). Serving is read-only cache; it runs no resolution, fetch, scan,
or evidence collection (ADR 0038 §3). Because pages are committed artifacts,
**reproducibility is a CI gate**: re-baking a given artifact digest with the same
engine version must produce **byte-identical** committed output, asserted in CI
(the analogue of `buildDecisionReceipt` determinism). A drift means the diff
fails the build.

### 5. Domain = same origin (`calllint.com/trust/…` + `calllint.com/v1/public/…`)

Trust pages live at `calllint.com/trust/…`; the Partner API (I2) lives at
`calllint.com/v1/public/…` on the **same origin**. This is the simplest CORS and
cache posture — one certificate, one zone, no cross-origin preflight for
first-party embeds.

Enabling this requires the `calllint.com` zone to be **in Cloudflare** — today it
is not (standing blocker, see the domain-state memory). Resolving it is a **manual
DNS/registrar step only the user can perform** (Cloudflare Free plan: change
nameservers; $0). It is **not** required for I0 or I1a, and I1b can first ship
pages under the existing `calllint-www` domain and migrate the apex afterward. So
the blocker does not block the build order.

### 6. Cost posture: Phase I fits the free tier by construction

At the ADR-level scope cap (ADR 0038 §6: 100–1,000 pages, 10,000 hard ceiling),
the chosen shape stays within Cloudflare's permanent free tiers: Pages (static,
free bandwidth), Workers for the I2 API (100,000 req/day free), R2 (10 GB free,
free egress) only if snapshots overflow Git, KV/D1 avoided where the index can be
baked as static JSON. Workers Paid ($5/mo) is triggered only by exceeding free
limits, which the kill gate is designed to prevent. **Phase I's expected
infrastructure cost is $0/month;** the cost is engineering time. This is recorded
so a future contributor does not reach for paid infra the scope does not need.

## Non-negotiables locked by this ADR

- Ingestion (the sole scanner) and serving are **separate deployables** — a CI
  workflow and a CDN — never a shared one (ADR 0038 §3 made structural).
- Baked pages + snapshots are **committed to Git**; R2 is an overflow escalation,
  not an I1 dependency.
- Reproducibility is a **CI gate**: same digest + same engine ⇒ byte-identical
  committed page.
- Serving is read-only cache with **no scanner in the deployable** and no scan
  side-effect on any request.
- Same-origin surface; the domain migration is a deferrable manual user step, not
  a build-order blocker.
- No new verdict vocabulary and no second scan engine — ingestion is
  *orchestration* around the shipped resolver/evidence/authority engines (same
  rule as Phase F/G/H).

## Consequences

### Positive
- The safety-critical decoupling invariant is enforced by topology (CI vs CDN),
  not by review vigilance — the strongest possible form.
- I1 (a + b) introduces **essentially no new infrastructure**; it can proceed on
  the repo + current Pages setup alone. Workers/KV/R2 enter only at I2 or on
  snapshot overflow.
- Reproducibility becomes a mechanically-checkable diff, not a runtime claim.
- Predictable $0/month cost at the gated scope.

### Negative
- Ingestion latency is coupled to a CI schedule (minutes-to-hours), not real time.
  This is acceptable and even desirable: the Index is a curated, slow-moving
  evidence set, not a live scanner, and slowness reinforces "observed at digest T,"
  never "live status."
- Git as a store has a natural size ceiling; the R2 escalation path (§2) exists for
  exactly that, and the kill gate caps growth well before it bites.

### Trade-offs
- Chose **commit-to-Git static serving** over a database-backed dynamic service:
  reproducibility + zero infra + free, at the cost of real-time freshness the Index
  explicitly does not want.
- Chose **GitHub Actions** over a bespoke ingestion service: the decoupling
  invariant for free, at the cost of eventually migrating to CF Cron if volume
  grows (a good problem, gated away for now).

## Compliance / gate impact

Phase I acceptance (ADR 0038 §Compliance) is now additionally bound to this ADR:
ingestion and serving are separate deployables; pages are committed and
reproducibility-gated in CI; the API deployable contains no scanner. Any change to
the store (Git → R2 for pages), the ingestion host (Actions → CF Cron as the
*only* scanner), or the same-origin surface requires a new ADR. The no-"certified"
copy guard (ADR 0038 §2) extends to generated pages via the existing
`check-public-copy.mjs` machinery.

## Invariants preserved

`serving ⊥ scanning` (now structural: CI-only scanner, CDN-only serving) ·
pages/API never trigger a scan (ADR 0038 §3) · Registry is input, snapshots
retained in-repo (ADR 0038 §1) · "observed at digest" only, enforced by copy guard
on generated pages (ADR 0038 §2) · reproducible (ADR 0038 §5) now a CI diff gate ·
Index small + kill-gated (ADR 0038 §6) · no second verdict vocabulary · no scan
engine in the serving deployable.
