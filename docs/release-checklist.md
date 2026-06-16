# Release checklist

A deterministic, repeatable gate before tagging a release. Every box must pass
on a clean checkout. CallLint never executes the servers it scans; none of these
steps run untrusted code.

## 1. Clean state

- [ ] On a release branch (never commit a release directly to `main`).
- [ ] Working tree clean (`git status`).
- [ ] `pnpm install --frozen-lockfile` succeeds.

## 2. Quality gates (all green)

- [ ] `pnpm typecheck` — clean (tsc strict).
- [ ] `pnpm test` — all tests pass (unit + E2E + package smoke; network is
      mocked, tests never go online).
- [ ] `pnpm build` — produces `apps/cli/dist/index.js`.
- [ ] `pnpm smoke` — package smoke test passes against the freshly built bundle.

## 3. Contract & behaviour

- [ ] Golden verdict contract passes through the built binary (covered by
      `tests/e2e`). Any intended change to a golden verdict has an ADR.
- [ ] MONEY split intact: `review-financial` → REVIEW, `block-observed-payment`
      → BLOCK.
- [ ] Online no-downgrade invariant intact (ADR 0006) and covered by tests.

## 4. Manual artifact verification

Run the built binary the way a user would:

- [ ] `node apps/cli/dist/index.js --help` prints usage.
- [ ] `node apps/cli/dist/index.js scan examples/sample-mcp.json` returns a
      verdict with evidence.
- [ ] `node apps/cli/dist/index.js scan <config> --sarif` emits valid SARIF
      2.1.0 (`version` 2.1.0, `$schema` present).
- [ ] `node apps/cli/dist/index.js scan <config> --html > report.html` opens as
      a self-contained report (inline CSS, no external links/JS); HTML is
      XSS-escaped.
- [ ] `node apps/cli/dist/index.js scan <config> --ci` exits with the documented
      code for the verdict.

## 5. Docs in sync

- [ ] `README.md` reflects current commands and flags.
- [ ] `PROJECT_STATUS.md` updated: phase label, test count, golden contract,
      open risks, roadmap.
- [ ] `LIMITATIONS.md` still accurate.
- [ ] Any schema/behaviour change recorded as an ADR under `docs/adr/`.

## 6. Packaging & distribution

The CLI is published as a **single self-contained esbuild bundle** — see
[ADR 0007](adr/0007-cli-distribution-strategy.md). The publishable package is
`apps/cli` (`@calllint/cli`); the monorepo root stays private.

- [ ] `pnpm pack:smoke` passes: the real `npm pack` tarball contains exactly
      `package.json`, `README.md`, `dist/index.js`; the published surface has an
      empty runtime `dependencies` (no `workspace:*`); and an isolated global
      install runs `calllint --help` / `scan` / `--json` / `--ci` (exit 30 on
      BLOCK) from a clean prefix.
- [ ] `npm publish --dry-run` (run in `apps/cli/`) succeeds and lists the 3-file
      tarball. It validates name, version, bin, files, and the README/LICENSE.
      No auth is required for a dry-run; a real publish requires `npm login`
      against the **official** registry.

> Registry note: a real `npm publish` must target `https://registry.npmjs.org/`.
> If `npm config get registry` shows a mirror (e.g. `registry.npmmirror.com`),
> publish with an explicit `--registry https://registry.npmjs.org/`. Mirrors are
> read-only and will reject a publish.

## 7. Tag

- [ ] Bump version(s).
- [ ] Tag the release and push.
- [ ] Attach the built `apps/cli/dist/index.js` (or published package) to the
      release.
