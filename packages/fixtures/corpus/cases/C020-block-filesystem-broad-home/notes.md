# C020 — Filesystem server scoped to a home directory is BLOCK

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/filesystem/README.md (NPX)), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real published filesystem config from the README's NPX example. Combines a broad home path (blocking) with an unpinned npx package — the canonical over-scoped filesystem shape.

**Why this verdict (BLOCK, max S2):** Granting a filesystem server a broad home-anchored path (/Users/username/Desktop) lets an agent read and write far beyond a project, which is a blocking risk; the unpinned package compounds it.

**Required findings:** `files.broad-path`, `supply.unpinned-package`

**Known false positives:** A ${workspaceFolder}-scoped path would not block (see seed C001); the broad home anchor is what triggers it.

**Known false negatives / limits:** If the path were tokenized differently at run time the static value would not reflect it.

**Redactions:** none — unmodified public documentation snippet.
