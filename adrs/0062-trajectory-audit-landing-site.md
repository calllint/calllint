# ADR 0062 — Where a trajectory audit lands: an audit that cannot be committed is not an audit

- Status: Accepted (2026-08-08). Boundary-only decision artifact. It moves the landing
  site of the **T0 trajectory-readiness audit** from the site its specification named to
  one where the specification's own delivery requirement can be met. It changes **no**
  behavior, **no** served byte, **no** schema, and **no** line of production code, and it
  publishes **zero bytes** from `docs/`. Written in the same batch that delivers the nine
  chapters it governs.
- Date: 2026-08-08
- Refines: 0051 (preflight hook boundary — the audit's Q1/Q8/Q9 subject), 0045
  (continuous guard command and hook — the source of the action-time-enum constraint the
  audit measures), 0042 (per-call runtime blocking, design-only — the freeze that makes
  RG-4 unmeasurable)
- Related: 0061 (canonical adoption graph — the concurrently edited ADR; §8.6 lands in
  this same batch), 0043 (schema `$id`/domain convention — why no schema is written here)

## §1 Numbering: this ADR is 0062, and two committed artifacts said otherwise

Two files merged the day before this one enumerate 0062 as belonging to Workstream M's
next batch (M26-1):

| File | What it said |
| --- | --- |
| [artifacts/mcp-2026-07-28/non-goals.md](../artifacts/mcp-2026-07-28/non-goals.md) | *"Write ADR 0062 — belongs to M26-1"* |
| [artifacts/mcp-2026-07-28/proposed-file-map.md](../artifacts/mcp-2026-07-28/proposed-file-map.md) | the same reservation, plus its own escape clause |

`proposed-file-map.md` carries the instruction **"Re-`ls adrs/` when authorized rather
than trusting this line."** Measured at authoring time: `adrs/` tops out at `0061`, and
`ls adrs/0062*` returns no match. So consuming 0062 here **executes that instruction
rather than overriding it**, and M26-1 uses **0063**.

Both lines are amended in place by **append**, deleting nothing — the same discipline
ADR 0061 §8.5 used when it declined to rewrite §8.4's now-false present tense. This
matters beyond bookkeeping: a reason that names a future batch becomes a lie the moment a
different batch lands first, and the repair is a traceable amendment, not a silent edit.

This ADR is 0062 rather than 0060 because **0060 is reserved, not free**: it is held for
the `propertyNames` schema defect recorded — *"RECORDED, NOT FIXED"* — in drift-checked
bytes at `artifacts/phase-2.4/presentation-plane-audit.json:135`. Taking it would break a
reservation that a gate reads. Beyond that, numbers are consumed in the order batches
land, and a gap is cheaper than a renumber (the same reason 0061 is not 0057).

## Context

`docs/new16.md:1285-1365` specifies T0 as a **nine-chapter measurement** of what already
exists on the trajectory axis — five status words (`EXISTS` / `PARTIAL` / `ABSENT` /
`CONTRADICTED` / `UNKNOWN`), 12 required questions, six prohibitions, and a four-item Exit
Gate. It also names the home: `docs/audits/trajectory/**`.

That home makes the artifact undeliverable, and the reason is measured, not argued:

| Measurement | Value |
| --- | --: |
| Files tracked under `docs/` | **0** |
| Local `.md` files under `docs/` | **153** |
| `.gitignore` line 44 | `docs/` |

An audit written there cannot enter a PR, cannot be read by CI, and cannot be read on
another machine. The repository's own tracker recorded T0-a/T0-c as `DONE` with the
qualifier *"true only on the authoring machine"* — an accurate description of a document
that exists nowhere else.

**The blocker is not that `docs/` is ignored.** `docs/` being local is a standing
repository convention and a user constraint, reaffirmed for this batch: not one byte of
`docs/` is published. The blocker is that **the specification named a home inconsistent
with that convention**. Those are different problems, and only the second is fixable
inside a batch. This ADR fixes the second.

## The problem this ADR actually solves

A prior planning decision (O-T2) had already considered and rejected one alternative home,
`packages/fixtures/`, on the grounds that fixtures there **enter the gates** and would
therefore charge a later workstream (T1) for an audit written by T0.

That reasoning is sound, and it is *specific to `packages/fixtures/`*. The question this
ADR must answer is whether it migrates to `artifacts/`. Measured:

| Question | Measurement |
| --- | --- |
| Is `artifacts/` tracked? | **Yes** — 5 subtrees, 31 files before this batch |
| Is the new subdirectory ignored? | **No** — `git check-ignore -v artifacts/trajectory-v0/` exits 1 |
| Does any scanner walk `artifacts/*` generically? | **No** — 5 files reference `artifacts/`, every one by a *named* path; zero `readdirSync`/glob over the root |
| Would the chapters enter a gate? | **No** — the fixtures loader never reads `artifacts/` |

So **O-T2's reason does not migrate.** `artifacts/trajectory-v0/` satisfies both
constraints at once: the bytes are in git (so PR, CI, and any other machine can read
them), and they are outside every gate (so T1 inherits zero cost).

There is also a **committed precedent**, which matters more than a fresh argument.
`artifacts/mcp-2026-07-28/non-goals.md` already carries a section headed *"Why
`artifacts/` and not `docs/`"*, reaching this conclusion verbatim:

> *"An audit that cannot be committed is not an audit; it is a local note."*

This ADR does not invent a rationale. It applies one the repository already accepted for
Workstream M's audit, to Workstream T's audit, for the identical reason.

## Decision

1. **The T0 audit lands at `artifacts/trajectory-v0/`.** Chapters are named verbatim per
   `docs/new16.md:1304-1313` — `01-current-guard-semantics.md` through
   `09-recommended-delta.md` — plus a `00-index.md` carrying this landing decision, the
   status vocabulary, and the 12-question → chapter map.

2. **The specification's `docs/audits/trajectory/**` home is superseded, not satisfied.**
   No file is written there. Anyone reading `new16.md` and looking for the audit at the
   path it names will not find it, so `00-index.md` states the substitution on its first
   screen and this ADR is the decision record for it.

3. **The nine chapters are a projection of conclusions, never a transfer of bytes.** The
   local planning and boundary documents (`docs/new16.md`, `docs/new16-new17-*.md`, the
   local boundary analysis §19) stay local and unpublished. What lands is what T0
   *measured*, with each claim bound to a `path:line` in committed code. Where a
   conclusion originates in a local document, the conclusion is restated and attributed by
   role, and the source text is not reproduced.

4. **The audit measures; it does not design.** T0's prohibitions are honored literally:
   zero new schemas, zero executable fixtures, zero production code, no verdict movement.
   `07-overlap-second-engine-risk.md` carries T0-b's five fixture designs **in prose
   only** — the tables describe fixtures that do not exist as files.

5. **Inference is labelled as inference.** Two claims in the audit are not measurements
   and say so on the page: the identity of the "four stable schemas" (the upstream
   reference names them by category only, and `pnpm schema:compat` covers all **30**), and
   `AuthorityCompleteness`'s members (not read). Writing an inference as a measurement is
   the specific failure this audit format exists to prevent.

6. **`artifacts/trajectory-v0/** text eol=lf` is pinned** in the same batch that creates
   the directory. Consistent with every `artifacts/` subtree before it, and with the
   reasoning recorded at `artifacts/adoption-index-v1` in R-0: nothing hashes these bytes
   *yet*, so nothing fails today — the pin is added now precisely because a later batch
   that introduces a byte-comparison would otherwise introduce the check and the missing
   pin together, where the miss surfaces on `windows-latest` **alone** and `ci:local`
   structurally cannot see it.

   Stated honestly: this pin has **no row in `SERVED_SUBTREES`** and no guard test, so by
   that table's own docblock it is itself unguarded — deleting it would fail nothing today.
   That is accepted here rather than papered over. These are prose chapters with no
   source/served split to byte-compare; adding a guard would mean inventing a consumer for
   the sake of guarding the pin.

## What this ADR does not decide

- **It does not move the restart gate.** RG-1…RG-5 stand at **0 of 5**, and the audit
  records why each is where it is. T0 was never able to move the score; it could only make
  the reasons checkable, which it did for RG-2 (now bound to a matcher string at
  [plugins/calllint/hooks/hooks.json:5](../plugins/calllint/hooks/hooks.json#L5), a missing
  `permissionDecision` field, and three silent `exit(0)` paths). Two of the five are
  observations about the world and cannot be measured in a repository at all.
- **It does not authorize T1.** No trajectory feature, schema, field, or decision path is
  approved by this ADR. The six decisions the audit names (D-1…D-6) are T1's, each with its
  own ADR.
- **It does not publish `docs/`.** The constraint is unchanged and now checkable: `git
  ls-files docs/ | wc -l` must remain **0**, and it is verified in this batch's gate run.
- **It does not claim the audit is complete beyond its questions.** Each chapter ends with
  a "what this chapter does not claim" section, and those limits are part of the artifact.

## Consequences

**Positive.**

- T0's Exit Gate becomes satisfiable. Its four requirements can be pointed at, reviewed in
  a PR, and confirmed by someone other than the author on a machine other than this one.
- The strongest finding survives contact with other readers. Q10 — the hook's completeness
  is `CONTRADICTED`, guaranteed incomplete on three axes, and a dropped event is
  byte-identical to "nothing to report" — is now falsifiable by pointing at a line rather
  than by trusting a summary.
- The `docs/` constraint stops being an unbounded blocker. Any future audit inherits a
  working answer: measure into `artifacts/`, keep the planning prose local.

**Negative, and accepted.**

- `new16.md` now names a path that holds nothing. Mitigated by `00-index.md` stating the
  substitution and by this ADR, but a reader who consults only the spec is misdirected.
- The audit's bytes are unguarded (see Decision 6). A silent corruption of these chapters
  would fail no test.
- 0062 is consumed before 0063 by a workstream that did not reserve it, and `adrs/` now
  has a hole at 0060 that is a live reservation rather than an accident. The amendments in
  `non-goals.md` and `proposed-file-map.md` are the only trail, and they are append-only.

**Neutral.**

- `artifacts/` grows from 5 subtrees to 6. No gate, script, or test changes as a result,
  because nothing walks that root generically.
