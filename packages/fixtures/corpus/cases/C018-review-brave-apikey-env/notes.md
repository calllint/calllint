# C018 — Brave Search server with an API-key env is REVIEW

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived) @ `9be4674d1ddf` (src/brave-search/README.md), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real archived brave-search config. A second, independent API-key env case so the secret heuristic is exercised beyond GitHub's PAT.

**Why this verdict (REVIEW, max S2):** An API-key env is a credential surface to review; the pinned image and docker env flag are benign, so the verdict is REVIEW rather than BLOCK.

**Required findings:** `secrets.env-key`

**Known false positives:** docker -e BRAVE_API_KEY is an env flag; exec.dangerous-command must not fire.

**Known false negatives / limits:** Placeholder value; no inline secret-value detection yet.

**Redactions:** none — unmodified public documentation snippet.
