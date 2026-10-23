# ADR 0100 — Isolated detector maintenance is not distribution zero-diff

- **Status:** Accepted by the maintainer for PR #385 on 2026-10-23.
- **Scope:** CI applicability only; no runtime policy, risk model or verdict schema change.

## Context

PR #385 repairs three verified Windows filesystem false-SAFE results. The
distribution zero-diff check rejects its detector edit even though no distribution
product surface changes. The remote `ledger-authenticity` job failed in run
`39885322707`, while its ledger and cohort checks passed. Calling a repaired
detector semantically unchanged would be false; disabling the gate in general
would lose the distribution contract.

## Decision

The existing gate always measures its Git range, forbidden fields and identity
coupling. Missing history still fails closed. It recognizes one narrow maintenance
scope only when the complete committed/staged/unstaged/untracked change set has:

- At least one existing detector source under `packages/static-analyzer/src/detectors/`.
- A detector regression test, a `block-*` fixture, a `safe-*` fixture and an ADR.
- Only those detector sources, golden JSON fixtures, detector tests, root tests,
  ADR Markdown and the gate's own implementation. All required files must exist.

Any other path, including a distribution manifest, application source, resolver,
policy, risk engine, schema, workflow or renamed-outside-scope source, restores the
strict distribution zero-diff requirement. Existing additive-vocabulary exemptions
are unchanged. This is a reviewable maintenance class, not a branch-name, label,
commit-message or environment-variable override.

For this scope, detector source changes remain visible in the measured report and
are printed as **CHANGED**, with zero-diff explicitly **not applicable**. `--check`
runs the live invariant checks without comparing or rewriting the historical
distribution-only artifact. An invariant violation still exits nonzero. Ordinary
distribution ranges still compare that artifact and enforce strict zero-diff.

The scope does not approve detector correctness. Required typecheck, complete
tests, build, corpus and authority bench remain responsible for that evidence.
No existing fixture expectation, publish-channel approval or risk threshold may
be relaxed to make a repair pass. New fixtures here are regression inputs and do
not expand the frozen public Trust Pages cohort.

## Verification and limits

Real temporary Git repositories exercise the actual gate: isolated maintenance,
missing supports, mixed distribution/product changes, dirty and untracked paths,
missing history, forbidden fields and identity coupling. Both committed and dirty
maintenance must retain a visible source-change measurement. A matching artifact
cannot clear a live violation; the historical artifact stays byte-identical.

Any future expansion of the allowed path set requires a new ADR and corresponding
negative controls. This decision authorizes neither merge, release nor deployment.

Live source checks include untracked, non-ignored source files as well as tracked
files. Only Git grep's no-match status is accepted; operational scan errors remain
violations. This prevents the dirty-maintenance scope from hiding new source.
