# C042 — GitLab MCP over docker with a personal-access-token env (REVIEW)

## What this is

The Docker variant from `modelcontextprotocol/servers-archived` `src/gitlab/README.md`
@ `9be4674d1ddf` (MIT): a pinned `mcp/gitlab` image launched with two env vars,
`GITLAB_PERSONAL_ACCESS_TOKEN` and `GITLAB_API_URL`.

## Verdict: REVIEW

`secrets.env-key` fires once on `GITLAB_PERSONAL_ACCESS_TOKEN` (medium, S2) → REVIEW.
The package is a pinned docker image (not npx), there is no bind mount, and no
dangerous command, so secrets is the only finding.

## True-negative this case pins

`GITLAB_API_URL` is a host/URL env name, not credential-shaped — it matches none of
the secret hints (TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL/AUTH/SESSION), so it is
correctly **not** flagged. The case uses `allowExtraFindings: false` so it proves
exactly one finding with one evidence entry fires; a second evidence entry on
`GITLAB_API_URL` (a value-vs-shape confusion) would fail the gate. This mirrors the
C030 (`SENTRY_HOST`) and C040 (`DB_CONNECTION_STRING`) host/url-env true-negatives,
on a docker-token shape.

## Provenance / redaction

- Source: `modelcontextprotocol/servers-archived` @ `9be4674d1ddf`,
  `src/gitlab/README.md` (Docker variant). License MIT.
- One redaction: the upstream README annotates `GITLAB_API_URL` with a trailing
  `// Optional, for self-hosted instances` JavaScript-style comment, which is not
  valid JSON. The comment was removed so the snapshot parses; both env keys, the
  command, the args, and the image are otherwise verbatim. The token value
  `<YOUR_TOKEN>` is upstream's own placeholder — no real secret was present.
