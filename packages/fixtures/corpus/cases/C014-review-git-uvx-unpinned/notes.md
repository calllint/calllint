# C014 — Git server via unpinned uvx package is REVIEW

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/git/README.md), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real published git server config. uvx with no version pin is the canonical unpinned-supply-chain shape for the Python/uv ecosystem.

**Why this verdict (REVIEW, max S1):** An unpinned uvx package resolves to whatever version is latest at run time, so a reviewer should pin it before trusting the supply chain, but nothing here is dangerous on its own.

**Required findings:** `supply.unpinned-package`

**Known false positives:** None expected for this shape.

**Known false negatives / limits:** A pinned uvx spec (mcp-server-git==x.y.z) should NOT trigger; this case guards the unpinned path only.

**Redactions:** none — unmodified public documentation snippet.
