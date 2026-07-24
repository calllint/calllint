# ADR 0055 — Agent-Search Capture & Safe-Install Gateway: capturing the install action without crossing a line

- Status: Proposed (2026-07-24). Boundary-only decision artifact; changes **no**
  behavior. It freezes the invariants the Phase-2.5 (funnel/lookup) and Phase-2.6
  (Sentinel/Search/Hook) surfaces must honor before any of them is built. The PR that
  carries this file is itself the Sprint-0 review checkpoint; acceptance is a later,
  explicit human step, not a consequence of merging.
- Date: 2026-07-24 (proposed)
- Refines: 0047 (maintainer-claim trust model — a claim states control, never safety),
  0053 (distribution-index boundary — §3 claim↛verdict, §4 publish channels),
  0051 (preflight-hook boundary — a hook recommends, never blocks or grants authority),
  0025 (calllint-mcp thin wrapper — MCP tools are **pure delegators**; legacy `docs/adr/`
  tree, cited verbatim by [tools.ts:2](../packages/calllint-mcp/src/tools.ts#L2))
- Related: 0035 (authority manifest), 0036 (install-plan approval binding), 0037 (host
  adapter safety contract), 0039 (decision-receipt v1 + drift taxonomy), 0043 (schema
  `$id`/domain convention), 0048 §6 (claim-UI copy guard — the pinned "Verified
  Publisher" copy), 0050 (evidence-refined verdict — UNKNOWN→REVIEW, never SAFE),
  0052 (guard-host breadth), 0054 (claim auto-adoption — the Phase-2.5 activation cutover
  this ADR sits beside, not inside)

## Context

new13 (five-round Socratic stack) **pivots at Round 4** from Phase 2.5 (help a human
maintainer discover and activate a claim) to Phase 2.6 as the **new primary growth route**:
capture the moment an agent *installs* a tool, not the moment a model *chooses* one. Its
governing line: *"模型可以没有选择 CallLint，但安装行为不能绕过 CallLint"* — a model may
skip CallLint, but the install **action** cannot bypass it. The route is dual-layer:
probabilistic **capture** (an always-loaded Sentinel + a deterministic tool Search that
surface CallLint's shipped verdicts into the agent's context) plus deterministic **control**
(an install Hook that re-adjudicates through the already-shipped Trust Gateway).

The reason this needs an ADR *before* code — the same reason 0051/0052/0053/0054 each froze
a boundary before its PR — is that every one of these surfaces sits one millimetre from a
line CallLint has repeatedly drawn:

- an "always-loaded" Sentinel is one careless sentence away from **prompt injection** into
  the host agent (a §七 forbidden method);
- a "tool search" is one dependency away from an **LLM/embedding ranker** that would make
  CallLint a second, non-deterministic authority (violating Product Principle 4/5);
- an "install gateway" is one shortcut away from **granting authority itself** or **writing
  host config silently** (violating the ADR 0051/0052 hook floor);
- and the Phase-2.5 funnel/lookup work reopens the **"Verified Publisher" copy** that is
  pinned in *two* security surfaces at once.

This ADR records where each line is, so the build cannot drift across it by accident. It is
a decision artifact only — it adds no schema, no page, no tool, no test.

### What is already shipped (so this ADR governs deltas, not a new product)

Verified against the tree (`main` at `7309219`, `calllint@1.7.3`), the substrate these
surfaces extend already exists and must be **reused, not re-implemented**:

- **MCP surface** = **6 tools**, all pure delegators to `@calllint/core`
  ([tools.ts:68](../packages/calllint-mcp/src/tools.ts#L68), citing ADR 0025 at line 2).
  The Sentinel and Search are **new tools in this same server** — not a new server.
- **Install machinery** = `packages/install-planner` (prepare→approve→apply→verify with
  revalidate→backup→atomic-write→re-read+verify→**rollback**; `decisionReceipt`/`verify`/
  `drift` = `calllint.receipt.v1`, ADR 0035–0037/0039). The Hook **routes through this**;
  it does not re-decide.
- **Hook floor** = `plugins/calllint` — today one recommend-only, always-exit-0
  `PreToolUse` hook (ADR 0051). The install Hook **extends** this contract, staying inside
  it.
- **Claim/funnel** = `reconcileClaims.ts` / `verifyClaims.ts` / `claim.ts` /
  `claimStateMachine.ts` (9 states + 7 re-verify triggers), `trust-verify-claims.yml`
  (daily cron, PR-only, never deploys), `app-created.html` + `renderAppCreated.ts`
  (PR #215), `renderSitemap()` + `sitemap.xml` + `robots.txt` (PRs #216/#217). Phase 2.5 is
  **~90% shipped**; its genuine gaps are the funnel event stream, the `/trust` lookup UI,
  and the self-claim revoke/reactivate dogfood.

### The "Verified Publisher" copy is load-bearing in two security surfaces at once

Phase 2.5-D (the publisher activation page) wants clearer identity copy. Verified on disk,
the string `Verified Publisher` is pinned in **two** places that must move together or not
at all:

1. [check-public-copy.mjs:418](../scripts/check-public-copy.mjs#L418) —
   `const claimed = /Verified Publisher/.test(f.text)` — this regex is the **branch
   selector** for check 19 (the claim-funnel boundary: a claimed page must show the
   publisher note and must **not** show the funnel; an unclaimed page is the inverse).
   Rename the noun and every page silently mis-classifies.
2. [0048 §6:121](../adrs/0048-i2c-claim-mechanism-github-app.md#L121) — the ADR pins the
   allowed copy verbatim: `"Verified Publisher — controls github.com/{org}"`.

So a rename is not a copy tweak; it is a **security-guard change** touching the guard token,
an accepted ADR's pinned copy, every baked claimed page, and the `<calllint-trust>` embed —
all at once. Separately, the specific disclaimer sentence *"Identity verification does not
change the CallLint verdict."* is **absent** from the tree today (verified: 0 matches
repo-wide); a *semantic* equivalent exists only as prose in
[renderAppCreated.ts:85-87](../packages/trust-index/src/renderAppCreated.ts#L85-L87)
("It is **not a safety claim** … does not change the observed verdict"). Adding the fixed
sentence is therefore a genuine, additive strengthening — not a duplicate.

## Decision

Adopt the following seven boundaries. Each surface downstream (funnel, lookup, Sentinel,
Search, Hook) must satisfy them; absent any, the surface is not built.

### 1. Ship the additive verdict-disclaimer line now; DEFER the "Verified Publisher" rename

- **(a) Adopt now — additive.** The fixed line *"Identity verification does not change the
  CallLint verdict."* is added to claimed surfaces, and `check:public-copy` is **extended to
  require** it on claimed pages. This is a *strengthening* of the copy guard (it can only
  add a mandatory honest sentence), never a weakening, and the line is genuinely absent today
  (§Context). It lands with Phase 2.5-D (PR-N4).
- **(b) Defer the rename** `Verified Publisher` → `Publisher identity verified`. Because the
  token is load-bearing in check-19 and ADR 0048 §6 (§Context), a rename may happen **only**
  as one atomic change that moves the guard token, amends ADR 0048 §6, re-bakes every claimed
  page, and updates the embed **together**, behind explicit human sign-off. This ADR
  **forbids editing the guard token in isolation** to make copy pass — the CallLint developer
  discipline ("never weaken a security rule to make a test pass") applies to the *selector*
  regex exactly as to a verdict rule.

### 2. Fold the web trust-event privacy posture into this ADR (no separate ADR yet)

The Phase-2.5-B funnel event stream (`calllint.trust-event.v1`) is bound here rather than in
its own ADR, because it introduces no new trust primitive — only a first-party counter. Its
posture is fixed: **first-party only** (no third-party vendor, no external beacon),
**PII-free**, **cookie-free**, **no `localStorage`**, server-side hashing of any coarse
dimension, **`204 No Content`** response, **fail-open for UX / fail-closed for invalid
writes** (a malformed or oversized event is dropped, never stored, never surfaced), and
**no LLM** anywhere on the path. A dedicated ADR is opened **only if/when** the Cloudflare
Analytics-Engine live binding is enabled (a future 🌐 infra step) — until then the emitter
and client shim ship dark, like every other pre-adoption seam.

### 3. The Sentinel is honest presence, size-bounded, and never an instruction

The always-loaded Sentinel tool (`calllint_guard_external_tools`) **states what CallLint
does** — it does not tell the host agent what to do. It is:

- **≤ 2500 bytes** of tool description/output, pinned by a test. The repo's established idiom
  is a ceiling assertion (`Buffer.byteLength(...) < N`, as the embed's shipped-bytes test
  does), not a byte-exact `.toBe(N)`; PR-N6 adds a ceiling assertion, not an equality.
- a **pure delegator** (ADR 0025) in the shipped `packages/calllint-mcp` — it reads shipped
  verdicts/evidence and reports presence; it holds no logic of its own.
- **never an injected instruction.** Copy that redirects, coerces, or impersonates the host
  agent's own turn ("you must now…", "ignore…", "always call CallLint before…") is a §七
  forbidden method and is prohibited. Its copy is governed by `check:public-copy` like every
  other public string.

### 4. Search is deterministic; the Hook re-adjudicates through the shipped planner; one server

- **Safe Search** (`calllint_search_agent_tools`) is **deterministic lexical** ranking over
  **committed** data (`snapshots/official-mcp-registry.json` + authority manifests). **No
  LLM, no embedding, no fuzzy/semantic ranker.** It **surfaces the shipped verdict/
  evidence-level** per result and introduces **no new score, rank-authority, or verdict**
  (Product Principle 4; ADR 0053 §3).
- **One MCP server.** Sentinel and Search are new tools **inside** the shipped
  `packages/calllint-mcp` (6 pure delegators today), staying pure delegators (ADR 0025).
  No second server, no second verdict/risk engine, no second resolver.
- **The install Hook re-adjudicates, it does not decide.** It routes the install/approve
  action through the shipped `install-planner`
  (prepare→approve→apply→verify→**rollback**; receipt `calllint.receipt.v1`, ADR
  0035–0037/0039) and **never grants authority itself, never writes host config silently**
  (the ADR 0051/0052 hook floor: recommend/re-adjudicate, exit without mutating unless the
  planner's approved, receipted path does it). Claim/identity **never moves a verdict**
  (ADR 0047/0053 §3); the GitHub App stays `metadata:read` only.

### 5. Schema homes and identity (per ADR 0043)

Two new schemas live in the repo-root flat `schemas/` dir, JSON Schema **draft-07**,
`additionalProperties:false`, `$id` on `https://calllint.com/schemas/…`, and their **wire
identity is the `const` tag** (not the filename, not the `$id`):

- `schemas/calllint.trust-event.v1.schema.json` — wire tag `calllint.trust-event.v1`.
- `schemas/calllint.trust-lookup-index.v1.schema.json` — wire tag
  `calllint.trust-lookup-index.v1` (the deterministic `/trust` lookup index; **no LLM, no
  fuzzy** — distinct from the *API-side* `partner-api/src/lookup.ts` that already exists).

### 6. The four other Phase-2.6 tools are deferred

`compare_tool_authority`, `prepare_safe_install`, `verify_tool_install`, `check_tool_update`
are recorded as **deferred** (new13 Round 5). Sentinel + Search + Hook ship first; the four
are revisited only after a real interception is exercised.

### 7. Hard-block ordering is binding

`Sprint 0 (this ADR) → Phase 2.5 A→B→C→D→E → Phase 2.6 Sentinel→Search→Hook → Phase 3+`.
A→E is **sequential** (A, the self-claim dogfood, is the spine: the loop must provably close
on CallLint's own namespace first). Phase 2.6 does **not** start until the Phase-2.5 signoff
doc (PR-N5) is green. Phase 3+ does **not** start until Phase 2.6 ships **and** a real
agent-install interception is exercised end-to-end. No front-running.

## Consequences

- **Positive**: the growth route new13 rates highest (agent-install capture, closure score
  ≈8.5–9) gets a written floor before code, so the build is turnkey and cannot drift across
  an injection/LLM/silent-write line by accident. The "Verified Publisher" rename — the one
  genuinely risky copy change — is quarantined behind an atomic, human-signed change while the
  honest disclaimer line ships immediately.
- **Cost / risk retained**: folding the funnel privacy posture into this ADR (Decision 2)
  means the *first* time the live Analytics-Engine binding is enabled, a follow-on ADR is
  owed; skipping it now is deliberate (the emitter ships dark, so there is nothing live to
  govern yet). The Sentinel byte ceiling (Decision 3) is a real constraint the copy must live
  within; if honest presence cannot fit ≤2500 bytes, that is a signal to cut copy, not to
  raise the ceiling silently.
- **Reversible**: this is a boundary doc. Every constraint it names is a property of code not
  yet written; nothing here mutates a shipped byte. If a downstream surface proves a boundary
  wrong, the fix is an ADR amendment before that surface's PR — the same reversibility ADR
  0054 §"Reversible" relies on.

## Options considered

| Decision | Option chosen | Rejected alternative | Why |
|---|---|---|---|
| Publisher copy | **Additive disclaimer line now; rename deferred (§1)** | Rename "Verified Publisher" now | Rename moves a guard-selector token + an accepted ADR's pinned copy + every claimed page + the embed at once; too much blast radius for a copy pass. The honest line is additive and needs none of that. |
| Funnel privacy ADR | **Fold into 0055 (§2)** | Separate trust-event ADR now | No new trust primitive until a live sink exists; a dedicated ADR is owed only when the Analytics-Engine binding is enabled. Folding avoids an empty ADR. |
| MCP topology | **Extend the shipped 6-tool server (§4)** | New MCP server for the agent-capture tools | A second server = a second surface to keep pure-delegator and a second thing to trust; one server, more pure delegators, honors ADR 0025 and "one MCP server". |
| Search ranking | **Deterministic lexical over committed data (§4)** | LLM/embedding semantic ranker | An LLM ranker makes CallLint a second, non-deterministic authority (Product Principle 4/5); determinism keeps the verdict the single source. |

## Decision record (2026-07-24)

**Proposed.** This ADR is offered as the Sprint-0 boundary. Per the approved plan, the PR
carrying it is the review checkpoint: the boundary is what the user reviews, and that review
*is* the Sprint-0 signoff. **Acceptance (flipping Status → Accepted) and any Phase-2.5 build
are explicit later steps** — merging this file does not authorize either. This mirrors how
0051/0052/0053/0054 each landed a boundary as a standalone artifact before the behavior it
governs.

**What "Proposed" does and does not do:**

- **Does**: freeze the seven boundaries so the Phase-2.5/2.6 surfaces have an unambiguous
  floor; correct the record that the disclaimer *line* is a genuine add (not a duplicate of
  the renderAppCreated prose); and pin the "Verified Publisher" rename as a two-surface
  security-guard change, not a copy edit.
- **Does not**: build or wire any surface; touch branch protection, the GitHub App manifest,
  or any shipped byte; enable the funnel live sink; or start Phase 2.5. The claim store still
  holds exactly one active record (CallLint's own), so nothing downstream is unblocked by this
  ADR alone.

## Invariants preserved

A claim/identity states control, never safety, and never alters a verdict (ADR 0047/0053 §3)
· UNKNOWN never becomes SAFE (ADR 0050) · deterministic rules decide verdicts; **no LLM** in
lookup/analytics/claim/rendering/publication/search (Product Principle 4/5) · one MCP server,
one verdict, one claim model, one receipt — every new tool is a **pure delegator** (ADR 0025)
· the install Hook **re-adjudicates through the shipped planner**, never grants authority and
never writes host config silently (ADR 0051/0052 floor; receipt `calllint.receipt.v1`) · the
Sentinel is honest presence ≤2500 bytes, **never an injected instruction** · the GitHub App
stays `metadata:read` only · **no §七 forbidden method** (no prompt injection, no fake
metrics, no mass SEO doorways, no unauthorized config modification, no mass auto Issue/PR) ·
the copy guard is only ever **strengthened**, never weakened, and the "Verified Publisher"
selector token moves only inside an atomic, human-signed rename · `pnpm ci:local` runs green
before and after every workstream.
