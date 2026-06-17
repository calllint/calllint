# C013 — Puppeteer server via pinned docker image with an env flag is SAFE

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived) @ `9be4674d1ddf` (src/puppeteer/README.md), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real archived puppeteer config. Regression anchor for the docker -e fix: docker run -e VAR is an env flag, NOT inline eval, so exec.dangerous-command must NOT fire.

**Why this verdict (SAFE, max S1):** A browser-automation server in a pinned container with only a non-secret DOCKER_CONTAINER env flag exposes no credentials or host shell; it is a clean baseline.

**Required findings:** (none — SAFE)

**Known false positives:** Previously mis-flagged exec.dangerous-command on the -e docker flag; fixed so this is correctly SAFE.

**Known false negatives / limits:** Runtime network egress from the browser is out of static scope.

**Redactions:** none — unmodified public documentation snippet.
