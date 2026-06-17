# C008-review-money-inferred

## Purpose
Verifies that a name-inferred financial domain is reviewed at the financial risk class
(S5) without being hard-blocked on a name alone.

## Human expected verdict
REVIEW

## Why this is REVIEW at S5
The package name `mcp-stripe-payments` matches the financial hint set, so the detector
emits `action.financial` (S5, high, INFERRED, non-blocker). Because "stripe" is also
an external-mutation hint, the engine additionally (and correctly) emits
`action.external-mutation` (S3). The highest risk class wins → S5. No blocker → REVIEW.

## Required vs allowed findings
- Required: `action.financial`.
- Allowed extra: `action.external-mutation` (same name, two hint sets — auditable, not a bug).
- Forbidden: `action.financial-observed` (that is the OBSERVED blocker reserved for C009).

## Inferred vs observed (the key distinction)
This case is INFERRED (name only) → REVIEW. C009 is OBSERVED (a money-moving tool verb
plus a credential/network surface) → BLOCK. The corpus pins both so the inferred/observed
boundary can never silently collapse.

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
