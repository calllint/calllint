# GitHub Actions + SARIF integration

The fastest way to gate a repo is the **CallLint Action** — a thin wrapper over
the published CLI. It installs `calllint`, scans your config, uploads SARIF to
the Security tab, writes a Markdown summary to the PR, and fails the build on the
verdict. It never executes the scanned server.

```yaml
permissions:
  contents: read
  security-events: write   # for the SARIF upload

jobs:
  calllint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: calllint/calllint@v1
        with:
          target: .cursor/mcp.json
          # policy: calllint.policy.json   # optional; its ci.failOn drives the gate
```

The Action invents **no** new gate semantics: the pass/fail decision is the
CLI's own `--ci` exit code driven by the policy's `ci.failOn` set. Choose
BLOCK-only vs BLOCK+UNKNOWN by editing the policy, not an Action flag.

| Input | Default | Notes |
| --- | --- | --- |
| `target` | `.cursor/mcp.json` | path, `npm:<pkg>`, or `github:<owner/repo>` (needs `online: true`) |
| `version` | `latest` | CLI version / dist-tag to run |
| `policy` | _(built-in)_ | path to a `calllint.policy.json`; its `ci.failOn` is the gate |
| `online` | `false` | read public npm/GitHub metadata (never executes code, never lowers a verdict) |
| `surface-dir` | _(none)_ | local-document prompt-surface scan (ADR 0015) |
| `sarif` | `true` | emit + upload SARIF 2.1.0 |
| `step-summary` | `true` | write a Markdown report to the PR Step Summary |
| `gate` | `true` | `false` = report-only (SARIF + summary still produced) |

Outputs: `verdict` (`SAFE`/`REVIEW`/`BLOCK`/`UNKNOWN`) and `sarif-file`.

> **Live demo:** [`calllint/calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
> runs the equivalent integration — a 4-server config scanned on every push, with
> the findings visible in its **Security → Code scanning** tab.

---

## Doing it by hand (the three pieces the Action wraps)

If you'd rather not use the Action, CallLint fits a pull-request gate in three
pieces:

1. **Upload SARIF** to the GitHub Security tab so findings are annotated inline.
2. **Gate the build** on the verdict (non-zero exit on BLOCK / UNKNOWN).
3. **Verify drift** against a committed baseline (rug-pull / TOCTOU).

A ready-to-use workflow is at
[`examples/github-actions/calllint-sarif.yml`](../../examples/github-actions/calllint-sarif.yml).
Copy it to `.github/workflows/calllint.yml`.

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
node apps/cli/dist/index.js scan .cursor/mcp.json --sarif > calllint.sarif
```

SARIF is CallLint's GitHub Code Scanning format (SARIF 2.1.0). Pipe it to a file
and upload with `github/codeql-action/upload-sarif@v3`. The `--sarif` step exits
0 on its own (only `--ci` sets a non-zero gate code), so it does not abort the
job before the upload — keep the pass/fail decision in the dedicated gate step.

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
node apps/cli/dist/index.js baseline .cursor/mcp.json   # writes .calllint/baseline.json
git add .calllint/baseline.json && git commit -m "chore: approve mcp risk surface"
```

Then have CI fail (exit 40) when the risk surface changes — a pinned-version
bump, changed package, or new tool metadata:

```bash
node apps/cli/dist/index.js verify .cursor/mcp.json --ci --no-emoji
```

## Notes

- CallLint never executes the servers it scans. The workflow runs the bundled
  CLI; it does not install or launch any MCP server.
- The workflow is offline by default. Add `--online` only if you intend to read
  public npm / GitHub metadata — it still never executes fetched code, and
  online findings can only add risk, never lower a verdict
  ([ADR 0006](../adr/0006-online-enrichment-advisory.md)).
- Point the `scan` path at whatever your repo uses (`.cursor/mcp.json`,
  `.mcp.json`, `.claude/settings.json`, …).
