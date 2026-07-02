# Changelog

All notable changes to CallLint are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0
onward. While pre-1.0, minor versions may include breaking changes.

`MCPGuard` was the internal codename for this project; the public product is
**CallLint** (see ADR 0008).

## [Unreleased]

## [0.9.2] — 2026-07-02 — R4 Enhanced: Complete Detectors + Fixtures

### Added

- **Complete fixture coverage for all 9 action kinds** (+12 fixtures, 19 total).
  - `github.write`: 3 fixtures (positive create-pr, negative unverified-repo with excessive scopes, negative external-links)
  - `npm.publish`: 3 fixtures (positive clean-publish, negative name-squatting, negative version-float)
  - `cloud.modify`: 3 fixtures (positive small-instance, negative expensive-instance, negative open-all-ports)
  - `account.register`: 3 fixtures (positive clean-registration, negative unverified-service, negative excessive-scopes)

- **Enhanced detectors for all 9 action kinds** (+8 detectors, 13 total).
  - `supply.name-squatting` — Detect npm package name typosquatting (similar to popular packages)
  - `supply.version-float` — Detect unpinned npm versions (^/~ ranges instead of exact)
  - `action.unverified-repository` — GitHub write to unverified repository
  - `action.excessive-github-scopes` — Dangerous GitHub OAuth scopes (delete_repo, admin:org)
  - `action.external-links` — External links in GitHub PR/issues
  - `action.expensive-cloud-resource` — Cloud resource cost detection (>$1000/month)
  - `action.insecure-security-group` — Cloud security group opens all ports (0.0.0.0/0)
  - `action.unverified-service` — Account registration on unverified service
  - `action.excessive-oauth-scopes` — Excessive OAuth scopes for account registration

**Tests:** +9 new tests (529 total, was 520)

**Coverage Matrix:**
- email.reply: 3 fixtures, 3 detectors ✓
- message.post: 1 fixture, 1 detector ✓
- a2a.delegate: 2 fixtures, 2 detectors ✓
- payment.authorize: 1 fixture, 1 detector ✓
- account.register: 3 fixtures, 2 detectors ✓
- github.write: 3 fixtures, 3 detectors ✓
- npm.publish: 3 fixtures, 2 detectors ✓
- cloud.modify: 3 fixtures, 2 detectors ✓
- email.forward: 0 fixtures (shares detectors with email.reply)

## [0.9.1] — 2026-07-02 — R4 Runtime: Action Inspect Command

### Added

- **`calllint action inspect` — Unified External Action Preflight (R4 runtime, ADR 0029).**
  Inspect planned external actions before execution. Takes a `calllint.action.v0` JSON
  descriptor and returns SAFE / REVIEW / BLOCK / UNKNOWN with findings, applying the same
  risk symbols (PROMPT / SUPPLY / FILES / NETWORK / EXEC / ACTION / MONEY / SECRETS) and
  verdict engine as MCP scans. Supports 9 action kinds: `email.reply`, `email.forward`,
  `message.post`, `a2a.delegate`, `payment.authorize`, `account.register`, `github.write`,
  `npm.publish`, `cloud.modify`. Implemented detectors: `action.unverified-attachment`
  (email attachments without SHA-256 hashes), `action.missing-delegate-target` (a2a
  delegation without target), `action.insecure-delegate-target` (HTTP not HTTPS),
  `action.financial-observed` (payment with monetary amount), `secrets.env-key`
  (secret-shaped header keys). Terminal and JSON output modes. Policy support via
  `--policy`. See ADR 0029.

**Usage:**
```bash
calllint action inspect payment.json
calllint action inspect email-reply.json --json
calllint action help
```

**Package:** New `@calllint/action-analyzer` package implements the core analysis logic.

## [0.9.0] — 2026-07-02 — R4 Design Checkpoint (Unified External Action Preflight)

### Added (Design-only, no runtime implementation)

