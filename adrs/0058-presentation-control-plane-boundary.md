# ADR 0058 — Presentation Control Plane: making copy, layout, and tokens configurable without letting configuration reach the decision plane

- Status: Accepted (2026-07-28). Boundary-only decision artifact; changes **no**
  behavior and **no** served byte. It freezes the invariants the Phase-2.4 second
  half (new15 Workstream P — Structured Content Schema, Copy Catalog, Layout
  Manifest, Authority-Consequence Templates, Host Presentation, Agent Relay Copy,
  Design Tokens, Preview/Snapshot harness, Config Digest & Rollback) must honor
  before any of it is built. Written first in Workstream P / Batch 0 / PR P-0.
  Acceptance authorizes the PR P-1 build to begin under these boundaries; it does
  **not** by itself lift one string, add one token, or change one emitted byte.
- Date: 2026-07-28 (PR P-0)
- Refines: 0056 (safe-install acquisition projection — the direct parent; this ADR
  makes 0056's *copy* configurable while leaving 0056's projection logic, verdict
  route, and exact-target gate untouched), 0038 (public Trust Index boundaries —
  serving reads committed static assets only; a config plane must not turn serving
  into rendering), 0053 (distribution-index boundary — publish channels)
- Related: 0020 (reason codes are a projection of findings — the precedent this ADR
  extends one layer outward: consequence *sentences* are a projection of reason
  *codes*), 0035 (authority manifest), 0036 (install-plan approval binding — the
  sealed plan whose digest must survive every copy edit), 0039 (decision-receipt
  v1), 0043 (schema `$id`/domain convention — the new presentation schema follows
  it), 0055 (agent-search capture & safe-install gateway boundary)

## Context

new15 Workstream P is the unbuilt second half of Phase 2.4. Phase 2.4 Batches 1–9
shipped the *projection*: one baked fact object per resource driving a human Install
page, a sealed Agent Adoption Contract, a CLI route, and five MCP tools. What it
shipped with is **hardcoded copy** — every CTA string, every authority-consequence
sentence, every section heading is a TypeScript constant, and the emitted pages
carry **no stylesheet at all** (verified 2026-07-28: `grep -c 'stylesheet\|<style'`
over the 19 served install pages returns 0).

That is not an oversight to be embarrassed about — it is the correct shipping order.
Copy that lives in code is copy that cannot drift behind a CMS, and a page with no
CSS cannot hide a decision behind a visual affordance. But it is not a resting
state either: Gate 2.4-B measures whether a human recognizes target, consequence,
and next action within five seconds, and five-second recognition is substantially a
question of visual hierarchy. Recognition cannot be tuned when every string and
every spacing value requires a TypeScript edit reviewed as engine code.

So Workstream P has to make wording, layout, and tokens **configurable**. And that
is exactly the move that has to be bounded before it is built, because a
presentation control plane is one millimetre from the line CallLint has drawn in
0038, 0047/0048, 0053, 0054, 0055, and 0056: *presentation must never become a
second decision surface.* A config plane that can edit "No blockers observed" can,
one careless commit later, edit what "no blockers" means — or worse, edit a string
that a sealed install plan binds, silently invalidating every agent's expected
digest without any real change to the artifact.

## The problem this ADR actually solves

Existing ADRs bound *who may decide*. None of them bound *what a config edit may
reach*. Without that boundary, "make copy configurable" has no reviewable stopping
point: every subsequent PR gets to argue afresh whether one more field is
"presentation".

The prior art in this repo is 0020: reason codes are a deterministic projection of
findings, and that is why introducing them added no second risk engine. Workstream
P is the same shape one layer outward — consequence sentences are a deterministic
projection of reason codes — and it needs the same kind of hard edge.

## Decision

### §1 A level is defined by digest reachability, not by opinion

The four configuration levels new15 names (L0 visual tokens · L1 cognitive copy ·
L2 security-explanation copy · L3 behavioral semantics) are **not** assigned by
judgment. A field's level is determined by a mechanical question:

