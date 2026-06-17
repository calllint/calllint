# C021 — Windows cmd /c filesystem launcher with a broad path is BLOCK

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/filesystem/README.md (Windows cmd /c)), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real documented Windows variant from the filesystem README. Confirms cmd (a shell) BLOCKs via exec.dangerous-command and stacks with the broad-path blocker.

**Why this verdict (BLOCK, max S4):** Launching the server through cmd is a shell entrypoint (arbitrary execution), and the broad home-anchored Desktop path compounds it — two independent blocking surfaces.

**Required findings:** `files.broad-path`, `exec.dangerous-command`

**Known false positives:** cmd as a launcher is sometimes unavoidable on Windows; the rule still treats a shell entrypoint as arbitrary execution.

**Known false negatives / limits:** The static value cannot bound what the shell ultimately runs.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
