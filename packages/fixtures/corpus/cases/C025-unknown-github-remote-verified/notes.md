# C025 — Verified GitHub remote server is UNKNOWN (uninspectable by construction)

**Provenance:** `real-public-snapshot` from [github/github-mcp-server](https://github.com/github/github-mcp-server) @ `6830c4d39426` (README.md (Remote MCP, VS Code)), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real documented GitHub remote config. Demonstrates the allowlisted-remote path: UNKNOWN verdict with ZERO findings, distinct from the non-allowlisted finding path (C026/C006).

**Why this verdict (UNKNOWN, max S1):** Even a first-party, allowlisted remote endpoint cannot be inspected statically — the scanner can see where it points but not what tools it will expose — so the honest verdict is UNKNOWN, with no risk finding because the host is verified.

**Required findings:** (none)

**Known false positives:** No finding — the allowlisted host is correctly not flagged.

**Known false negatives / limits:** Static analysis never enumerates a remote server's tools; that is the definition of UNKNOWN here.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
