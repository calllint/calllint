# C049 — Google Drive MCP via docker named volume + inline -e env (SAFE; anchors ADR 0016)

## What this is

The Docker variant from `modelcontextprotocol/servers-archived` `src/gdrive/README.md`
@ `9be4674d1ddf` (MIT): a pinned `mcp/gdrive` image with a **named volume** bind
(`-v mcp-gdrive:/gdrive-server`) and a credentials-path variable passed **inline via
docker `-e`** (`-e GDRIVE_CREDENTIALS_PATH=/gdrive-server/credentials.json`). There is
**no `env` block**.

## Verdict: SAFE — for two reasons, one correct and one a documented gap

1. **CORRECT true-negative (the primary value of this case).** `files.broad-path`
   does **not** fire: the ADR 0012 docker host-path extractor treats `mcp-gdrive`
   (no leading slash) as a **named volume**, not a host path. This locks that the
   ADR 0012 change does not over-flag named volumes on a real config.
2. **DOCUMENTED GAP — ADR 0016.** `secrets.env-key` does **not** fire even though
   `GDRIVE_CREDENTIALS_PATH` contains the `CREDENTIAL` hint, because the variable is
   passed via a docker `-e` **argument**, not in an `env` block, and the secret
   detector reads env-block keys (`server.envKeys`), not docker `-e` args.

## How the gap was verified (not assumed)

A real scan confirms the mechanism, against the temptation to invent a tidy reason:
- This config (`-e GDRIVE_CREDENTIALS_PATH=…`, no env block) → **SAFE**.
- The **same key in an `env` block** (`{"env":{"GDRIVE_CREDENTIALS_PATH":"…"}}`) →
  **REVIEW** (`secrets.env-key`).
- A pure danger probe `docker run -e MY_API_KEY=sk-secret` → **SAFE** (no finding).

So the SAFE is the docker-`-e` extraction gap, **not** "the name isn't
credential-shaped" (it is). This is a **non-blocker (REVIEW-class) under-call**, not
a dangerous false-SAFE — recorded in
[ADR 0016](../../../../../docs/adr/0016-docker-env-args-not-extracted-for-secrets.md)
(Proposed/deferred), the secrets-detector analogue of the ADR 0012 host-path fix.
`thisCaseMustNeverBeSafe` stays **false**: the source is observable and the missed
signal is non-blocking. If ADR 0016 is accepted, this case flips SAFE → REVIEW and is
updated deliberately.

## Provenance / redaction

- Source: `modelcontextprotocol/servers-archived` @ `9be4674d1ddf`,
  `src/gdrive/README.md` (Docker variant). License MIT.
- No redaction: verbatim documentation, normalized only to a valid JSON root.
