# C050 — EverArt MCP via docker with an API-key env block (REVIEW)

## What this is

The Docker variant from `modelcontextprotocol/servers-archived` `src/everart/README.md`
@ `9be4674d1ddf` (MIT): a pinned `mcp/everart` image with an `EVERART_API_KEY`
credential declared in the `env` block.

## Verdict: REVIEW

`secrets.env-key` fires once on `EVERART_API_KEY` (medium, S2) → REVIEW. A pinned
docker image (no `supply.unpinned-package`), no bind mount, no dangerous command —
secrets is the only finding.

## What this pins (contrast with C049 / ADR 0016)

The credential is declared in the **`env` block**, so it IS flagged — exactly the
path that C049's inline `-e` form misses (ADR 0016). This pair makes the gap legible:

- **C050** — `env: { EVERART_API_KEY }` → `secrets.env-key` fires → REVIEW.
- **C049** — `-e GDRIVE_CREDENTIALS_PATH=…` (no env block) → not flagged → SAFE
  (the ADR 0016 docker-`-e` extraction gap).

Same docker shape, credential surfaced or not depending solely on env-block vs
`-e`-arg placement.

## Provenance / redaction

- Source: `modelcontextprotocol/servers-archived` @ `9be4674d1ddf`,
  `src/everart/README.md` (Docker variant). License MIT.
- No redaction: verbatim documentation, normalized only to a valid JSON root.
  `your_key_here` is upstream's own placeholder — no real secret was present.