- **`calllint.action.v0` schema — Unified External Action Preflight (ADR 0029).**
  Design checkpoint for R4. Schema defines 9 action kinds (email.reply/forward,
  message.post, a2a.delegate, payment.authorize, account.register, github.write,
  npm.publish, cloud.modify) with kind-specific parameters and metadata. Reuses
  existing risk symbols (PROMPT / SUPPLY / FILES / NETWORK / EXEC / ACTION /
  MONEY / SECRETS) and verdict engine. This release contains the schema
  (`schemas/action.schema.json`), fixture contract (`packages/fixtures/action/`
  with 9 stub directories), and design ADR (local docs) — the `calllint action
  inspect` command implementation is a future release. See ADR 0029.

**Note:** This is a design checkpoint release. The `action inspect` command is
not yet implemented. The schema and fixture structure are provided for review
and integration planning. This version will not be published to npm — use
v0.8.1 for the latest runtime features.

## [0.8.1] — 2026-07-02 — Online registry surface (邻接校准)

### Added

- **Registry-metadata prompt surface under `--online` (ADR 0027).** With
  `--online`, the npm registry's own model-visible text — the resolved version's
  published `description`, and the registry document's `readme` when it already
  carries one — is routed through the *existing* prompt-surface detectors
  (`prompt.poisoning` / `prompt.hidden-instructions`) via the same
  `analyzeDocumentSurfaces` path a local `README`/`SKILL.md` uses (ADR 0015). A
  package whose local config is clean but whose published `description` hides a
  model-directed or obfuscated instruction now surfaces the existing
  `prompt.surface-instructions` finding (PROMPT, S2, REVIEW, non-blocker),
  stamped `source:"online"` + `fetchedAt`, with the surface origin recorded in
  evidence (`registry:<name>#description` / `#readme`). No new detector, reason
  code, or `ScanReport` schema change — only the evidence's surface origin and
  online provenance stamp are new. Per ADR 0006 this online-derived text is
  advisory: it may raise a verdict to REVIEW and never downgrades one or
  manufactures SAFE. **Offline default is unchanged** — with no `--online`,
  nothing here runs and the deterministic verdict is byte-identical. The offline
  60/38 corpus gate (never passes `--online`) is the standing proof of that
  invariance; the online surface is covered by replay fixtures (a real benign
  `description` ⇒ no finding; a real base with a clearly-labelled synthetic poison
  payload ⇒ REVIEW) with no live network in CI. See ADR 0027.

## [0.8.0] — 2026-07-01 — Receipt-first trust layer (new5 R3)

### Added

- **Local receipts — `scan --receipt` + `receipt verify` (new5 R3, ADR 0028).**
  A receipt (`calllint.receipt.v0`) is a small local JSON file that records the
  outcome of a scan: which CallLint version produced which verdict, over which
  input, under which policy/ruleset context, with per-finding references
  (`rule_id`, `severity`, `evidence_path` — never an evidence value). It is a
  pure *reporting layer* over the existing `calllint.report.v0` scan report:
  `verdict`, `risk_counts`, and `finding_refs` are read straight from that
  report — a receipt never re-scans, re-judges, executes a target, contacts the
  network, or reads a secret value (the `trust_boundaries` block is type-locked
  to encode this). `scan --receipt [--receipt-out <file>]` writes the receipt
  *after* the normal scan (unchanged output and exit code; absent flag ⇒
  byte-identical behavior); `receipt verify <file>` structurally validates it
  offline (exit 0 valid / 1 invalid). Hashes reuse `@calllint/fingerprint`. The
  receipt is unsigned — the `signature` field is reserved for a future release
  and never populated. A receipt is not a proof of runtime safety and never
  certifies a tool. Author guide: [`RECEIPTS.md`](RECEIPTS.md). See ADR 0028.
- **GitHub Action — optional `receipt` artifact (new5 R3).** The `calllint`
  Action gains `receipt` (default `false`) and `receipt-file` inputs. When
  `receipt: true` it runs `scan --receipt --receipt-out <file>` and uploads the
  receipt as a build artifact. `receipt: false` leaves the Action's SARIF
  upload, Markdown step summary, and `--ci` gate behavior unchanged — the
  receipt is additional evidence, never a new gate.

