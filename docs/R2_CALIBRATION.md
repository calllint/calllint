# CallLint v0.3-R2.0 — Calibration Report

Generated from a real run of `pnpm corpus:test` against the built CLI
(`apps/cli/dist/index.js`), with `--generated-at` pinned to `2026-06-16T00:00:00.000Z`.

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 10 |
| Verdict distribution | SAFE 1 · REVIEW 4 · BLOCK 4 · UNKNOWN 1 |
| Contract failures | 0 |
| Dangerous false-SAFE | 0 |
| UNKNOWN ratio | 10.0% (target < 15%) |

All contracts hold. No dangerous case reports SAFE. The UNKNOWN ratio is within the
healthy band — the scanner is neither hiding uncertainty as SAFE nor over-using UNKNOWN
as an escape hatch.

## Per-case results

| Case | Verdict | maxRiskClass | Findings (ids) |
|------|---------|--------------|----------------|
| C001-safe-filesystem-workspace | SAFE | S1 | (none) |
| C002-block-broad-filesystem-home | BLOCK | S2 | `files.broad-path` |
| C003-block-dangerous-shell-rm | BLOCK | S4 | `exec.dangerous-command` |
| C004-review-secret-env-keys | REVIEW | S2 | `secrets.env-key` |
| C005-review-unpinned-package | REVIEW | S1 | `supply.unpinned-package` |
| C006-unknown-unverified-remote | UNKNOWN | S1 | `supply.unknown-remote` |
| C007-review-external-mutation | REVIEW | S3 | `action.external-mutation` |
| C008-review-money-inferred | REVIEW | S5 | `action.external-mutation`, `action.financial` |
| C009-block-money-observed | BLOCK | S5 | `secrets.env-key`, `action.financial-observed` |
| C010-block-prompt-poisoning | BLOCK | S2 | `prompt.poisoning` |

## Detector coverage

All nine finding ids the engine can emit are exercised by at least one case:

`files.broad-path` · `exec.dangerous-command` · `secrets.env-key` ·
`supply.unpinned-package` · `supply.unknown-remote` · `action.external-mutation` ·
`action.financial` · `action.financial-observed` · `prompt.poisoning`.

## Calibration notes

- **C002 and C010 are BLOCK, not REVIEW** (the R2 blueprint's draft). `files.broad-path`
  and `prompt.poisoning` are critical blockers in the shipped engine; the corpus reflects
  the secure reality rather than weakening the rules. See [CORPUS.md](./CORPUS.md).
- **C008 emits two findings** (`action.external-mutation` + `action.financial`) because
  "stripe" matches both the mutation and financial hint sets. The contract requires
  `action.financial` and allows the extra; max risk class is S5.
- **C004 is REVIEW** because the secrets detector matches credential-shaped key *names*,
  not inline secret *values*. Inline-value detection is a documented future capability,
  recorded as a known limitation on the case.

## Reproducing

```bash
pnpm build
pnpm corpus:test            # or: pnpm corpus:test:verbose
```

The run is deterministic; this report should reproduce exactly until the corpus or the
detectors change — at which point the gate forces this report to be updated alongside.

## Scope and next steps

This is **R2.0**: corpus structure, the release-gate runner, and 10 calibrated synthetic
seed cases. Deferred:

- **R2.1** — expand to ~30 cases including redacted/real public snapshots with provenance.
- **R3+** — diagnostics, prompt-surface depth, demo repo, and npm publishing.
