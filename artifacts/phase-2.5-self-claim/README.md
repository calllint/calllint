# Phase 2.5-A — Self-Claim Production Dogfood (honesty ledger + human runbook)

**What this directory is.** The append-only record of CallLint driving its **own** real
maintainer-claim through the full lifecycle — **ACTIVATE → REVOKE → REACTIVATE** — on the
`calllint` GitHub account, and the proof that CallLint's **verdict and page digest never
move** while the claim appears, is revoked, and reappears.

This is the **spine** of new13 (ADR 0055 §7): the claim loop must provably close on our
own namespace before any external claim surface is built. It is a **dogfood**, not new
machinery — it reuses the shipped `reconcileClaims` / `claim` core verbatim
(`packages/trust-index/src/`); nothing about the verdict engine, the schema, or a served
byte changes here.

---

## The honest state today: **3 / 3 — closed** (2026-07-24)

All three legs were exercised on the **live** `calllint` account and the reconciled store
+ re-baked pages are committed. The load-bearing invariant held throughout: verdict
**SAFE** and pageDigest **`sha256:20091cded7699f05bf0238bb57d20f8452da1755dcbf909a3bd4627d32b84e8d`**
are byte-identical across all three legs (a claim never moved the verdict).

| Leg | State | Proven by |
|---|---|---|
| **activate** | ✅ **done** (committed) | The claim was minted (`installationId 147742681`, `verifiedAt 2026-07-22T02:24:28.289Z`) and the served page carried the matching `verifiedPublisher` overlay. Now the `revoked` audit record in `packages/trust-index/claims/claim-store.json`. |
| **revoke** | ✅ **done** (committed) | The App was **uninstalled** on `calllint`; the verify job observed no installation and flipped the record to `revoked` (`verifiedAt 2026-07-24T08:45:34.399Z`, PR #220). The served overlay dropped — the verdict did **not** move. |
| **reactivate** | ✅ **done** (committed) | The App was **re-installed** (a new grant, `installationId 148693982`); the verify job minted a fresh `active` record (`verifiedAt 2026-07-24T09:44:55.534Z`, PR #221) and kept the revoked one as an audit trail. The served overlay returned — the verdict still did **not** move. |

The offline proof that the verdict + page digest are **byte-identical across all three
legs** is machine-checked by `packages/trust-index/test/self-claim-dogfood.test.ts`. Run
the readiness audit any time to see the committed N/3 state:

```bash
pnpm audit:self-claim      # tsx scripts/audit-self-claim-readiness.ts
```

It exits **0** on any legitimate committed state (whether partial or the current 3/3) and
exits **1** only on a genuine integrity fault (coordinate drift, an ambiguous >1-active
self-claim, or a served overlay that disagrees with the store). It currently reports
**3/3, no integrity faults**.

---

## Why a human must do the revoke/reactivate legs (and why that is correct)

The revoke and reactivate legs are driven, in the real world, by a **human GitHub-UI App
uninstall / re-install** — the one action the CallLint ingestion plane **cannot and must
not** self-trigger. This is a *property*, not a limitation:

- **Control is GitHub's admin model, not ours.** A claim is verified by the fact that the
  CallLint GitHub App (id **4322539**, `metadata: read` only) is *installed* by the
  account that owns the repository the registry points at (`reconcileClaims.ts` header:
  "Ownership is thus GitHub's own admin model — we only match the registry's declared
  repository against a covered repository"). Installing/uninstalling an App is exactly the
  human owner's lever. If CallLint could revoke or re-grant its own claim, the claim would
  no longer prove control.
- **The App holds `metadata: read` only** (ADR 0048 §3). It has no permission to install
  or uninstall itself anywhere, by design.
- **The reconciler fails closed on absence.** When the verify job runs and the App is *not
  observed* on the account, `reconcileClaims` flips the prior `active` record to
  `revoked` — which drops the served overlay. That "not observed → revoked" edge is the
  precise thing a human uninstall exercises, and the thing this dogfood proves is safe
  (the verdict does not move when the overlay drops).

So Claude Code builds and machine-checks the **harness**; the **human** performs the one
account-level action; the committed store + this ledger record the result.

---

## The mechanism (verified from the shipped code, so the steps below are grounded)

`packages/trust-index/src/reconcileClaims.ts` (pure) computes the next claim store from
(previous store, current installation view, registry index, baked digests, `now`):

- **observed now, no prior active** → a **new `active`** record (`verifiedAt = now`).
- **observed now, prior active** → **preserved verbatim** (stable diff).
- **prior `active`, NOT observed now** → flipped to **`revoked`** (`verifiedAt = now`).
- **prior `revoked`** → **kept as-is** (audit trail).

The impure half, `verifyClaims.ts`, runs **only** in the Actions ingestion plane: it mints
a short-lived App JWT, asks GitHub which accounts installed the App and which repos each
covers (`metadata: read`), hands that to `reconcileClaims`, and commits the store. The
served page reads only the baked flag; **the overlay is excluded from the page digest**
(`emitCohort.ts`: "NOT part of pageDigest (a claim never alters a verdict, ADR 0053 §3)").

That is the whole reason a human uninstall is safe to perform: it can only toggle the
overlay, never the verdict.

---

## Human runbook — exact steps

> ⚠️ These steps change the **live** claim state on the `calllint` account. They are
> deliberately reversible (re-install restores an active claim). Do them when you want to
> complete legs 2 and 3 of the dogfood. **Nothing here touches a verdict.**

### Preconditions
- You are an **owner/admin** of the `calllint` GitHub account.
- The CallLint GitHub App is **id 4322539**, currently installed as
  **installationId 147742681** (this is what the committed store records today).
- `trust-verify-claims.yml` (the daily PR-only verify job) is enabled, **or** you will
  trigger the verify step manually. It **never deploys**; it opens a PR that commits the
  reconciled store.

### Leg 2 — REVOKE (uninstall)
1. Go to **https://github.com/organizations/calllint/settings/installations** (Org →
   Settings → GitHub Apps / Installed GitHub Apps).
2. Find **CallLint** (App id 4322539) → **Configure**.
3. Scroll to the bottom → **Uninstall** → confirm.
   *Effect:* the App is no longer installed, so the next verify run observes **no
   installation** for this namespace.
4. Trigger the verify job (wait for the daily cron, or run it manually). It will observe
   the App as **not present**, and `reconcileClaims` will flip the record to **`revoked`**
   (`verifiedAt` = the run time). The job opens a **PR** with that store change.
5. Merge that PR. Then re-bake + commit so the served page drops the overlay
   (`pnpm bake:trust-index`), or let the scheduled bake do it.
6. **Verify the invariant held:** `pnpm audit:self-claim` should now show **2/3**
   (activate + revoke), and the served `verdict` + `pageDigest` must be **unchanged** from
   the values recorded in `ledger.json` at activate time. If either moved, **stop** — that
   is a kill-gate breach (a claim moved a verdict), not a pass.

### Leg 3 — REACTIVATE (re-install)
7. Go back to **https://github.com/apps/calllint-trust** (or the org's GitHub Apps page) →
   **Install** / **Configure** → install it on the `calllint` account, granting access to
   the **`calllint/calllint`** repository (the same repo the registry entry points at).
8. **Record the new `installationId`.** A re-install almost always mints a **new**
   installation id. When it does, update `SELF_CLAIM.installationId` in
   `packages/trust-index/src/selfClaimDogfood.ts` **in the same change** that commits the
   reactivated store — `pnpm audit:self-claim` will otherwise report a coordinate **drift
   fault** (by design: it refuses to silently trust a changed grant).
9. Trigger the verify job. It observes the App present again; `reconcileClaims` mints a
   **fresh `active`** record and **keeps the `revoked` one** as an audit trail. Merge the
   PR; re-bake.
10. **Verify the invariant held:** `pnpm audit:self-claim` should now show **3/3**, and the
    served `verdict` + `pageDigest` must **still** equal the activate-time values in
    `ledger.json`. Byte-identical across all three legs = the dogfood closed.

### After 3/3
- Append the three real timestamps to `ledger.json` (see its shape below).
- The offline test already pins the invariant; the ledger records that the **real** legs
  were exercised on the live account, closing new13 Phase 2.5-A.

---

## `ledger.json`

An append-only, PII-free record of the three legs **as they actually happen** on the live
account. It stores only public coordinates + the observed verdict/digest per leg — never a
token, never anything that could move a verdict. Until a leg is performed, its entry stays
`null`. See the committed `ledger.json` in this directory for the current state — **all
three legs are now recorded** (activate `2026-07-22T02:24:28.289Z`, revoke
`2026-07-24T08:45:34.399Z`, reactivate `2026-07-24T09:44:55.534Z`), closing the dogfood
3/3.