### Fixed

- **Receipt schema cites ADR 0028 by number.** `schemas/receipt.schema.json`
  previously referenced `docs/adr/0028-…md`, a path under the gitignored `docs/`
  tree; it now cites "ADR 0028" like the rest of the tracked docs. The
  public-copy guard also now verifies the README corpus numbers against
  `project-facts.json` (previously only the homepage was checked).

## [0.7.0] — 2026-07-01 — Trust badge (Phase 6) + docker inline secret keys

### Added

- **`calllint scan --badge` — Trust badge (Phase 6, ADR 0026).** Emits a
  shields.io *endpoint* JSON badge (`{schemaVersion, label:"CallLint", message,
  color}`) for the aggregate verdict. Like `--sarif`/`--markdown`, it is a new
  projection of the existing `calllint.report.v0` verdict — no `ScanReport`
  schema change, no verdict decision of its own. An MCP author commits
  `calllint-badge.json`, points a shields.io endpoint badge at it, and refreshes
  it in CI. Transparency over false comfort: only `SAFE` is green; `REVIEW`,
  `UNKNOWN`, and `BLOCK` each carry a distinct non-green colour (a `no-green-only`
  test locks this). Author guide: [`badge.md`](badge.md).

### Changed

- **Docker inline `-e` secret keys are now inspected (ADR 0016).** The secret
  detector reads the `env` block *and*, for a `docker` runtime, the env-var keys
  passed inline via `-e KEY[=value]` / `--env KEY[=value]` (never a value;
  `--env-file` is ignored). A credential-shaped var passed inline with no `env`
  block — e.g. `-e GDRIVE_CREDENTIALS_PATH=…` — now emits `secrets.env-key`
  (SECRETS, S2, REVIEW, non-blocker), the secrets-detector analogue of ADR 0012's
  docker bind-mount host-path extraction. Same finding id; no schema change. Only
  verdict delta: corpus `C049` docker inline-cred SAFE → REVIEW (deliberate,
  safe-direction, pre-recorded in the case provenance). Keys are matched by shape,
  so a non-credential inline var (`-e DOCKER_CONTAINER=true`) stays unflagged. See
  ADR 0016.
- **`calllint-mcp@0.1.1` — MCP Registry readiness.** Adds `mcpName`
  (`io.github.calllint/calllint`) to the package so the official MCP Registry can
  verify npm package ownership, and aligns `server.json` to the live registry
  schema (`2025-12-11`, camelCase fields). Published via OIDC + provenance by a
  new dedicated `publish-mcp.yml` workflow (triggered by a `mcp-v*` tag), which
  also submits the entry to the MCP Registry using GitHub OIDC (no stored token).
  `calllint-mcp` is no longer published by `release.yml` — one package per
  workflow. No tool, verdict, or engine change.

## [0.6.0] — 2026-06-29 — Agent rules, approved-state drift gate (L4), and the `calllint-mcp` safety gate

The distribution release. It carries the new4 Layer S–Phase 3 capability core
(capability fingerprint + compact decision + surface extractors) onto the stable
line and builds three layers on top of it, without weakening a single verdict
(corpus floor unchanged: 0 dangerous false-SAFE, UNKNOWN 10.0%).

### Added

- **Agent distribution rules (Phase 3).** `calllint gen-rule --host <h>` emits a
  token-frugal CallLint safety rule for Claude, Cursor, Copilot, Codex, Gemini,
  Windsurf, Cline, and a generic `AGENTS.md` host, from a single source of truth.
- **Approved state + drift gate (Phase 4, L4 — ADR 0024).** `calllint approve`
  records the repo-wide capability surface as `.calllint/approved.json`
  (`calllint.approved.v0`, keyed on the capability fingerprint — distinct from the
  Evidence-layer baseline). `calllint verify --approved` diffs the current surface
  against it; drift never collapses to SAFE. A path-filtered
  `.github/workflows/calllint.yml` runs the gate (`verify --approved --ci`).
