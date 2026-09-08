# new22b closure report — GitHub Copilot approval authority boundary

- **Date:** 2026-09-08
- **Branch:** `feat/new22-cursor-authority-boundary-v2` (off `main` @ `c4c388b`)
- **Source plan:** "CALLLINT — GitHub Copilot Approval Authority Boundary Closure" (P1,
  *Architecture boundary correction*). The plan text is untracked, so this file and the
  [`N22B-P1`](NEW19-21_OPEN_ITEMS.md#n22b-p1-a-copilot-review-can-now-satisfy-a-required-approval-rule-and-the-boundary-said-nothing)
  tracker row are the tracked record of what it asked for.
- **Scope:** one P1 coverage-boundary correction. **No detector, no schema change, no
  verdict-semantics change, no runtime dependency.**

## What the external change actually was

GitHub's Copilot Code Review can — **after explicit administrator configuration** — produce an
approval that **satisfies a repository's required-approval rule**. That is the whole reason this
round exists, and the distinction is worth stating precisely, because it is the one the old
boundary erased: a review *comment* carries information; an *approval* can change whether code is
allowed to merge. The first is advisory, the second is on the `effect` layer.

The authority chain is:

```
identity → enterprise / org / repo administrator policy → Copilot review execution
        → approval action → branch-protection state change
```

CallLint has **no deterministic static evidence source for any link in that chain**. None of it is
on this machine: administrator policy is server-side account state, and branch protection is a
remote repository setting. So the honest response is a **coverage boundary correction, not a new
security capability** — and the plan said so itself (§4, §9, §14).

## §6 — repository reality, measured before any edit

The plan required this mapping be completed from code before modifying anything. Measured at
`c4c388b`.

| # | question | measured answer |
|---|---|---|
| 1 | How many GitHub host records exist? | **exactly one** — `apps/web/data/distribution-surfaces.json`, `id: "copilot-cli"`, one of 18 hosts |
| 2 | Its support class / commands? | `DISCOVERY_ONLY`, `truthfulCommands: []`, `authoritySurfaces: ["shell","cli","mcp"]` |
| 3 | What did `coverageBoundary` say? | **62 chars**: *"CallLint does not yet auto-discover Copilot CLI configuration."* — silent on approval authority entirely |
| 4 | Does anything model approval/branch protection? | **no.** No detector, no schema field, no fixture. Nothing to change, and nothing that could be quietly widened |
| 5 | Does CallLint touch GitHub's PR surface at all? | **yes — it writes into it.** See below |
| 6 | Is a schema change needed? | **no.** `coverageBoundary` is already required free text (`{"type":"string","minLength":1}`) — matching the plan's `DEFAULT: NO schema change` |

**The finding that changed the shape of the work (Q5).**
`calllint guard install --host github` ([`apps/cli/src/commands/guard.ts:278`](../../apps/cli/src/commands/guard.ts#L278))
writes `.github/workflows/calllint.yml`, rendered by `renderCiGate()` in
[`packages/core/src/distribution/ciGate.ts`](../../packages/core/src/distribution/ciGate.ts). So
CallLint **already installs an artifact into the exact surface approval authority acts on** — the
pull-request merge decision. Approval authority is therefore not a remote abstraction to be
described at arm's length; it lands on the same decision as something we ship. And the person most
likely to conflate a check with an approval is precisely the one who just installed our gate.

Two consequences followed from that, neither of them a design preference:

1. The check-is-not-an-approval distinction had to be **published in the boundary**, not merely
   asserted in a test. A test protects a reader who runs the suite; the boundary reaches the reader
   who installs the gate.
2. `ciGate.ts` could not be touched: `packages/core` is a `VERDICT_PACKAGE` under the §18 zero-diff
   gate (`scripts/verify-security-semantic-diff.mjs`). This **independently forced** the
   data-and-docs-only path the plan had asked for on other grounds — a useful confirmation rather
   than a constraint fought.

### Reuse findings — every one removed work rather than adding it

- `coverageBoundary` already required free text → **no schema change**, per §9.
- The guard structure already existed: `tests/invariants/activation-contract.invariants.test.ts`
  already held a `new22 §NC-CURSOR-V2` block with exactly this shape (host-scoped subject regexes,
  an `unsupported` assertion, a SAFE-negation assertion). **Extended, not duplicated.**
- `artifacts/distribution-watch/COPILOT_PERMISSION_AUTHORITY_WATCH.md` already existed from new22
  P2-a → **no new artifact needed**, and its Q4 is now answered.
- All nine gates already exist as npm scripts → **zero new gate files, zero new scripts.**

## Before / after coverage statement

**Before.** For `copilot-cli`, CallLint published one sentence: *"CallLint does not yet
auto-discover Copilot CLI configuration."* Approval authority was not mentioned, not qualified, and
not excluded.

**After.** The same host publishes 1207 chars naming each unobservable layer explicitly: the
approval/required-approval/branch-protection `effect` layer, the administrator-policy `identity`
layer, the permission-mode and session-resume `execution` layer, the review-vs-approval distinction,
and the fact that CallLint's own installable workflow is a check that *cannot* satisfy a
required-approval rule.

**What is unchanged: the coverage itself.** Nothing became covered, and nothing became uncovered.
No verdict moved. The correction is to what CallLint *claims*, not to what it *does* — which is the
definition of a boundary correction.

**Why the old sentence was not merely incomplete but misleading**, and this is the load-bearing
point for the next reader: *silence about a layer is not truthfulness about it.* Framing the entire
gap as a configuration-discovery backlog invites two false inferences — that Copilot's authority
surface **is** its MCP config, and that the gap **closes when an extractor lands**. For approval
authority no extractor would ever reach it, because the decision does not live in a file. The
boundary's closing sentence is the one that carries this: *"Reading a Copilot MCP config tells you
what one layer of Copilot's authority declares, and never that an unreadable layer is SAFE."*

## Files changed, and why each

| file | change | why |
|---|---|---|
| `apps/web/data/distribution-surfaces.json` | `copilot-cli.coverageBoundary` **only** — 62 → 1207 chars | the single canonical data edit; the SSOT for all 31 projections |
| 6 generated projections | `pnpm gen:distribution` output | derived, never hand-edited (§12). `agent-surfaces.json`, `agent-discovery-index.json`, `harnesses/copilot-cli/index.html`, `harnesses/index.html`, `llms-full.txt`, `FINAL_PLATFORM_MATRIX.md` |
| `tests/invariants/activation-contract.invariants.test.ts` | +1 describe block (`new22b §NC-COPILOT-APPROVAL`), 8 tests | §10's five required regression tests; appended to the existing guard rather than a new file |
| `artifacts/distribution-watch/COPILOT_PERMISSION_AUTHORITY_WATCH.md` | struck the "needs no edit this round" bullet; added an update header. **⚠ local-only — see below** | that claim is **superseded by this round** — it said the boundary was fine as-is |
| `artifacts/architecture/NEW19-21_OPEN_ITEMS.md` | struck the same claim in `N22-P2a`; added the `new22b` section + `N22B-P1` | the tracker repeated the superseded sentence verbatim; a tracker that outlives its subject is the fault class this repo pins |
| `artifacts/architecture/NEW22B_CLOSURE_REPORT.md` | **new** (this file) | §15 |

**Field-level proof of scope**, measured against `main` rather than asserted: the only field of the
`copilot-cli` record that differs is `coverageBoundary`. `supportClass`, `truthfulCommands`,
`authoritySurfaces`, `configEvidence` and both primitive `state`s are unchanged, and the host count
is 18 → 18.

**⚠ The watch file is gitignored, and that falsifies a claim in the previous round's report.**
`.gitignore:83` ignores `/artifacts/distribution-watch/` wholesale. My edits to
`COPILOT_PERMISSION_AUTHORITY_WATCH.md` landed on disk and `git status` cannot see them —
`git ls-files --error-unmatch` says *"did not match any file(s) known to git"*. So that file is
**local-only**: it does not exist for anyone who clones this repo, and it never did.
[`NEW22_CLOSURE_REPORT.md`](NEW22_CLOSURE_REPORT.md) lists it under "What changed" as a **new**
tracked artifact and justifies its location at length ("kept beside `official-sources.json` rather
than inside it"), which reads as a landed deliverable. It was not one.

This matters beyond bookkeeping, and it is this repo's own fault class applied to a document: the
P2-a evidence — the five questions a future Copilot detector must answer, and the instruction *"Do
not build a detector from this file"* — is **unreachable by the reader it was written for**. The
tracked substitute is the `N22-P2a` row in
[`NEW19-21_OPEN_ITEMS.md`](NEW19-21_OPEN_ITEMS.md#n22-p2a-copilot-cli-permissionsession-authority--evidence-only-no-rule),
which links to the ignored path — a tracked link to an untracked file, which resolves for nobody
else. **Not fixed here.** Moving the file or narrowing `.gitignore:83` is outside this round's
data-and-docs scope, touches a shared ignore rule, and is the kind of change that should be its own
reviewed decision rather than a side effect of a boundary correction. Registered as owed work; the
approval-authority closure itself does not depend on it, because every claim in this report is
anchored to a **tracked** file (the SSOT, the projections, the guard, this report, the tracker).

Also modified on this branch but **not part of this round** — pre-existing uncommitted new22 work:
`harnesses/cursor/index.html`, `artifacts/adr/0005-*.md`, `artifacts/gate-s1/open-items.md`,
`tests/invariants/gate-s1-claims.invariants.test.ts`, `NEW22_CLOSURE_REPORT.md`.

## §10 — the five required regression tests

All eight tests are in the one appended block. Mapping to the plan's numbering:

| plan test | how it is met |
|---|---|
| **TEST-01** host exists, no approval-policy evidence → no false detection, no SAFE inference | *"names the unobservable approval authority"* (4 layer subjects present in the SSOT) + *"may not read as SAFE"* (per-occurrence SAFE-negation, **plus** pins `authorityLayerVerdictFloor("unsupported") === "UNKNOWN"`) + *"reaches the served page and both machine surfaces, verbatim"* |
| **TEST-02** a page claiming full Copilot authority analysis must fail a truth gate | *"cannot claim full Copilot authority analysis"* — 4 over-claim regexes checked against **both** the SSOT and the served HTML; and *"states it as unobservable, not merely an unfinished feature"* requires `/unsupported/i` together with `/not statically observable\|no deterministic static evidence/i` |
| **TEST-03** existing GitHub/Copilot scan fixtures produce identical verdicts | *"changed no evidence, and so no verdict"* pins the evidence fields; corroborated below by a **zero-diff measurement** across all six verdict packages and the corpus |
| **TEST-04** adding unsupported approval authority must not alter scan output | same assertion; `truthfulCommands === []` and the primitive states are pinned, so a future edit that grows a claim reds |
| **TEST-05** review feedback and approval authority stay separate | *"CallLint's own CI gate is a check, and structurally cannot approve"* — asserted against `.github/workflows/calllint.yml` itself: a `permissions:` block exists, **no** `pull-requests: write`, **no** `pull_request_review`. A claim checked against code, not prose |

**Anti-vacuity comes first.** The block opens with a premise test (the host exists, is
`DISCOVERY_ONLY`, carries a non-empty boundary, and there are exactly 4 layer subjects). Without it
every later assertion could pass by describing a host that had been renamed away — this repo's
dominant fault class: *a guard that cannot observe its subject.*

## Negative controls — 12, each proven to red

Every assertion was mutated until the **intended** test failed, then restored and verified
**byte-identical with `cmp`** (never `git status`, which cannot see a byte-level revert). Script:
`d:\tmp\nc22b-negctl.sh`.

```
NC-01 required-approval removed from boundary              RED as intended
NC-02 branch protection removed                            RED as intended
NC-03 permission mode removed                              RED as intended
NC-04 both review-vs-approval spellings removed            RED as intended
NC-05 UNSUPPORTED downgraded to 'not covered'              RED as intended
NC-06 'fully analyzes Copilot authority' injected          RED as intended
NC-07 both check-is-not-approval clauses removed           RED as intended
NC-08 CI gate granted pull-requests: write                 RED as intended
NC-09 machine surface diverged from SSOT only              RED as intended
NC-10 served page only lost required-approval              RED as intended
NC-11 supportClass flipped to NATIVE                       RED as intended
NC-12 DISCOVERY_ONLY host gained a command                 RED as intended

restore verification: identical × 4 (SSOT, served page, agent-surfaces.json, workflow)
controls that red as intended: 12 ; controls that did NOT red: 0
```

Three of these are worth naming individually:

- **NC-08** mutates the *workflow*, not the prose: granting `pull-requests: write` makes the
  boundary's "cannot approve" claim false and reds TEST-05. The published claim is therefore
  anchored to the artifact, not to a sentence about it.
- **NC-09 / NC-10** mutate **only** the machine surface, and **only** the served HTML, leaving the
  SSOT correct. Each reds its assertion alone, proving those are independent readers of served
  bytes rather than restatements of the data file.
- **NC-11** reds 7 tests, which is the premise test doing its job: flip the support class and the
  whole block's anti-vacuity guard fails loudly instead of quietly re-scoping.

### Two faults found inside the control harness itself

Recorded because both would otherwise be reintroduced, and because in both cases the *harness* was
wrong rather than the guards:

- **All 12 controls reported `NO_REPORT` on the first run** — a total blindness, not a failure.
  Cause: MSYS path translation. `/d/tmp/nc22b-result.json` is translated when passed as a vitest
  CLI argument but **not** when interpolated into a `node -e` source string, where Node resolved it
  as `D:\d\tmp\...`. Diagnosed by probing both spellings; fixed by using `d:/tmp/...`, which vitest
  and Node agree on. This is the same class the previous round recorded one level up: *a control
  harness that cannot see failure reports success.* **No verdict was read from that run.**
- **NC-04 and NC-07 did not red on the second run, and the guards were correct.** Both assertions
  are alternations. NC-04 dropped `review feedback` while `/review (feedback|comment)/i` still
  matched *"a review **comment** carries information"*; NC-07 dropped `never an approval` while
  `/…|cannot satisfy/i` still matched *"it **cannot satisfy** a required-approval rule"*. Green was
  the right answer to a badly aimed mutation — exactly the new22 NC-02b diagnosis. **Both controls
  were rebuilt to remove the whole subject; neither guard was narrowed.** A guard weakened to make
  a control red is the defect these controls exist to catch.

## Verification

Node **v20.20.2**, pinned explicitly (`export PATH="/c/Users/admin/AppData/Local/nvm/v20.20.2:$PATH"`;
`node -v` confirmed before trusting any run — a green run under an unpinned version is not evidence).

| gate | result |
|---|---|
| `pnpm typecheck` | **EXIT 0** |
| `pnpm test` | **EXIT 0** — 277 files, **5682 passed / 1 skipped** (the same pre-existing skip) |
| `pnpm build` | **EXIT 0** |
| `pnpm corpus:test` | **EXIT 0** — "All corpus contracts hold"; toxic-flow gate failures **0** |
| `pnpm check:distribution-drift` | **EXIT 0** — projections byte-identical to the SSOT |
| `pnpm check:harness-distribution` | **EXIT 0** |
| `pnpm check:agent-surface` | **EXIT 0** |
| `pnpm check:public-copy` | **EXIT 0** |
| `pnpm check:security-semantics` | **EXIT 0** — `SECURITY_SEMANTICS = UNCHANGED` |
| the extended invariants file | **52 / 52 pass** (44 before; +8) |
| 12 negative controls | **12 / 12 red as intended**, restores `cmp`-verified |

**TEST-03, measured two ways.** The five GitHub corpus verdicts are unchanged — C017 `REVIEW`,
C025 `UNKNOWN`, C026 `UNKNOWN`, C029 `REVIEW`, C045 `UNKNOWN` (read from each case's
`expected.calllint.json`). Stronger than the expectation files: `git diff --name-only main` over
`packages/risk-engine packages/static-analyzer packages/policy packages/types packages/fingerprint
packages/core packages/fixtures` is **empty**, and `packages/types/src/authority.ts` is
**byte-identical to `main`**. No verdict-deciding code was touched at all, so no verdict *could*
have moved.

## §14 — the four required confirmations

1. **No verdict changes.** Zero diff across all six §18 verdict packages and the corpus, measured
   against `main`. `check:security-semantics` = `UNCHANGED`. The five GitHub corpus verdicts are
   identical.
2. **No detector changes.** No detector added, removed or modified. `CopilotApprovalDetector` and
   `GitHubBranchProtectionDetector` were **declined** (§4) — a detector with no evidence source
   manufactures confidence and breaks `UNKNOWN != SAFE`. `renderCiGate()` was read and left
   untouched.
3. **No runtime dependency.** No network call, no GitHub API, no credential, no remote org or
   branch-protection inspection, no runtime monitoring, no telemetry, no LLM classification, no
   clock. Nothing was added to any `package.json`.
4. **No fake evidence.** No fixture was created for a file that does not exist. Copilot exposes no
   local artifact stating approval policy or branch protection, so inventing one would fabricate an
   artifact the product does not provide. Every control mutates a **real** shipped file (the SSOT,
   the generated page, the machine surface, our own workflow), and the assertions express *"this
   authority is not covered"* — never *"we parsed it"*.

Additionally: **UNKNOWN remains UNKNOWN.** `authorityLayerVerdictFloor("unsupported") === "UNKNOWN"`
is pinned by a test in this block, and the boundary states the authority as `UNSUPPORTED` *"rather
than reading it as SAFE"* — the word form four shipped assertions already depend on.

## §11 — what was deliberately not done

Each was a live option, declined on evidence:

- **No `CopilotApprovalDetector`, no `GitHubBranchProtectionDetector`** — the authority chain has no
  locally readable link.
- **No GitHub API call, no user GitHub credential, no remote org-settings read, no remote
  branch-protection read, no runtime monitoring, no telemetry, no LLM classification.**
- **No invented configuration format**, and **no fabricated fixture** for a nonexistent file.
- **No schema change** — `CopilotApprovalFinding`, `CopilotApprovalRisk` and
  `GitHubApprovalAuthority` were all declined (§9).
- **No verdict-semantics change, no risk-scoring change.**
- **No architecture redesign** (§8) — one data field, one test block, three documents.
- **Not committed, not pushed, not published** (§16). Stopping at implementation review.

## Still open after this round

- **`COPILOT_PERMISSION_AUTHORITY_WATCH.md` is untracked** (`.gitignore:83`), so the P2-a evidence
  and its five questions reach nobody who clones the repo, and `N22-P2a` links to a path that
  resolves only on this machine. Owed: either move it under a tracked path or narrow the ignore
  rule — a shared-surface decision, deliberately not bundled into this round.
- **`COPILOT_PERMISSION_AUTHORITY_WATCH.md` Q1–Q3 and Q5 remain unanswered**, so `N22-P2a` stays
  OPEN and there is still no Copilot permission detector. Q4 (where a resumed session's authority
  lives) is now answered *in the boundary rather than by a detector* — which is precisely the
  outcome Q4 specified if the state lives anywhere CallLint cannot read.
- **Approval authority stays `UNSUPPORTED` indefinitely, not pending.** Unlike config
  auto-discovery, this is not waiting on an extractor. It would become observable only if GitHub
  published a locally readable, stable, documented artifact declaring approval policy — and a
  reader should not be led to expect that.
- Pre-existing and untouched by this round: **R-9** (Aliyun rolling worker enable — an ops act on
  the host), **Gate S1** (`processing-time-mean-p95` needs one ingest; `disk-growth` needs calendar
  time), **Gate S2** (blocked on the ADR 0009 instrumentation, not on cadence).