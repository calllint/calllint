# MCP Tag Protection — Supply Chain Gate

**Context**: G3.4 — Supply Chain Gate for mcp-v* release tags
**Status (measured 2026-08-19)**: **NOT PROTECTED.** The repository has exactly one ruleset,
`17728504 "Protect main" target=branch`. There is no tag ruleset. Creating one is an admin
action and is the last open item on this gate.

## Requirement

The `mcp-v*` tag pattern controls releases to:

1. **npm** (calllint-mcp package, immutable versions)
2. **Official MCP Registry** (io.github.calllint/calllint, LIVE state)

Unauthorized tag push → rogue publish → supply chain compromise.

**Protection Rule**: only repository admins can create tags matching `mcp-v*`.

The `environment: npm` reviewer gate in `.github/workflows/publish-mcp.yml` is a second
barrier, not a substitute for this one: it is a single approval, and the npm publish and the
Registry publish run in the same job behind it.

## Verification

```bash
node scripts/verify-mcp-tag-protection.mjs           # assert; exit 1 if unprotected
node scripts/verify-mcp-tag-protection.mjs --explain  # also print the ruleset to create
```

The script reads repository **rulesets**:

```bash
gh api repos/calllint/calllint/rulesets
gh api repos/calllint/calllint/rulesets/{id}   # for each target=tag ruleset
```

A ruleset counts as protection only when all of the following hold. Each condition was a way
the previous check could have read green while the tag stayed open:

| Condition | Why it is required |
| --- | --- |
| `target: "tag"` | A branch ruleset does not constrain tags at all. |
| `enforcement: "active"` | `evaluate` reports without blocking; `disabled` does nothing. |
| `conditions.ref_name.include` covers the whole `mcp-v*` space | `mcp-v1.*` leaves `mcp-v2.0.0` open. Only `mcp-v*`, `mcp-*` or `*` are accepted. |
| `mcp-v*` not carved back out by `exclude` | An exclude silently reverses the include. |
| `rules[].type` contains `creation` | Tags are created, not pushed to. A ruleset restricting only `update`/`deletion` leaves the release trigger open. |

### Why this replaced the previous check

The first version of both this document and the script used
`GET /repos/{owner}/{repo}/tags/protection` and expected
`[{"pattern": "mcp-v*", "required_approving_review_count": 0}]`.

GitHub has **removed that endpoint**. It returns 404 even for a caller with `admin: true`,
which was confirmed against this repository. So the guard could never pass, and its red was
uninformative: "endpoint gone" and "tag unprotected" produced the same failure. A guard that
cannot observe its subject is worse than no guard, because its failure is indistinguishable
from the condition it is supposed to detect. Tag protection now lives in rulesets.

## Setup (admin only)

GitHub UI: **Settings → Rules → Rulesets → New ruleset → New tag ruleset**

- Name: `Protect mcp-v* release tags`
- Enforcement: **Active**
- Target tags: `mcp-v*`
- Rules: **Restrict creations**, **Restrict deletions**
- Bypass list: repository admins only

Equivalent API call (requires admin):

```bash
gh api --method POST repos/calllint/calllint/rulesets \
  -f name='Protect mcp-v* release tags' -f target=tag -f enforcement=active \
  -f 'conditions[ref_name][include][]=refs/tags/mcp-v*' \
  -f 'conditions[ref_name][exclude][]=' \
  -f 'rules[][type]=creation' -f 'rules[][type]=deletion' \
  -f 'bypass_actors[][actor_id]=5' -f 'bypass_actors[][actor_type]=RepositoryRole' \
  -f 'bypass_actors[][bypass_mode]=always'
```

`actor_id=5` is the built-in **Repository admin** role. Confirm with
`gh api repos/calllint/calllint/rulesets/{id}` afterwards, and re-run the verifier — it must
print `PASS`.

## Rationale

- **Immutable npm versions**: once published, `calllint-mcp@X.Y.Z` cannot be unpublished
  (npm policy). Tag protection prevents accidental or malicious version burn.
- **Registry state finality**: MCP Registry updates are immediate and visible to every
  platform consuming it. Wrong version → wrong authority → trust violation.
- **OIDC supply chain**: the publish workflow uses GitHub OIDC (no stored tokens), so tag
  creation is the first gate before publish.

## Monitoring

`.github/workflows/distribution-watch.yml` runs the verifier daily:

```yaml
- name: Check mcp-v* tag protection
  env:
    GH_TOKEN: ${{ github.token }}
  run: node scripts/verify-mcp-tag-protection.mjs
```

The watch workflow only fires once it is on the **default branch** — a `schedule:` block on a
feature branch never runs. Until this branch merges, the daily check has executed zero times.

## Trade-offs

- **Pros**: prevents unauthorized `mcp-v*` release; aligns with npm and Registry finality.
- **Cons**: requires admin intervention for every MCP release tag (cannot be delegated to a
  CI write token).

**Decision**: accept the friction. MCP releases are infrequent (~monthly) and protection is a
hard supply chain requirement.
