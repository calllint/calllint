# ADR 0048: I2c Claim Mechanism — GitHub App + Actions (control-proof, offline-only, no secret on the serving origin)

**Status**: Accepted
**Date**: 2026-07-17
**Phase**: I (Public Trust Index & Partner, shipped as v1.6.0) — Milestone I2c (freezes the claim *mechanism* before I2c code)
**Supersedes**: none
**Refines**: [0047 Maintainer-Claim Trust Model](./0047-maintainer-claim-trust-model.md) §2 (picks the concrete GitHub method)
**Related**: [0038 Public Trust Index Boundaries](./0038-public-trust-index-boundaries.md), [0046 Phase I Architecture](./0046-phase-i-architecture.md), [0039 Decision Receipt v1 & Drift Taxonomy](./0039-decision-receipt-v1-and-drift-taxonomy.md)
**Drives**: `docs/phase-i-design.md` §3.3 (I2c implementation)

## Context

ADR 0047 froze the claim *trust model* — what "Verified Publisher" asserts
(namespace control, never safety), that a claim never changes a verdict, that
claims are revocable and fail closed, that drift reuses the shipped taxonomy
(ADR 0039), and that verification/storage live in the **offline/ingestion**
plane while serving only reads a baked flag (0047 §6, 0046 §1). It named GitHub
OAuth as the first method (0047 §2) but **deliberately left the mechanism open**:
where the interactive, stateful compute physically lives.

That is the one genuine architectural fork, and it is sharp because OAuth is
inherently **online + interactive + state-writing** (a maintainer clicks
"Claim" → redirect to GitHub → callback with a `code` → exchange for a token →
check org/repo admin → persist a claim record), yet ADR 0046 §1 / 0047 §6 forbid
any mutation or secret-bearing compute on the **serving** plane. The fork is:
*where does that "online + writes" step run without breaking serving ⊥ mutation?*

Three shapes were on the table:

- **A. GitHub App + Actions** — App installation is itself the control proof;
  a minimal webhook → `repository_dispatch` → a GitHub Actions job verifies with
  an **ephemeral installation token** and commits the claim record to the Git
  store; the next ingestion bake writes the baked flag.
- **B. A dedicated claim Cloudflare Worker + KV** — a serving-origin Worker
  handles the OAuth callback, control check, and a KV/D1 write, isolated from the
  read-only Partner API by dep-graph/isolation tests.
- **C. Repo-nonce, pure Actions** — the claimant commits a CallLint-issued nonce
  into the namespace they control; a scheduled Actions job publicly re-reads it.

**Decision: A.** The reasoning and the resulting contract follow.

## Decision

### 1. Ship a GitHub App whose *installation* is the control proof

Phase I ships one method (0047 §2): a **GitHub App**. The claim succeeds iff the
App is **installed** on the org/repo that owns the resource's canonical
namespace, because GitHub only lets an **org/repo admin** install an App. This is
0047 §2's "control relationship, not identity" read literally — installation *is*
admin-level control, and it needs no personal-identity data. A GitHub App is a
**refinement of "GitHub OAuth"** (it authenticates via the same OAuth substrate),
chosen because raw OAuth-token scopes prove *a user's* access at a moment, whereas
an **installation** is a durable, first-class, revocable control grant scoped to
exactly the claimed namespace — a better fit for a label that must stay truthful
over time (0047 §4). No change to what "Verified Publisher" *asserts*, so 0047's
compliance clause is satisfied without a new trust-model ADR.

### 2. The online + state-writing compute lives entirely in the offline plane

The flow keeps **zero mutation and zero secret on the serving origin** (0046 §1,
0047 §6):

1. Maintainer installs the App (or clicks "Claim", which deep-links to the App
   install). GitHub sends an **installation webhook**.
