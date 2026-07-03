# CallLint Report Formats

CallLint supports multiple output formats for different use cases: terminal (default), JSON, SARIF, HTML, Markdown, and compact formats.

## Terminal Output (Default)

The default format is designed for interactive terminal use with colors and emoji:

```bash
calllint scan .cursor/mcp.json
```

**Features:**
- Color-coded verdicts (green SAFE, yellow REVIEW, red BLOCK, gray UNKNOWN)
- Emoji indicators (🛡 SAFE, ⚠ REVIEW, ⛔ BLOCK, ◇ UNKNOWN)
- Structured sections: summary, findings, evidence, policy recommendations
- Human-readable timestamps and fingerprints

**Use when:**
- Running locally during development
- Interactive troubleshooting
- Manual security reviews

## JSON Output

Machine-readable structured output for programmatic consumption:

```bash
calllint scan .cursor/mcp.json --json
```

**Schema:** See `apps/web/public/report-schema.md` or `packages/types/src/report.ts`

**Structure:**
```json
{
  "target": {"name": "...", "configPath": "..."},
  "verdict": "SAFE|REVIEW|BLOCK|UNKNOWN",
  "findings": [...],
  "fingerprints": {...},
  "summary": {...},
  "timestamp": "...",
  "toolVersion": "...",
  "runtimeBinding": {...}
}
```

**Use when:**
- Building automation or dashboards
- Storing results in a database
- Programmatic analysis or filtering
- Integrating with custom tooling

## SARIF Output

SARIF 2.1.0 format for CI/CD and security platforms:

```bash
calllint scan .cursor/mcp.json --sarif
```

See [SARIF.md](./SARIF.md) for comprehensive documentation.

**Use when:**
- GitHub Code Scanning integration
- GitLab Security Reports
- IDE integrations (VS Code SARIF Viewer)
- Multi-tool security pipelines

## HTML Output

Self-contained HTML report for sharing and archiving:

```bash
calllint scan .cursor/mcp.json --html > report.html
```

**Features:**
- Standalone file (no external dependencies)
- Inline CSS and embedded brand logo
- Semantic HTML with proper accessibility attributes
- Responsive layout (desktop and mobile)
- Structured sections matching terminal output
- Clean, professional styling

**Structure:**
- **Header:** Brand logo, config path, overall verdict, timestamp
- **Counts:** Summary of verdicts (BLOCK, UNKNOWN, REVIEW, SAFE)
- **Server sections:** Per-server breakdown with:
  - Verdict badge
  - Risk class and confidence
  - Risk symbols
  - Findings table (if any)
  - Policy recommendations
- **Footer:** CallLint branding and disclaimer

**Use when:**
- Security review reports for management
- Procurement documentation
- Archiving scan results
- Sharing with non-technical stakeholders
- Email attachments or intranet publishing

## Markdown Output

GitHub-flavored markdown for issues, PRs, and documentation:

```bash
calllint scan .cursor/mcp.json --md
```

**Features:**
- GitHub/GitLab compatible
- Tables for findings
- Code blocks for evidence
- Header structure for navigation
- Emoji-free (uses text symbols)

**Use when:**
- Creating GitHub/GitLab issues
- Pull request comments
- Documentation or wikis
- Markdown-native workflows

## Compact Output

Minimal one-line format for CI logs:

```bash
calllint scan .cursor/mcp.json --compact
```

**Example:**
```
[SAFE] .cursor/mcp.json: 1 server, 0 findings
```

**Use when:**
- CI logs where space is constrained
- Quick status checks
- Monitoring dashboards with line-by-line parsing
- Log aggregation systems

## No-Emoji Mode

Remove emoji from terminal/markdown output:

```bash
calllint scan .cursor/mcp.json --no-emoji
```

**Use when:**
- CI environments with poor Unicode support
- Accessibility requirements
- Corporate style guides that prohibit emoji
- Log parsing systems that don't handle Unicode well

## Multi-Format Output

Generate multiple formats in one scan:

```bash
calllint scan .cursor/mcp.json \
  --json > report.json \
  --sarif > report.sarif \
  --html > report.html
```

**Note:** Only the last format flag takes effect. To generate multiple formats, run separate commands or use process substitution.

## Exit Codes

All formats use the same exit codes:

| Exit Code | Meaning |
|-----------|---------|
| `0` | Scan succeeded, verdict is SAFE or REVIEW (unless `--ci` changes behavior) |
| `1` | Scan succeeded, but verdict triggers CI failure (based on policy) |
| `2` | Scan failed (invalid config, file not found, etc.) |

Use `--ci` to enable CI mode where exit codes are controlled by policy settings.

## Format Comparison

| Feature | Terminal | JSON | SARIF | HTML | Markdown | Compact |
|---------|----------|------|-------|------|----------|---------|
| Human-readable | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Machine-parseable | ❌ | ✅ | ✅ | ❌ | ⚠️ | ⚠️ |
| Color | ✅ | ❌ | ❌ | ✅ (CSS) | ❌ | ❌ |
| Emoji | ✅ (opt-out) | ❌ | ❌ | ❌ | ✅ (opt-out) | ❌ |
| Complete schema | ❌ | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| GitHub integration | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Standalone file | N/A | ✅ | ✅ | ✅ | ✅ | N/A |
| Evidence details | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Fingerprints | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

## Format Stability

- **Terminal/Markdown/Compact**: Output format may change in minor versions (cosmetic improvements)
- **JSON**: Schema follows semver; breaking changes only in major versions
- **SARIF**: Conforms to SARIF 2.1.0 spec (stable)
- **HTML**: Structure may change in minor versions (CSS/layout improvements)

## Further Reading

- [SARIF.md](./SARIF.md) - SARIF format documentation
- [CI_INTEGRATION.md](./CI_INTEGRATION.md) - Using reports in CI/CD
- [apps/web/public/report-schema.md](../apps/web/public/report-schema.md) - JSON schema documentation
