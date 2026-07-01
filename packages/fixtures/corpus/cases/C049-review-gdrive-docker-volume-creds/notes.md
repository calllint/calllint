# C049 — Google Drive MCP via docker named volume + inline -e env (REVIEW; ADR 0016 accepted)

## What this is

The Docker variant from `modelcontextprotocol/servers-archived` `src/gdrive/README.md`
@ `9be4674d1ddf` (MIT): a pinned `mcp/gdrive` image with a **named volume** bind
(`-v mcp-gdrive:/gdrive-server`) and a credentials-path variable passed **inline via
docker `-e`** (`-e GDRIVE_CREDENTIALS_PATH=/gdrive-server/credentials.json`). There is
**no `env` block**.

## Verdict: REVIEW — one correct true-negative, one now-closed gap (ADR 0016)

1. **CORRECT true-negative (still the anchor value of this case).** `files.broad-path`
   does **not** fire: the ADR 0012 docker host-path extractor treats `mcp-gdrive`
   (no leading slash) as a **named volume**, not a host path. This locks that the
   ADR 0012 change does not over-flag named volumes on a real config.
2. **NOW FLAGGED — ADR 0016 (accepted).** `secrets.env-key` **fires** on
   `GDRIVE_CREDENTIALS_PATH` (the `CREDENTIAL` hint) because the secret detector now
   also extracts docker `-e KEY[=value]` / `--env` argument keys, not only the `env`
   block. The finding is a non-blocker (SECRETS, S2) → aggregate verdict REVIEW. The
   evidence reports the key name only (`GDRIVE_CREDENTIALS_PATH`), never the value.

## How the verdict was verified (not assumed)

A real scan confirms the mechanism, against the temptation to invent a tidy reason:
- This config (`-e GDRIVE_CREDENTIALS_PATH=…`, no env block) → **REVIEW** post-ADR 0016
  (was SAFE before; the flip is the whole point of the ADR).
- The **same key in an `env` block** already yielded REVIEW pre-ADR — the two paths
  now agree.
- A negative probe `docker run -e DOCKER_CONTAINER=true` → **no `secrets.env-key`**
  (the name matches no credential hint), so the extractor does not over-flag benign
  inline env such as C013's.

This was a **non-blocker (REVIEW-class) under-call** before the fix, not a dangerous
false-SAFE — hence the deliberate, safe-direction re-verdict. `thisCaseMustNeverBeSafe`
stays **false**: the missed signal is non-blocking, but the config now correctly
reaches REVIEW. See ADR 0016 (Accepted), the secrets-detector analogue of the ADR 0012
host-path fix.

## Provenance / redaction

- Source: `modelcontextprotocol/servers-archived` @ `9be4674d1ddf`,
  `src/gdrive/README.md` (Docker variant). License MIT.
- No redaction: verbatim documentation, normalized only to a valid JSON root.
