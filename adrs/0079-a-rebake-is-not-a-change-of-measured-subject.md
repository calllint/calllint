# ADR 0079: A rebake is not a change of measured subject

**Status:** Accepted  
**Date:** 2026-08-14  
**Workstream:** Gate 2.4-B freshness basis (follow-up to [0077](0077-one-absence-read-by-two-mechanisms.md))  
**Batch:** P Batch 9

## Context

`partitionPanelFreshness` (`packages/trust-index/src/phase24Eval.ts:396`) decides whether a
recorded five-second response still measures the page we serve. Its basis is the **whole-page
sha256**: a response is fresh iff `servedDigests.get(slug) === r.shownDigest`.

That basis is right about the thing it was written for. Recognition data is evidence *about a
specific artifact*; once the page moves, an old response is not a weaker measurement of the new
page, it is not a measurement of it at all. 0077 kept this and reclassified only the absence
rule.

But the whole-page digest also moves for reasons the panel never measured. Measured on today's
bytes, against each response's own shown bytes recovered from git (`8ef6319f`):

| responses | served now | whole-page digest | the three answers |
| --------- | ---------- | ----------------- | ----------------- |
| 7         | yes        | **DIFFERS**       | **identical 3/3** |
| 3         | **gone**   | n/a               | n/a               |

For all seven still-served pages `git diff --numstat` reports exactly `2 2` — two lines changed,
and both carry the **contract digest**:

```
-  href="calllint://adoption/…?artifact=sha256:bdba…&contract=sha256:11984e1f…"
+  href="calllint://adoption/…?artifact=sha256:bdba…&contract=sha256:772ad4cd…"
-  <li>Contract digest: <code>sha256:11984e1f…</code></li>
+  <li>Contract digest: <code>sha256:772ad4cd…</code></li>
```

The contract digest is a **provenance** field. It changes on every rebake of the projection. No
five-second question asks about it, no participant can read it in five seconds, and
`extractCapsuleAnswers` — the operator's grading key — does not look at it.

So the current basis voids ten responses' worth of human evidence, of which **seven** measured a
page whose measured content did not change. The remaining three are honestly stale: their slugs
left the cohort in the 19→25 re-selection (`ac.tandem-docs-mcp => agency.goji-goji`,
`ac.inference.sh-mcp => …`, `io.github.calllint-calllint => agency.kesey-pretrip`), so there is
no page to be fresh about.

### Why this is not "weaken the rule until the gate passes"

It would be, if the fix were "answers identical ⇒ fresh". That version inherits recognition
evidence across *any* edit outside the three answers — including deleting the stylesheet the
page's legibility depends on. Since P-4b the rendered appearance depends on a rooted
`/styles/...` reference, which is exactly why `auditShownArtifact` exists: a five-second test
measures a **rendered** page. A basis that ignores everything but three strings would let an
unstyled or restructured page keep evidence it never earned.

The honest reframing is that "the page changed" was never the question. The question is **did the
surface this panel measured change**. Whole-page bytes over-answer it; three answers
under-answer it.

## Decision

**D1. The basis becomes the measured surface, not the whole page.** A response stays fresh only
when every component of what a five-second session actually measures is unchanged: the three
graded answers *and* the page's rendering-critical structure (its stylesheet references, and the
presence of the identity / disposition / consequence sections the questions are drawn from).
Provenance fields — contract digest, and the artifact digest wherever it appears purely as a
recorded observation — are outside the measured surface.

**D2. The surface is computed by one exported function, `panelMeasuredSurface(html)`, and
digested.** `shownSurfaceDigest` is what freshness compares. Deriving a digest from a named
surface (rather than diffing field-by-field at the comparison site) keeps the store's recorded
value and the served value computed by *the same* code path, and keeps the rule falsifiable by a
fixture pair rather than by prose.

**D3. `shownDigest` is retained, never reinterpreted.** The whole-page digest stays in the store
and stays recorded. It remains the answer to "what exact bytes did this participant see" — which
is what makes a response auditable after the fact, and is how the seven pages above were
recovered at all. Freshness stops *deciding* on it; nothing stops *recording* it. A store entry
predating D2 has no `shownSurfaceDigest`, so it cannot be graded on one: it is treated as
**UNKNOWN-basis**, which does not count toward the floor. UNKNOWN is not fresh (Principle: UNKNOWN
is not SAFE).