- **`calllint-mcp` (Phase 5 — ADR 0025).** A new, separately published MCP server
  exposing CallLint as a static preflight safety gate: tools `scan_mcp_config_path`,
  `scan_mcp_config_json`, `verify_baseline`, `explain_finding`,
  `generate_agent_rule`, `generate_ci_gate_snippet`. Thin wrapper — every tool
  delegates to the engine; zero runtime dependencies; never executes a scanned
  server. First published as `calllint-mcp@0.1.0`.

### Notes

- No `ScanReport` schema, exit-code, verdict, or detector change in this release —
  SAFE is exactly as hard to reach as in 0.5.0. The additions are distribution and
  workflow layers around the existing engine.

## [0.5.0] — 2026-06-29 — PR-gate trifecta + policy guide & override `owner`

The decision-point release. Its core closes the pull-request gate end-to-end
without touching the engine: a `--markdown` renderer, a `scan --changed` git-diff
entry point, and a thin `calllint/calllint@v1` GitHub Action compose the existing
CLI into a PR check. It also ships a policy authoring guide and one additive,
ADR-backed policy-schema field (`owner` on `PolicyOverride`). No `ScanReport`
schema, exit-code, verdict, or detector change — SAFE is exactly as hard to reach
as in `0.4.0`; the only schema movement is the additive `calllint.policy.v0`
`owner` field, which leaves the set of verdicts an override can produce unchanged.

### Added
- **Policy guide (`policy.md`)** + ready-to-copy examples in `examples/policies/`
  (`ci-block-only`, `ci-strict`, `override-timeboxed`), with a validation test
  asserting every shipped example is valid `calllint.policy.v0` (S5). The guide
  describes only verified behavior (CI exit codes and the `BLOCK → REVIEW`
  override); declared-not-read fields are called out as such.
- **`owner` on `PolicyOverride`** — an optional, validated-if-present accountable
  identity (handle/team/email) for a security exception. Recorded and echoed in
  the `policy.applied` diagnostic, never interpreted. Additive, non-breaking
  (ADR 0017-B, `adrs/0017-override-owner-accountability.md`). Schema-additive
  MINOR; the set of verdicts an override can produce is unchanged.
- **`calllint scan --markdown`** — a deterministic, emoji-free Markdown renderer
  for the `ScanReport` (verdict, per-server findings with evidence/impact/fix,
  exit-code legend), derived from the same `calllint.report.v0` the other
  renderers consume. Designed for a PR Step Summary; pipe-safe (table cells are
  escaped). No schema change — it is a view, like `--sarif`/`--html`.
- **CallLint GitHub Action** (`uses: calllint/calllint@v1`) — a thin composite
  action wrapping the published CLI: installs `calllint`, scans the config,
  captures the aggregate verdict as an output, uploads SARIF to Code Scanning,
  writes a Markdown report to the PR Step Summary, and gates the build on the
  verdict. It invents no new gate semantics — the pass/fail decision is the CLI's
  own `--ci` exit code driven by the policy's `ci.failOn` set. Inputs: `target`,
  `version`, `policy`, `online`, `surface-dir`, `sarif`, `step-summary`, `gate`.
  Exercised by an in-repo self-test workflow (`action-selftest.yml`) over SAFE,
  BLOCK report-only, and BLOCK-gates fixtures. Never executes the scanned server.
- **`calllint scan --changed`** — scans only the agent-tool configs that appear
  in the git diff (`git diff --name-only HEAD`), filtered to the known config
  locations (`.cursor/mcp.json`, `.mcp.json`, `mcp.json`, `.claude/settings.json`,
  `.vscode/mcp.json`). The git-diff PR-gate decision point: it cuts reviewer noise
  by skipping unchanged configs and composes with every existing flag (`--ci`,
  `--markdown`, `--json`, `--policy`, `--surface-dir`). No relevant change → a
  no-op exit 0. One changed config behaves exactly like `scan <path>`. For
  multiple, the process exit code is the worst child verdict; `--json` emits a
  JSON array of unchanged `calllint.report.v0` summaries and other formats are
  concatenated. No `ScanReport` schema change. The git diff source is best-effort
  (a non-repo or missing git yields "nothing to scan", never a crash).

