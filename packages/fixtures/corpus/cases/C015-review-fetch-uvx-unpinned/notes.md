# C015 — Fetch server via unpinned uvx package is REVIEW

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/fetch/README.md), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real published fetch server config. Pairs an unpinned package with a network-egress purpose, a common real combination.

**Why this verdict (REVIEW, max S1):** A network-fetching server pulled from an unpinned uvx package warrants review of the supply chain before use; the fetch capability itself is the server's purpose, not an anomaly.

**Required findings:** `supply.unpinned-package`

**Known false positives:** None expected for this shape.

**Known false negatives / limits:** Static analysis does not enumerate which URLs the fetch server may reach.

**Redactions:** none — unmodified public documentation snippet.
