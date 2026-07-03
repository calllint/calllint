# SARIF Output Format

CallLint generates SARIF 2.1.0 output for integration with GitHub Code Scanning, GitLab Security Reports, and other SARIF-aware CI/CD tools.

## What is SARIF?

SARIF (Static Analysis Results Interchange Format) is an industry-standard JSON format for representing static analysis results. It's defined by the OASIS SARIF Technical Committee and supported by major platforms including GitHub, GitLab, and Microsoft.

**Specification**: [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)

## Generating SARIF Output

```bash
# Output SARIF to a file
calllint scan .cursor/mcp.json --sarif > results.sarif

# Use in CI for GitHub Code Scanning
calllint scan .cursor/mcp.json --sarif > calllint.sarif
# Upload calllint.sarif as a Code Scanning artifact
```

## SARIF Structure

CallLint's SARIF output includes:

### Tool Information
- **Driver name**: CallLint
- **Version**: Current tool version from npm
- **Information URI**: https://calllint.com

### Rules
Each unique finding ID becomes a SARIF rule with:
- **id**: Finding identifier (e.g., `supply.unknown-remote`)
- **name**: Finding title
- **shortDescription**: Brief summary
- **fullDescription**: Impact description
- **defaultConfiguration.level**: Severity mapping (see below)
- **properties**: 
  - `symbol`: Risk symbol (NETWORK, EXEC, etc.)
  - `riskClass`: Risk classification (S1-S5)
  - `tags`: Searchable tags for filtering

### Results
Each finding occurrence becomes a SARIF result with:
- **ruleId**: Links to the rule definition
- **level**: Severity level (error/warning/note)
- **message**: Combined impact, fix, and false positive notes
- **locations**: Physical location in the config file
  - **artifactLocation.uri**: Relative path to config file
  - **region.startLine**: Line number (if available from evidence)
  - **logicalLocations**: Server/tool namespace
- **partialFingerprints**: Deduplication hashes
  - `configHash`: Config content hash
  - `riskSurfaceHash`: Risk surface hash
- **properties**: Metadata for filtering/analysis
  - `server`: Server name
  - `verdict`: SAFE/REVIEW/BLOCK/UNKNOWN
  - `symbol`: Risk symbol
  - `riskClass`: S1-S5 classification
  - `mode`: OBSERVED/INFERRED
  - `confidence`: high/medium/low
  - `blocker`: true/false

## Severity Mapping

CallLint severity levels map to SARIF levels:

| CallLint Severity | SARIF Level |
|-------------------|-------------|
| `critical`        | `error`     |
| `high`            | `error`     |
| `medium`          | `warning`   |
| `low`             | `note`      |
| `info`            | `note`      |

## GitHub Code Scanning Integration

### Basic Workflow

```yaml
name: Security Scan

on: [push, pull_request]

jobs:
  calllint:
    runs-on: ubuntu-latest
    permissions:
      security-events: write  # Required for Code Scanning upload
      contents: read
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Run CallLint
        run: |
          npx calllint scan .cursor/mcp.json --sarif > calllint.sarif
      
      - name: Upload to Code Scanning
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: calllint.sarif
          category: calllint
```

### With Exit Code Enforcement

```yaml
- name: Run CallLint (fail on BLOCK)
  run: |
    npx calllint scan .cursor/mcp.json --sarif --ci > calllint.sarif
    # --ci exits 1 on BLOCK verdict

- name: Upload to Code Scanning (always run)
  if: always()
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: calllint.sarif
```

### Viewing Results

After upload, security findings appear in:
- **Pull Request**: Security tab with inline annotations
- **Repository**: Security → Code scanning alerts
- **Diff view**: Inline comments on changed lines

## GitLab Integration

```yaml
calllint:
  stage: test
  script:
    - npm install -g calllint
    - calllint scan .cursor/mcp.json --sarif > gl-sast-report.json
  artifacts:
    reports:
      sast: gl-sast-report.json
```

GitLab recognizes SARIF files in the `sast` report type and displays findings in the Security Dashboard.

## Filtering and Querying

SARIF properties enable rich filtering:

### Filter by Verdict
```bash
jq '.runs[0].results[] | select(.properties.verdict == "BLOCK")' calllint.sarif
```

### Filter by Risk Symbol
```bash
jq '.runs[0].results[] | select(.properties.symbol == "NETWORK")' calllint.sarif
```

### Filter by Risk Class
```bash
jq '.runs[0].results[] | select(.properties.riskClass | startswith("S"))' calllint.sarif
```

### Count by Severity
```bash
jq '.runs[0].results | group_by(.level) | map({level: .[0].level, count: length})' calllint.sarif
```

## Deduplication with Fingerprints

CallLint includes `partialFingerprints` for stable issue tracking:

- **configHash**: Hash of the server configuration
- **riskSurfaceHash**: Hash of the detected risk surface

These fingerprints remain stable across:
- Code formatting changes
- Comment additions/removals
- Whitespace changes

They change when:
- The server configuration actually changes
- The risk surface (tools, permissions, env vars) changes

This allows SARIF consumers to track whether a finding is:
- **New**: Never seen before
- **Recurring**: Same issue, different location
- **Resolved**: Previously present, now gone

## Limitations

### What SARIF Output Includes
- All findings with evidence
- Config file locations
- Structured metadata

### What SARIF Output Does NOT Include
- The full scan report structure (use `--json` for that)
- Receipt signatures (use `--receipt` for that)
- Runtime binding details beyond what's in evidence
- Policy application details

### Line Number Accuracy
- Line numbers are provided when evidence includes them
- Not all detectors produce line-level evidence (e.g., name-based inference)
- When no line number is available, the location points to the config file without a region

## Schema Validation

CallLint's SARIF output is validated against the official SARIF 2.1.0 schema in our test suite. See `packages/report-renderer/test/sarif-schema.test.ts` for validation tests.

To validate manually:

```bash
npm install -g ajv-cli
calllint scan .cursor/mcp.json --sarif > output.sarif
ajv validate -s sarif-schema-2.1.0.json -d output.sarif
```

## Further Reading

- [SARIF Specification](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
- [GitHub Code Scanning Documentation](https://docs.github.com/en/code-security/code-scanning)
- [SARIF Tutorials](https://github.com/microsoft/sarif-tutorials)
- [SARIF Viewer (VS Code extension)](https://marketplace.visualstudio.com/items?itemName=MS-SarifVSCode.sarif-viewer)
