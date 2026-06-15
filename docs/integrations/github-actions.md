# GitHub Actions + SARIF integration

MCPGuard fits a pull-request gate in three pieces:

1. **Upload SARIF** to the GitHub Security tab so findings are annotated inline.
2. **Gate the build** on the verdict (non-zero exit on BLOCK / UNKNOWN).
3. **Verify drift** against a committed baseline (rug-pull / TOCTOU).

A ready-to-use workflow is at
[`examples/github-actions/mcpguard-sarif.yml`](../../examples/github-actions/mcpguard-sarif.yml).
Copy it to `.github/workflows/mcpguard.yml`.

## Permissions

SARIF upload needs `security-events: write`:

```yaml
permissions:
  contents: read
  security-events: write
```

## The three steps

### 1. Emit SARIF

```bash
node apps/cli/dist/index.js scan .cursor/mcp.json --sarif > mcpguard.sarif
```

SARIF is MCPGuard's GitHub Code Scanning format (SARIF 2.1.0). Pipe it to a file
and upload with `github/codeql-action/upload-sarif@v3`. Use `|| true` on the
scan step so a BLOCK verdict does not abort the job *before* the SARIF uploads —
let the dedicated gate step decide pass/fail.

### 2. Gate on the verdict

```bash
node apps/cli/dist/index.js scan .cursor/mcp.json --ci --no-emoji
```

With `--ci`, the exit code is the gate:

| Code | Meaning |
| --- | --- |
| 0 | SAFE (or verdict not in policy `failOn`) |
| 10 | REVIEW (only when `failOnReview` is enabled) |
| 20 | UNKNOWN |
| 30 | BLOCK |
| 40 | DRIFT (`verify --ci`) |
| 2 | usage error |
| 3 | parse / runtime error |

### 3. Verify drift (optional)

Record an approved baseline once and commit it:

```bash
node apps/cli/dist/index.js baseline .cursor/mcp.json   # writes .mcpguard/baseline.json
git add .mcpguard/baseline.json && git commit -m "chore: approve mcp risk surface"
```

Then have CI fail (exit 40) when the risk surface changes — a pinned-version
bump, changed package, or new tool metadata:

```bash
node apps/cli/dist/index.js verify .cursor/mcp.json --ci --no-emoji
```

## Notes

- MCPGuard never executes the servers it scans. The workflow runs the bundled
  CLI; it does not install or launch any MCP server.
- The workflow is offline by default. Add `--online` only if you intend to read
  public npm / GitHub metadata — it still never executes fetched code, and
  online findings can only add risk, never lower a verdict
  ([ADR 0006](../adr/0006-online-enrichment-advisory.md)).
- Point the `scan` path at whatever your repo uses (`.cursor/mcp.json`,
  `.mcp.json`, `.claude/settings.json`, …).
