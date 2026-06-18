# Stable release gate (0.3.0 `latest`)

Hard requirements before promoting CallLint from preview to the first stable
release on the `latest` dist-tag. This is a high-level go/no-go gate; the
mechanical pre-tag steps live in [release-checklist.md](./release-checklist.md)
and post-publish verification in [RELEASE_VERIFICATION.md](./RELEASE_VERIFICATION.md).

Do not promote to `latest` on feel. Every box must be checked.

## Evidence & calibration

- [x] R2.1 corpus ≥ 30 cases. *(30 cases)*
- [x] ≥ 20 cases are `redacted-real-snapshot` or `real-public-snapshot` (each
      with origin metadata). *(20: 19 real-public + 1 redacted)*
- [x] `corpus:test` (and `corpus:test:r2-final`) pass.
- [x] Dangerous false-SAFE = 0.
- [x] UNKNOWN ratio ≤ 15%. *(10.0%)*
- [x] Every REVIEW/BLOCK finding has evidence, a false-positive note, and
      remediation.
- [x] `docs/R2_CALIBRATION.md` regenerated and current. *(30/20)*

## Distribution & supply chain

- [x] All quality gates green (typecheck, test, build, smoke, pack:smoke,
      corpus:test) — see release-checklist.md. *(189 tests; pack:smoke PASS)*
- [x] `npm publish --dry-run` passes against the official registry.
- [x] Trusted Publishing configured; no long-lived NPM_TOKEN anywhere.
- [x] Provenance / signatures verified for the latest preview
      (`npm audit signatures`). *(preview.1: 1 verified signature + 1 verified
      attestation against registry.npmjs.org)*
- [ ] dist-tag plan documented and ready: on stable publish, point `latest` at
      `0.3.0` and resolve the preview.0 drift (RELEASE_VERIFICATION.md §1).

## Real-world proof

- [x] SARIF dogfood: [`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
      runs CallLint in GitHub Actions; 4 alerts (one per finding) appear in Code
      Scanning and the run is green with a report-only gate.
- [x] Exit-code contract verified end-to-end in CI (BLOCK exits 30 under the
      `--ci` gate; report mode uploads SARIF + HTML regardless).
- [x] At least a handful of external/real configs scanned with no dangerous
      false-SAFE. *(20 real/redacted corpus snapshots, 0 dangerous false-SAFE)*

## Trust narrative

- [x] `PROJECT_STATUS.md`, `CHANGELOG.md`, and `docs/releases/` reflect reality.
- [x] `SECURITY.md` current.
- [x] Limitations visible in both `README.md` and the homepage (not hidden).
- [x] No unsupported safety claims ("proves safe", "prevents all", "secure")
      anywhere in README, website, or release notes.

## Promotion sequence

```text
0.3.0-preview.1 (current)
  → 0.3.0-rc.0   (preview dist-tag; invite external testers; collect FP/FN)
  → 0.3.0        (latest dist-tag; fix dist-tag drift; GitHub Release)
```

Only when every box above is checked does `0.3.0` ship to `latest`.
