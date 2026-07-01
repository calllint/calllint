# CallLint badge

A CallLint badge lets an MCP author show a **truthful, current** CallLint verdict
for their tool's configuration in a README. It is built for transparency, not
comfort: the badge shows whatever the verdict is — `SAFE`, `REVIEW`, `UNKNOWN`,
or `BLOCK` — and only `SAFE` is rendered green.

This document describes what the badge **actually does today**, verified against
the CLI, not aspirational behavior.

## What the badge is

`calllint scan <config> --badge` emits a [shields.io endpoint][endpoint] JSON
object derived from the same aggregate verdict every other renderer uses. It adds
no analysis and makes no verdict decision of its own — it is a projection of the
scan result, exactly like `--json`, `--sarif`, or `--markdown`.

```bash
calllint scan .cursor/mcp.json --badge
```

```json
{
  "schemaVersion": 1,
  "label": "CallLint",
  "message": "REVIEW",
  "color": "yellow",
  "cacheSeconds": 3600
}
```

## Verdict → colour

The colour is a fixed, deterministic map. **Only `SAFE` is green.** A `REVIEW`,
`UNKNOWN`, or `BLOCK` surface can never present a green badge — this is enforced
by a test, not left to convention.

| Verdict   | Message  | Colour       |
| --------- | -------- | ------------ |
| `SAFE`    | SAFE     | brightgreen  |
| `REVIEW`  | REVIEW   | yellow       |
| `UNKNOWN` | UNKNOWN  | lightgrey    |
| `BLOCK`   | BLOCK    | red          |

`SAFE` means **no blockers observed** under current evidence — it is **not a proof
of runtime safety**, and `UNKNOWN` is never `SAFE`. The badge is heuristic
decision support, the same as every CallLint verdict.

## Wiring it up (endpoint badge)

The endpoint badge is self-refreshing: shields.io re-reads the committed JSON, so
the badge tracks the verdict as your config changes.

1. Generate and commit the badge JSON in CI whenever the config changes:

   ```bash
   calllint scan .cursor/mcp.json --badge > calllint-badge.json
   ```

2. Point a shields.io endpoint badge at the raw file and add it to your README:

   ```markdown
   ![CallLint](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/<owner>/<repo>/<branch>/calllint-badge.json)
   ```

Because the JSON is regenerated from a real scan, the badge cannot drift into a
stale green: if the surface becomes `REVIEW`/`UNKNOWN`/`BLOCK`, the next CI run
rewrites the colour.

## The report artifact

For a machine-readable status file to publish alongside the badge, use the
existing `--json` output — a stable `calllint.report.v0` document:

```bash
calllint scan .cursor/mcp.json --json > calllint-report.json
```

This is the same schema every CallLint consumer reads; the badge is just its
one-line, human-glanceable summary. No new schema is introduced by the badge.

## What the badge does not claim

- It does **not** prove a server is safe. It reports a static, pre-run verdict.
- A green (`SAFE`) badge means no blockers were observed, not that the tool is
  guaranteed safe or that no review is needed.
- It reflects the **configuration you scanned**, at scan time. A server can change
  after you badge it — regenerate the badge in CI to keep it honest.

[endpoint]: https://shields.io/badges/endpoint-badge
