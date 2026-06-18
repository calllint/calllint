# C024 — SQLite server via pinned image and named volume is SAFE

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived) @ `9be4674d1ddf` (src/sqlite/README.md), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real archived sqlite config. A second non-docker-network SAFE baseline using a named volume + in-container db path.

**Why this verdict (SAFE, max S1):** A pinned image with a container-scoped named volume and an in-container db path exposes no host filesystem, no secret, and no shell — a clean SAFE baseline.

**Required findings:** (none)

**Known false positives:** None expected.

**Known false negatives / limits:** Image-tag mutability is outside static scope.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