> Can this value reach `contractDigest`?

- **Reachable ⇒ L3.** It is behavioral semantics. It is owned by code, schema, and
  ADR; it is never editable from `apps/web/content/**`. Changing it changes every
  sealed Agent Adoption Contract and therefore invalidates `expectedContractDigest`
  in every install plan derived from it.
- **Not reachable, and appears only in human HTML ⇒ L1 or L2.** It is presentation.
  It is editable as configuration. L2 (security-explanation copy: authority
  consequence sentences, limitation wording, agent relay summaries) additionally
  requires security-owner review; L1 (CTA, support lines, section titles, guard
  conversion copy) requires public-copy review.
- **Not reachable, and appears only in CSS ⇒ L0.**

This is testable rather than assertable, and PR P-0 tests it: a mutation probe
perturbs each copy constant, re-projects, and records which digests move. The
resulting classification is a measured artifact
(`artifacts/phase-2.4/presentation-plane-audit.json`), not a hand-maintained table,
so it cannot drift from the code it describes.

The audit's finding at acceptance time: `OBSERVED_CONSEQUENCE`,
`ABSENCE_CONSEQUENCE`, and `PRIMARY_CTA` are **unreachable** from `contractDigest`
(the contract's `authorityDelta.adds` carries the authority *token*, never the
sentence), while `VERDICT_PUBLIC_LABEL` **is** reachable. INV-P1 therefore already
holds structurally in the shipped code — as a consequence of good layering, not of
an enforcement mechanism. §5 supplies the missing mechanism.

### §2 Configuration is a parameter, never an import

Renderers stay pure. `renderSafeInstall`, `safeInstallProjection`, and
`selectDecisionAuthorities` must remain functions with no filesystem access, no
clock, and no ambient state, because that purity is what makes the bake
byte-reproducible and unit-testable against plain objects.

Therefore presentation configuration is **read at the emit edge** (in
`emitSafeInstall`, which already performs I/O) and **passed inward as an argument**.
No module under `packages/*/src/**` may `import` a file from `apps/web/content/**`
or `apps/web/styles/**`, and no renderer may read a path at all. A config plane that
is imported is a config plane that can be reached from anywhere; a config plane that
is a parameter can only be reached by whoever was handed it.

### §3 Configuration selects; it never invents

The above-the-fold structure is the shipped six-group human display contract
(new14 §7: identity · disposition · one-sentence consequence · ≤3 authority facts ·
one primary action · ≤2 secondary links). The Layout Manifest may **select** among
orderings the code already implements and validates; it may not introduce a group,
delete a group, or reorder into an arrangement the renderer does not structurally
support. Likewise the Authority-Consequence Templates supply wording **per shipped
reason code**; they may not add a code, rename a code, rename `notObserved` to
`denied`/`absent`/`impossible`, or coin a consequence for a capability the engine
does not observe.

Concretely forbidden, carrying new15 §18.3 forward: one config file per MCP server,
per-resource HTML, per-resource CSS, per-resource JavaScript, per-resource agent
instructions. Permitted structured per-resource overrides are limited to
`displayName`, a human-readable scope alias, a known original setup URL, an expiry,
and a reason — none of which may affect a decision field.

### §4 Byte-identity is the default; a visual change is its own PR

Every Workstream P batch that lifts, refactors, or reorganizes copy must reproduce
the committed served tree **byte for byte**. The existing reproducibility gate
(`packages/trust-index/test/safe-install/committed-install-tree.test.ts`) is the
enforcement, and it is not to be relaxed for the convenience of a refactor.

**Spec correction (binding).** new15 §6.2 lists PR P-4 (Design Tokens) as
"changes served bytes: no". That is not physically satisfiable: a page cannot
acquire visual hierarchy without an HTML reference to a stylesheet, and adding that
reference changes bytes. Per new15 §1 (shipped reality outranks planning prose),
P-4 is split:

