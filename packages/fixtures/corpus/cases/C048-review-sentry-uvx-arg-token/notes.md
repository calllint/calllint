# C048 — Sentry MCP via uvx with an --auth-token CLI arg (REVIEW)

## What this is

The uvx/stdio variant from `getsentry/sentry-mcp` `README.md` @ `ba44f5d61447`
(FSL-1.1-Apache-2.0): `uvx mcp-server-sentry --auth-token YOUR_SENTRY_TOKEN`.

## Verdict: REVIEW

`supply.unpinned-package` fires once on the unpinned `mcp-server-sentry` (high, S1)
→ REVIEW. `uvx` is a recognized package runner with a parsed package name, so
`exec.unverified-local-source` does **not** fire (contrast the bare-local cases
C035/C040/C043).

## True-negative this case pins

The credential is passed as a **CLI argument** (`--auth-token YOUR_SENTRY_TOKEN`),
not as an env var. `secrets.env-key` keys on env-key **names**, not argv, so it
correctly does **not** fire. The case uses `allowExtraFindings: false` to prove the
only finding is the unpinned package — a token-as-arg must not be mistaken for an
env secret. This is distinct from C027/C030 (sentry via env-secret shapes).

## Limitations

The token risk is real but lives in a surface CallLint deliberately does not parse
for secrets (argument values). CallLint flags env-shaped credential **keys**, not
argument values — recorded so this is a known, explained boundary, not a miss.

## Provenance / redaction

- Source: `getsentry/sentry-mcp` @ `ba44f5d61447`, `README.md` (uvx variant).
  License FSL-1.1-Apache-2.0.
- No redaction: verbatim documentation, normalized only to a valid JSON root.
  `YOUR_SENTRY_TOKEN` is upstream's own placeholder — no real secret was present.
