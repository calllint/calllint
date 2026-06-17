# CallLint v0.3-R2.1 — Calibration Report

Generated from a real run of `pnpm corpus:test` against the built CLI
(`apps/cli/dist/index.js`), with `--generated-at` pinned to
`2026-06-17T00:00:00.000Z`.

This report tracks the **R2.1 curation in progress**: the R2.0 synthetic seed
(C001–C010) plus the first batch of real public snapshots (C011–C020). The
R2.1 acceptance gate (`pnpm corpus:test:r2-final`) is not yet green — it
requires ≥ 30 total cases and ≥ 20 real/redacted; see
[CORPUS_CURATION.md](./CORPUS_CURATION.md).

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 20 |
| Verdict distribution | SAFE 4 · REVIEW 10 · BLOCK 5 · UNKNOWN 1 |
| Curation mix | synthetic-contract-seed 10 · real-public-snapshot 10 |
| Real / redacted cases | 10 |
| Contract failures | 0 |
| Dangerous false-SAFE | 0 |
| UNKNOWN ratio | 5.0% (target < 15%) |

All contracts hold. No dangerous case reports SAFE. The real snapshots come
from the official `modelcontextprotocol/servers` and `servers-archived`
repositories (commits pinned per case), scanned — never executed.

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
| C011-safe-memory-docker-pinned | SAFE | S1 | (none) |
| C012-safe-postgres-docker-connstring | SAFE | S1 | (none) |
| C013-safe-puppeteer-docker | SAFE | S1 | (none) |
| C014-review-git-uvx-unpinned | REVIEW | S1 | `supply.unpinned-package` |
| C015-review-fetch-uvx-unpinned | REVIEW | S1 | `supply.unpinned-package` |
| C016-review-memory-env-path | REVIEW | S1 | `supply.unpinned-package` |
| C017-review-github-token-env | REVIEW | S2 | `secrets.env-key` |
| C018-review-brave-apikey-env | REVIEW | S2 | `secrets.env-key` |
| C019-review-slack-mutation-secrets | REVIEW | S3 | `secrets.env-key`, `supply.unpinned-package`, `action.external-mutation` |
| C020-block-filesystem-broad-home | BLOCK | S2 | `files.broad-path`, `supply.unpinned-package` |

## Real-snapshot batch 1 (C011–C020)

Ten unmodified configuration snippets from official MCP server documentation,
recorded as `real-public-snapshot` with per-case `url` + pinned `commit`:

- **Sources:** `modelcontextprotocol/servers` @ `7b1170d1da1e`
  (memory, git, fetch, filesystem) and `modelcontextprotocol/servers-archived`
  @ `9be4674d1ddf` (postgres, puppeteer, github, brave-search, slack).
- **License:** the `servers` repo is mid-transition MIT → Apache-2.0 (docs
  CC-BY-4.0); `servers-archived` is MIT. Recorded per case.
- **No redaction:** every snippet is verbatim public documentation; upstream's
  own placeholders (`<YOUR_TOKEN>`, `/Users/username/Desktop`) are preserved.

These exercise the real-world distribution: well-formed public configs are
mostly REVIEW (unpinned packages, credential-shaped env keys), with genuine
SAFE baselines (pinned docker images, credential-free connection strings) and
one BLOCK (a home-anchored filesystem grant).

## Calibration finding: docker `-e` is not inline eval

Scanning the real github/brave/puppeteer configs surfaced a false positive:
`exec.dangerous-command` matched the `-e` flag on **any** command, so
`docker run -e VAR` (an env-var flag) was misread as `node -e <code>` inline
eval and BLOCKed. The detector now scopes inline-eval flags
(`-c`/`-e`/`--eval`/`--command`) to actual interpreters
(node/deno/bun/python/ruby/perl/php). Shells still trigger independently, so no
true positive was weakened (C003 dangerous-shell is unchanged). Regression
anchors: C013/C017/C018 (docker `-e` must not block) and the
`block-node-inline-eval` / `safe-docker-env-flag` golden fixtures.

## Detector coverage

All nine finding ids the engine can emit remain exercised by at least one case:

`files.broad-path` · `exec.dangerous-command` · `secrets.env-key` ·
`supply.unpinned-package` · `supply.unknown-remote` · `action.external-mutation` ·
`action.financial` · `action.financial-observed` · `prompt.poisoning`.

## Reproducing

```bash
pnpm build
pnpm corpus:test                                         # contracts (R2.0 gate)
pnpm corpus:test -- --summary-json corpus-summary.json   # machine summary
pnpm corpus:test:r2-final                                # R2.1 size/mix gate (still red)
```

The run is deterministic; this report reproduces exactly until the corpus or the
detectors change — at which point the gate forces it to be updated alongside.

## Scope and next steps

This is **R2.1 in progress**: 20 cases, half of them real public snapshots.
Remaining to satisfy `corpus:test:r2-final`:

- **Batch 2** — reach ≥ 30 total / ≥ 20 real-or-redacted, adding more BLOCK and
  UNKNOWN coverage (dangerous shells, unverified remotes, broad paths) from real
  or redacted sources.
- **R3+** — diagnostics command, prompt-surface depth, SARIF dogfood demo repo.
