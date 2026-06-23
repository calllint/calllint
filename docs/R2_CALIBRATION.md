# CallLint v0.3-R2 — Calibration Report

Generated from a real run of `pnpm corpus:test` against the built CLI
(`apps/cli/dist/index.js`), with `--generated-at` pinned to
`2026-06-16T00:00:00.000Z`.

**R2.1 shipped (30 cases); R2.2 has ratcheted the corpus to 36.** The acceptance
gate (`pnpm corpus:test:r2-final`) is green at the current floor — **36 cases, 26
real or redacted public snapshots** with per-case provenance — and the floor
(`minTotalCases`/`minRealOrRedacted` in `scripts/run-corpus.mjs`) only moves up as
R2.2 adds cases. See [CORPUS_CURATION.md](./CORPUS_CURATION.md) for the curation
contract.

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 36 |
| Verdict distribution | SAFE 7 · REVIEW 16 · BLOCK 8 · UNKNOWN 5 |
| Curation mix | synthetic-seed 10 · real-public 20 · redacted-real 6 |
| Real / redacted cases | 26 |
| Contract failures | 0 |
| Dangerous false-SAFE | 0 |
| UNKNOWN ratio | 13.9% (target ≤ 15%) |

All contracts hold. No dangerous case reports SAFE. Real snapshots are drawn
from five official upstreams — `modelcontextprotocol/servers`,
`servers-archived`, `github/github-mcp-server`, `getsentry/sentry-mcp`, and
`cloudflare/mcp-server-cloudflare` — at pinned commits, scanned and never
executed. C031–C036 are real `.cursor`/`.mcp`/`claude_desktop` configs surfaced
during the 0.3.0-rc.0 feedback window (RC-B04/B06/B07/B08/B09/B10), redacted
shape-preserving.

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
| C031-unknown-unrecognized-shape | UNKNOWN | S0 | redacted-real | (none) |
| C032-review-weather-mcp-db-creds | REVIEW | S2 | real-public | `secrets.env-key` |
| C033-review-cromwell-kit-unpinned-npx | REVIEW | S1 | redacted-real | `supply.unpinned-package` ×3 |
| C034-block-openclaw-filesystem-broad-home | BLOCK | S2 | redacted-real | `files.broad-path`, `supply.unpinned-package` |
| C035-safe-game-assistant-local-node | SAFE | S1 | redacted-real | (none) |
| C036-review-90-server-multi-runtime | UNKNOWN | S3 | redacted-real | `supply.unpinned-package` ×89, `action.external-mutation`, `supply.unknown-remote`, `secrets.env-key` |

## Real-snapshot provenance

All 26 real/redacted cases cite a source. The 20 from official upstreams cite a
repo, a pinned commit, and a license:

| Upstream | Commit | License | Cases |
|----------|--------|---------|-------|
| modelcontextprotocol/servers | `7b1170d1da1e` | Apache-2.0 / MIT transition; docs CC-BY-4.0 | C011, C014–C016, C020–C023 |
| modelcontextprotocol/servers-archived | `9be4674d1ddf` | MIT | C012, C013, C017–C019, C024 |
| github/github-mcp-server | `6830c4d39426` | MIT | C025, C026, C029 |
| getsentry/sentry-mcp | `ba44f5d61447` | FSL-1.1-Apache-2.0 | C027, C030 |
| cloudflare/mcp-server-cloudflare | `cb0186135e2f` | Apache-2.0 | C028 |

The 6 from the 0.3.0-rc.0 third-party feedback harvest (RC-B0x) cite the source
repo and pinned commit. Only C032 has a redistributable license (MIT); the other
five source repos carry **no detectable/clear license**, so they are stored as
shape-preserving `redacted-real-snapshot`s — the non-copyrightable config shape is
retained, not a verbatim redistribution:

| Source repo | Commit | License | Case | Curation |
|-------------|--------|---------|------|----------|
| glaucia86/weather-mcp-server | `c688791` | MIT | C032 | real-public |
| grantcromwell/cromwell-kit | `32da36e` | none | C033 | redacted-real |
| WinshipWheatley/openclaw-eyes | `7ca644d` | none | C034 | redacted-real |
| JacquesGariepy/game-assistant-mcp | `27df1b5` | none | C035 | redacted-real |
| uengine-oss/process-gpt-completion | `2c80ede` | none | C036 | redacted-real |
| public `.cursor/mcp.json` (RC-B04) | — | none | C031 | redacted-real |

Six cases are `redacted-real-snapshot`:

- **C026** (GitHub Enterprise remote): the README fragment's `...` ellipses were
  removed and the entry wrapped in a valid root; `type`, `url`, and the
  `Authorization` header are verbatim (the `octocorp.ghe.com` host is upstream's
  own example domain).
- **C031** (unrecognized nested `server.url`): minimised from a real committed
  `.cursor/mcp.json` in a public repo (RC-B04); the internal host was masked to
  `components.example.org`. No secrets were present. This is the RC-BLK-01
  regression lock (see below).
- **C033 / C034 / C035** (RC-B08 / B09 / B06): real configs from unlicensed public
  repos. Shape-preserving redaction only — identifying host/volume paths and
  usernames neutralized; package pin-state, command shape, broad-path depth, and
  the C033 nested-key typo are all preserved because they drive the verdict.
  License is omitted because the source grants no redistribution; the retained
  config *facts* are not copyrightable.