2. A **minimal webhook receiver** (a thin, stateless endpoint) does exactly one
   thing: fire a GitHub Actions **`repository_dispatch`**. It holds no claim
   state, performs no GitHub API call beyond signature verification, and can
   itself run as an Actions-triggering shim — it is *not* the serving plane and
   *not* the Partner API deployable.
3. A **GitHub Actions job** (the offline/ingestion plane — the same plane that is
   the sole scanner, ADR 0046 §3) mints an **ephemeral installation token**,
   confirms the installation covers the claimed namespace, records the claim into
   the **Git store** (a committed, PII-free claim record), and stops. Merging /
   committing is what applies it — a human-reviewable, decoupled step.
4. The **next ingestion bake** reads the committed claim records and writes a
   baked `claimed: true` + `verifiedPublisher` field onto the static Trust Page.

The **serving plane only reads that baked flag** off the static page — no OAuth,
no GitHub API, no claim mutation on any page view or `/v1/public/*` request. The
Partner API deployable gains **no new capability** and still cannot resolve,
fetch, scan, or write (its dep-graph/import guards from I2a remain the lock).

### 3. No token at rest; minimum PII-free record in Git

Installation tokens are **ephemeral** — minted inside the Actions job, used, and
discarded; **never stored** (0047 §7). The App's private key / webhook secret are
**GitHub Actions secrets**, never shipped in any serving deployable and never in
the repo. The committed claim record stores only what re-verification needs: the
installation id + owning account/namespace, the resource's canonical namespace,
the **artifact digest observed at claim time** (`calllint.artifact.v1`, 0047 §3),
a granted-scope digest, and a timestamp — **no OAuth tokens, no PII beyond the
public GitHub handle** (0038 §5, 0047 §7).

### 4. Revocation = uninstall, and it fails closed

A claim is revoked (0047 §4) when: the maintainer **uninstalls** the App
(uninstall webhook → same dispatch → Actions marks the record revoked); periodic
/ on-drift **re-verification** finds the installation no longer covers the
namespace; or an 0038 §5 correction resolves against the claim. On revocation the
next bake **drops** the `verifiedPublisher` flag and the page states the resource
is unclaimed. Re-verification **fails closed**: if the installation cannot be
confirmed, the flag is dropped, never retained (0047 §4). Uninstall giving
automatic, GitHub-native revocation is a direct benefit of choosing an App.

### 5. Drift notifications are App-native and off the verdict path

When ingestion re-bakes a claimed resource and its authority surface has moved
vs. the pinned digest (§3), the maintainer is notified via the **App's own**
issue/notification against the claimed repo. Drift is computed by the
**already-shipped** ADR 0039 taxonomy over the public authority manifest — **no
second drift engine** (0047 §5). Delivery is **best-effort and never on the
verdict path**: a failed notification never changes a page, never blocks
ingestion, never reads as "no drift"; the **baked page** ("observed at digest T")
is the authoritative record (0047 §5).

### 6. The claim-UI copy guard extends the forbidden set

