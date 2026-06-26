# CallLint Project Status

Current phase: **v0.3.0 — stable, published** (npm `latest` → `0.3.0`; GitHub
Release `v0.3.0` is the latest, non-pre-release). The promotion was a human-gated
publish (GitHub Release → OIDC publish → `npm dist-tag add calllint@0.3.0
latest`), which also resolved the earlier `latest` → `0.3.0-preview.0` drift. No
scanner-semantics change from `0.3.0-rc.1` — the engine is byte-identical.

Post-stable work (unreleased, on `main`): R2.2 corpus reached **60 cases** (floor
60/38); R3 `diagnostics --json` shipped; the ADR 0011/0012 detector-calibration
questions are resolved; R4 prompt-surface **v0** (`prompt.hidden-instructions`,
ADR 0014) and the **local-document surface increment** (`prompt.surface-instructions`
via `--surface-dir`, ADR 0015) shipped; and a docker `-e` secrets gap is recorded as
ADR 0016 (deferred). These change verdict behaviour for specific shapes in the safe
direction and are ADR-gated + fixture-backed + corpus-locked; they are staged for the
next release (see CHANGELOG `[Unreleased]`).

CallLint is a deterministic, offline-first CLI for pre-run risk linting of MCP
and agent-tool configurations. It returns SAFE / REVIEW / BLOCK / UNKNOWN with
evidence, and never executes the server it judges.

Product name: **CallLint** (CLI `calllint`, npm `calllint`, internal scope
`@calllint/*`). `MCPGuard` was the internal codename — see
[ADR 0008](docs/adr/0008-brand-transition-calllint.md). Historical planning docs
(`000.md`, ADRs 0001/0003/0004) retain the codename intentionally.

## Public artifacts

- Website: https://calllint.com (Cloudflare Pages, auto-deployed from `main`)
- npm package: published dist-tags — `latest: 0.3.0`, `next: 0.3.0-rc.1`,
  `preview: 0.3.0-preview.1`. The stable publish pointed `latest` at `0.3.0` and
  resolved the earlier `0.3.0-preview.0` drift (`npm dist-tag add calllint@0.3.0
  latest`).
- GitHub repository: `calllint/calllint`
- GitHub Release: `v0.3.0` (latest, not a pre-release)
- Install / run: `npx calllint scan .cursor/mcp.json`

## Completed

- v0.1 / v0.2 deterministic engine (parser, resolver, eight detectors, risk
  engine, policy-as-code, drift fingerprints, scan pipeline, renderers).
- v0.2.1 hardening — MONEY contract end-to-end, observed money-movers hard-block,
  online enrichment can never downgrade a verdict, Windows behaviour pinned,
  shipped artifact smoke-tested.
- v0.3-R0 brand migration (MCPGuard → CallLint), zero scanner-semantics change.
- v0.3-R1 distribution packaging — publishable single-bundle CLI, empty runtime
  dependency list, `files` allowlist, isolated-install smoke, `npm publish
  --dry-run`.
- v0.3-R2.1 corpus gate — `packages/fixtures/corpus/` with 30 calibrated cases
  (20 real-public/redacted snapshots with per-case origin metadata) and a
  `corpus:test` / `corpus:test:r2-final` release gate.
- Trusted Publishing release workflow (OIDC, provenance; no long-lived
  NPM_TOKEN).
- calllint.com public website (V3: agent-readable surface, corpus + release
  integrity sections) deployed.
