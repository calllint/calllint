# C022 — Windows cmd /c memory launcher is BLOCK

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) @ `7b1170d1da1e` (src/memory/README.md (cmd /c)), license Apache-2.0 / MIT (transition); docs CC-BY-4.0. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real documented Windows variant from the memory README. A minimal cmd-shell BLOCK with no other findings — isolates the shell-entrypoint rule.

**Why this verdict (BLOCK, max S4):** A cmd shell entrypoint is arbitrary command execution regardless of the benign package it currently launches, so it blocks.

**Required findings:** `exec.dangerous-command`

**Known false positives:** Same Windows-launcher caveat as C021.

**Known false negatives / limits:** Static analysis does not expand what cmd /c npx resolves to at run time.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