## [0.4.0] — Post-stable detector + corpus + prompt-surface

Post-stable detector and corpus work (R2.2 batches 4–6, R3 `diagnostics --json`,
R3-adjacent calibration ADRs, and R4 prompt-surface v0 + local-document increment).
These change verdict behaviour for specific config shapes in the **safe direction**
(they add findings the engine previously missed) and are gated by ADRs, positive +
negative fixtures, unit tests, and a corpus impact pass per the development
contract. No `ScanReport` schema, exit-code, or policy change — SAFE is only
harder to reach.

### Added
- **R3 `calllint diagnostics --json`** — a stable, editor/agent-host-friendly
  machine protocol under its own schema version `calllint.diagnostics.v0`,
  derived purely from an existing `ScanReport` (no new analysis, no verdict
  change, no network). Emits one diagnostic per finding with finding id,
  severity, file + config key-path, observed value, remediation, and verdict
  contribution — including real source line/column for config-mapped evidence.
  This is the geology under any future IDE/agent-host integration, which is why
  it precedes any plugin. See ADR 0013
  (Accepted, implemented).
- **R4 local-document prompt surface** — opt-in `calllint scan --surface-dir <dir>`
  reads a bounded, offline allowlist of project documents (`README.md`, `SKILL.md`,
  `AGENTS.md`, and `package.json` `description`) and runs the prompt-surface scanners
  over them, emitting a project-level `prompt.surface-instructions` (PROMPT, S2,
  REVIEW, non-blocker) finding with a surface path and FP note. Default behaviour is
  unchanged — with no flag, nothing beyond the config is read. Bounded (256 KiB/file,
  named allowlist, no globbing/recursion/symlinks), offline, never executes. The
  `prompt.poisoning` / `prompt.hidden-instructions` scanners were extracted to one
  shared module so the config-metadata and document surfaces flag identically. See
  ADR 0015.
- **R4 prompt-surface v0** — new detector `prompt.hidden-instructions` (PROMPT, S2,
  REVIEW, non-blocker) flags hidden/obfuscated content in the model-visible surface
  (server instructions + provided tool name/description/schema text): zero-width and
  invisible characters, Unicode bidirectional overrides (Trojan-Source class),
  tag-character ASCII smuggling, and embedded HTML/XML comments. Complements the
  existing `prompt.poisoning` literal-phrase blocker by catching its evasion. Static
  shape detection only — never a prompt-injection claim.
  See ADR 0014.
- **`exec.unverified-local-source`** (EXEC, S2, REVIEW, non-blocker) — flags a
  runtime that executes a local script/binary CallLint never inspects (`node
  ./server.js`, `uv run python -m …`, an unrecognized local binary) and that is
  neither a recognized package, a docker image, nor a remote. SAFE is now reachable
  only for recognized, inspectable sources. See
  ADR 0011 (Accepted,
  Direction 2).

### Changed
- **Docker bind-mount host paths are now inspected.** The broad-path detector
  extracts the host side of `--mount type=bind,src=…`/`source=…`, `-v host:container`,
  `--volume`, and inline `--mount=…` forms (drive-letter aware) and runs the
  broad-path check on it (never the container `dst`, never a named volume). A config
  that binds a broad host directory into a container now emits `files.broad-path` →
  BLOCK. Same finding id; no schema change. See
  ADR 0012 (Accepted).
- **Corpus re-verdicts (deliberate, ADR-gated):** `C023` docker bind-mount
  SAFE → BLOCK (ADR 0012); `C035` bare-node and `C040` local-uv-python SAFE → REVIEW
  (ADR 0011 Direction 2). Each case's contract, notes, and `index.json` updated;
  `thisCaseMustNeverBeSafe` set where a blocker now applies.