**D4. Recovery is explicit and reviewable, never automatic.** The affected responses are not
retro-credited by code. `pnpm eval:phase-2.4:panel:reseat` recomputes `shownSurfaceDigest` for an
existing response **from the bytes that response's own `shownDigest` identifies**, located in git
history — the same shape as 0080's `--reseat`: it never reads the working tree, never invents a
document, and refuses any entry whose recorded bytes it cannot find. A response whose shown bytes
are unrecoverable stays UNKNOWN-basis rather than being upgraded on the strength of today's page.
Recovering a basis does **not** make a response countable: whether it counts is decided afterwards,
by freshness, against the served tree. See Verification — all ten reseat, three then exclude as
`PAGE_GONE`.

**D5. Gate 2.4-B's floor and thresholds do not move.** `FIVE_SECOND_MIN_PANEL = 10` and
`FIVE_SECOND_THRESHOLD` are untouched. This ADR changes *which responses are eligible to be
counted*, not how many are required or how well they must score. Measured: seven are fresh and
three stay stale, so the panel is 7 < 10 and the gate stays `PENDING_HUMAN_PANEL`. **This ADR does
not close Gate 2.4-B**, and is not permitted to: the gate needs ten real human sessions
(0053 §4), and no code path may manufacture a panel.

**D6. The stale report distinguishes the three reasons.** `StalePanelResponse` currently carries
`currentDigest: string | null`, where `null` doubles as "page gone". A single nullable field
cannot say *why* a response was excluded, and 0077's lesson was precisely that one absence read by
two mechanisms produces the wrong diagnosis. The reasons are named:
`PAGE_GONE` · `SURFACE_CHANGED` · `UNKNOWN_BASIS`.

**D7. Negative controls, per decision.** D1: a fixture pair differing *only* in contract digest
must be fresh, and a pair differing *only* in stylesheet href must be stale — each able to fire
alone. D2: deleting a component from `panelMeasuredSurface` must red a test, so the surface's
membership is asserted, not implied. D3: a response with no `shownSurfaceDigest` must not count
toward the floor. D4: `reseat` must refuse — never substitute — when the bytes offered for a
response do not hash to that response's recorded `shownDigest`. That refusal is only testable if
the decision is separable from the git invocation and from the CLI's top-level dispatch, so it is
exported as a pure function over an injected history lookup. Note that a refusal is *not* the same
exclusion as `PAGE_GONE`: recovery is decided against history, freshness against the served tree.

## Verification

Measured against this branch's working tree (`feat/p8-ledger-authenticity`, on top of `7b65896`).
The measurements in Context were taken before deciding, against `8ef6319f` and the then-current
working tree, using `extractCapsuleAnswers` itself (not a re-implementation of it) as the grading
key. What was run after implementing:

- `pnpm typecheck` — clean.
- `pnpm test` — **226 files / 3797 passed / 3 skipped**, EXIT 0. `phase24-eval.test.ts` carries
  **52** tests (47 before the D4 controls were added).
