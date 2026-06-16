# C004-review-secret-env-keys

## Purpose
Verifies that credential-named environment keys raise a review, not a silent pass.

## Human expected verdict
REVIEW

## Why this is REVIEW (not BLOCK)
`OPENAI_API_KEY` and `GITHUB_TOKEN` match the credential-name heuristic and emit a
single `secrets.env-key` finding (S2, medium, non-blocker). Credentials widen the
blast radius but are not inherently malicious, so the verdict is REVIEW.

## Honest capability boundary
The detector inspects credential-shaped **key names**, not inline secret-shaped
**values**. The env values here are the literal string `redacted`; no real secret is
stored. A future detector that recognises a live inline secret value would justifiably
push this class of case toward BLOCK — that is recorded as a known limitation in
source.json, not silently assumed.

## Required evidence
`secrets.env-key` referencing the credential key name(s).

## Why not C009-style BLOCK
There is no money-moving tool verb and no destructive command — only credential
presence. Escalating to BLOCK on credentials alone would generate noise.

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
