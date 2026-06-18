# C011 — Pinned memory server via docker image is SAFE

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/memory/README.md (Docker)), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real published Docker config for the official memory server. No secret env, no host filesystem mount, no shell command — the named volume claude-memory:/app/dist is container-scoped.

**Why this verdict (SAFE, max S1):** A memory server run from a pinned docker image with a named volume exposes no host paths, no credentials, and no shell, so it should not alarm the user.

**Required findings:** (none — SAFE)

**Known false positives:** None expected — docker run of a named image with a container volume is the documented safe shape.

**Known false negatives / limits:** If the image tag mcp/memory were silently re-pointed, static analysis could not see it (documented limitation).

**Redactions:** none — unmodified public documentation snippet.