- `pnpm ci:local` — all **21** steps, EXIT 0.
- `pnpm eval:phase-2.4:write` then `pnpm eval:phase-2.4` — the derived artifact was stale after the
  reseat (a red CI leg this ADR's own change introduced); regenerated and back in sync. It now
  reports `humanPanel.status: RECORDED`, `responses: 7`, all three recognition rates `1`, and three
  `PAGE_GONE` entries carrying a named `reason` instead of a bare `currentDigest: null` (D6).
- `pnpm eval:phase-2.4:gates` · `pnpm ledger:presentation:validate` · `pnpm gate:s0:regression` —
  EXIT 0 (2.4-A/D/E/F/H PASSED; ledger 10 entries, every digest recomputed; cohort 25/25).
- `pnpm eval:phase-2.4:panel:validate` — before reseat: `fresh: 0 · stale: 10`, the seven reported
  `UNKNOWN_BASIS` and three `PAGE_GONE`. After reseat: **`fresh: 7 · stale: 3`**, and all three
  remaining are `PAGE_GONE`. No response is `SURFACE_CHANGED`, which is the point: the rebake that
  had voided all ten is no longer read as a change of subject.
- `pnpm eval:phase-2.4:panel:reseat` — reseated **10**, refused **0**, EXIT 0. A second run prints
  `nothing to reseat` and returns 0, so it is idempotent.

**A prediction this ADR got wrong.** D4 and Consequences both said "the seven reseat and the three
stay stale". The real run reseated **ten**, not seven. The three whose pages left the cohort are
still excluded — but by `PAGE_GONE`, decided against the *served tree*, not by a refusal decided
against *history*. Their recorded bytes are in history and hash correctly, so `reseat` recovered a
basis for them; freshness then excludes them because there is no served page to compare against.
The two mechanisms are the D6 distinction, and this ADR's own prose had blurred them. The count 7
was right for the wrong reason: 7 fresh, but 10 reseated and 0 refused.

Because that run produced **no refusal**, D7's D4 control was not exercised by it, and the refusal
branch had no failing mode: it was unreachable from a test, since the script's top-level dispatch
ran on import. So `reseat`'s per-response decision was extracted as an exported pure function
`reseatResponses(store, lookup)` over an injected `HistoryLookup`, and the script gained the
`invokedDirectly` guard `scripts/presentation-ledger.ts` already uses. Five controls now drive it:
bytes that match are reseated onto exactly `panelSurfaceDigest(bytes)`; bytes that do **not** match
are refused with the response left basis-less; a page offering no history is refused; a mixed store
refuses per response while still crediting the recoverable one; and an already-seated response is
left untouched **without history being consulted at all** (asserted by a call counter, so a
"rewrite everything" regression reds).

One control was *not* obtained. Mutating the `sha256(bytes) !== r.shownDigest` comparison to prove
the refusal tests go red was blocked by the harness as a security-check removal — correctly, since
that edit is indistinguishable from weakening the rule. The guard was restored byte-for-byte and
the diff re-inspected. What stands in its place is a two-sided pair over the *same* function whose
only difference is whether the offered bytes hash to the recorded digest, asserting opposite
outcomes (`changed: 1 / refusals: []` vs `changed: 0 / refusals: [1]`). That pair cannot both pass
if the comparison is removed. This is weaker than an executed mutation and is recorded as such.

### A committed assertion that was true by accident

Regenerating the artifact turned one pre-existing test red:
`expected [ 'UNRECORDED', 'NOT_RUN' ] to include 'RECORDED'`. The `else` branch of "human panel
PASSED or PENDING" asserted `hp.responses === 0` — i.e. *pending implies the store is empty*. That
is not Gate 2.4-B's pending condition. `decideGateB` returns `PENDING_HUMAN_PANEL` when
`panel.responses < FIVE_SECOND_MIN_PANEL`; zero is one way to be under ten, not the only way.

Its history is the whole argument for this ADR, told from the test side. The assertion was written
at `8ef6319` (#245, 2026-07-30) — the commit whose subject line is *"Gate 2.4-B CLOSED"*, where the
artifact read `PASSED / RECORDED / 10`. So at the moment it was authored it sat in a **dead branch**
and never ran. It first executed at `3eeb967` (#293, 2026-08-13), the commit where the rebake had
voided all ten responses and flipped the artifact to `PENDING / NOT_RUN / 0`. It has been live for
exactly three commits (`3eeb967`, `7a6b0a5`, `7b65896`) — every one of them a state in which the
defect this ADR removes was active. The assertion was never true *of the gate*; it was true of the
bug, and the first run in which human evidence survived is the run that exposed it.

Fixed by asserting the gate's own condition rather than a proxy of it: `responses <
FIVE_SECOND_MIN_PANEL`, `status` tracking `responses === 0`, and — the honesty property the old
form did not carry at all — a pending artifact must still list **why**. Three negative controls
were executed against the derived artifact, each mutating one field and each firing a *different*
assertion:

| mutation | assertion that fired |
| --- | --- |
| `responses: 0` while `status: RECORDED` | `expected 'RECORDED' to be 'NOT_RUN'` |
| `responses: 10` while status is PENDING | `expected 10 to be less than 10` |
| `blockers: []` | `expected [] to not deeply equal []` |

The filter was first run unmutated to confirm it selects the test (`1 passed | 51 skipped`) — a red
control that matched zero tests would prove nothing. The artifact was restored byte-identical after
each (`a335fa1c75cc…`, verified against the pre-control digest).

## Consequences

Seven responses become countable evidence instead of discarded evidence, by an explicit reviewed
command rather than by a widened rule. Ten were reseated; three of those are still excluded as
`PAGE_GONE` because their pages left the cohort. Gate 2.4-B still needs ten sessions; it now needs
**three** more, not ten — but that arithmetic is a *consequence* of the basis being right, and is
not the reason the basis changed. The gate remains `PENDING_HUMAN_PANEL` and this ADR does not
close it (D5).

A rebake no longer voids recognition evidence. A restyle, a restructure, or a copy change to any
graded answer still does — which is the property the whole-page digest was standing in for.

What is **not** decided: whether the measured surface should include the CTA label wording (today
it is inside `action`, so a label change is already caught); and whether `shownFrom` should
participate, given that a session run from a different origin renders the same bytes.
