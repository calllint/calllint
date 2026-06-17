# C009-block-money-observed

## Purpose
Verifies that an observed money-moving tool, backed by a real capability surface, is a
hard blocker — the strongest financial signal in the corpus.

## Human expected verdict
BLOCK

## Why this is BLOCK
The `x-calllint.tools` metadata exposes `create_payment` / `issue_refund` — explicit
money-moving verbs in the model-visible surface. Combined with a credential
(`ACME_API_TOKEN`), the financial detector emits `action.financial-observed` (S5,
critical, OBSERVED, blocker), which forces BLOCK. A `secrets.env-key` finding also
appears (allowed extra).

## Observed vs inferred (contrast with C008)
- C008: name-only inference → `action.financial` (non-blocker) → REVIEW.
- C009: observed money-moving verb + credential → `action.financial-observed` (blocker) → BLOCK.

This pairing is the corpus's guard on the most consequential distinction in the engine:
a label about money vs. an observed ability to move it.

## Why the engine does NOT use the blueprint's shell form
The blueprint sketched C009 as `sh -c 'stripe refunds create ...'`. That would block via
`exec.dangerous-command` (shell), not via a money signal — the wrong reason. Modeling it
on observed tool metadata exercises the actual financial-observed blocker.

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
