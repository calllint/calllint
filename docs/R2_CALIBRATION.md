# CallLint v0.3-R2 — Calibration Report

Generated from a real run of `pnpm corpus:test` against the built CLI
(`apps/cli/dist/index.js`), with `--generated-at` pinned to
`2026-06-16T00:00:00.000Z`.

**R2.1 shipped (30 cases); R2.2 has ratcheted the corpus to 60 — past the 45-case
target, toward 80.** The acceptance gate (`pnpm corpus:test:r2-final`) is green
at the current floor — **60 cases, 38 real or redacted public snapshots** with
per-case provenance — and the floor (`minTotalCases`/`minRealOrRedacted` in
`scripts/run-corpus.mjs`) only moves up as R2.2 adds cases. See
[CORPUS_CURATION.md](./CORPUS_CURATION.md) for the curation contract.

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 60 |
| Verdict distribution | SAFE 10 · BLOCK 14 · REVIEW 30 · UNKNOWN 6 |
| Curation mix | synthetic-seed 22 · real-public 28 · redacted-real 10 |
| Real / redacted cases | 38 |
| Contract failures | 0 |
| Dangerous false-SAFE | 0 |
| UNKNOWN ratio | 10.0% (target ≤ 15%) |

All contracts hold. No dangerous case reports SAFE. Real snapshots are drawn
from five official upstreams — `modelcontextprotocol/servers`,
`servers-archived`, `github/github-mcp-server`, `getsentry/sentry-mcp`, and
`cloudflare/mcp-server-cloudflare` — at pinned commits, scanned and never
executed. C031–C036 are real `.cursor`/`.mcp`/`claude_desktop` configs surfaced
during the 0.3.0-rc.0 feedback window (RC-B04/B06/B07/B08/B09/B10); C037–C040 are
real single-server configs from a public MCP catalog (batch 3), all redacted
shape-preserving; C041–C045 are batch 4 (a synthetic prompt-surface seed plus four
real-public snapshots); C046–C060 are batches 5–6 (R4 local-document
prompt-surface seeds, four more real shapes, and docker mount/volume branch
locks).

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
| C023-block-filesystem-docker-mount | BLOCK | S2 | real-public | `files.broad-path` |
| C024-safe-sqlite-docker-volume | SAFE | S1 | real-public | (none) |
| C025-unknown-github-remote-verified | UNKNOWN | S1 | real-public | (none) |
| C026-unknown-github-enterprise-remote | UNKNOWN | S1 | redacted-real | `supply.unknown-remote` |
| C027-review-sentry-npx-secrets | REVIEW | S2 | real-public | `secrets.env-key`, `supply.unpinned-package` |
| C028-review-cloudflare-mcp-remote | REVIEW | S1 | real-public | `supply.unpinned-package` ×2 |
| C029-review-github-local-docker-token | REVIEW | S2 | real-public | `secrets.env-key` |
| C030-review-sentry-selfhosted-host | REVIEW | S2 | real-public | `secrets.env-key`, `supply.unpinned-package` |
| C031-unknown-unrecognized-shape | UNKNOWN | S0 | redacted-real | (none) |
| C032-review-weather-mcp-db-creds | REVIEW | S2 | real-public | `secrets.env-key`, `exec.unverified-local-source` |
| C033-review-cromwell-kit-unpinned-npx | REVIEW | S1 | redacted-real | `supply.unpinned-package` ×3 |
| C034-block-openclaw-filesystem-broad-home | BLOCK | S2 | redacted-real | `files.broad-path`, `supply.unpinned-package` |
| C035-review-game-assistant-local-node | REVIEW | S2 | redacted-real | `exec.unverified-local-source` |
| C036-review-90-server-multi-runtime | UNKNOWN | S3 | redacted-real | `supply.unpinned-package` ×~89, `action.external-mutation`, `supply.unknown-remote`, `secrets.env-key`, `exec.unverified-local-source` ×2 |
| C037-review-stripe-payments-inferred | REVIEW | S5 | redacted-real | `secrets.env-key`, `supply.unpinned-package`, `action.external-mutation`, `action.financial` |
| C038-review-jira-mutation-secrets | REVIEW | S3 | redacted-real | `secrets.env-key`, `supply.unpinned-package`, `action.external-mutation` |
| C039-review-google-ads-multi-secret | REVIEW | S2 | redacted-real | `secrets.env-key`, `supply.unpinned-package` |
| C040-review-postgres-local-python | REVIEW | S2 | redacted-real | `exec.unverified-local-source` |
| C041-review-hidden-instructions-prompt-surface | REVIEW | S2 | synthetic | `prompt.hidden-instructions` |
| C042-review-gitlab-docker-token | REVIEW | S2 | real-public | `secrets.env-key` |
| C043-block-sqlite-uv-local-broad-path | BLOCK | S2 | real-public | `files.broad-path`, `exec.unverified-local-source` |
| C044-review-google-maps-npx-secret | REVIEW | S2 | real-public | `secrets.env-key`, `supply.unpinned-package` |
| C045-unknown-github-remote-auth-header | UNKNOWN | S1 | real-public | (none) |
| C046-review-readme-prompt-surface | REVIEW | S2 | synthetic | `prompt.surface-instructions` |
| C047-safe-redis-docker-url | SAFE | S1 | real-public | (none) |
| C048-review-sentry-uvx-arg-token | REVIEW | S1 | real-public | `supply.unpinned-package` |
| C049-safe-gdrive-docker-volume-creds | SAFE | S1 | real-public | (none) |
| C050-review-everart-docker-secret | REVIEW | S2 | real-public | `secrets.env-key` |
| C051-review-skill-prompt-surface | REVIEW | S2 | synthetic | `prompt.surface-instructions` |
| C052-review-package-description-surface | REVIEW | S2 | synthetic | `prompt.surface-instructions` |
| C053-safe-clean-surface-docs | SAFE | S1 | synthetic | (none) |
| C054-review-agents-hidden-comment-surface | REVIEW | S2 | synthetic | `prompt.surface-instructions` |
| C055-block-docker-v-broad-bind | BLOCK | S2 | synthetic | `files.broad-path` |
| C056-safe-docker-mount-named-volume | SAFE | S1 | synthetic | (none) |
| C057-block-docker-mount-source-alias | BLOCK | S2 | synthetic | `files.broad-path` |
| C058-safe-docker-v-workspace-scoped | SAFE | S1 | synthetic | (none) |
| C059-block-docker-mount-inline-form | BLOCK | S2 | synthetic | `files.broad-path` |
| C060-block-docker-volume-long-form | BLOCK | S2 | synthetic | `files.broad-path` |

