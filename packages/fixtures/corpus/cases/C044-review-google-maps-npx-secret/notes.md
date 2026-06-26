# C044 — Google Maps MCP via npx with an API-key env (REVIEW)

## What this is

The NPX variant from `modelcontextprotocol/servers-archived`
`src/google-maps/README.md` @ `9be4674d1ddf` (MIT): `npx -y
@modelcontextprotocol/server-google-maps` with a `GOOGLE_MAPS_API_KEY` env.

## Verdict: REVIEW

Two non-blocking findings:

- **`supply.unpinned-package`** (high, S1) — the package ships without a version in
  the upstream docs, so it is unpinned (rug-pull / drift surface).
- **`secrets.env-key`** (medium, S2) — `GOOGLE_MAPS_API_KEY` matches the `API_KEY`
  hint.

→ REVIEW.

## What this pins

The common real **"npx package + API key"** shape, with an `*_API_KEY` env name —
distinct from the `*_TOKEN` shapes (C017 github, C042 gitlab) and the `*_SECRET` /
`*_CLIENT_ID` mix (C039 google-ads). `allowExtraFindings: false` keeps it to exactly
the two expected findings.

## Provenance / redaction

- Source: `modelcontextprotocol/servers-archived` @ `9be4674d1ddf`,
  `src/google-maps/README.md` (NPX variant). License MIT.
- No redaction: verbatim documentation, normalized only to a valid JSON root.
  `<YOUR_API_KEY>` is upstream's own placeholder — no real secret was present.
