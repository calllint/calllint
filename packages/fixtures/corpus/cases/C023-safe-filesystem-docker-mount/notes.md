# C023 — Filesystem server via docker bind-mounts is SAFE (with a documented limit)

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/filesystem/README.md (Docker)), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real documented Docker variant. Honest negative: the engine reports SAFE because it does not parse docker --mount src= host paths. Recorded as a known limitation, not hidden.

**Why this verdict (SAFE, max S1):** The pinned image is given /projects inside the container; a reviewer reading the docker --mount sources would still want to check what host paths are bound, which the static scan does not currently inspect.

**Required findings:** (none)

**Known false positives:** None — no finding is emitted.

**Known false negatives / limits:** A broad host path bound via docker --mount src= is not currently flagged (the path lives in a docker flag, not the server's path args). The mechanism and a candidate fix are recorded in [ADR 0012](../../../../../docs/adr/0012-docker-mount-host-paths-not-inspected.md) (Proposed — deferred); if accepted, this case flips SAFE → BLOCK and is updated deliberately.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
