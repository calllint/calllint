# C030 — Self-hosted Sentry server with a token and host env is REVIEW

**Provenance:** `real-public-snapshot` from [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp) @ `ba44f5d61447` (README.md (self-hosted)), license FSL-1.1-Apache-2.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real Sentry self-hosted config. Negative control that a *_HOST env is not treated as a secret, alongside a genuine token + unpinned package.

**Why this verdict (REVIEW, max S2):** The access token is a secret to review and the npx package is unpinned; SENTRY_HOST is a hostname, not a credential, and must not be flagged as a secret.

**Required findings:** `secrets.env-key`, `supply.unpinned-package`

**Known false positives:** None expected for this shape.

**Known false negatives / limits:** Placeholder token value is not validated.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
