# 03 — Verdict and disposition map

Answers T0 question 2: *is `REQUIRE_CONFIRMATION` a verdict, a disposition, or does it not exist?*

**Status: the name is `ABSENT`, the capability `EXISTS`.** `REQUIRE_CONFIRMATION` has **0**
occurrences in tracked files (`git grep -c REQUIRE_CONFIRMATION -- .` → 0 files). "Human
confirmation is needed" is nevertheless expressible today, in **five** independent closed
vocabularies, each owned by a different layer.

Recording the count is the point. A design that introduces `REQUIRE_CONFIRMATION` as a new verdict
would not be filling a gap — it would be adding a sixth vocabulary to five that already agree.

## The one verdict authority

| Claim | Binding | Measured |
| --- | --- | --- |
| There are exactly four verdicts | [packages/types/src/verdict.ts:5](../../packages/types/src/verdict.ts#L5) | `["SAFE", "REVIEW", "BLOCK", "UNKNOWN"]` |
| Array order is not severity order | [verdict.ts:1-4](../../packages/types/src/verdict.ts#L1-L4) | Stated in the docblock; `VERDICT_SEVERITY` is separate |
| `UNKNOWN` outranks `REVIEW` | [verdict.ts:10-12](../../packages/types/src/verdict.ts#L10-L12) | Verbatim: *"insufficient evidence must not be treated as merely needing review"* |

**`REVIEW` is where "needs confirmation" lives at the verdict layer.** It is a verdict, not a
disposition — and it is one of four, in a closed tuple, consumed by every surface. The repository
contract labels it *"Review required — Human confirmation needed"*.

## The five vocabularies

Each is closed (a `const` tuple or a total `Record`), each is owned by one layer, and each has a
distinct member meaning "a human must confirm":

| # | Layer | Vocabulary | The confirm member | Binding |
| --: | --- | --- | --- | --- |
| 1 | Verdict | `SAFE` `REVIEW` `BLOCK` `UNKNOWN` | **`REVIEW`** | [verdict.ts:5](../../packages/types/src/verdict.ts#L5) |
| 2 | Decision `nextAction` | `continue` `ask_before_continue` `stop` `gather_more_evidence` | **`ask_before_continue`** | [decision.ts:25,45](../../packages/types/src/decision.ts#L25) · rendered at [renderDecision.ts:13-18](../../packages/report-renderer/src/renderDecision.ts#L13-L18) |
| 3 | Continuous-guard action | `silent` `note` `prompt` `request-evidence` `refuse` `fail-closed` | **`prompt`** | [continuousGuard.ts:26-32](../../packages/core/src/state/continuousGuard.ts#L26-L32) |
| 4 | Preflight recommendation | `proceed` `review` `gather-evidence` `stop-and-confirm` | **`review`** (and `stop-and-confirm` for BLOCK) | [recommend.ts:25-30](../../packages/agent-triggers/src/recommend.ts#L25-L30) |
| 5 | Report label | *"Review required"* | — | repository contract's verdict-semantics table |

### They are projections of one another, not competitors

Two of the four mappings are committed as total records, which is what makes this a projection
rather than five parallel decisions:

```
VERDICT_TO_RECOMMENDATION   (recommend.ts:62-67)
  SAFE    → proceed
  REVIEW  → review
  UNKNOWN → gather-evidence
  BLOCK   → stop-and-confirm
```

```
continuousGuard.ts:18-23   (drift severity → action)
  no drift              → silent
  drift, worst SAFE     → note
  drift, worst REVIEW   → prompt              ← the confirm path
  drift, worst UNKNOWN  → request-evidence    (never SAFE, I-04)
  drift, worst BLOCK    → refuse
  guard's OWN failure   → fail-closed         (ADR 0045 §3)
```

Three properties of these maps bear on any trajectory design:

1. **`UNKNOWN` never collapses into the confirm path.** It maps to `gather-evidence` /
   `request-evidence`, not to `review` / `prompt`. Product principle 2 is enforced at every
   projection, not just at the verdict.
2. **Vocabulary 3 has a member the others lack: `fail-closed`,** for the guard's *own* failure.
   The other four vocabularies have no way to say "I could not run." A trajectory design that
   needs to distinguish "no trajectory violation" from "trajectory analysis failed" would find
   only vocabulary 3 capable of it today.
3. **Nothing in vocabularies 2–5 blocks.** `stop-and-confirm` is annotated verbatim as *"advice to
   a human, not an enforced veto (ADR 0051 §1)"* ([recommend.ts:11](../../packages/agent-triggers/src/recommend.ts#L11))
   and *"strongly advise stopping, but do not force it"* ([recommend.ts:29](../../packages/agent-triggers/src/recommend.ts#L29)).
   See [04](04-host-evidence-capability-matrix.md) — this is structural, not a current limitation.

## Verdict vs disposition, stated plainly

The question's framing assumes the two are alternatives. In this repo they are layers:

- **Verdict** is what the deterministic rules decided: one of four, owned by `packages/risk-engine`,
  and per product principle 5 an LLM may never decide it.
- **Disposition** is what a *surface* should do about that verdict: `nextAction` for the decision
  document, `GUARD_ACTIONS` for the continuous guard, `RECOMMENDATIONS` for the preflight hook.

So `REQUIRE_CONFIRMATION` would be a **disposition** in this repo's vocabulary — and each of the
three disposition layers already has one. It would be a verdict only if a trajectory violation
warranted a fifth verdict, which would move a stable enum consumed by every surface and requires an
ADR under the repository contract.

## What this chapter does not claim

- Not that five vocabularies is the right number. It is measured as five, with two committed total
  maps that keep them consistent. Whether they should be unified is not a T0 question.
- Not that `REVIEW` is semantically adequate for a trajectory finding. It records that `REVIEW`
  exists and carries "human confirmation needed" today; whether trajectory needs a distinction
  `REVIEW` cannot express is a T1 question, raised in [09](09-recommended-delta.md).