## Real-snapshot provenance

All 34 real/redacted cases cite a source. The 24 from official upstreams cite a
repo, a pinned commit, and a license:

| Upstream | Commit | License | Cases |
|----------|--------|---------|-------|
| modelcontextprotocol/servers | `7b1170d1da1e` | Apache-2.0 / MIT transition; docs CC-BY-4.0 | C011, C014–C016, C020–C023 |
| modelcontextprotocol/servers-archived | `9be4674d1ddf` | MIT | C012, C013, C017–C019, C024, C042–C044 |
| github/github-mcp-server | `6830c4d39426` | MIT | C025, C026, C029, C045 |
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

The 4 from R2.2 batch 3 (C037–C040) all come from one public MCP catalog repo,
`khopilot/amazing-mcp-for-productivity` @ `b0c3ac15`, which carries no detectable
license — so each is a shape-preserving `redacted-real-snapshot`. Every committed
env value in these four was already an upstream placeholder (`your_*`), so no
secret redaction was required:

| Source path | Case | Verdict | Curation |
|-------------|------|---------|----------|
| web_development/stripe_mcp.json | C037 | REVIEW | redacted-real |
| productivity/jira_mcp.json | C038 | REVIEW | redacted-real |
| productivity/google_ads_mcp.json | C039 | REVIEW | redacted-real |
| ai_engineering/postgresql_mcp.json | C040 | REVIEW | redacted-real |

R2.2 batch 4 (C041–C045) is one synthetic seed plus four real-public snapshots, so
it cites no new redacted source. C041 is a synthetic R4 prompt-surface seed (see the
batch 4 calibration bullet below). C042/C043/C044 are verbatim configs from
`modelcontextprotocol/servers-archived` @ `9be4674d1ddf` (MIT), and C045 is from
`github/github-mcp-server` @ `6830c4d39426` (MIT) — all already listed in the
upstream table above. With C041 added, synthetic seeds now total 11.

