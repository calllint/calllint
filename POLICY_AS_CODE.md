# Policy-as-Code

CallLint supports **policy-as-code**: define your organization's risk tolerance, CI behavior, and exceptions as a version-controlled JSON file.

## Quick Start

```bash
# Generate a default policy file
calllint policy init

# Scan with a custom policy
calllint scan .cursor/mcp.json --policy .calllint-policy.json

# Validate a policy file
calllint policy validate .calllint-policy.json
```

## Policy File Structure

A CallLint policy file is a JSON document with the schema version `calllint.policy.v0`:

```json
{
  "schemaVersion": "calllint.policy.v0",
  "defaults": {
    "unknownSource": "deny",
    "unpinnedPackage": "warn",
    "broadFilesystemAccess": "deny",
    "arbitraryCommandExecution": "deny",
    "promptPoisoning": "deny",
    "externalMutation": "warn",
    "financialAction": "deny"
  },
  "ci": {
    "failOn": ["BLOCK", "UNKNOWN"],
    "failOnReview": false
  },
  "allowedSources": [
    "npm:@modelcontextprotocol/*",
    "github:modelcontextprotocol/*"
  ],
  "allowedPaths": [
    "${workspaceFolder}"
  ],
  "overrides": []
}
```

## Policy Sections

### 1. Defaults

The `defaults` section defines actions for common risk patterns:

| Risk Pattern                  | Actions          | Description                                      |
|-------------------------------|------------------|--------------------------------------------------|
| `unknownSource`               | allow/warn/deny  | Remote servers or unverified packages            |
| `unpinnedPackage`             | allow/warn/deny  | npm packages without exact version pins          |
| `broadFilesystemAccess`       | allow/warn/deny  | Tools with read/write to broad paths             |
| `arbitraryCommandExecution`   | allow/warn/deny  | Tools that can execute shell commands            |
| `promptPoisoning`             | allow/warn/deny  | Model-directed instructions in tool metadata     |
| `externalMutation`            | allow/warn/deny  | Tools that act on external systems (GitHub, Slack, etc.) |
| `financialAction`             | allow/warn/deny  | Tools that can move money or perform financial actions |

**Actions:**
- `allow`: Accept this risk without warning
- `warn`: Flag as REVIEW but don't block
- `deny`: Block (verdict becomes BLOCK if this risk is present)

### 2. CI Configuration

The `ci` section controls exit codes for CI enforcement:

```json
{
  "ci": {
    "failOn": ["BLOCK", "UNKNOWN"],
    "failOnReview": false
  }
}
```

- **`failOn`**: Array of verdicts that cause exit code 1
  - Default: `["BLOCK", "UNKNOWN"]`
  - Options: `["SAFE", "REVIEW", "BLOCK", "UNKNOWN"]`
- **`failOnReview`**: If true, REVIEW verdict exits 1
  - Default: `false`
  - Use `true` for strict approval workflows

**Common CI Patterns:**

```json
// Strict: fail on anything except SAFE
{"failOn": ["REVIEW", "BLOCK", "UNKNOWN"], "failOnReview": true}

// Permissive: only fail on hard blocks
{"failOn": ["BLOCK"], "failOnReview": false}

// Default: fail on blocks and unknowns
{"failOn": ["BLOCK", "UNKNOWN"], "failOnReview": false}
```

### 3. Allowed Sources

The `allowedSources` array defines trusted package/repository patterns:

```json
{
  "allowedSources": [
    "npm:@modelcontextprotocol/*",
    "github:modelcontextprotocol/*",
    "npm:@myorg/*",
    "github:myorg/*"
  ]
}
```

**Pattern Syntax:**
- `npm:package-name` - Exact npm package
- `npm:@scope/*` - All packages in an npm scope
- `github:owner/repo` - Exact GitHub repository
- `github:owner/*` - All repos from a GitHub org

Packages matching these patterns are exempt from `unknownSource` denials.

### 4. Allowed Paths

The `allowedPaths` array defines filesystem paths that tools can access:

```json
{
  "allowedPaths": [
    "${workspaceFolder}",
    "${workspaceFolder}/.cache",
    "/tmp"
  ]
}
```