- **P-4** deploys `apps/web/styles/**` as assets and changes **no** HTML byte.
- **P-4b** adds the stylesheet reference. It is the **only** Workstream P PR
  permitted to change served bytes, it re-baselines the reproducibility gate in the
  same commit, and it lands with a visual snapshot.

Hiding a byte change inside a batch labelled "no byte change" is precisely the drift
this repo's gates exist to catch.

### §5 The mechanisms that make the boundary enforceable

Boundaries that rest on reviewer vigilance decay. Four gates carry these
invariants, each mapping to one invariant from new15 §8:

1. **Semantic-isolation probe (INV-P1).** For every L1/L2 constant: mutate it,
   re-project, assert `contractDigest`, `artifactDigest`, `evidenceDigest`, and
   `decisionDigest` are byte-identical. For `VERDICT_PUBLIC_LABEL`: mutate it and
   assert `contractDigest` **does** move — a boundary that never fires on the
   negative case is proving nothing.
2. **Behavior-isolation probe (INV-P2).** Under any config mutation, `verdict`,
   `installability`, and `recommendedNextAction.kind` are invariant.
3. **Config-integrity + rollback gate (INV-P3).** Every emitted tree carries a
   valid `presentationDigest` recorded in a committed lock file; no orphan config
   references; the previous digest is restorable and reproduces its bytes.
4. **Vocabulary gate (INV-P4).** `check:public-copy` extends its scan to
   `apps/web/content/**`, so both forbidden-phrase sets (Trust-Page and
   Safe-install) apply to configuration exactly as they apply to emitted bytes.
   `VERDICT_PUBLIC_LABEL` is not overridable from configuration at all.

`presentationDigest` is recorded in a committed lock file rather than embedded in
the page, because embedding it would make every page byte a function of the config
plane and would force a byte change in batches that must not have one (§4).

### §6 What stays code, permanently

Not editable from the presentation plane, in any batch, without a new ADR:

- the four verdict labels and the reason-code set (INV-P4);
- `recommendedNextAction` and its `kind` discriminant; `mustAskBefore`,
  `mustStopWhen`, `prohibitedShortcuts`, and the six protocol `steps` of
  `AGENT_GUIDANCE` — new15 §20.1's `AgentProtocolPolicy` (L3). Only new15 §20.2's
  `AgentRelayCopy` (headline, reason, adds, notObserved, approval question, guard
  offer wording) is L1-editable, and relay copy may never add or remove a protocol
  trigger;
- the verdict→installability route and the exact-target degradation gate
  (INV-2.4-06);
- the publisher-content quarantine (INV-2.4-05): publisher text renders only in its
  labelled block, and no config may relocate it into a decision group;
- the no-decision-JavaScript rule: the emitted page has no `<script>` and no inline
  handler, in every batch, including after P-4b.

## Consequences

**Accepted cost.** Configuration adds an indirection: reading the emitted wording
now means reading a JSON file plus a renderer, not one constant. The mutation-probe
artifact is the mitigation — it states, mechanically, which file governs which byte.

**Accepted cost.** `presentationDigest` in a lock file rather than in the page means
a consumer cannot read the page alone and learn which config produced it. That is
the deliberate trade for §4; the lock file is committed, so the mapping is public
and auditable, just not inline.

**Rejected: a CMS service.** v1 content edits are ordinary pull requests (new15 P10
is DEFER). A live CMS would place a mutable external input upstream of published
bytes and defeat §4's reproducibility gate.

**Rejected: per-page templates.** §3. The product is one durable record with many
deterministic views, not a page factory.

**Unchanged.** No verdict moves. No page byte changes at acceptance. The inherited
kernel invariant holds: no LLM in the critical decision path — all gates pass with
`llm.enabled=false`. An LLM may summarize evidence; it never decides, and it never
writes configuration that reaches a decision field.
