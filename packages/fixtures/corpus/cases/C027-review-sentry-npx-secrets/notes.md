# C027 — Sentry server via unpinned npx with token and API-key envs is REVIEW

**Provenance:** `real-public-snapshot` from [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp) @ `ba44f5d61447` (README.md (stdio / npx)), license FSL-1.1-Apache-2.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real Sentry MCP config. Combines two distinct secret-env names with an unpinned package — a realistic multi-secret review case.

**Why this verdict (REVIEW, max S2):** Two credential-shaped envs (a Sentry access token and an OpenAI API key) plus an unpinned npx package are all review-worthy, but none is independently blocking.

**Required findings:** `secrets.env-key`, `supply.unpinned-package`

**Known false positives:** None expected for this shape.

**Known false negatives / limits:** Placeholder values (your-token, sk-...) are not validated; inline secret-value detection is future work.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
