# C043 — SQLite MCP via local uv with a ~/ db-path (BLOCK)

## What this is

The `uv` variant from `modelcontextprotocol/servers-archived` `src/sqlite/README.md`
@ `9be4674d1ddf` (MIT):

```
uv --directory parent_of_servers_repo/servers/src/sqlite run mcp-server-sqlite --db-path ~/test.db
```

## Verdict: BLOCK

Two findings fire:

1. **`files.broad-path`** (critical blocker, S2) — the `--db-path` argument
   `~/test.db` starts with the broad home root `~/`, so the server is granted access
   rooted at the user's home directory. This forces BLOCK.
2. **`exec.unverified-local-source`** (S2, REVIEW-class) — `uv` is not a recognized
   package runner (only `uvx` is), so this is a bare local runtime running a module
   CallLint never inspects (ADR 0011 Direction 2).

The blocker dominates → BLOCK. `thisCaseMustNeverBeSafe: true`.

## Why this case is valuable

- The **first real case** to exercise `exec.unverified-local-source` alongside a
  blocker (C035/C040 are the REVIEW-only real cases).
- A real **broad-path BLOCK that is neither** a docker bind mount (C023) **nor** an
  npx/local filesystem server (C020/C034) — it is a home-rooted *db path* arg,
  proving the broad-path detector catches home roots wherever they appear in args.

## Provenance / redaction

- Source: `modelcontextprotocol/servers-archived` @ `9be4674d1ddf`,
  `src/sqlite/README.md` (uv variant). License MIT.
- No redaction: verbatim documentation, normalized only to a valid JSON root.
  `~/test.db` is upstream's own example path.
