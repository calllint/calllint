# C006-unknown-unverified-remote

## Purpose
Verifies that an unverifiable remote endpoint resolves to UNKNOWN — the honest
"insufficient evidence" exit — and never to SAFE.

## Human expected verdict
UNKNOWN

## Why this is UNKNOWN
The server is defined only by a URL on a host that is not in the known-host set.
The source cannot be inspected offline, so `binding.sourceKnown` is false and the
verdict logic returns UNKNOWN. The detector also emits `supply.unknown-remote` (S1).

## Why not SAFE
"We can't see inside it" must never be reported as "it's fine." UNKNOWN is the honesty
exit; the corpus pins `thisCaseMustNeverBeSafe: true` to enforce that.

## Note on REVIEW/BLOCK contract requirements
falsePositiveNote / remediation presence checks apply only to REVIEW and BLOCK cases.
UNKNOWN findings still carry evidence (asserted here).

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
