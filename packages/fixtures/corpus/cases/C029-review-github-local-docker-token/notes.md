# C029 — GitHub server via local docker image with a PAT env is REVIEW

**Provenance:** `real-public-snapshot` from [github/github-mcp-server](https://github.com/github/github-mcp-server) @ `6830c4d39426` (README.md (local docker / ghcr.io)), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real github/github-mcp-server local config (ghcr.io image). Second-source secret-env REVIEW and a regression anchor that docker -e <NAME> does not add exec.dangerous-command.

**Why this verdict (REVIEW, max S2):** A PAT env is the single review-worthy surface; the ghcr.io image is pinned-by-name and the docker -e flag is benign, so it is REVIEW not BLOCK.

**Required findings:** `secrets.env-key`

**Known false positives:** docker -e here is the env flag, not inline eval; exec must not fire.

**Known false negatives / limits:** The ${input:...} token reference is not a live secret value.

**Redactions:**
none — content is verbatim public documentation, normalized only to a valid JSON root.
