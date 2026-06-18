# Project health

A lightweight, manual dashboard for CallLint's release readiness. Not a service
— a checklist you run. Five axes; each lists the exact command and the current
known-good value so drift is obvious. Re-run before any tag or publish.

Toolchain: Node 20 + corepack pnpm (`export PATH="/c/nvm4w/nodejs:$PATH"`).

## 1. Release health

```bash
npm view calllint version dist-tags repository homepage --registry=https://registry.npmjs.org/
npx --yes npm@latest audit signatures --registry=https://registry.npmjs.org/
```

Known state (as of preparing `0.3.0-rc.0`):

- `latest` → `0.3.0-preview.0` — **known drift**, corrected at stable 0.3.0
  ([RELEASE_VERIFICATION.md](./RELEASE_VERIFICATION.md) §1).
- `preview` → `0.3.0-preview.1`.
- `next` → not yet set; will be `0.3.0-rc.0` after the rc tag is pushed.
- `repository` = `git+https://github.com/calllint/calllint.git`; `homepage` =
  `https://calllint.com`.
- Provenance: preview.1 verified (1 registry signature + 1 attestation).

After the rc publishes, expect: `next → 0.3.0-rc.0`, `preview → 0.3.0-preview.1`,
`latest → 0.3.0-preview.0` (unchanged until stable).

## 2. Quality health

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm corpus:test
pnpm corpus:test:r2-final
pnpm pack:smoke
```

Known-good: typecheck clean · **189 tests pass across 20 files** · build →
self-contained `apps/cli/dist/index.js` (~86 kb) · both corpus gates green ·
pack:smoke PASS (6-file allowlist tarball, isolated install, exit 30 on BLOCK).

## 3. Corpus health

```bash
pnpm corpus:test                                         # contract gate
pnpm corpus:test -- --summary-json corpus-summary.json   # machine summary
pnpm corpus:test:r2-final                                # R2.1 acceptance gate
```

Known-good (R2.1, see [R2_CALIBRATION.md](./R2_CALIBRATION.md)):

| Metric | Value | Threshold |
|--------|-------|-----------|
| Total cases | 30 | ≥ 30 |
| Real / redacted | 20 | ≥ 20 |
| Dangerous false-SAFE | 0 | = 0 (hard) |
| UNKNOWN ratio | 10.0% | ≤ 15% |
| Contract failures | 0 | = 0 |

Trend to watch as R2.2 grows: dangerous false-SAFE must stay 0; UNKNOWN ≤ 15%;
all nine finding ids stay exercised.

## 4. Integration health

```bash
# SARIF dogfood — calllint-demo-risky-mcp runs CallLint in GitHub Actions
#   expect: workflow green, one Code Scanning alert per finding
calllint scan .cursor/mcp.json --sarif > calllint.sarif   # local SARIF shape
calllint scan .cursor/mcp.json --html  > report.html      # local HTML artifact
```

Known-good: [`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
green; 4 alerts (one per finding) in Code Scanning; report-only gate; BLOCK
exits 30 under `--ci`. Keep the example workflow in
[integrations/github-actions.md](./integrations/github-actions.md) current.

## 5. Adoption health

Early numbers are expected to be small — track the **shape**, not the size.

- npm weekly downloads
- GitHub stars / issues / PRs (note which are external vs author)
- external configs scanned / feedback received (→ RC log / R2.2 candidates)
- CI / SARIF users beyond the dogfood repo

Early "healthy" is qualitative: real external feedback, real FP/FN discussion,
real corpus candidates — not a download count. The platform decision gates in
[ROADMAP.md](./ROADMAP.md) read from this axis.

---

Related: [STABLE_RELEASE_GATE.md](./STABLE_RELEASE_GATE.md) (go/no-go),
[RC_FEEDBACK_PROTOCOL.md](./RC_FEEDBACK_PROTOCOL.md) (rc window),
[release-checklist.md](./release-checklist.md) (pre-tag steps),
[RELEASE_VERIFICATION.md](./RELEASE_VERIFICATION.md) (post-publish).
