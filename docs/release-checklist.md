# Release checklist

A deterministic, repeatable gate before tagging a release. Every box must pass
on a clean checkout. MCPGuard never executes the servers it scans; none of these
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

## 6. Packaging note (current constraint)

The CLI ships as a **self-contained esbuild bundle** (`apps/cli/dist/index.js`),
which is what the smoke test validates. A true `npm pack` / `npx mcpguard` flow
is **not yet wired**: the workspace packages use `workspace:*` deps and the root
is `private`, so packing the published surface requires either inlining those
deps into a single published package or publishing each workspace package.

- [ ] If publishing: resolve the `workspace:*` deps (changesets / a bundled
      publish package) and verify a real `npm pack` tarball installs and runs
      `mcpguard --help` in a clean directory.
- [ ] If not publishing this release: ship the bundle and note it in the release
      description.

## 7. Tag

- [ ] Bump version(s).
- [ ] Tag the release and push.
- [ ] Attach the built `apps/cli/dist/index.js` (or published package) to the
      release.