R2.2 batch 5 (C046, C051–C054) is synthetic R4 local-document surface seeds; it
cites no external source. R2.2 batch 6's four real cases (C047–C050) are verbatim
documentation from already-listed upstreams — C047/C049/C050 from
`modelcontextprotocol/servers-archived` @ `9be4674d1ddf` (MIT), C048 from
`getsentry/sentry-mcp` @ `ba44f5d61447` (FSL-1.1-Apache-2.0). C055–C060 are
synthetic docker mount/volume branch locks. With batches 5–6 added, synthetic
seeds total 22 and real-public snapshots total 28.

Ten cases are `redacted-real-snapshot`:

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
  (`scripts/run-corpus.mjs`) was ratcheted 31/21 → 35/25 → 36/26 → 40/30 → 45/34 so
  this lock — and the real/redacted siblings — cannot be dropped without failing
  `corpus:test:r2-final`.
- **R2.2 batch 1 (C032–C035): RC inputs promoted to permanent cases.** Four
  third-party configs validated during the rc.0 window are now regression cases,
  re-scanned on the current engine: C032 (credential-shaped `WEATHER_API_KEY` →
  REVIEW; also fires `exec.unverified-local-source` under ADR 0011 Direction 2),
  C033 (three unpinned `npx -y` packages → REVIEW; preserves a real
  nested-key authoring typo the parser tolerates), C034 (broad `/home` filesystem
  grant, unpinned → BLOCK, locked `thisCaseMustNeverBeSafe`). The batch was chosen
  REVIEW/BLOCK-weighted on purpose: it raised real/redacted coverage without adding
  UNKNOWN, so the UNKNOWN ratio fell from 12.9% to 11.4%.
- **C035 / RC-OBS-02 resolved — unrecognized local source now REVIEW.** A bare local
  `node <script>.js` server is observable (its source is not hidden — contrast C031),
  so it was originally baselined SAFE while the open question — whether an
  unrecognized-but-observable local executable should instead be REVIEW — was tracked
  for an ADR. That question is now answered: [ADR 0011](./adr/0011-unrecognized-local-command-calibration.md)
  Direction 2 was **Accepted and implemented**. The new non-blocker
  `exec.unverified-local-source` (S2, OBSERVED) fires on a local executable that is
  neither a recognized package, a docker image, nor a remote, so C035 flipped SAFE →
  REVIEW. C040 (`uv run python -m …`) flipped the same way for the same reason. Both
  remain `thisCaseMustNeverBeSafe: false` — REVIEW, not a blocker — and the gate forces
  this report and the cases to move together.
- **C036 / RC-B10 — 92-server multi-runtime stress (batch 2).** The largest single
  config in the corpus: 92 servers mixing `npx`/`uvx`/`python`/`node`/`docker`
  runtimes and one recognized remote. It exercises finding *multiplicity* —
  `supply.unpinned-package` ×~89 plus `exec.unverified-local-source` ×2 and one each
  of `action.external-mutation`, `supply.unknown-remote`, and `secrets.env-key` —
  and confirms the aggregate verdict is **UNKNOWN** (a recognized remote among 92 is
  uninspectable), not SAFE, on a config no human would audit by hand. maxRiskClass S3. The contract uses
  `requiredFindingIds` with `minCount: 50` on the unpinned finding rather than
  pinning the exact 89, so the lock survives benign upstream reshuffling while
  still proving the multiplicity. Secret handling: the one real committed
  credential set was placeholder-substituted before storage (see provenance
  above); `thisCaseMustNeverBeSafe: true`.