**Variables:**
- `${workspaceFolder}`: Workspace root (auto-detected)
- Absolute paths: `/tmp`, `/var/log`
- Relative paths: Resolved from scan location

Tools that access paths outside these bounds trigger `broadFilesystemAccess` findings.

### 5. Overrides

The `overrides` array allows **time-bounded exceptions** for specific servers:

```json
{
  "overrides": [
    {
      "target": "my-experimental-server",
      "expiresAt": "2026-12-31T23:59:59Z",
      "reason": "Eval period for new tool; review scheduled 2026-12-15",
      "owner": "security-team@example.com",
      "allow": ["NETWORK", "EXEC"],
      "require": ["manualApproval"],
      "dangerousOverride": true
    }
  ]
}
```

**Required Fields:**
- `target`: Server name (matches `mcpServers.<name>` in config)
- `expiresAt`: ISO 8601 timestamp (overrides MUST expire)
- `reason`: Human explanation for the exception

**Optional Fields:**
- `owner`: Who approved this (email, team handle, or name)
- `allow`: Risk symbols to tolerate (`["NETWORK", "EXEC", "WRITE", "MONEY"]`)
- `require`: Extra controls (`["manualApproval", "sandbox"]`)
- `dangerousOverride`: Must be `true` to allow `EXEC` or `MONEY` symbols

**Expiry Behavior:**
- Expired overrides are ignored (treated as if absent)
- CallLint warns when an override expires within 7 days
- Overrides without `expiresAt` are invalid

**Example Use Cases:**

```json
// Temporarily allow a tool during evaluation
{
  "target": "github-pr-creator",
  "expiresAt": "2026-08-01T00:00:00Z",
  "reason": "30-day eval; decision due 2026-07-25",
  "owner": "dev-tools-team",
  "allow": ["NETWORK"]
}

// Allow a trusted internal tool with extra controls
{
  "target": "internal-deploy-tool",
  "expiresAt": "2027-01-01T00:00:00Z",
  "reason": "Approved for production use with manual approval gate",
  "owner": "ops-team@example.com",
  "allow": ["EXEC", "NETWORK"],
  "require": ["manualApproval"],
  "dangerousOverride": true
}
```

## Example Policies

### Strict Mode (Zero Trust)

```json
{
  "schemaVersion": "calllint.policy.v0",
  "defaults": {
    "unknownSource": "deny",
    "unpinnedPackage": "deny",
    "broadFilesystemAccess": "deny",
    "arbitraryCommandExecution": "deny",
    "promptPoisoning": "deny",
    "externalMutation": "deny",
    "financialAction": "deny"
  },
  "ci": {
    "failOn": ["REVIEW", "BLOCK", "UNKNOWN"],
    "failOnReview": true
  },
  "allowedSources": [
    "npm:@modelcontextprotocol/*"
  ],
  "allowedPaths": [
    "${workspaceFolder}"
  ],
  "overrides": []
}
```

**When to Use:** Security-critical environments, compliance requirements, or initial rollout.

### Permissive Mode (Developer Friendly)

```json
{
  "schemaVersion": "calllint.policy.v0",
  "defaults": {
    "unknownSource": "warn",
    "unpinnedPackage": "allow",
    "broadFilesystemAccess": "warn",
    "arbitraryCommandExecution": "deny",
    "promptPoisoning": "deny",
    "externalMutation": "warn",
    "financialAction": "deny"
  },
  "ci": {
    "failOn": ["BLOCK"],
    "failOnReview": false
  },
  "allowedSources": ["*"],
  "allowedPaths": ["*"],
  "overrides": []
}
```

**When to Use:** Local development, prototyping, or teams with mature code review.

### Read-Only Mode

```json
{
  "schemaVersion": "calllint.policy.v0",
  "defaults": {
    "unknownSource": "warn",
    "unpinnedPackage": "warn",
    "broadFilesystemAccess": "deny",
    "arbitraryCommandExecution": "deny",
    "promptPoisoning": "deny",
    "externalMutation": "deny",
    "financialAction": "deny"
  },
  "ci": {
    "failOn": ["BLOCK", "UNKNOWN"],
    "failOnReview": false
  },
  "allowedSources": [
    "npm:@modelcontextprotocol/*"
  ],
  "allowedPaths": [
    "${workspaceFolder}"
  ],
  "overrides": []
}
```

