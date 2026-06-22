# CallLint Project Status

Current phase: **v0.3.0 — stable, prepared on `main`** (version bumped, CHANGELOG
and gate complete; **not yet tagged/published**). The published artifact is still
`0.3.0-rc.1` on the `next` dist-tag; promotion to `latest` is the remaining
human-gated publish step (GitHub Release → OIDC publish → `npm dist-tag add
calllint@0.3.0 latest`). No scanner-semantics change from rc.1 — engine is
byte-identical.

CallLint is a deterministic, offline-first CLI for pre-run risk linting of MCP
and agent-tool configurations. It returns SAFE / REVIEW / BLOCK / UNKNOWN with
evidence, and never executes the server it judges.

Product name: **CallLint** (CLI `calllint`, npm `calllint`, internal scope
`@calllint/*`). `MCPGuard` was the internal codename — see
[ADR 0008](docs/adr/0008-brand-transition-calllint.md). Historical planning docs
(`000.md`, ADRs 0001/0003/0004) retain the codename intentionally.

## Public artifacts

- Website: https://calllint.com (Cloudflare Pages, auto-deployed from `main`)
- npm package: published dist-tags — `next: 0.3.0-rc.1`, `preview:
  0.3.0-preview.1`, `latest: 0.3.0-preview.0` (drift). **`0.3.0` stable is prepared
  in-repo** (version bumped, CHANGELOG); on publish it claims `latest` and resolves
  the drift (`npm dist-tag add calllint@0.3.0 latest`).
- GitHub repository: `calllint/calllint`
- Install / run (pre-stable, rc on `next`): `npx calllint@next scan .cursor/mcp.json`

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

## Current limitations

- Static analysis only — does not execute MCP servers.
- Does not prove runtime safety; a clean run is necessary, not sufficient.
- R2.1 corpus meets its thresholds but does not yet represent the full MCP
  ecosystem; expansion continues.
- Pre-1.0 preview; verdicts are heuristic decision support, not a guarantee.

## Verification status (last run)

- typecheck: clean (tsc strict)
- tests: **193 passed across 20 files** (unit + E2E against the built binary;
  package smoke; network mocked — tests never touch the network). +4 since rc.0:
  the RC-BLK-01 regression locks (see Known issues).
- build: `apps/cli/dist/index.js` (self-contained esbuild bundle, node shebang)
- corpus:test: **31 cases** (21 real/redacted), 0 contract failures, 0 dangerous
  false SAFE, UNKNOWN ratio 12.9%; `corpus:test:r2-final` thresholds met
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
- **npm dist-tag drift:** `latest` currently points at `0.3.0-preview.0` (the
  first preview, published before the release workflow derived dist-tags from
  the version). `preview` correctly points at `0.3.0-preview.1`. A preview
  should not occupy `latest`; this is tracked for correction at the first stable
  (`0.3.0`) release. See [docs/RELEASE_VERIFICATION.md](docs/RELEASE_VERIFICATION.md).

## Next roadmap (v0.3)

1. **Done — `0.3.0-rc.1` published** to the `next` dist-tag (RC-BLK-01 fixed and
   re-validated on the published artifact). Close out the RC feedback window
   ([docs/RC_FEEDBACK_PROTOCOL.md](docs/RC_FEEDBACK_PROTOCOL.md)).
2. **Stable `0.3.0`** to `latest`, gated by
   [docs/STABLE_RELEASE_GATE.md](docs/STABLE_RELEASE_GATE.md); correct the
   `latest` → preview.0 drift at that point and flip the website's default
   install command to `npx calllint`.
3. **R2.2 — corpus breadth:** continue adding real-public/redacted snapshots
   beyond the R2.1 thresholds; keep measuring false positives, parser
   boundaries, and UNKNOWN rate.
4. (Later) R3 `calllint diagnostics --json`, R4 Prompt Surface expansion.

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