- **R2.2 batch 3 (C037–C040): real money/mutation/SAFE shapes from a public MCP
  catalog.** Four single-server configs from `khopilot/amazing-mcp-for-productivity`,
  chosen to fill the thinnest *real* coverage while keeping UNKNOWN ≤ 15%:
  - **C037 (stripe)** is the **first real/redacted `action.financial` case** — the
    finding was previously synthetic-only (C008). The package name `stripe-mcp-server`
    drives the INFERRED money finding (REVIEW), alongside `action.external-mutation`,
    `secrets.env-key`, and `supply.unpinned-package`. It also pins the key
    money-surface distinction: the OBSERVED blocker `action.financial-observed`
    (→ BLOCK) requires provided-tool metadata (a `create_payment`-style verb) that a
    static command/args/env config does not carry, so it correctly does **not** fire
    and is `forbidden`. This is why C009/C010 (`action.financial-observed`,
    `prompt.poisoning`) remain synthetic-only — those findings read inline tool
    metadata real config snapshots almost never declare, so an honest real case for
    them is not harvestable from configs.
  - **C038 (jira)** is the second real `action.external-mutation` case (C019 Slack is
    the first), broadening that thin shape with a different integration domain.
  - **C039 (google-ads)** pins a mixed env shape: `secrets.env-key` fires (one finding,
    3 evidence entries) on `*_SECRET`/`*_TOKEN` names but **not** on `*_CLIENT_ID` /
    `*_CUSTOMER_ID` identifiers — a true-negative-within-a-case.
  - **C040 (postgres)** landed as the first real **local-python** case (`uv run python -m
    …`); prior real SAFE cases were all docker-based. It pins that a
    `DB_CONNECTION_STRING` env name is not credential-shaped (real-config analogue of
    the synthetic C012). It originally verdicted SAFE; under ADR 0011 Direction 2 it now
    fires `exec.unverified-local-source` and is REVIEW (see the RC-OBS-02 bullet above).
    At landing the batch was REVIEW/SAFE-weighted on purpose: it added 4 real cases with
    **zero** new UNKNOWN, so the UNKNOWN ratio fell 13.9% → 12.5%.
- **R2.2 batch 4 (C041–C045): prompt-surface seed + the 45 target.** Five cases — one
  synthetic R4 seed and four real-public snapshots — that closed out the R2.2 target of
  45 cases:
  - **C041 (hidden-instructions)** is a synthetic R4 prompt-surface seed exercising the
    new `prompt.hidden-instructions` finding (S2, REVIEW): hidden/obfuscated content
    (zero-width characters, bidi overrides, tag-char smuggling, HTML comments) in the
    model-visible surface. Like `prompt.poisoning`, it reads inline `x-calllint` tool
    metadata that real config snapshots almost never declare, so it is synthetic-only.
  - **C042 (gitlab)** is a real `servers-archived` docker-token config (→ REVIEW
    `secrets.env-key`); it also pins a true-negative — the `GITLAB_API_URL` env name is
    a host, not credential-shaped, so `secrets.env-key` does not fire on it.
  - **C043 (sqlite uv-local)** is the **first real case exercising
    `exec.unverified-local-source` alongside a blocker**: a `uv` local source plus a
    broad `files.broad-path` grant → BLOCK. It is also the first real broad-path BLOCK
    that is neither a docker bind-mount (C023) nor an `npx`-fronted grant (C020).
  - **C044 (google-maps)** is a real `npx` config with a `*_API_KEY` shape → REVIEW
    (`secrets.env-key`, `supply.unpinned-package`).
  - **C045 (github remote auth-header)** is the Authorization-header variant of the
    GitHub remote (`github/github-mcp-server`), UNKNOWN with **zero** findings — it
    completes the C025 (allowlisted, 0 findings) / C045 (header variant) / C026
    (Enterprise host, `supply.unknown-remote`) remote matrix.
- **R2.2 batch 5 (C046, C051–C054): R4 local-document prompt-surface seeds + a
  clean negative (ADR 0015).** Five synthetic cases exercising the new
  `prompt.surface-instructions` finding (PROMPT, S2, REVIEW, non-blocker) emitted
  by `calllint scan --surface-dir <dir>`:
  - **C046 (README)** — a clean pinned-npx config whose sibling `README.md`
    carries model-directed phrases; with `--surface-dir` the README is scanned
    and `prompt.surface-instructions` fires → REVIEW. Pins the `readme` surface
    kind (evidence key `readme`).
  - **C051 (SKILL.md)** — same shape on the `skill` surface kind.
  - **C052 (package.json description)** — the `package-description` surface
    kind; the JSON is parsed for `description` only, never executed.
  - **C054 (AGENTS.md hidden comment)** — the `agents` surface kind with an
    HTML-comment-hidden instruction, exercising the shared hidden-content
    scanner on a project doc.
  - **C053 (clean surface docs)** — the **negative**: a benign README (incl.
    legitimate non-Latin scripts) yields no finding; `allowExtraFindings: false`
    with `prompt.surface-instructions` forbidden locks the false-positive guard.
  Synthetic by necessity: real config snapshots do not ship sibling skill/readme
  files in the config itself.
