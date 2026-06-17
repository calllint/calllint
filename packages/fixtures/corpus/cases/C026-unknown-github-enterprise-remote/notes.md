# C026 — GitHub Enterprise remote endpoint is UNKNOWN with an unverified-source finding

**Provenance:** `redacted-real-snapshot` from [github/github-mcp-server](https://github.com/github/github-mcp-server) @ `6830c4d39426` (README.md (GitHub Enterprise Cloud)), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real documented GHES config (redacted from a README fragment). The non-allowlisted host path: UNKNOWN + supply.unknown-remote, contrasting C025's allowlisted no-finding path.

**Why this verdict (UNKNOWN, max S1):** A self-hosted GitHub Enterprise endpoint on a non-allowlisted host cannot be verified, so it is UNKNOWN and carries an explicit unverified-source finding for the reviewer.

**Required findings:** `supply.unknown-remote`

**Known false positives:** None expected for this shape.

**Known false negatives / limits:** The Authorization header references an input token, not an inline secret value.

**Redactions:**
- Removed README ellipsis (...) placeholders surrounding the server entry
- Wrapped the documented fragment in a valid configuration root
- Preserved type, url, and Authorization header verbatim (example host octocorp.ghe.com is upstream's own)
