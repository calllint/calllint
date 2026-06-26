# C047 — Redis MCP via docker with a connection-URL positional arg (SAFE)

## What this is

The Docker variant from `modelcontextprotocol/servers-archived` `src/redis/README.md`
@ `9be4674d1ddf` (MIT): a pinned `mcp/redis` image given a `redis://` connection URL
as a positional argument, with no env block.

## Verdict: SAFE

No findings: no env (no `secrets.env-key`), no bind mount (no `files.broad-path`),
a pinned docker image rather than npx (no `supply.unpinned-package`), no dangerous
command. SAFE (S1). `allowExtraFindings: false` with the full forbidden list proves
nothing fired.

## What this pins

A `redis://…` connection URL passed as a **positional docker arg** is data handed
to the container — it is **not** mistaken for a broad filesystem path, nor for a
remote MCP transport (`server.url`). Contrast C025/C045 (real `type: http` remotes →
UNKNOWN). It complements the docker-SAFE family (C011 named volume, C012 connstring,
C013 env-flag, C024 sqlite volume) with a URL-positional shape.

## Limitations

A `redis://` URL can embed credentials in its userinfo; CallLint inspects config
**shape**, not values, so an inline password in the URL value is not surfaced (same
value-vs-shape limit as C012/C040). Here the URL is the upstream default with no
credentials.

## Provenance / redaction

- Source: `modelcontextprotocol/servers-archived` @ `9be4674d1ddf`,
  `src/redis/README.md` (Docker variant). License MIT.
- No redaction: verbatim documentation, normalized only to a valid JSON root.