The claim UI strings (badge, tooltip, page copy) are bound by the extended
forbidden-copy set (0047 §1, 0038 §2): "verified safe", "certified", "CallLint
approved", "trusted publisher", "guaranteed safe" are forbidden; allowed copy is
"Verified Publisher — controls `github.com/{org}`" / "claimed by the maintainer".
`check-public-copy.mjs` (and `project-facts.json`'s mirrored phrase lists) gain
the claim-surface strings so baked pages carrying a claim flag are guarded by the
same CI gate as every other public byte.

## Why A over B and C

- **vs. B (serving-origin Worker + KV).** B is the most "normal web" UX (instant
  callback) but it introduces the **first mutating, secret-bearing, stateful
  compute on the serving origin** — the exact thing ADR 0046 §1 made structurally
  impossible to keep Phase I safe. Isolation tests would *police* the boundary; A
  keeps it **structural** (Actions is the only writer, as with every other
  ingestion path). A OAuth client secret + a KV/D1 store on the serving side is
  net-new attack surface for a feature whose whole value is trust.
- **vs. C (repo-nonce, pure Actions).** C is the purest infra story (zero online
  state) but it **abandons GitHub OAuth as the first method** (0047 §2), so it
  would need an ADR that changes 0047's locked "ship OAuth first". A gets C's
  offline-only property (all verification runs in Actions) **while honoring 0047
  §2**, because the App authenticates via GitHub OAuth and the heavy compute still
  lands in Actions. C's methods (repo `calllint.json`, DNS, signed challenge)
  remain the **deferred** set 0047 already anticipated.

A is the only option that satisfies **both** 0047 §2 (GitHub control proof, first)
**and** 0046 §1 / 0047 §6 (mutation + secrets live offline, never on serving),
and it gets revocation-as-uninstall and native drift notifications for free.

## Non-negotiables locked by this ADR

- The claim's **online + state-writing** compute runs in **GitHub Actions**
  (offline plane); the webhook receiver is a stateless dispatch shim, not the
  serving plane and not the Partner API deployable.
- **No secret and no claim mutation on the serving origin**; serving reads a baked
  flag only (0046 §1, 0047 §6).
- **No installation/OAuth token at rest**; App key + webhook secret are Actions
  secrets only.
- Claim record in Git is **PII-free** beyond the public handle; pins the
  claim-time artifact digest (0047 §3).
- **Revocation = uninstall / failed re-verification, fails closed** (flag dropped,
  0047 §4).
- Drift reuses the **ADR 0039** taxonomy; notification is best-effort, off the
  verdict path (0047 §5).
- Claim never changes a verdict; "Verified Publisher" never reads as safety; the
  copy guard covers the claim UI (0047 §1).

## Consequences

### Positive
- Boundary stays **structural, not disciplinary**: Actions is the sole writer, so
  "serving never mutates" needs no runtime enforcement on the serving side.
- **Uninstall = revocation** and **installation = admin proof** are GitHub-native,
  so §4's fail-closed and §2's control-proof are mechanisms, not code we maintain.
- No new stateful serving infra, no client secret on the origin, no token at rest.

### Negative
- A GitHub App is heavier to set up than a bare OAuth app (one-time registration,
  webhook + `repository_dispatch` wiring, key in Actions secrets). Mitigated: it
  is one-time and buys native revocation + notifications.
- A thin webhook receiver still exists. Mitigated: it is stateless, holds no claim
  data, and only fires a dispatch — it is not a scanner and not the serving plane.
- Async UX (claim appears after the Actions verify + next bake), not instant.
  Mitigated: the claim page states "pending verification"; this matches the
  decoupled, human-reviewable ingestion model already shipped in I1b.

### Trade-offs
- Chose **installation-as-control-proof** over user-token-scope-proof: an
  installation is durable, namespace-scoped, and revocable — better for a label
  that must stay truthful than a point-in-time token grant.
- Chose **offline correctness over instant UX** (A over B): the trust asset is
  worth the async delay and the smaller attack surface.

## Compliance / gate impact

I2c code may not (a) put the OAuth client secret, App private key, or any claim
mutation in a serving deployable; (b) store an installation/OAuth token at rest;
(c) change a verdict on claim; (d) retain a `verifiedPublisher` flag when the
installation can no longer be verified; or (e) introduce a second drift engine.
The forbidden-copy guard extends to the claim UI strings. Adding any deferred
method (repo `calllint.json` / DNS / signed challenge) must reuse 0047 §2's
control-relationship semantics and this ADR's offline-only, no-secret-on-serving
placement; changing either requires a new ADR.

## Invariants preserved

serving ⊥ mutation/scanning (0046 §1; all claim writes are Actions-only) · no
secret / no token at rest on serving · "observed at digest" / no-certified copy
(0038 §2, extended to claim UI) · claiming never changes a verdict · no second
drift engine (reuses 0039) · no new verdict/drift vocabulary · PII-free beyond the
public handle (0038 §5) · revocation fails closed (0047 §4).