- **R2.2 batch 6 (C047–C050, C055–C060): four more real shapes + docker
  mount/volume branch locks.**
  - **C047 (redis docker-url)** — a pinned docker image given a `redis://` URL
    as a positional arg → SAFE. Pins that a connection-URL positional arg is not
    mistaken for a broad path or a remote MCP transport (contrast C025/C045).
  - **C048 (sentry uvx arg-token)** — an unpinned `uvx` package → REVIEW via
    `supply.unpinned-package`. The token is a CLI **arg** (`--auth-token`), not
    an env key, so `secrets.env-key` correctly does **not** fire — a
    true-negative pinning that the secret detector keys on env-key names, not
    argv values.
  - **C049 (gdrive docker volume + inline -e)** — a pinned docker image with a
    **named volume** (`mcp-gdrive:/…`) and an inline `docker -e
    GDRIVE_CREDENTIALS_PATH=…`. SAFE for two reasons: (1) **correct**
    true-negative — `files.broad-path` does not fire because the ADR 0012 host
    -path extractor treats `mcp-gdrive` (no leading slash) as a named volume;
    (2) **documented gap** — `secrets.env-key` does not fire even though the
    name contains `CREDENTIAL`, because the var is a docker `-e` arg, not an
    env-block key (ADR 0016, Proposed/deferred). This case **anchors ADR 0016**.
  - **C050 (everart docker secret)** — a pinned docker image with
    `EVERART_API_KEY` in the **env block** → REVIEW via `secrets.env-key`. The
    clean contrast to C049: the same credential shape, surfaced correctly
    because it is in the env block, not inline `-e`.
  - **C055–C060 (docker mount/volume branch locks)** — six synthetic branch
    locks for the ADR 0012 host-path extractor: `-v host:container` broad bind
    (C055 BLOCK) vs named volume (C056 SAFE); `--mount source=` alias (C057
    BLOCK); `-v` workspace-scoped (C058 SAFE); inline `--mount=type=bind,…`
    (C059 BLOCK); `--volume` long-form (C060 BLOCK). These lock every form the
    extractor handles so a parser regression that drops one form fails the gate.
- **`npx mcp-remote <url>` reads as unpinned npx, not a remote.** C028
  (Cloudflare) pins this: the URL is an argument to a local bridge package, so
  the engine flags the unpinned bridge (REVIEW), not a remote source.
- **Path- and host-shaped envs are not secrets.** `MEMORY_FILE_PATH` (C016) and
  `SENTRY_HOST` (C030) are correctly not flagged; only credential-shaped names
  (`*_TOKEN`, `*_API_KEY`) match `secrets.env-key`.
- **A resolved false negative (C023).** C023 was previously a documented false
  negative — SAFE, because the broad-path detector read only the server's own path
  args, not docker `--mount src=` host paths. [ADR 0012](./adr/0012-docker-mount-host-paths-not-inspected.md)
  was **Accepted and implemented**: the broad-path detector now extracts docker
  bind-mount host paths, so C023 is **BLOCK** via `files.broad-path`. The other docker
  cases stay SAFE for the right reasons — C011/C012/C013/C024 use named volumes, scoped
  paths, or connection strings rather than a broad host bind-mount.

## Detector coverage

All twelve finding ids the engine can emit are exercised by at least one case:

`files.broad-path` · `exec.dangerous-command` · `exec.unverified-local-source` ·
`secrets.env-key` · `supply.unpinned-package` · `supply.unknown-remote` ·
`action.external-mutation` · `action.financial` · `action.financial-observed` ·
`prompt.poisoning` · `prompt.hidden-instructions` · `prompt.surface-instructions`.

The newest is `prompt.surface-instructions` (PROMPT, S2, REVIEW, non-blocker,
OBSERVED — ADR 0015, R4 local-document surface; fires when `--surface-dir` reads
a bounded allowlist of project documents and one contains model-directed
phrasing or hidden/obfuscated content; reuses the same scanner module as
`prompt.poisoning` / `prompt.hidden-instructions`). The two prior additions are
`exec.unverified-local-source` (EXEC, S2, REVIEW, non-blocker, OBSERVED —
ADR 0011 Direction 2) and `prompt.hidden-instructions` (PROMPT, S2, REVIEW,
non-blocker, OBSERVED — ADR 0014, R4 prompt-surface v0).

