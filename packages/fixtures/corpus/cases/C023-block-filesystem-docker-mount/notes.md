# C023 — Filesystem server binds a broad host path via docker --mount → BLOCK

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/filesystem/README.md (Docker)), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real documented Docker variant whose `--mount type=bind,src=/Users/username/Desktop` grants the container the host's `~/Desktop`. It was the anchor for [ADR 0012](../../../../../docs/adr/0012-docker-mount-host-paths-not-inspected.md): a broad host grant hidden inside a compound docker arg that the broad-path detector originally read as a whole string and missed (SAFE, a documented false negative).

**Why this verdict (BLOCK, max S2):** ADR 0012 is now Accepted and implemented. The broad-path detector extracts the host side of docker bind mounts (`--mount type=bind,src=` and `-v|--volume host:container`) and runs the same broad-path check on it. The host source `/Users/username/Desktop` matches the `/Users/<name>` broad root, so `files.broad-path` fires as a critical blocker → BLOCK. The container-internal destination (`/projects`, `/projects/Desktop`) is never checked, and a named volume would not be flagged.

**Required findings:** `files.broad-path` (evidence value is the extracted host path `/Users/username/Desktop`, never the container dst).

**Known false positives:** None for this shape. The extractor only flags a path-shaped bind source; named volumes (`name:/container`), container destinations, and `${workspaceFolder}`-scoped sources are excluded.

**Known false negatives / limits:** Host-path extraction covers `--mount type=bind,src=` and `-v|--volume host:container`. It does not resolve indirect env-var interpolation inside a source (an explicit `${HOME}`/`$HOME`/`%USERPROFILE%` root is matched, but an indirect `$CUSTOM/x` is not), and it does not inspect `--tmpfs` or `--device`.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.

**History:** Shipped SAFE in 0.3.0 with the false negative documented on the case and in ADR 0012 (Proposed — deferred). Flipped SAFE → BLOCK when ADR 0012 was Accepted post-stable, with positive (`block-docker-bind-broad.json`) and negative (`safe-docker-volume-scoped.json`) golden fixtures and the other docker cases (C011/C012/C013/C024) re-verified SAFE.
