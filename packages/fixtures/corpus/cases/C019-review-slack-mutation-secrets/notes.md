# C019 — Slack server combines secret env, unpinned npx, and external mutation

**Provenance:** `real-public-snapshot` from [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived) @ `9be4674d1ddf` (src/slack/README.md), license MIT. Retrieved 2026-06-17T00:00:00.000Z.

**Why this case exists:** Real archived slack config. Exercises three detectors together and pins the inferred external-mutation (S3) verdict as REVIEW, not BLOCK.

**Why this verdict (REVIEW, max S3):** This config layers three review-worthy surfaces at once — a bot-token secret, an unpinned npx package, and a server whose purpose is to post to Slack (external mutation) — so it is the richest non-blocking case in the corpus.

**Required findings:** `secrets.env-key`, `supply.unpinned-package`, `action.external-mutation`

**Known false positives:** None expected for this shape.

**Known false negatives / limits:** Token scopes / actual side effects are runtime properties outside static scope.

**Redactions:** none — unmodified public documentation snippet.
