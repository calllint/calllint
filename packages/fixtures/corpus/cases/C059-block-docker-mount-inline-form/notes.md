# C059 — docker --mount=type=bind,src=/root,dst=/data (inline = form) BLOCK

Synthetic seed locking the ADR 0012 extractor's **inline `--mount=<csv>`** form (a
single token), as opposed to the next-token `--mount <csv>` form that C023 uses. The
extractor's `arg.startsWith("--mount=")` branch slices the CSV after the `=`;
`src=/root` is a broad root → `files.broad-path` (blocker) → **BLOCK**. The container
`dst=/data` is never flagged. `thisCaseMustNeverBeSafe: true`.
