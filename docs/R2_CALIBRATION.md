# CallLint v0.3-R2.1 — Calibration Report

Generated from a real run of `pnpm corpus:test` against the built CLI
(`apps/cli/dist/index.js`), with `--generated-at` pinned to
`2026-06-17T00:00:00.000Z`.

**R2.1 is complete.** The acceptance gate (`pnpm corpus:test:r2-final`) is
green: 30 cases, 20 of them real or redacted public snapshots with per-case
provenance. See [CORPUS_CURATION.md](./CORPUS_CURATION.md) for the curation
contract.

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 30 |
| Verdict distribution | SAFE 6 · REVIEW 14 · BLOCK 7 · UNKNOWN 3 |
| Curation mix | synthetic-seed 10 · real-public 19 · redacted-real 1 |
| Real / redacted cases | 20 |
| Contract failures | 0 |
| Dangerous false-SAFE | 0 |
| UNKNOWN ratio | 10.0% (target < 15%) |

All contracts hold. No dangerous case reports SAFE. Real snapshots are drawn
from five official upstreams — `modelcontextprotocol/servers`,
`servers-archived`, `github/github-mcp-server`, `getsentry/sentry-mcp`, and
`cloudflare/mcp-server-cloudflare` — at pinned commits, scanned and never
executed.

## Per-case results

| Case | Verdict | maxRiskClass | Curation | Findings (ids) |
|------|---------|--------------|----------|----------------|
| C001-safe-filesystem-workspace | SAFE | S1 | synthetic | (none) |
| C002-block-broad-filesystem-home | BLOCK | S2 | synthetic | `files.broad-path` |
| C003-block-dangerous-shell-rm | BLOCK | S4 | synthetic | `exec.dangerous-command` |
| C004-review-secret-env-keys | REVIEW | S2 | synthetic | `secrets.env-key` |
| C005-review-unpinned-package | REVIEW | S1 | synthetic | `supply.unpinned-package` |
| C006-unknown-unverified-remote | UNKNOWN | S1 | synthetic | `supply.unknown-remote` |
| C007-review-external-mutation | REVIEW | S3 | synthetic | `action.external-mutation` |
| C008-review-money-inferred | REVIEW | S5 | synthetic | `action.external-mutation`, `action.financial` |
| C009-block-money-observed | BLOCK | S5 | synthetic | `secrets.env-key`, `action.financial-observed` |
| C010-block-prompt-poisoning | BLOCK | S2 | synthetic | `prompt.poisoning` |
| C011-safe-memory-docker-pinned | SAFE | S1 | real-public | (none) |
| C012-safe-postgres-docker-connstring | SAFE | S1 | real-public | (none) |
| C013-safe-puppeteer-docker | SAFE | S1 | real-public | (none) |
| C014-review-git-uvx-unpinned | REVIEW | S1 | real-public | `supply.unpinned-package` |
| C015-review-fetch-uvx-unpinned | REVIEW | S1 | real-public | `supply.unpinned-package` |
| C016-review-memory-env-path | REVIEW | S1 | real-public | `supply.unpinned-package` |
| C017-review-github-token-env | REVIEW | S2 | real-public | `secrets.env-key` |
| C018-review-brave-apikey-env | REVIEW | S2 | real-public | `secrets.env-key` |
| C019-review-slack-mutation-secrets | REVIEW | S3 | real-public | `secrets.env-key`, `supply.unpinned-package`, `action.external-mutation` |
| C020-block-filesystem-broad-home | BLOCK | S2 | real-public | `files.broad-path`, `supply.unpinned-package` |
| C021-block-filesystem-cmd-windows | BLOCK | S4 | real-public | `files.broad-path`, `exec.dangerous-command` |
| C022-block-memory-cmd-windows | BLOCK | S4 | real-public | `exec.dangerous-command` |
| C023-safe-filesystem-docker-mount | SAFE | S1 | real-public | (none) |
| C024-safe-sqlite-docker-volume | SAFE | S1 | real-public | (none) |
| C025-unknown-github-remote-verified | UNKNOWN | S1 | real-public | (none) |
| C026-unknown-github-enterprise-remote | UNKNOWN | S1 | redacted-real | `supply.unknown-remote` |
| C027-review-sentry-npx-secrets | REVIEW | S2 | real-public | `secrets.env-key`, `supply.unpinned-package` |
| C028-review-cloudflare-mcp-remote | REVIEW | S1 | real-public | `supply.unpinned-package`, `supply.unpinned-package` |
| C029-review-github-local-docker-token | REVIEW | S2 | real-public | `secrets.env-key` |
| C030-review-sentry-selfhosted-host | REVIEW | S2 | real-public | `secrets.env-key`, `supply.unpinned-package` |

