# ADR 0007: CLI Distribution is a Single Bundled Package

Status: Accepted

## Context

MCPGuard is a pnpm monorepo: one product app (`apps/cli`, the `mcpguard`
binary) on top of eleven internal `packages/*` consumed via `workspace:*`. The
build (`apps/cli/build.mjs`, esbuild) inlines every workspace dependency into a
single self-contained `apps/cli/dist/index.js` with a `#!/usr/bin/env node`
shebang. The package smoke test asserts the bundle contains **no** unresolved
`@mcpguard/*` imports — i.e. the shipped artifact already has zero runtime
dependencies.

Two facts blocked a real `npm pack` / `npx mcpguard` flow:

1. `apps/cli` was `private: true`, so npm refuses to pack or publish it.
2. `apps/cli` declared the workspace packages under `dependencies` as
   `workspace:*`. Those specifiers do not exist on any registry, so a published
   `dependencies` block would be uninstallable — even though the bundle never
   needs them at runtime.

The first-principles adoption path for a developer CLI is
`npx mcpguard scan ...`, not `npm install github:owner/repo`. We need a real,
installable tarball without changing scanner semantics.

## Decision

1. **Ship one bundled package, not eleven.** The published surface is the CLI
   package alone (`apps/cli`), carrying only the esbuild bundle. The internal
   `packages/*` are **build-time inputs**, not separately published artifacts.

2. **The workspace deps are dev-time, not runtime.** `apps/cli` declares the
   `@mcpguard/*` packages under `devDependencies` (they are needed only to
   build the bundle) and ships an **empty runtime `dependencies`**. The tarball
   therefore has no `workspace:*` specifier and nothing for a consumer to
   resolve.

3. **The artifact is minimal and allowlisted.** A `files` allowlist restricts
   the tarball to exactly: the built `dist/`, `README`, and `LICENSE`. Source,
   tests, `build.mjs`, fixtures, caches, and local config are never published.

4. **`prepack` rebuilds the bundle** so a tarball can never ship a stale
   `dist/`.

5. **Repository roles are split.** GitHub is the source, CI, audit, and release
   host; npm is the distribution/invocation entry point (`npx mcpguard`). The
   monorepo root stays `private: true` — only the CLI package is publishable.

## Rejected alternative: publish each workspace package

Publishing `@mcpguard/types`, `@mcpguard/core`, … separately (changesets,
synchronized versions) was rejected for this stage:

- It enlarges the public, audited surface from one artifact to a dozen.
- It adds version-synchronization and release complexity with no consumer
  asking for the internal packages.
- The bundle already makes the CLI self-contained, so multi-package publishing
  buys nothing for the `npx` path today.

It remains a future option if and when the internal packages need independent
reuse; this ADR would be superseded at that point.

## Rules

- The published `dependencies` of the CLI package MUST stay empty (no
  `workspace:*` ever reaches a registry); workspace packages live under
  `devDependencies`.
- The tarball MUST stay allowlisted via `files`; adding source, tests, or
  fixtures to the published artifact requires updating this ADR.
- The bundle MUST remain self-contained (no unresolved `@mcpguard/*` imports),
  enforced by the package smoke test.
- This decision changes packaging only. It does not alter any detector, verdict,
  golden expectation, or the offline/advisory boundaries (ADR 0003, ADR 0006).

## Reason

Auditability by design: a reviewer can read one `files` allowlist and one empty
runtime-dependency list and know exactly what a user installs. A consumer gets
the first-principles path — `npx mcpguard scan ...` — with the smallest possible
trusted surface, and the engine's security semantics are untouched.
