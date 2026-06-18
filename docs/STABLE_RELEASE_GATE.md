# Stable release gate (0.3.0 `latest`)

Hard requirements before promoting CallLint from preview to the first stable
release on the `latest` dist-tag. This is a high-level go/no-go gate; the
mechanical pre-tag steps live in [release-checklist.md](./release-checklist.md)
and post-publish verification in [RELEASE_VERIFICATION.md](./RELEASE_VERIFICATION.md).

Do not promote to `latest` on feel. Every box must be checked.

## Evidence & calibration

- [ ] R2.1 corpus ≥ 30 cases.
- [ ] ≥ 20 cases are `redacted-real-snapshot` or `real-public-snapshot` (each
      with origin metadata).
- [ ] `corpus:test` (and `corpus:test:r2-final`) pass.
- [ ] Dangerous false-SAFE = 0.
- [ ] UNKNOWN ratio ≤ 15%.
- [ ] Every REVIEW/BLOCK finding has evidence, a false-positive note, and
      remediation.
- [ ] `docs/R2_CALIBRATION.md` regenerated and current.

## Distribution & supply chain

- [ ] All quality gates green (typecheck, test, build, smoke, pack:smoke,
      corpus:test) — see release-checklist.md.
- [ ] `npm publish --dry-run` passes against the official registry.
- [ ] Trusted Publishing configured; no long-lived NPM_TOKEN anywhere.
- [ ] Provenance / signatures verified for the latest preview
      (`npm audit signatures`).
- [ ] dist-tag plan documented and ready: on stable publish, point `latest` at
      `0.3.0` and resolve the preview.0 drift (RELEASE_VERIFICATION.md §1).

## Real-world proof

- [x] SARIF dogfood: [`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
      runs CallLint in GitHub Actions; 4 alerts (one per finding) appear in Code
      Scanning and the run is green with a report-only gate.
- [x] Exit-code contract verified end-to-end in CI (BLOCK exits 30 under the
      `--ci` gate; report mode uploads SARIF + HTML regardless).
- [ ] At least a handful of external/real configs scanned with no dangerous
      false-SAFE.

## Trust narrative

- [ ] `PROJECT_STATUS.md`, `CHANGELOG.md`, and `docs/releases/` reflect reality.
- [ ] `SECURITY.md` current.
- [ ] Limitations visible in both `README.md` and the homepage (not hidden).
- [ ] No unsupported safety claims ("proves safe", "prevents all", "secure")
      anywhere in README, website, or release notes.

## Promotion sequence

```text
0.3.0-preview.1 (current)
  → 0.3.0-rc.0   (preview dist-tag; invite external testers; collect FP/FN)
  → 0.3.0        (latest dist-tag; fix dist-tag drift; GitHub Release)
```

Only when every box above is checked does `0.3.0` ship to `latest`.
