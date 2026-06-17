# C016 — Memory server via unpinned npx with a file-path env is REVIEW

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/memory/README.md (NPX + env)), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real published memory config. Important negative control: an env var that is a FILE PATH must NOT be flagged as secrets.env-key.

**Why this verdict (REVIEW, max S1):** An unpinned npx package is the only review-worthy surface; the MEMORY_FILE_PATH env is a path, not a credential, so it must not be treated as a secret.

**Required findings:** `supply.unpinned-package`

**Known false positives:** MEMORY_FILE_PATH is a path-shaped env name; the secret detector correctly does not match it.

**Known false negatives / limits:** If the path resolved to a sensitive location at run time, static analysis would not see it.

**Redactions:** none — unmodified public documentation snippet.
