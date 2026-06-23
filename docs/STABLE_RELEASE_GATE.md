# Stable release gate (0.3.0 `latest`)

Hard requirements before promoting CallLint from preview to the first stable
release on the `latest` dist-tag. This is a high-level go/no-go gate; the
mechanical pre-tag steps live in [release-checklist.md](./release-checklist.md)
and post-publish verification in [RELEASE_VERIFICATION.md](./RELEASE_VERIFICATION.md).

Do not promote to `latest` on feel. Every box must be checked.

> **Status 2026-06-22: stable `0.3.0` published to `latest`; every box below
> checked.** The `0.3.0-rc.0` window found a dangerous false-SAFE (RC-BLK-01 in
> [RC_FEEDBACK_LOG.md](./RC_FEEDBACK_LOG.md)): unrecognized/empty server shapes
> resolved to SAFE instead of UNKNOWN. It is **resolved + regression-locked**
> ([ADR 0010](./adr/0010-unknown-runtime-fails-to-unknown.md), Accepted; golden +
> corpus C031), **merged to `main` (PR #36), published as `0.3.0-rc.1` to the
> `next` dist-tag, and re-confirmed on the published artifact** (B04 + 4 synthetic
> shapes + B01–B10 all correct on `npx calllint@next` = rc.1; dangerous
> false-SAFE = 0). `0.3.0` was then promoted to `latest` (`npm dist-tag add
> calllint@0.3.0 latest`, resolving the preview.0 drift), GitHub Release `v0.3.0`
> published as latest (not a pre-release), and the website + README default
> install flipped to `npx calllint`. The engine is byte-identical to rc.1.

## Evidence & calibration

- [x] R2.1 corpus ≥ 30 cases. *(30 cases)*
- [x] ≥ 20 cases are `redacted-real-snapshot` or `real-public-snapshot` (each
      with origin metadata). *(20: 19 real-public + 1 redacted)*
- [x] `corpus:test` (and `corpus:test:r2-final`) pass.
- [x] Dangerous false-SAFE = 0. *(0 on the published `0.3.0-rc.1` — B04 + 4
      synthetic shapes + B01–B10 all correct; corpus 31 cases report 0. Stable
      `0.3.0` is byte-identical to rc.1.)*
- [x] UNKNOWN ratio ≤ 15%. *(10.0%)*
- [x] Every REVIEW/BLOCK finding has evidence, a false-positive note, and
      remediation.
- [x] `docs/R2_CALIBRATION.md` regenerated and current. *(30/20)*

## Distribution & supply chain

- [x] All quality gates green (typecheck, test, build, smoke, pack:smoke,
      corpus:test) — see release-checklist.md. *(193 tests; pack:smoke PASS)*
- [x] `npm publish --dry-run` passes against the official registry.
- [x] Trusted Publishing configured; no long-lived NPM_TOKEN anywhere.
- [x] Provenance / signatures verified for the latest preview
      (`npm audit signatures`). *(preview.1: 1 verified signature + 1 verified
      attestation against registry.npmjs.org)*
- [x] dist-tag plan documented and ready: on stable publish, point `latest` at
      `0.3.0` and resolve the preview.0 drift (RELEASE_VERIFICATION.md §1).
      *(Executed as part of publish: `npm dist-tag add calllint@0.3.0 latest`.)*

## Real-world proof

- [x] SARIF dogfood: [`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
      runs CallLint in GitHub Actions; 4 alerts (one per finding) appear in Code
      Scanning and the run is green with a report-only gate.
- [x] Exit-code contract verified end-to-end in CI (BLOCK exits 30 under the
      `--ci` gate; report mode uploads SARIF + HTML regardless).
- [x] At least a handful of external/real configs scanned with no dangerous
      false-SAFE. *(20 real/redacted corpus snapshots + 11 RC non-author configs;
      the one dangerous false-SAFE found — RC-BLK-01/B04 — is fixed and
      regression-locked, and re-confirmed on the published `0.3.0-rc.1`.)*

## Trust narrative

- [x] `PROJECT_STATUS.md`, `CHANGELOG.md`, and `docs/releases/` reflect reality.
- [x] `SECURITY.md` current.
- [x] Limitations visible in both `README.md` and the homepage (not hidden).
- [x] No unsupported safety claims ("proves safe", "prevents all", "secure")
      anywhere in README, website, or release notes.

## Promotion sequence

```text
0.3.0-preview.1 (published; preview dist-tag)
  → 0.3.0-rc.0   (next dist-tag; invite external testers; collect FP/FN)
  → 0.3.0        (latest dist-tag; fix the preview.0 latest drift; GitHub Release)
```

Release candidates publish to **`next`**, not `preview`, so testers tracking
`@preview` are never auto-moved onto an rc. The dist-tag is derived from the
version by the release workflow (`*-rc.*` → `next`, other prereleases →
`preview`, clean semver → `latest`).

### RC verification (after `v0.3.0-rc.0` is published to `next`)

```bash
npm view calllint version dist-tags --registry=https://registry.npmjs.org/
# expect: next → 0.3.0-rc.0 · preview → 0.3.0-preview.1 · latest → 0.3.0-preview.0

npx --yes calllint@next --help
npx --yes calllint@next scan .cursor/mcp.json
npx --yes npm@latest audit signatures --registry=https://registry.npmjs.org/
```

The RC feedback window and its blocking criteria are defined in
[RC_FEEDBACK_PROTOCOL.md](./RC_FEEDBACK_PROTOCOL.md).

Only when every box above is checked does `0.3.0` ship to `latest`.