- **R2.2 corpus → 60 cases** (real/redacted floor 38). Batch 4 (C041–C045): R4
  hidden-instructions seed + real gitlab/sqlite/google-maps/github-remote shapes.
  Batches 5–6 (C046–C060): R4 local-document surface seeds (README/SKILL.md/
  package.json/AGENTS.md via `--surface-dir`) + a clean-surface negative; four more
  real shapes (redis docker-url SAFE, sentry uvx arg-token, gdrive docker-volume SAFE,
  everart docker-secret); and docker mount/volume branch locks
  (`-v`/`--volume`/`--mount=`/`source=` alias/`type=volume`). Acceptance floor
  ratcheted 40/30 → 60/38; dangerous false-SAFE stays 0; UNKNOWN ratio 10.0% (≤ 15%).

### Deferred (recorded, not yet implemented)
- **ADR 0016** — docker `-e KEY[=value]` env keys are not extracted by the secret
  detector (it reads the `env` block, not docker args), so a credential-named var
  passed inline via `-e` with no `env` block is not flagged. A non-blocker
  (REVIEW-class) under-call, the secrets-detector analogue of ADR 0012; anchored by
  corpus case C049. See
  ADR 0016. **(Resolved: implemented in `[Unreleased]` — the extractor now inspects
  docker `-e`/`--env` keys; C049 flips SAFE → REVIEW accordingly.)**


## [0.3.0] — First stable release

First stable release of CallLint, published to the `latest` dist-tag. **No
scanner-semantics change since `0.3.0-rc.1`**: the engine, detectors, verdict
rules, golden expectations, and exit codes are byte-identical — this release
promotes the validated rc.1 to stable and corrects the dist-tag drift. "Stable"
means the **CLI contract, verdict semantics, report schema v0, release chain, and
CI integration are stable** — not that any scanned tool is proven safe (CallLint
is a static, offline, heuristic pre-flight scanner; see `SECURITY.md` /
`LIMITATIONS.md`).

### Changed
- Promoted to the `latest` dist-tag and corrected the known dist-tag drift:
  `latest` now points at `0.3.0` (it had pointed at `0.3.0-preview.0`, published
  before the release workflow derived dist-tags from the version). See
  RELEASE_VERIFICATION.md §1.
- Documented install path moves from `npx calllint@preview` to `npx calllint`
  (the `latest` tag now serves stable).

### Included since the preview line (no behaviour change at promotion)
- **RC-BLK-01 fix** (shipped in `0.3.0-rc.1`): unrecognized or empty MCP server
  shapes resolve to `UNKNOWN`, never a dangerous false-`SAFE`
  (ADR 0010; golden +
  corpus `C031`).
- R2.1 corpus (31 cases, 21 real/redacted), SARIF dogfood, website V3, Trusted
  Publishing with provenance.

## [0.3.0-rc.1] — Stable candidate (RC-BLK-01 fix)

Second release candidate. Fixes a **dangerous false-SAFE** found during the
`0.3.0-rc.0` feedback window while scanning real third-party MCP configs from
public repositories. Published to the **`next`** dist-tag (`npx calllint@next`);
`latest` stays on `0.3.0-preview.0` until stable.

### Fixed
- **Unrecognized / empty server shapes are now UNKNOWN, not SAFE** (RC-BLK-01).
  A server config whose runtime the parser could not recognize — a nested
  `mcpServers.<name>.server.url`, a typo'd key hiding a remote URL, or an empty
  server object — previously resolved to `SAFE` ("no blockers observed") with
  `autonomousUse: allow`. The verdict engine now requires a positively recognized
  source for `SAFE`: any unverifiable source resolves to `UNKNOWN`
  (`packages/risk-engine/src/computeVerdict.ts`). Separately, a config that parses
  but contains **zero servers** (empty `mcpServers`, or a wrong-schema file) now
  aggregates to `UNKNOWN` rather than `SAFE` (`packages/core/src/scanConfig.ts`) —
  "nothing was examined" must not read as "no blockers observed". See
  ADR 0010.

### Added
- Regression coverage for RC-BLK-01: golden fixture
  `unknown-unrecognized-shape.json` (→ UNKNOWN), corpus case
  `C031-unknown-unrecognized-shape` (`thisCaseMustNeverBeSafe`), and unit tests in
  `@calllint/risk-engine` and `@calllint/core`. Corpus is now **31 cases**
  (21 real/redacted), still 0 dangerous false-SAFE.

