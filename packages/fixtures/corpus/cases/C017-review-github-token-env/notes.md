# C017 — GitHub server with a PAT env key is REVIEW

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived) @ `9be4674d1ddf` (src/github/README.md), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real archived github config. Confirms a PAT env name is REVIEW (S2), and is a regression anchor that docker run -e <NAME> does NOT add an exec.dangerous-command false positive.

**Why this verdict (REVIEW, max S2):** A credential-shaped env key (a GitHub personal access token) is a real secret surface a reviewer must verify is sourced safely; the pinned docker image and -e env flag are not themselves dangerous.

**Required findings:** `secrets.env-key`

**Known false positives:** The -e flag here is docker's env flag, not inline eval; exec must not fire (see the dangerousCommand precision fix).

**Known false negatives / limits:** The placeholder value is not a live secret; inline secret-VALUE detection is a documented future capability.

**Redactions:** none — unmodified public documentation snippet.