**When to Use:** Allow read-only research tools but block all writes/mutations.

### Offline-Only Mode

```json
{
  "schemaVersion": "calllint.policy.v0",
  "defaults": {
    "unknownSource": "deny",
    "unpinnedPackage": "warn",
    "broadFilesystemAccess": "warn",
    "arbitraryCommandExecution": "warn",
    "promptPoisoning": "deny",
    "externalMutation": "deny",
    "financialAction": "deny"
  },
  "ci": {
    "failOn": ["BLOCK", "UNKNOWN"],
    "failOnReview": false
  },
  "allowedSources": ["*"],
  "allowedPaths": ["${workspaceFolder}"],
  "overrides": []
}
```

**When to Use:** Air-gapped environments or offline-first workflows.

## Policy Validation

CallLint validates policies on load:

```bash
calllint policy validate .calllint-policy.json
```

**Validation Checks:**
- Schema version is recognized
- All required fields are present
- Actions are valid (`allow`/`warn`/`deny`)
- Overrides have required fields (`target`, `expiresAt`, `reason`)
- `expiresAt` timestamps are valid ISO 8601
- Dangerous overrides (`EXEC`, `MONEY`) require `dangerousOverride: true`
- No duplicate override targets

**Exit Codes:**
- `0`: Policy is valid
- `1`: Validation failed (errors printed to stderr)

## CI Integration

### With Policy File

```yaml
- name: Scan with policy
  run: |
    calllint scan .cursor/mcp.json \
      --policy .calllint-policy.json \
      --ci
```

### Policy in Repository Root

Place `.calllint-policy.json` at the repository root:

```
repo/
├── .calllint-policy.json
├── .cursor/
│   └── mcp.json
└── ...
```

CallLint auto-discovers it:

```bash
calllint scan .cursor/mcp.json --ci
# Automatically uses .calllint-policy.json if present
```

### Per-Environment Policies

```yaml
- name: Scan (staging)
  run: calllint scan .cursor/mcp.json --policy policies/staging.json --ci

- name: Scan (production)
  run: calllint scan .cursor/mcp.json --policy policies/production.json --ci
```

## Policy Evolution

### Version Overrides with Expiry

When updating a risky tool, use a time-bounded override:

1. **Week 1-2**: Add override with 14-day expiry
2. **Review findings** during the trial period
3. **Week 2**: Decide: keep (renew override), fix (no override needed), or remove tool
4. **Override expires**: Policy reverts to default deny

### Gradual Tightening

Start permissive, tighten over time:

1. **Month 1**: `unknownSource: "warn"` — observe what's in use
2. **Month 2**: Add `allowedSources` for trusted orgs, keep warning
3. **Month 3**: Switch to `unknownSource: "deny"` with allowlist

### Audit Trail

Commit policy changes with PR reviews:
- Override additions require security team approval
- `dangerousOverride` changes require two approvers
- Expiry extensions require re-justification

## Limitations

### What Policy Does
- Controls CallLint's verdict logic
- Enforces CI exit codes
- Manages time-bounded exceptions

### What Policy Does NOT Do
- **Does not enforce runtime behavior** — agents can ignore CallLint verdicts
- **Does not prevent tool installation** — only flags risk
- **Does not sandbox execution** — combine with OS-level controls
- **Does not verify override `owner` field** — trust is on the commit approval process

## Schema Reference

See `packages/types/src/policy.ts` for the TypeScript definition and `packages/policy/src/defaultPolicy.ts` for the default values.

Policy schema: `calllint.policy.v0` (current, stable)

## Further Reading

- [Verdict Semantics](../README.md#verdict-semantics)
- [Risk Classification](./threat-model.md)
- [CI Integration](./CI_INTEGRATION.md)
- [Overrides ADR](./adr/0017-policy-overrides.md) (if exists)