- **C036** (RC-B10): a real 92-server config from an unlicensed public repo. One
  server (`odoo ERP`) carried a **real committed credential set** (live employer
  Odoo URL, DB name, a person's email, a 40-char password); those four values were
  replaced with neutral placeholders **before** the file entered the repo — the
  live values were never written to the corpus or any log, and a post-write leak
  check ran clean. All 92 server shapes (pin state, runtime kind, transport) are
  otherwise preserved.

Every other real case is verbatim documentation, normalized only to a valid JSON
root.

## Calibration findings

- **docker `-e` is not inline eval.** Scanning the real github/brave/puppeteer
  configs surfaced a false positive: `exec.dangerous-command` matched `-e` on
  any command, so `docker run -e VAR` was misread as `node -e <code>` and
  BLOCKed. The detector now scopes inline-eval flags to actual interpreters
  (node/deno/bun/python/ruby/perl/php); shells still trigger independently, so
  no true positive was weakened. Anchors: C013/C017/C018/C029 and the
  `block-node-inline-eval` / `safe-docker-env-flag` golden fixtures.
- **Three UNKNOWN paths.** (1) A *recognized* remote server is uninspectable by
  construction, so it is always UNKNOWN — but only a *non-allowlisted* host adds a
  `supply.unknown-remote` finding. C025 (api.githubcopilot.com, allowlisted) is
  UNKNOWN with **zero** findings; C026 (GitHub Enterprise host) and C006
  (synthetic) are UNKNOWN **with** the finding. (2) C031 is a third path: an
  *unrecognized* shape (nested `server.url`) that resolves to **no** runtime at
  all — maxRiskClass S0, no findings — and is UNKNOWN by the `sourceKnown` gate,
  not by remote detection.
- **C031 / RC-BLK-01 regression lock.** Before ADR 0010 the C031 shape returned
  SAFE (a dangerous false-SAFE: the least-understood config got the safest
  verdict). The case pins `dangerousFalseSafePolicy.thisCaseMustNeverBeSafe: true`,
  so re-introducing the bug fails the gate. The R2.2 acceptance floor
  (`scripts/run-corpus.mjs`) was ratcheted 31/21 → 35/25 → 36/26 so this lock —
  and the real/redacted siblings — cannot be dropped without failing
  `corpus:test:r2-final`.
- **R2.2 batch 1 (C032–C035): RC inputs promoted to permanent cases.** Four
  third-party configs validated during the rc.0 window are now regression cases,
  re-scanned on the current engine: C032 (credential-shaped `WEATHER_API_KEY` →
  REVIEW), C033 (three unpinned `npx -y` packages → REVIEW; preserves a real
  nested-key authoring typo the parser tolerates), C034 (broad `/home` filesystem
  grant, unpinned → BLOCK, locked `thisCaseMustNeverBeSafe`). The batch was chosen
  REVIEW/BLOCK-weighted on purpose: it raised real/redacted coverage without adding
  UNKNOWN, so the UNKNOWN ratio fell from 12.9% to 11.4%.
- **C035 / RC-OBS-02 documented SAFE baseline.** A bare local `node <script>.js`
  server resolves SAFE because its source is observable (not hidden — contrast
  C031). Whether an unrecognized-but-observable local executable should instead be
  REVIEW is an open detector-calibration question tracked for an ADR; it is *not* a
  dangerous false-SAFE by the resolver definition, so the case is left
  `thisCaseMustNeverBeSafe: false` and records the current contract. If a future
  detector pass flips it, the gate forces this report and the case to be updated
  deliberately.
- **C036 / RC-B10 — 92-server multi-runtime stress (batch 2).** The largest single
  config in the corpus: 92 servers mixing `npx`/`uvx`/`python`/`node`/`docker`
  runtimes and one recognized remote. It exercises finding *multiplicity* —
  `supply.unpinned-package` ×89 plus one each of `action.external-mutation`,
  `supply.unknown-remote`, and `secrets.env-key` — and confirms the aggregate
  verdict is **UNKNOWN** (a recognized remote among 92 is uninspectable), not SAFE,
  on a config no human would audit by hand. maxRiskClass S3. The contract uses
  `requiredFindingIds` with `minCount: 50` on the unpinned finding rather than
  pinning the exact 89, so the lock survives benign upstream reshuffling while
  still proving the multiplicity. Secret handling: the one real committed
  credential set was placeholder-substituted before storage (see provenance
  above); `thisCaseMustNeverBeSafe: true`.
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
pnpm corpus:test:r2-final                                # acceptance gate (green at 36/26)
```

The run is deterministic; this report reproduces exactly until the corpus or the
detectors change — at which point the gate forces it to be updated alongside.

## Scope and next steps

**R2.1 shipped** (30 cases, 20 real/redacted, one real precision fix from
calibration). **R2.2 is active**: the corpus has ratcheted 30 → 31 (C031 RC-BLK-01
lock) → 35 (batch 1: C032–C035, validated RC non-author inputs promoted to
permanent cases) → 36 (batch 2: C036, the B10 92-server multi-runtime stress), with
the acceptance floor moving up to match each batch (now 36/26). It continues toward
45 → 60 from real/redacted field feedback. Next:

- **R2.2 batch 3+** — continue harvesting real/redacted field configs toward 45;
  prioritise verdict shapes still thin in the corpus (observed money movement,
  prompt poisoning in real configs).
- **Detector-calibration ADRs (record, do not fix in R2.2)** — RC-OBS-02 (bare
  local executable → SAFE, baselined as C035) is recorded in
  [ADR 0011](./adr/0011-unrecognized-local-command-calibration.md); the C023
  docker-`--mount` false negative is recorded in
  [ADR 0012](./adr/0012-docker-mount-host-paths-not-inspected.md). Both are
  Proposed/deferred: each would re-verdict legitimate existing configs, so any
  verdict change needs fixtures and a corpus impact pass before landing.
- **R3+** — diagnostics command, prompt-surface depth, the SARIF dogfood demo
  repo, and a detector pass for the recorded false negatives.
