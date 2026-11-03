# ADR 0103: Reproducible local CI shell and baseline

Status: Accepted
Date: 2026-11-03

## Context

The remote fixes in ADRs 0101 and 0102 passed subsequent main CI and scheduled
workflows. Local revalidation exposed separate environment-dependent failures:

- Windows resolved `bash` to a WSL launcher with no `/bin/bash`. Thirteen usage
  probe assertions received no harness result and reported `NaN` comparisons.
- The security-semantic gate preferred an existing, stale local `main` over
  `origin/main`. It reclassified already accepted detector repairs as changes in
  a new distribution range. Full CI clones had no corresponding stale local ref.
- The CI aggregate attributed any failure in the multi-purpose
  `ledger-authenticity` job to a ledger mismatch, even when identity or semantic
  checks were the actual cause.

## Decision

1. Default the semantic gate to `origin/main`, then `main` if the remote ref is
   absent. An existing ref without common history fails without a fallback.
   Keep explicit `--base` requests and their existing remote-name
   fallback. Print the resolved baseline and merge-base. Do not fetch implicitly,
   update branch refs, rewrite historical artifacts during checks, or suppress
   committed, dirty, untracked, forbidden-field or identity-coupling violations.
   A missing baseline still fails closed. Operators refresh remote refs before
   review or pass an intentional alternative baseline explicitly.
2. Configure Windows test processes to use Bash and utilities from the active
   Git for Windows installation. Preserve the Node executable that started the
   test run and allow user-local tools in `%USERPROFILE%\.local\bin`. Do not
   modify global PATH, WSL, permission settings or unrelated projects. Real jq
   remains a prerequisite for credential behavior tests; it is never replaced
   by a permissive mock. Missing prerequisites must be diagnosed explicitly.
3. Preserve the required aggregate's rejection of failed, skipped and cancelled
   dependencies. Direct the operator to the actual failed step and list the
   job's distinct checks rather than asserting an unobserved ledger defect.
4. Require a parsed deployment URL and observed matching logo bytes for web
   deployment acceptance. Missing deployment identity fails; it cannot skip
   verification and return success. Behavioral tests execute the actual workflow
   block with matching, wrong, unavailable and absent-URL evidence.

## Validation

Exercise real temporary Git histories with stale local main and current remote
main, local-only and remote-only checkouts, explicit and absent refs, and
committed/worktree security changes. Run the actual shell and extracted CI
aggregate, including non-success dependency states. Re-run the existing workflow
behavior tests, typecheck, full test suite, build and both corpus gates under
Node 20.20.2. Product detectors, verdicts, publication thresholds and historical
claims are unchanged. Local verification does not imply a remote merge or deploy.