### Notes
- No detector, exit code, or pre-existing golden verdict changed. The only verdict
  delta is unrecognized/empty shapes moving `SAFE → UNKNOWN` (safe direction).
- The parser does not yet positively recognize a nested/aliased `server.url` as a
  remote; it reaches `UNKNOWN` via the unknown-source path. A pre-existing,
  non-blocking calibration item (an unrecognized local `command` resolving to
  `SAFE`, RC-OBS-02) is recorded for R2.2 and deliberately not changed here.

## [0.3.0-rc.0] — Stable candidate

First release candidate for the stable `0.3.0` line. **No scanner-semantics
change** since preview.1: no detector, verdict, golden expectation, or exit code
was altered. The rc validates the release path end-to-end before `0.3.0` claims
the `latest` dist-tag — release workflow, the dedicated `next` dist-tag, build
provenance, and the `npx` install path. Published to the **`next`** dist-tag
(`npx calllint@next`); `latest` is left on `0.3.0-preview.0` until stable, when
the drift is corrected.

### Added
- **R2.1 corpus** — expanded the calibration corpus to 30 cases, 20 of them
  real-public or redacted-real snapshots with per-case origin metadata, plus a
  `corpus:test:r2-final` gate asserting the R2.1 thresholds (≥30 cases, ≥20
  real/redacted, UNKNOWN ≤ 15%, dangerous false-SAFE = 0).
