# Changelog

All notable changes to CallLint are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0
onward. While pre-1.0, minor versions may include breaking changes.

`MCPGuard` was the internal codename for this project; the public product is
**CallLint** (see ADR 0008).

## [Unreleased]

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
- `LIMITATIONS.md` (trust boundaries) and `docs/release-checklist.md`.

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
