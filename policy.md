# CallLint policy

CallLint's policy is **policy-as-code**: a single JSON file, `calllint.policy.json`,
validated against schema `calllint.policy.v0`. It is part of v0.1 by design (product
principle 10), not an enterprise add-on.

This document describes what the policy file **actually does today** — verified
against the engine, not aspirational. Where a field is declared in the schema but
not yet read by the verdict pipeline, this document says so plainly rather than
implying behavior that does not exist.

## TL;DR

- A policy can change a CI **exit code** (via `ci.failOn` / `ci.failOnReview`) and
  can **downgrade a single server's `BLOCK` to `REVIEW`** (via a time-boxed,
  reasoned `override`). That is the entire set of behaviors that affect output.
- A policy can **never** produce `SAFE`. `applyPolicy` only ever does
  `BLOCK → REVIEW`. `UNKNOWN`, `REVIEW`, and `SAFE` verdicts pass through untouched.
- An override that tolerates `EXEC` or `MONEY` is rejected unless it sets
  `dangerousOverride: true` — a deliberate speed bump, not a lock.

## Using a policy

```bash
calllint policy init                 # write a default calllint.policy.json to cwd
calllint policy explain              # print the effective policy (default if none)
calllint policy explain --policy p.json
calllint scan .cursor/mcp.json --policy calllint.policy.json --ci
```

With no `--policy`, CallLint uses the built-in default (see below). `policy explain`
runs the same `validatePolicy` the scan path uses, so it doubles as a linter for a
policy file: a non-zero exit means the file is invalid, with the reasons on stderr.

## Schema (`calllint.policy.v0`)

```jsonc
{
  "schemaVersion": "calllint.policy.v0",   // required, exact string
  "defaults": { /* PolicyDefaults */ },     // required object (see note below)
  "ci": { "failOn": ["BLOCK", "UNKNOWN"], "failOnReview": false },  // required
  "allowedSources": ["npm:@modelcontextprotocol/*"],   // declared, see note
  "allowedPaths": ["${workspaceFolder}"],              // declared, see note
  "overrides": [ /* PolicyOverride[] */ ]   // optional; the only verdict-changer
}
```

### `ci` — drives the CI exit code (enforced)

`shouldFailCi` reads exactly two things:

- `ci.failOn`: a list of verdicts that should fail a `--ci` run. `BLOCK`,
  `UNKNOWN`, and `SAFE` are matched against this list.
- `ci.failOnReview`: a boolean. `REVIEW` fails the run only when this is `true`
  (it is intentionally separate from `failOn` so a `REVIEW` gate is an explicit opt-in).

Exit codes (when `--ci` is set): `0` SAFE · `10` REVIEW (if `failOnReview`) ·
`20` UNKNOWN · `30` BLOCK · `40` DRIFT (`verify --ci`). Without `--ci`, the scan
exits `0` regardless of verdict.

### `overrides` — the only thing that changes a verdict (enforced)

`applyPolicy` runs once per server. An override applies only when **all** of:

1. the raw verdict is `BLOCK` (any other verdict passes through unchanged);
2. an override's `target` equals the server name;
3. the override is active — `expiresAt` is a valid ISO timestamp in the future;
4. the override's `allow` set covers **every** blocking finding's risk symbol.

When all four hold, the verdict becomes `REVIEW` (never `SAFE`) and the report
records a `policy.applied` diagnostic naming the override, its expiry, reason,
and `owner` (when one is set). If any blocking symbol is not in `allow`, the
`BLOCK` stands.

`PolicyOverride` fields: `target` (required), `reason` (required, non-empty),
`expiresAt` (required ISO timestamp), `owner?` (string; accountable identity —
recorded and echoed, not verified), `allow?` (RiskSymbol[]), `require?`
(`"manualApproval"` | `"sandbox"`), `dangerousOverride?` (boolean).

Valid `allow` symbols: `SECRETS`, `FILES`, `NETWORK`, `PROMPT`, `EXEC`, `ACTION`,
`MONEY`, `SUPPLY`, `RUGPULL`. Tolerating `EXEC` or `MONEY` requires
`dangerousOverride: true`.

### `defaults`, `allowedSources`, `allowedPaths` — declared, not yet read by the verdict path

These fields are part of the schema and are **required to be present and valid**
(`defaults` must be an object), and `policy explain` prints them. But as of the
current engine, **no code in the scan/verdict pipeline reads them** — the verdict is
produced by the deterministic risk engine, and the only policy hook in that pipeline
is the `BLOCK → REVIEW` override above (`packages/core/src/scanServer.ts`). Treat
them as forward-declared configuration: keep them accurate and intention-revealing,
but do not expect changing `defaults.financialAction` to alter a verdict today. If a
future release wires them into the verdict path, that is a schema-behavior change and
will require an ADR (per the development contract).

## What `validatePolicy` rejects

`validatePolicy` throws `PolicyValidationError` (listing every issue) when:

- `schemaVersion` is not exactly `"calllint.policy.v0"`.
- `defaults` is missing or not an object.
- `ci` is missing or not an object.
- an override is not an object.
- an override is missing `target` (or it is empty).
- an override is missing `reason` (or it is blank) — **overrides without a reason
  are not allowed**.
- an override's `expiresAt` is missing or not a parseable ISO timestamp —
  **overrides must expire**.
- an override's `owner` is present but not a non-empty string (ADR 0017-B):
  `owner` is optional, but a blank owner is rejected.
- an override's `allow` contains `EXEC` or `MONEY` without `dangerousOverride: true`.

The first three keep the file shape honest; the rest enforce the accountability
contract on every exception: who/why (`reason`), and a hard stop date (`expiresAt`).

## Safety invariants (true by construction)

- **A policy can never reach `SAFE`.** `applyPolicy` only emits `BLOCK → REVIEW`;
  it has no `SAFE` branch. `UNKNOWN` is never touched.
- **No silent, permanent exceptions.** Every override must carry a `reason` and a
  future `expiresAt`; an expired override is ignored (`isOverrideActive`).
- **Dangerous symbols are gated.** Allowing `EXEC`/`MONEY` requires an explicit
  `dangerousOverride: true`, so it cannot happen by accident.
- **No detector can be disabled.** The schema has no "disable rule" mechanism; a
  policy can only tolerate a *blocking symbol* on a *named server* for a *bounded
  time*. The detectors always run.

These mirror the product principles: UNKNOWN is not SAFE; deterministic rules
decide verdicts; an override is an accountable, expiring exception, not an off switch.

## Examples

Ready-to-copy policies live in [`examples/policies/`](examples/policies/):

| File | What it shows |
|------|---------------|
| `ci-block-only.json` | Loosen the gate to fail CI only on `BLOCK` (UNKNOWN/REVIEW pass). |
| `ci-strict.json` | Strictest gate: fail on `BLOCK`, `UNKNOWN`, and `REVIEW`. |
| `override-timeboxed.json` | Two time-boxed, reasoned, `owner`-stamped overrides — a plain `FILES` allow and a `dangerousOverride` `EXEC` allow with `manualApproval`. |

Every example validates against `calllint.policy.v0`
(`pnpm --filter calllint build && node apps/cli/dist/index.js policy explain --policy <file>`).

## Related

- Development contract: `CLAUDE.md` (product principle 10; ADR required for any
  policy-schema change).
- Override accountability `owner` field: `adrs/0017-override-owner-accountability.md`.
- Exit codes and CI integration: `README.md`.
