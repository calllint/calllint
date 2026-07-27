# Phase 2.5 — Signoff (PR-N5): the maintainer-claim funnel closes on our own namespace

**What this directory is.** The evidence-backed acceptance record for **new13 Phase 2.5**
(the maintainer-claim funnel + `/trust` lookup), and the gate ADR 0055 §7 names: *"Phase
2.6 does **not** start until the Phase-2.5 signoff doc (PR-N5) is green."* This is that
doc. It records what each sub-phase A→E is, how it was verified, and the invariants that
held across all of them.

It signs off **evidence**, not optimism: every row below points at a commit, a test, or a
gate you can re-run. Where a claim is "built locally, not yet landed," it says so — this
doc never reports a merge that has not happened.

---

## Honest landing state (as of authoring)

Phase 2.5 is delivered as a **linear stack** `main → B → C → D → E`, built and
`ci:local`-green at every tip. Per the repo's push discipline and the active quota window,
the remote landing (push → PR → squash-merge) is **deferred to the Aug-1 window** and is
**not** performed by this doc. So:

- **A** is **landed on `main`** (`bd53d15`, PR #219; revoke #220 / reactivate #221).
- **B, C, D, E** are **built + verified locally**, awaiting the Aug-1 landing window.

This doc therefore signs off that Phase 2.5 is **build-complete and boundary-compliant**;
the operational unblock of Phase 2.6 takes effect when B→C→D→E land green on `main` in the
landing order recorded in [`LANDING.md`](./LANDING.md).

---

## The five sub-phases (A→E) — evidence table

ADR 0055 §7 fixes the order **A→B→C→D→E** (sequential; A is the spine). The stack honors
it: A on `main`, then B, C, D, E stacked in that exact order.

| Sub-phase | What it delivered | Anchor | Verified by |
|---|---|---|---|
| **A** self-claim dogfood | CallLint drove its **own** claim ACTIVATE→REVOKE→REACTIVATE on the live `calllint` account; verdict + pageDigest byte-identical across all 3 legs | `bd53d15` (main); PR #219/#220/#221 | `self-claim-dogfood.test.ts` + `pnpm audit:self-claim` → **3/3, no faults**; ledger in [`../phase-2.5-self-claim/`](../phase-2.5-self-claim/) |
| **B** funnel events | `calllint.trust-event.v1` schema + `@calllint/trust-event-contract` + CF `functions/v1/events/trust.ts` + client shim — **ships dark** (no live sink) | `bd73514` | `trust-event-contract.test.ts`, `trust-events.test.ts`, `trust-route.test.ts`; posture pinned by ADR 0055 §2 |
| **C** `/trust` lookup | deterministic **lexical** `lookup-index.json` + `lookup.html` + `calllint.trust-lookup-index.v1` schema — no LLM, no fuzzy | `c045492` | `lookup-index.test.ts`, `discovery.test.ts` |
| **D** publisher copy | fixed line *"Identity verification does not change the CallLint verdict."* added to every Verified-Publisher surface; `check:public-copy` extended to **require** it on claimed pages | `db651bb` | `bake-claim.test.ts` + check 19 (guard proven to fail on a missing line) |
| **E** signoff | this doc + [`LANDING.md`](./LANDING.md) | *(this commit)* | `ci:local` green at the E tip |

---

## Invariants that held across A→E (the reason this is safe to sign)

Each is a property ADR 0055 §"Invariants preserved" names; each was checked, not assumed.

- **A claim states control, never safety, and never moves a verdict.** The self-claim
  dogfood proves it empirically (verdict `SAFE` + pageDigest
  `sha256:20091cd…` byte-identical across activate/revoke/reactivate); D's copy change
  touches only the *claimed overlay* HTML — **all 37 unclaimed pages baked byte-identical**
  (verified: only the one genuinely-claimed self-page moved).
- **No LLM anywhere** on the funnel / lookup / claim / render / analytics path. C's lookup
  is deterministic lexical ranking over committed data; B's event path has no model; D is a
  fixed string. (Product Principle 4/5.)
- **The copy guard was only strengthened, never weakened.** D *adds* a mandatory honest
  sentence to claimed pages; it does not relax any existing rule. The "Verified Publisher"
  selector token is untouched — the rename stays **deferred** (ADR 0055 §1b).
- **The GitHub App stays `metadata: read` only** (ADR 0048 §3) — Phase 2.5 added no scope.
- **The funnel event stream ships dark** — first-party, PII-free, cookie-free, no
  `localStorage`, `204` response, no live Analytics-Engine binding (ADR 0055 §2). A
  follow-on ADR is owed only when that binding is enabled.
- **`pnpm ci:local` runs green before and after every workstream** (typecheck · test ·
  build · corpus · bench · public-copy · evidence · coverage · calibration).

## What this signoff does NOT do

- It does **not** merge B/C/D/E to `main` (deferred to the Aug-1 window; see `LANDING.md`).
- It does **not** enable the funnel live sink, rename "Verified Publisher", or add any App
  scope.
- It does **not** start Phase 2.6. Phase 2.6 (Sentinel → Search → Hook) begins only once
  this stack is green **on `main`**, per ADR 0055 §7. The four other Phase-2.6 tools remain
  deferred (ADR 0055 §6, new13 Round 5).

