# C012 — Postgres server with a container-host connection string is SAFE

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived) @ `9be4674d1ddf` (src/postgres/README.md), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real archived postgres config. The connection string carries no secret and host.docker.internal is the container host, not an arbitrary remote — the engine does not flag it.

**Why this verdict (SAFE, max S1):** A read-oriented postgres server pointed at a container-host database, with no inline credentials and no shell, presents no flagged surface to a reviewer.

**Required findings:** (none — SAFE)

**Known false positives:** None expected; the connection string is credential-free.

**Known false negatives / limits:** If a password were embedded in the connection string, the current secret detector keys on env names, not inline URL credentials (known limitation, see C017).

**Redactions:** none — unmodified public documentation snippet.
