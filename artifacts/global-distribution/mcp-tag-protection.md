# MCP Tag Protection — Supply Chain Gate

**Context**: G3.4 — Supply Chain Gate for mcp-v* release tags

## Requirement

The `mcp-v*` tag pattern controls releases to:
1. **npm** (calllint-mcp package, immutable versions)
2. **Official MCP Registry** (io.github.calllint/calllint, LIVE state)

Unauthorized tag push → rogue publish → supply chain compromise.

**Protection Rule**: Only repository admins can create/delete tags matching `mcp-v*`.

## Verification

Check current protection status:

```bash
gh api repos/calllint/calllint/tags/protection
```

Expected response:
```json
[
  {
    "pattern": "mcp-v*",
    "required_approving_review_count": 0
  }
]
```

If empty array `[]` → **protection missing**.

## Setup (Admin only)

Enable tag protection via GitHub UI:
1. Go to: https://github.com/calllint/calllint/settings/tag_protection
2. Add pattern: `mcp-v*`
3. Save

Or via API (requires admin token):
```bash
gh api --method POST \
  repos/calllint/calllint/tags/protection \
  -f pattern='mcp-v*'
```

## Rationale

- **Immutable npm versions**: Once published, `calllint-mcp@X.Y.Z` cannot be unpublished (npm policy). Tag protection prevents accidental/malicious version burn.
- **Registry state finality**: MCP Registry updates are immediate and visible to all platforms consuming it. Wrong version → wrong authority → trust violation.
- **OIDC supply chain**: The publish workflow uses GitHub OIDC (no stored tokens). Tag creation is the ONLY gate before publish.

## Monitoring

The distribution watch workflow (G6) will include:
```yaml
- name: Verify mcp-v* tag protection
  run: node scripts/verify-mcp-tag-protection.mjs
```

If protection is missing, the watch fails and notifies maintainers.

## Trade-offs

- **Pros**: Prevents unauthorized mcp-v* release, aligns with npm/Registry finality
- **Cons**: Requires admin intervention for every MCP release tag (can't be delegated to CI write token)

**Decision**: Accept the friction. MCP releases are infrequent (~monthly), and protection is a hard supply chain requirement.
