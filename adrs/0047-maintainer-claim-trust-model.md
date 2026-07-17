# ADR 0047: Maintainer-Claim Trust Model — GitHub OAuth, "Verified Publisher", Revocation & Drift

**Status**: Accepted
**Date**: 2026-07-16
**Phase**: I (Public Trust Index & Partner, → v1.6.0) — Milestone I0 (freezes the claim *trust model* before I2c code)
**Supersedes**: none
**Refined by**: [0048 I2c Claim Mechanism — GitHub App + Actions](./0048-i2c-claim-mechanism-github-app.md) (picks the concrete method for §2)
**Related**: [0038 Public Trust Index Boundaries](./0038-public-trust-index-boundaries.md), [0046 Phase I Architecture](./0046-phase-i-architecture.md), [0039 Decision Receipt v1 & Drift Taxonomy](./0039-decision-receipt-v1-and-drift-taxonomy.md), [0035 Automated Trust Gateway & Authority Manifest](./0035-automated-trust-gateway-authority-manifest.md)
**Drives**: `docs/phase-i-design.md` §3.3, `new8-execution-roadmap.md` I2

## Context

ADR 0038 §5 allows a maintainer to **claim** a resource in the Public Trust Index
and, on success, receive a **"Verified Publisher"** label and drift notifications —
and it drew the hard line that this is **never an implied CallLint endorsement of
safety**. It named four candidate proof methods (GitHub OAuth / DNS well-known /
repo `calllint.json` / signed challenge) but did not pick one, define what the
label asserts, or say how a claim is revoked.

Those are exactly the decisions that decide whether "Verified Publisher" builds
trust or quietly erodes it. A claim badge that is mistaken for a safety stamp, that
cannot be revoked, or that keeps asserting control the claimant has lost, would
undermine the same trust asset ADR 0038 exists to protect. This ADR freezes the
claim trust model **before** the I2c code.

Phase I ships **one** method first (GitHub OAuth); the model is defined so the
other three can be added later without re-litigating semantics.

## Decision

### 1. "Verified Publisher" asserts *namespace control*, never safety

The label means exactly: **"CallLint verified that this claimant controls this
namespace at the time of the claim."** It never means the resource is safe,
certified, endorsed, or reviewed. This is the ADR 0038 §2 boundary applied to the
claim surface:

- Allowed copy: "Verified Publisher — controls `github.com/{org}`", "claimed by the
  maintainer".
- **Forbidden** (extends the ADR 0038 §2 / `check-public-copy.mjs` forbidden set to
  the claim UI): "verified safe", "certified", "CallLint approved", "trusted
  publisher" (drops the "safe/trusted" implication), or any wording that lets the
  label read as a security judgment.

