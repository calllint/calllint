# ADR 0054 — Claim Auto-Adoption: dropping the human merge safely

- Status: Proposed
- Date: 2026-07-23
- Refines: 0047 (maintainer-claim trust model — a claim states control, never safety),
  0048 (I2c claim mechanism — GitHub App install IS the control grant),
  0053 (distribution-index boundary — §1 human-gated publication, §4 publish channels)
- Related: 0038 (Trust Page language boundary), 0046 (Phase I — serving decoupled
  from scanning), 0050 (evidence-refined verdict — UNKNOWN→REVIEW, never SAFE)

## Context

The question this ADR settles (verbatim intent): *"Do we need the human merge? Can the
system auto-scan and auto-adopt, so the maintainer only has to claim?"*

Two facts frame the answer honestly, both verified in the current tree
(`main`, 2026-07-23):

1. **From the maintainer's side, "only claim" is already true.** A maintainer's entire
   action is installing the CallLint Trust GitHub App on the account that controls the
   namespace ([app-manifest.json](../packages/trust-index/github-app/app-manifest.json),
   `metadata:read` only). The human merge is NOT a maintainer step — it is a
   **CallLint-side** review of the auto-generated PR
   ([trust-verify-claims.yml:62-83](../.github/workflows/trust-verify-claims.yml#L62-L83)),
   which the maintainer never sees. So dropping it does not reduce maintainer effort; it
   reduces **latency** (up to one daily cron + review turnaround) and removes a
   **CallLint-side manual step** that does not scale to many claims.

2. **The human merge is currently the only gate before production.** The verify job is
   structurally deploy-incapable — least privilege `contents: write` + `pull-requests:
   write`, **no Cloudflare secrets**
   ([trust-verify-claims.yml:22-26](../.github/workflows/trust-verify-claims.yml#L22-L26))
   — it reconciles the claim store, re-bakes, runs `check:public-copy`, and opens a PR.
   Deployment happens **only** in `deploy-web.yml`, which triggers on `push` to `main`
   touching `apps/web/**`
   ([deploy-web.yml:16-21](../.github/workflows/deploy-web.yml#L16-L21)) and — critically —
   does **not** `needs:` the `build-and-test` gate. Today the human clicking "merge" is
   what runs the reproducibility + copy guards against the change before those bytes ship.

So "auto-adopt" is not `create-pull-request` → `git push`. It is a **policy change about
where the human sits**, and it is only safe if the guards the human currently enforces by
reading the diff are made **mandatory in CI**. This ADR records that policy so the change
can be decided deliberately, exactly as ADR 0051/0052/0053 settled a boundary before its
PR. It changes **no behavior**; it is a decision artifact.

### What a claim can and cannot do (blast-radius audit)

Auto-adoption is defensible because a claim's blast radius is small **by construction**,
verified in code:

- **A claim never alters a verdict** (ADR 0053 §3). `verifiedPublisher` is an overlay that
  is *not* part of `pageDigest` ([renderPage.ts](../packages/trust-index/src/renderPage.ts)
  `renderSidecar`); a claimed and an unclaimed page at the same artifact digest carry the
  **same verdict**. A bad claim cannot dye a dangerous tool SAFE, suppress a finding, or
  remove a page.
- **Claims are machine-derived, not asserted.** `reconcileClaims` mints a record only when
  the live GitHub App installation view proves the installer controls the repo the
  registry entry points at ([reconcileClaims.ts](../packages/trust-index/src/reconcileClaims.ts)).
  Forging a claim means forging GitHub's installation view under App-JWT auth — outside the
  PR-diff threat model.
- **Fails closed.** `verifiedPublisherFor` surfaces a publisher only when exactly one
  active record matches ([claim.ts](../packages/trust-index/src/claim.js)); ambiguity ⇒
  no flag.
- **Self-healing revocation.** Uninstall ⇒ dropped from the App listing ⇒ next run flips
  the record to `revoked` ⇒ re-bake removes the flag
  ([trust-verify-claims.yml:10-12](../.github/workflows/trust-verify-claims.yml#L10-L12)).
- **The deterministic guard already runs before the PR opens.** `check:public-copy`
  executes in the verify job ([trust-verify-claims.yml:59-60](../.github/workflows/trust-verify-claims.yml#L59-L60)),
  not only at merge.

The human merge therefore is **not** a load-bearing safety control for the claim itself.
What it still catches is narrower: **(a)** a poisoned/incorrect registry *snapshot* would
auto-produce wrong public attribution, and **(b)** an auditable "when did CallLint start
attributing X to A" record. Those are real, but they belong to the **snapshot ingestion**
input, not the claim overlay.

## Decision

Adopt **claim auto-adoption** — the `trust-verify-claims` claim-refresh PR MAY merge
without a human — **only** when all four guardrails below hold. Absent any one, the human
merge stays. This is the `AUTO_PUBLISH` channel of ADR 0053 §4 applied to the claim
overlay; it does not widen what may auto-publish, it automates the merge of a change that
already qualifies.

### 1. The deterministic CI gate becomes a REQUIRED status check (the load-bearing prerequisite)

Because `deploy-web.yml` deploys on push to `main` **without** `needs: build-and-test`,
auto-merge is safe only if branch protection on `main` makes the reproducibility gate
(`committed-tree` byte-diff) **and** `check:public-copy` **required status checks**. Then a
claim-refresh that fails to re-bake byte-identically, leaks a forbidden phrase or PII, or
breaks the claim-funnel state **cannot merge** — the machine enforces exactly what the
human reads for today. Without this, auto-merge means deploying unreviewed bytes with the
gate bypassed. **This guardrail is non-negotiable and must land before auto-merge is
enabled.**

### 2. Auto-adoption is scoped to the claim overlay only — never a new negative page

The claim job re-bakes from the **committed** snapshot + evidence
([bake.ts](../packages/trust-index/src/bake.ts) reads committed inputs), so a
claim-refresh only ever adds/removes a `verifiedPublisher` overlay. It MUST NOT be the path
that introduces a *new negative* conclusion (first BLOCK / high-sev REVIEW) — that remains
`REVIEW_HOLD` (ADR 0053 §4), human-gated. If a claim-refresh diff ever contains a verdict
or page-digest change (not just an overlay), auto-merge MUST abort and fall back to human
review. A cheap enforcement: assert the PR diff touches only `verifiedPublisher`/overlay
fields and `sitemap`/`.html` overlay bytes, never a `pageDigest` or `verdict` in any
sidecar.

### 3. Human review moves to snapshot ingestion — the actual untrusted input

Removing the claim-merge human makes the **registry snapshot the sole human-reviewed trust
input**. `trust-ingest.yml` (snapshot refresh) therefore **stays human-gated** and is the
correct place for human eyes: the Official MCP Registry is external, untrusted input
(ADR 0038 §5), and a poisoned entry is the realistic way wrong public attribution enters.
This ADR does **not** auto-adopt snapshot ingestion. Auto-adoption applies to claims
(machine-derived, fail-closed) — not to untrusted external data.

### 4. Auditability is preserved without the human

The merge commit is today's "when did attribution change" record. Under auto-merge, the
same audit trail MUST be preserved by the automation: the squash-merge commit + the
`claim-store.json` history (each record carries `verifiedAt`) remain the auditable ledger,
and the workflow keeps opening a titled, labelled PR (merged automatically) rather than
pushing directly to `main` — so the change is always a reviewable, revertible PR object,
never an opaque direct push.

## Consequences

- **Positive**: claim latency drops from "up to a day + review" to "next scheduled run";
  the CallLint-side manual step is removed, so the claim path scales to many maintainers.
  A maintainer's experience is unchanged (they already only install the App).
- **The safety floor is machine-enforced, not weakened.** Guardrail 1 converts the human's
  diff-read into required CI checks; guardrails 2–4 keep verdict-moving changes, untrusted
  snapshot data, and audit gaps out of the auto path. Net: the same invariants ADR 0053 §1
  lists (human-gated *negative* publication, UNKNOWN↛SAFE, claim↛verdict) still hold.
- **Cost / risk retained**: auto-adoption trades the human's judgement on *attribution
  correctness* for the App-install proof + fail-closed reconcile. If GitHub's installation
  view is ever wrong (not forged — simply stale/incorrect), a wrong attribution would ship
  without a human catching it until the next reconcile or a filed correction
  ([CORRECTION_URL](../packages/trust-index/src/renderPage.ts)). This is the residual risk
  the decision accepts in exchange for latency + scale.
- **Reversible**: auto-merge is a branch-protection + workflow setting, not a code
  rewrite. If wrong attributions appear, disable auto-merge and the human gate returns with
  no code change.

## Options considered

| Option | Latency | Human sits at | Residual risk | Verdict |
|---|---|---|---|---|
| **A. Status quo** — human merges the claim PR | up to 1 day + review | every claim change | lowest | safe, does not scale |
| **B. Auto-adopt claims (this ADR)** — auto-merge with guardrails 1–4 | next run | snapshot ingestion only | wrong attribution ships if GitHub view is stale | **recommended, conditional on guardrail 1** |
| **C. Write claims straight to `main`** — no PR object | next run | nowhere | no audit object, gate bypassable | **rejected** (violates §4, and deploy has no `needs:` gate) |

Option C is rejected explicitly: with `deploy-web.yml` lacking `needs: build-and-test`, a
direct push to `main` would deploy claim bytes with **no** gate and **no** reviewable
object — the opposite of the trust posture.

## Invariants preserved

A claim states control, never safety, and never alters a verdict (ADR 0053 §3) · UNKNOWN
never becomes SAFE (ADR 0050) · new *negative* pages stay `REVIEW_HOLD` / human-gated
(ADR 0053 §4) · the reproducibility + copy guards are enforced (as **required** checks
under this ADR, not merely at a human's discretion) · untrusted snapshot ingestion stays
human-reviewed · every change remains a reviewable, revertible PR object, never a direct
push.