## Real-snapshot provenance

All 20 real/redacted cases cite a source repo, a pinned commit, and a license:

| Upstream | Commit | License | Cases |
|----------|--------|---------|-------|
| modelcontextprotocol/servers | `7b1170d1da1e` | Apache-2.0 / MIT transition; docs CC-BY-4.0 | C011, C014–C016, C020–C023 |
| modelcontextprotocol/servers-archived | `9be4674d1ddf` | MIT | C012, C013, C017–C019, C024 |
| github/github-mcp-server | `6830c4d39426` | MIT | C025, C026, C029 |
| getsentry/sentry-mcp | `ba44f5d61447` | FSL-1.1-Apache-2.0 | C027, C030 |
| cloudflare/mcp-server-cloudflare | `cb0186135e2f` | Apache-2.0 | C028 |

Only **C026** (GitHub Enterprise remote) is `redacted-real-snapshot`: the
README fragment's `...` ellipses were removed and the entry wrapped in a valid
root; `type`, `url`, and the `Authorization` header are verbatim (the
`octocorp.ghe.com` host is upstream's own example domain). Every other real
case is verbatim documentation, normalized only to a valid JSON root.

## Calibration findings

- **docker `-e` is not inline eval.** Scanning the real github/brave/puppeteer
  configs surfaced a false positive: `exec.dangerous-command` matched `-e` on
  any command, so `docker run -e VAR` was misread as `node -e <code>` and
  BLOCKed. The detector now scopes inline-eval flags to actual interpreters
  (node/deno/bun/python/ruby/perl/php); shells still trigger independently, so
  no true positive was weakened. Anchors: C013/C017/C018/C029 and the
  `block-node-inline-eval` / `safe-docker-env-flag` golden fixtures.
- **Two UNKNOWN paths.** A remote server is uninspectable by construction, so it
  is always UNKNOWN — but only a *non-allowlisted* host adds a
  `supply.unknown-remote` finding. C025 (api.githubcopilot.com, allowlisted) is
  UNKNOWN with **zero** findings; C026 (GitHub Enterprise host) and C006
  (synthetic) are UNKNOWN **with** the finding.
- **`npx mcp-remote <url>` reads as unpinned npx, not a remote.** C028
  (Cloudflare) pins this: the URL is an argument to a local bridge package, so
  the engine flags the unpinned bridge (REVIEW), not a remote source.
- **Path- and host-shaped envs are not secrets.** `MEMORY_FILE_PATH` (C016) and
  `SENTRY_HOST` (C030) are correctly not flagged; only credential-shaped names
  (`*_TOKEN`, `*_API_KEY`) match `secrets.env-key`.
- **A documented false negative.** C023 is SAFE because the broad-path detector
  reads the server's own path args, not docker `--mount src=` host paths. This
  is recorded on the case, not hidden — a candidate for a future detector pass.

## Detector coverage

All nine finding ids the engine can emit are exercised by at least one case:

`files.broad-path` · `exec.dangerous-command` · `secrets.env-key` ·
`supply.unpinned-package` · `supply.unknown-remote` · `action.external-mutation` ·
`action.financial` · `action.financial-observed` · `prompt.poisoning`.

## Reproducing

```bash
pnpm build
pnpm corpus:test                                         # contract gate
pnpm corpus:test -- --summary-json corpus-summary.json   # machine summary
pnpm corpus:test:r2-final                                # R2.1 acceptance gate (green)
```

The run is deterministic; this report reproduces exactly until the corpus or the
detectors change — at which point the gate forces it to be updated alongside.

## Scope and next steps

**R2.1 is done**: 30 cases, 20 real/redacted, acceptance gate green, one real
precision fix shipped from calibration. Next:

- **R3+** — diagnostics command, prompt-surface depth, the SARIF dogfood demo
  repo, and a detector pass for the C023 docker-`--mount` false negative.