Of these, `action.financial-observed`, `prompt.poisoning`, and
`prompt.hidden-instructions` are exercised **only by synthetic seed cases**
(C009, C010, C041): all three read inline provided-tool metadata / server
instructions (`x-calllint` tool metadata), which real config snapshots almost
never declare (tools are discovered at connect time, which CallLint never does).
`prompt.surface-instructions` is exercised by five synthetic cases (C046, C051,
C052, C054 positive; C053 negative) for the same reason — real config snapshots
do not ship sibling README/SKILL/AGENTS files in the config itself; the surface
is supplied via `--surface-dir`. An honest real case for these four is therefore
not harvestable from a single config file — recorded here so the synthetic-only
status is a known, explained gap, not an oversight. `action.financial`
(INFERRED) crossed into real coverage in batch 3 via C037, and
`exec.unverified-local-source` has real coverage via C035/C040/C043 (plus C032
and C036).

## Reproducing

```bash
pnpm build
pnpm corpus:test                                         # contract gate
pnpm corpus:test -- --summary-json corpus-summary.json   # machine summary
pnpm corpus:test:r2-final                                # acceptance gate (green at 60/38)
```

The run is deterministic; this report reproduces exactly until the corpus or the
detectors change — at which point the gate forces it to be updated alongside.

## Scope and next steps

**R2.1 shipped** (30 cases, 20 real/redacted, one real precision fix from
calibration). **R2.2 reached 60 cases** (past the 45-case target, toward 80):
the corpus ratcheted 30 → 31 (C031 RC-BLK-01 lock) → 35 (batch 1: C032–C035,
validated RC non-author inputs) → 36 (batch 2: C036, the B10 92-server
multi-runtime stress) → 40 (batch 3: C037–C040, real
money/mutation/multi-secret/local shapes from a public MCP catalog) → 45 (batch
4: C041–C045, a prompt-surface seed plus four real-public snapshots) → 60
(batches 5–6: R4 local-document surface seeds + clean negative; four more real
shapes; docker mount/volume branch locks), with the acceptance floor moving up
to match each batch (now 60/38). It continues toward 80 from real/redacted field
feedback. Next:

- **R2.2 batch 7+** — continue harvesting real/redacted field configs toward 80.
  Observed money movement (`action.financial-observed`), `prompt.poisoning`,
  `prompt.hidden-instructions`, and `prompt.surface-instructions` stay
  synthetic-only by necessity (they need inline tool metadata / sibling doc
  files configs don't carry); prioritise other real shapes — BLOCK-class
  dangerous commands, more remote/header variants, broad-path real configs.
- **Detector-calibration ADRs (accepted and implemented).** RC-OBS-02 (unrecognized
  local executable) is resolved by [ADR 0011](./adr/0011-unrecognized-local-command-calibration.md)
  Direction 2 — `exec.unverified-local-source` ships and flipped C035/C040 to REVIEW.
  The C023 docker-`--mount` false negative is resolved by
  [ADR 0012](./adr/0012-docker-mount-host-paths-not-inspected.md) — the broad-path
  detector now extracts docker bind-mount host paths and C023 is BLOCK. Both shipped
  with fixtures and a corpus impact pass.
- **ADR 0016 (Proposed/deferred).** The docker `-e` env-key secrets gap is
  recorded and anchored by C049; not yet implemented. A REVIEW-class under-call,
  not a dangerous false-SAFE.
- **R3** — `calllint diagnostics --json` ([ADR 0013](./adr/0013-diagnostics-json.md),
  key-path-scoped v0) is **implemented**, including real source line/column for finding
  evidence.
- **R4 — prompt surface.** v0 shipped: `prompt.hidden-instructions`
  ([ADR 0014](./adr/0014-prompt-surface-hidden-instructions.md)) flags hidden/obfuscated
  content in model-visible metadata. The local-document increment shipped:
  `prompt.surface-instructions` ([ADR 0015](./adr/0015-prompt-surface-local-documents.md))
  via `--surface-dir`. Remaining R4 work covers registry metadata (npm/PyPI
  description, keywords) and a server's remote README — network input, the next
  (`--online`) increment.
  content in the model-visible surface. Remaining R4 work covers the README / SKILL /
  package / registry surfaces.