- SARIF dogfood live: [`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
  runs CallLint in GitHub Actions; alerts appear in Code Scanning.
- npm public preview published (`0.3.0-preview.0`, then `0.3.0-preview.1`).
- RC feedback window: `0.3.0-rc.0` published to `next`, third-party config harvest
  (B01–B10), RC-BLK-01 found and fixed, `0.3.0-rc.1` published and re-validated.
- **Stable `0.3.0` published** — promoted to npm `latest`, GitHub Release `v0.3.0`
  (latest, not a pre-release); engine byte-identical to rc.1.
- v0.3-R2.2 corpus growth (post-stable) — acceptance floor ratcheted 30/20 → 31/21
  (C031 RC-BLK-01 lock now gate-protected) → 35/25 (batch 1: C032–C035 promoted
  from validated RC non-author inputs) → 36/26 (batch 2: C036, the 92-server
  RC-B10 multi-runtime stress) → 40/30 (batch 3: C037–C040, first real
  `action.financial` + external-mutation / multi-secret / local-python SAFE shapes)
  → **45/34 (batch 4: C041 R4 prompt-surface seed + C042–C045 real gitlab /
  sqlite-uv-local / google-maps / github-remote-header shapes)**; UNKNOWN ratio
  13.3%, 0 dangerous false-SAFE. The 45-case target is met.
- v0.3-R3 `calllint diagnostics --json` — shipped (ADR 0013): a pure view of the
  ScanReport under `calllint.diagnostics.v0`, including real source line/column for
  config-mapped evidence; no change to verdict semantics or the report schema.
- **Detector-calibration ADRs resolved** — ADR 0012 (Accepted): the broad-path
  detector now extracts docker bind-mount host paths
  (`--mount type=bind,src=…`, `-v host:container`), C023 SAFE → BLOCK. ADR 0011
  (Accepted, Direction 2): new `exec.unverified-local-source` (REVIEW) for local
  executables that are not a recognized package/image/remote, C035 + C040 SAFE →
  REVIEW.
- **R4 prompt-surface v0** — shipped (ADR 0014): new `prompt.hidden-instructions`
  (REVIEW) flags hidden/obfuscated content (zero-width / bidi / tag-char / HTML
  comments) in the model-visible surface, complementing `prompt.poisoning`.
- **R4 local-document surface increment** — shipped (ADR 0015): opt-in
  `calllint scan --surface-dir <dir>` reads a bounded, offline allowlist of project
  documents (README.md / SKILL.md / AGENTS.md / package.json description) and runs
  the prompt-surface scanners over them, emitting a project-level
  `prompt.surface-instructions` (REVIEW). Default behaviour unchanged (no flag →
  nothing beyond the config is read). Registry/remote doc surfaces remain the next
  R4 (online) increment. A docker `-e` env-key secrets gap found while harvesting is
  recorded as ADR 0016 (Proposed/deferred), anchored by C049.

## Current limitations

- Static analysis only — does not execute MCP servers.
- Does not prove runtime safety; a clean run is necessary, not sufficient.
- The corpus (60 cases, R2.2 ongoing toward 80 from real/redacted field feedback)
  meets its thresholds but does not represent the full MCP ecosystem; expansion
  continues.
- Prompt-surface detection reads the config's declared tool metadata plus an
  opt-in `--surface-dir` allowlist of project documents (README.md / SKILL.md /
  AGENTS.md / `package.json` description, ADR 0015). Registry metadata (npm/PyPI
  description, keywords) and a server's remote README are not yet read — they
  are network input and the next R4 (`--online`) increment.
- A docker `-e KEY[=value]` env key is not extracted by the secret detector
  (ADR 0016, Proposed/deferred; anchored by C049) — a REVIEW-class under-call,
  not a dangerous false-SAFE.
- Pre-1.0; verdicts are heuristic decision support, not a guarantee.

## Verification status (last run)

- typecheck: clean (tsc strict)
- tests: **260 passed across 22 files** (unit + E2E against the built binary;
  package smoke; network mocked — tests never touch the network). Includes the
  ADR 0011/0012/0014/0015 detector + surface tests (docker bind-mount host paths
  incl. -v/--volume/--mount= branch coverage, unverified local source,
  hidden-instructions, document-surface scan + --surface-dir CLI).
- build: `apps/cli/dist/index.js` (self-contained esbuild bundle, node shebang)
- corpus:test: **60 cases** (38 real/redacted), 0 contract failures, 0 dangerous
  false SAFE, UNKNOWN ratio 10.0%; `corpus:test:r2-final` thresholds met (floor
  ratcheted to 60/38)
- pack:smoke: real npm tarball, empty runtime deps, no `workspace:*`; isolated
  global install runs `calllint --help` / `scan` / `--json` / `--ci` (exit 30
  on BLOCK)
- npm publish --dry-run: passes

## Exit codes (CI)

- 0 SAFE · 10 REVIEW (if failOnReview) · 20 UNKNOWN · 30 BLOCK · 40 DRIFT
  (verify --ci) · 2 usage · 3 error

## Design decisions of note

- UNKNOWN never auto-upgrades to SAFE.
- Risk engine is pure/deterministic; no LLM in the verdict path.
- JSON report is the stable, emoji-free contract; human views
  (terminal/sarif/html) derive from it.
- now/generatedAt are injected for deterministic, reproducible reports.
- Name-inferred and observed findings are never conflated: inference is REVIEW,
  observed money movement is BLOCK.
- Online enrichment is advisory and code-enforced never to downgrade a verdict
  (ADR 0006).
- Network is opt-in (`--online`) behind an injectable fetch interface; analyzers
  stay pure and offline.

## Known issues

- **RC-BLK-01 (found in the rc.0 window, fixed and shipped in rc.1):** scanning
  real third-party configs surfaced a dangerous false-SAFE — an unrecognized
  server shape (nested `server.url`, empty/wrong-schema config) resolved to SAFE
  instead of UNKNOWN. Fixed and regression-locked
  ([ADR 0010](docs/adr/0010-unknown-runtime-fails-to-unknown.md); golden + corpus
  C031), merged to `main` (PR #36), published as **`0.3.0-rc.1`** to `next`, and
  **re-validated on the published artifact** (B04 + 4 synthetic shapes + B01–B10
  all correct on `npx calllint@next` = rc.1; dangerous false-SAFE = 0).
  **Resolved.** See [docs/RC_FEEDBACK_LOG.md](docs/RC_FEEDBACK_LOG.md).
- **npm dist-tag drift (resolved at stable):** before the stable release, `latest`
  pointed at `0.3.0-preview.0` (the first preview, published before the release
  workflow derived dist-tags from the version). The `0.3.0` stable publish moved
  `latest` to `0.3.0` (`npm dist-tag add calllint@0.3.0 latest`), so a preview no
  longer occupies `latest`. See [docs/RELEASE_VERIFICATION.md](docs/RELEASE_VERIFICATION.md).

## Next roadmap (v0.3)

1. **Done — `0.3.0-rc.1` published** to the `next` dist-tag (RC-BLK-01 fixed and
   re-validated on the published artifact).
2. **Done — stable `0.3.0` published** to `latest` (gate
   [docs/STABLE_RELEASE_GATE.md](docs/STABLE_RELEASE_GATE.md) fully checked),
   resolving the `latest` → preview.0 drift, with the website + README default
   install flipped to `npx calllint`. RC feedback window
   ([docs/RC_FEEDBACK_PROTOCOL.md](docs/RC_FEEDBACK_PROTOCOL.md)) closed.
3. **R2.2 — corpus breadth (60-case floor met):** batches 1–6 done (floor
   30/20 → 31/21 → 35/25 → 36/26 → 40/30 → 45/34 → 60/38; cases C031–C060).
   Continue adding real-public/redacted snapshots toward 80; keep measuring
   false positives, parser boundaries, and UNKNOWN rate.
4. **R3 `calllint diagnostics --json` — done** (ADR 0013), incl. real line/column.
5. **Detector-calibration ADRs — done:** ADR 0012 (docker bind-mount host paths;
   C023 SAFE → BLOCK) and ADR 0011 Direction 2 (`exec.unverified-local-source`;
   C035 + C040 SAFE → REVIEW), both fixture-backed and corpus-locked.
6. **R4 Prompt Surface — v0 + local-document increment done:** ADR 0014
   (`prompt.hidden-instructions`, config tool metadata) and ADR 0015
   (`prompt.surface-instructions` via `--surface-dir`, project documents).
   Next R4 increment: registry metadata (npm/PyPI description, keywords) and a
   server's remote README — network input, an `--online` concern (advisory per
   ADR 0006). Then continued corpus growth toward 80. Platform-shaped work
   stays gated on real adoption signals.
7. **ADR 0016 — recorded, deferred:** docker `-e` env-key secrets gap
   (Proposed/deferred; anchored by C049). The secrets-detector analogue of
   ADR 0012; a REVIEW-class under-call, not a dangerous false-SAFE.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full phase map and explicit
non-goals. Telemetry is **not** in `0.3.0` (see
[ADR 0009](docs/adr/0009-optional-telemetry.md)).

## Non-goals (current)

- No gateway, payments, marketplace, SaaS dashboard, IDE plugin, runtime
  sandbox, or AgentTrust platform layer yet.
- No host execution of unknown MCP servers, no real secret access, no
  destructive calls.
- `--online` reads public registry/repo metadata only; it never executes
  fetched code, and never upgrades a verdict toward SAFE.
- No LLM in the verdict path.