A verdict on the page remains **"observed at digest T"** and is computed by the
engine, wholly independent of whether the resource is claimed. **Claiming a
resource never changes its verdict** (the analogue of "Team never changes a
verdict" and ADR 0045's "no second decision path").

### 2. Ship one method: GitHub OAuth, proving a control relationship — not identity

Phase I ships **GitHub OAuth** only. The claim succeeds iff the authenticated
GitHub account has a **control relationship** to the resource's canonical
namespace — admin/maintainer of the owning org/repo for a `github.com/{org}/{repo}`
artifact. The proof is *control*, not personal identity: CallLint stores the
minimum to re-verify (the GitHub account/org id, the resource's canonical
namespace, the granted-scope digest, a timestamp), never OAuth tokens at rest and
no PII beyond the public GitHub handle (ADR 0038 §5 PII-free).

The three other methods (DNS well-known, repo `calllint.json`, signed challenge)
are **deferred**, and this model is written so each maps onto the same
control-relationship semantics when added — no new label, no new meaning.

### 3. A claim is scoped to a namespace + pinned to a digest lineage

A successful claim binds `{verified-github-account} → {canonical namespace}` and
records the **artifact digest** observed at claim time (reusing the
`calllint.artifact.v1` identity from ADR 0035 / 0046 §2). The claim covers the
namespace's resources; the pinned digest lets drift (§5) be expressed as
"authority changed since the claim at digest T" using the **existing drift
taxonomy** (ADR 0039), **not** a new vocabulary.

### 4. Claims are revocable, and revocation is honored loudly

A claim is not permanent. It is revoked when any holds:

- **Self-revoke** — the verified maintainer revokes it.
- **Control lost** — re-verification (periodic, and on any drift event) finds the
  account no longer controls the namespace → the claim is **automatically**
  revoked.
- **Dispute/correction** — the ADR 0038 §5 correction link resolves against a
  claim.

On revocation the "Verified Publisher" label is **removed** from the page in the
next ingestion bake (ADR 0046 §3), and the page states the resource is unclaimed —
it never silently keeps asserting a control relationship that no longer holds.
Revocation **fails closed**: if control cannot be re-verified, the label is
dropped, not retained on the benefit of the doubt.

### 5. Drift notifications reuse the shipped drift engine; delivery is best-effort, evidence is authoritative

When ingestion re-bakes a claimed resource and its authority surface has moved
relative to the claim's pinned digest (§3), the maintainer is **notified**. Drift
is computed by the **already-shipped** `verifyApproved` / decision-receipt drift
taxonomy (ADR 0039) over the public authority manifest — **no second drift
engine** (same rule as ADR 0045 §1). Notification is a *presentation* layer over
that result.

Delivery (a GitHub issue/notification against the claimed repo, or an opt-in
channel captured at claim time) is **best-effort and never on the verdict path**:
a failed notification never changes a page, never blocks ingestion, and never
reads as "no drift." The authoritative, durable record of drift is the **baked
page itself** (which always states "observed at digest T"); the notification is a
convenience that points at it.

### 6. The claim service lives in the ingestion/offline plane, never in serving

Per ADR 0046 §1, OAuth callback handling, claim verification, and the claim record
store are part of the **offline/ingestion** side. The **serving plane only reads a
baked "claimed: true/false + Verified Publisher" field** off the static page — it
performs no OAuth, no GitHub API call, and no claim mutation on a page view or API
request. A claim is applied to the public surface only by the next ingestion bake.
This keeps ADR 0046 §1's serving⊥scanning/mutation invariant intact for the claim
feature too.

## Non-negotiables locked by this ADR

- "Verified Publisher" = **namespace control**, never safety/endorsement; forbidden
  copy enforced by the extended copy guard.
- **Claiming never changes a verdict.**
- Ship **GitHub OAuth only**; other methods deferred but must reuse this exact
  semantics.
- Claims are **revocable** and revocation **fails closed** (label dropped, not
  retained).
- Drift reuses the **shipped drift taxonomy** (ADR 0039) — no second drift engine,
  no new vocabulary.
- Claim verification/store live **offline**; serving only reads a baked flag.
- Minimum data at rest; no tokens stored; PII-free beyond the public handle.

## Consequences

### Positive
- The highest-value claim method (GitHub OAuth) ships first, with semantics tight
  enough that the label cannot be mistaken for a safety stamp.
- Reuses ADR 0039 drift + ADR 0035/0046 identity — the claim feature adds a trust
  *relationship*, not a new engine.
- Revocation + fail-closed re-verification keep the label truthful over time, which
  is the whole point of a "verified" badge.

### Negative
- GitHub-only excludes maintainers whose canonical namespace is not a GitHub org
  (npm-only, self-hosted). Mitigated: the deferred DNS/`calllint.json`/signed-
  challenge methods are designed onto the same model; a resource stays unclaimed
  (not wrongly claimed) until then.
- Best-effort notification means a maintainer can miss a ping. Mitigated: the page
  is the authoritative drift record; notification is convenience, not the contract.

### Trade-offs
- Chose **control-proof over identity-proof**: "you control this namespace" is
  verifiable and sufficient for the label; personal-identity verification is
  neither needed nor wanted (and would add PII).
- Chose **one method, correct semantics** over four methods shipped hastily: the
  meaning of "Verified Publisher" is the asset; methods are interchangeable plumbing
  under it.

## Compliance / gate impact

I2c may not ship a claim flow that (a) lets the label read as a safety claim,
(b) mutates claims from the serving plane, (c) changes a verdict on claim, or
(d) retains a label when control can no longer be verified. The forbidden-copy
guard (ADR 0038 §2) is extended to the claim UI strings. Adding any of the three
deferred methods requires only that it satisfy §2's control-relationship semantics;
changing what "Verified Publisher" *asserts*, or introducing a second drift engine,
requires a new ADR.

## Invariants preserved

"observed at digest" / no-certified language (ADR 0038 §2, extended to the claim
UI) · claiming never changes a verdict (no second decision path) · no second drift
engine (reuses ADR 0039) · no new verdict/drift vocabulary · serving ⊥
mutation/scanning (ADR 0046 §1; claim writes are offline-only) · PII-free, no tokens
at rest (ADR 0038 §5) · revocation fails closed.