- **SARIF dogfood** — [`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
  runs CallLint in GitHub Actions; findings appear in Code Scanning. Linked from
  the README and the GitHub Actions integration doc.
- **Website V3** — agent-readable surface (`/llms.txt`, `/agent-instructions.md`,
  `/report-schema.md`, `/security-boundaries.md`), a "For agents" section, and
  corpus-status + release-integrity sections.
- Calibration issue templates and a release-verification doc for the preview
  feedback loop.

### Fixed
- `exec` detector no longer treats an inline `-e` value flag (e.g. `docker run
  -e KEY=val`) as an interpreter inline-eval; precision fix with golden cases.

### Changed
- Release workflow derives the dist-tag in three lanes so a tag can never claim
  the wrong channel: `*-rc.*` → `next`, any other prerelease → `preview`, clean
  semver → `latest`. Release candidates stay off `preview` so preview testers
  are not auto-moved onto an rc.
- `--sarif` exit-code note corrected: it exits 0 on its own (only `--ci` gates),
  so the example workflow drops the unnecessary `|| true`.

## [0.3.0-preview.1] — Interactive polish

### Added
- Tiny "breathing" brand mark on interactive runs — a small CallLint shield with
  a gentle fade pulse, printed to **stderr only**. Strictly suppressed on
  machine output (`--json`/`--sarif`/`--html`/`--compact`), when piped
  (non-TTY), and under `NO_COLOR`, `CI`, `--no-color`, `--no-emoji`, or
  `--stdin`. Purely cosmetic and time-boxed; never delays or fails a command.

## [0.3.0-preview.0] — First public preview

First public preview of CallLint on npm. Static configuration scanner only; does
not execute MCP servers and does not prove runtime safety. Published before the
release workflow derived dist-tags from the version, so it landed on the default
`latest` tag — the dist-tag drift tracked in PROJECT_STATUS "Known issues",
corrected at the first stable release.

### Added
- Public npm preview release (`calllint@0.3.0-preview.0`), installable via
  `npx calllint scan .cursor/mcp.json`.
- **R2.0 seed corpus gate** — `packages/fixtures/corpus/` with 10 calibrated
  cases covering the current finding families, plus a `corpus:test` release gate
  asserting verdict, max risk level, required/forbidden finding kinds, evidence,
  false-positive notes, remediation, and a "dangerous never SAFE" policy.
- Deterministic `--generated-at` support and offline-enforcing corpus run mode.
- Trusted Publishing release workflow (OIDC + provenance; no long-lived
  NPM_TOKEN), publishing the bundled CLI on GitHub Release.
- calllint.com public website (Cloudflare Pages, auto-deployed from `main`).
- GitHub issue templates for false-positive / false-negative / parser edge-case
  reports.

### Changed
- Project license changed from MIT to **Apache-2.0**; added `NOTICE` and
  `TRADEMARKS.md`. The npm tarball ships `LICENSE` and `NOTICE`.
- **Brand transition: MCPGuard → CallLint (v0.3-R0).** The public product is now
  CallLint. This renamed, with no change to scanner semantics:
  - npm package `mcpguard` → `calllint` (unscoped, single bundled CLI)
  - internal workspace scope `@mcpguard/*` → `@calllint/*`
  - CLI binary `mcpguard` → `calllint`
  - cache/baseline directory `.mcpguard/` → `.calllint/`
  - on-disk schema identifiers `mcpguard.{report,baseline,drift,policy}.v0` →
    `calllint.*.v0`
  - policy file `mcpguard.policy.json` → `calllint.policy.json`
  - config input key `x-mcpguard` → `x-calllint`
  - SARIF tool driver name `MCPGuard` → `CallLint`; report titles updated
  - No migration shim: no public release wrote the old paths, so the rename is a
    clean cut.
- README expanded to the full public section set (what it is / checks / does not
  check / install / quick start / example report / rule list / security model /
  limitations / roadmap).
- `CHANGELOG.md` added.

## [0.3-R1] — Distribution readiness

### Added
- Single bundled-CLI distribution: publishable package with an empty runtime
  dependency list, `files: ["dist"]` allowlist, `prepack` rebuild, and npm
  metadata (ADR 0007).
- `scripts/package-smoke.mjs` + `pnpm pack:smoke`: packs the real tarball and
  asserts the manifest, bin/type/shebang, an empty runtime dep list, and a
  self-contained bundle; then installs into an isolated global prefix and runs
  the installed binary.
- `.github/workflows/ci.yml`: typecheck/test/build/smoke/pack:smoke with a
  least-privilege token; never publishes, never executes a scanned server.
- Apache-2.0 `LICENSE` and `NOTICE` (ship in the tarball) and `SECURITY.md`.

### Changed
- `apps/cli` made publishable: dropped `private`, moved `workspace:*` to
  `devDependencies`, bin canonicalized to `dist/index.js`.

## [0.2.1] — Hardening

### Added
- MONEY golden coverage driven end-to-end from a single source of truth.
- `block-observed-payment` golden: observed money-mover + capability → BLOCK.
- Online no-downgrade invariant: findings carry `source`/`fetchedAt`; enrichment
  is advisory and code-enforced never to lower a verdict
  (ADR 0006).
- Windows path/shell regression coverage.
- `LIMITATIONS.md` (trust boundaries) and the release checklist.

### Changed
- Split name-inferred financial risk (`action.financial`, INFERRED → REVIEW)
  from observed money movement (`action.financial-observed`, OBSERVED → BLOCK).

## [0.2.0] — Engine completion

### Added
- Drift detection (`baseline` / `verify`) with rug-pull signal on
  pinned-version changes.
- SARIF 2.1.0 output (GitHub Code Scanning) and a self-contained HTML report.
- `npm:` and `github:` scan targets; opt-in `--online` advisory enrichment.

## [0.1.0] — Foundation

### Added
- pnpm monorepo: config parser, resolver, static analyzer (eight detectors),
  deterministic risk engine (S0–S5 classes, SAFE/REVIEW/BLOCK/UNKNOWN verdicts),
  policy-as-code with a CI gate, stable drift fingerprints, scan pipeline, and a
  terminal/compact/JSON report renderer.
- Golden verdict contract enforced through the built binary.
- CLI: `scan` / `baseline` / `verify` / `explain` / `policy` with documented
  exit codes (0 SAFE · 10 REVIEW · 20 UNKNOWN · 30 BLOCK · 40 DRIFT · 2 usage ·
  3 error).
