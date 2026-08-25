# ADR 0002 — `submission` records the act, on its own axis, with no second status

- **Date:** 2026-08-23
- **Status:** Accepted
- **Scope:** `apps/web/data/distribution-surfaces.schema.json` (`definitions.primitive`);
  `apps/web/data/distribution-surfaces.json`; `scripts/check-harness-distribution.mjs`
  (HD-08); `tests/invariants/submission-axis.invariants.test.ts`
- **Supersedes nothing. Extends:** [ADR 0001](0001-one-distribution-state-not-six.md), whose
  argument this reuses and whose `READY_NOT_SUBMITTED` loose end it closes.

## Context

new20 §4 asks for a submission record carrying a **status** and a **date**. ADR 0001 had
already met the same section's `surfaceStatus` request by adding one enum member instead of
six, on the grounds that an enum value no record exercises "is documentation wearing a
schema's clothes". §4's remaining ask was still open.

The defect underneath it was real and narrow. `state` was carrying two questions at once:
where the **listing** sits, and whether a **human has acted**. Those come apart.
`cline`/`cline-marketplace-pr` had a genuine submission — PR
[cline/marketplace#49](https://github.com/cline/marketplace/pull/49), opened 2026-08-18,
still open — and the SSOT could not say so on any field a consumer reads. What it held was a
`submissionUrl` and a prose `note`: `"Existing PR #49 (open, verified 2026-08-23), do not
create duplicate"`.

That parenthesis is the whole finding. `2026-08-23` is the day we last **checked**, not the
day anyone **acted**. The act's date was therefore recorded nowhere in the repository, and
every other shelf channel — thirty of them, none touched by anyone — was structurally
indistinguishable from this one to any machine reading `state`.

## Decision

Add one optional field, `submission`, on a new axis. Do **not** add a status.

1. `definitions.primitive.properties.submission` — an object, `required: ["date"]`,
   `additionalProperties: false`, the date `pattern`-checked as `^\d{4}-\d{2}-\d{2}$`.
   A block rather than a flat `submittedOn`, so that anything else on the human-action axis
   attaches inside it instead of accreting sibling date keys next to the listing fields.
2. **Schema arm 3** — `submissionUrl ⇒ submission`. Naming where you submitted asserts that
   someone submitted, so the date must have a home.
3. **Schema arm 4** — `submission ⇒ state ≠ READY_NOT_SUBMITTED`. The one corner where the
   two axes can contradict, made unrepresentable.
4. **HD-08** — the two things a JSON Schema regex structurally cannot say: that `2026-02-31`
   is not a calendar day, and that a date is not in the future.
5. `cline`/`cline-marketplace-pr` records `submission.date: "2026-08-18"`, measured from the
   PR's own `createdAt` via a read-only `gh pr view` (new18 §87: the watcher never writes
   outward — §22 was a miscitation, corrected 2026-08-25).

### Why there is no `status`, though §4 asks for one

Enumerate what the field would carry, and check each value against what the SSOT can
already say:

| §4 status | Already representable as | Enforced by |
|---|---|---|
| submitted | this block existing | schema arm 3 |
| accepted | `state: AVAILABLE` + `liveUrl` | HD-07 (evidence required) |
| rejected | `state: BLOCKED` + `blocker` | HD-05 (a reason required) |
| withdrawn | no record, and no consumer | — |

So a `status` enum would be **one redundant member, two restating `state` via fields a gate
already checks, and one unpopulated**. That is the second lifecycle §3 forbids, arriving in
precisely the shape ADR 0001 rejected when §4 asked for six `surfaceStatus` values — and it
would restate `state` badly, because nothing could stop `status: accepted` from sitting
beside `state: BLOCKED`.

What was genuinely missing was the **date**. That is what the field carries.

The absence is pinned, not merely explained: two tests assert that `submission` has exactly
one key and that the `state` enum still has exactly its five members. Adding `status` later
has to confront this ADR rather than accreting past it.

## Consequences

- **Arm 3 had a live subject on the commit that introduced it.** The shipped SSOT was
  *invalid* against arm 3 until the date was added — ajv reported
  `/hosts/10/distributionPrimitives/1 must have required property 'submission'`. This is the
  opposite of the repo's usual "vacuous today, constrains the first record written", and it
  is the strongest form of evidence that a rule is not ceremonial.
- **`READY_NOT_SUBMITTED` now has a checkable job.** ADR 0001 left it with zero records and
  nothing constraining it — defensible, but unguarded. Arm 4 constrains it while it is still
  unpopulated, which is the most a rule can do for a state no record exercises yet. It stays
  legal and stays empty; the invariant file observes that emptiness deliberately, so that if
  it ever fills, the arm stops being vacuous at a place someone will read.
- **The converse of arm 3 is deliberately not asserted.** Most shelf channels are web forms
  with no URL to point at, so `submission ⇒ submissionUrl` would be unsatisfiable rather
  than strict — it would push someone toward deleting a true date to satisfy a gate.
- **HD-08 cannot pass over an empty cohort.** Its floor is derived, not typed: because the
  schema requires `submission` wherever `submissionUrl` appears, a non-empty `submissionUrl`
  cohort with an empty `submission` cohort means the arm was removed or the SSOT is not
  being validated. HD-08 fails in that case rather than printing a checkmark over zero
  records — the repo's dominant fault class is a guard that cannot observe its subject.
- **`note` keeps its verification date, and that is correct.** "verified 2026-08-23" and
  "submitted 2026-08-18" are two different facts about the same PR. The field did not
  de-duplicate a date; it added a missing one.
- **Projections gain the age of a wait.** `CHANNEL-COUNTS.md` previously described
  `PENDING_UPSTREAM` only as "Waiting on someone else", which cannot distinguish a five-day
  wait from a five-month one. The recorded date makes the age derivable at generation time.

## Alternatives rejected

**Implement §4 literally, with `{status, date}`.** Rejected on the table above: three of
four values are already enforced elsewhere, and the fourth has no records. It also
reintroduces the contradiction class ADR 0001 spent HD-05 eliminating, since nothing would
check `status` against `state`.

**A new `state` enum member, e.g. `SUBMITTED`.** This is the option the sprint's binding
constraint — 不要增加新 lifecycle — names directly. It also fails on the merits: it would
overwrite the listing fact with the action fact, so a channel with an open PR could no
longer say that the listing is `PENDING_UPSTREAM`. Two independent facts need two fields.

**Leave the date in `note` prose.** The status quo. No gate reads `note`, nothing keeps it
true, and it had already drifted into recording the verification date instead of the
submission date — which is how this defect was found rather than a hypothetical.

**Record `verifiedAt` alongside `date`.** Deferred, not rejected on principle. Every
projection already stamps provenance from the SSOT's own `generatedAt`, so a per-channel
verification date would have exactly one record and one reader today. If a channel's wait
ever needs re-verification independent of a generator run, it belongs in this block.
