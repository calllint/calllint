# MCP Tag Protection — Supply Chain Gate

**Context**: G3.4 — Supply Chain Gate for mcp-v* release tags
**Status (re-measured 2026-08-21 at `4bcedb5`)**: **STILL NOT PROTECTED.** The repository has
exactly one ruleset, `17728504 "Protect main" target=branch`. There is no tag ruleset. Creating
one is a repository-settings write and is the last open item on this gate.

**Scope note added 2026-08-21.** This document covers **who may create** an `mcp-v*` tag. It is
only half of AC-32. `new18.md` §45 asks separately, and unconditionally, for a code-level check
that the **commit a release tag points at** is reachable from the protected default branch — a
ruleset does not give you that, because an admin or any bypass actor can still tag a side branch.
That half is now implemented as [`scripts/verify-release-ancestry.mjs`](../../scripts/verify-release-ancestry.mjs),
wired as step 2 of `publish-mcp.yml`. Consequence for this file: with the ancestry gate live, a
rogue tag no longer publishes unreviewed code — it fails the job. The missing ruleset now means a
rogue tag can still be *created* and can still start a run.

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

## Setup (repository-settings write)

GitHub UI: **Settings → Rules → Rulesets → New ruleset → New tag ruleset**

- Name: `Protect mcp-v* release tags`
- Enforcement: **Active**
- Target tags: `mcp-v*`
- Rules: **Restrict creations**, **Restrict deletions**
- Bypass list: repository admins only

Equivalent API call:

```bash
gh api --method POST repos/calllint/calllint/rulesets \
  -f name='Protect mcp-v* release tags' -f target=tag -f enforcement=active \
  -f 'conditions[ref_name][include][]=refs/tags/mcp-v*' \
  -f 'conditions[ref_name][exclude][]=' \
  -f 'rules[][type]=creation' -f 'rules[][type]=deletion' \
  -f 'bypass_actors[][actor_id]=5' -f 'bypass_actors[][actor_type]=RepositoryRole' \
  -f 'bypass_actors[][bypass_mode]=always'
```

A ready-to-send request body is committed at
[`artifacts/authority-distribution-closure/mcp-tag-ruleset.json`](mcp-tag-ruleset.json), so the
call can be made without retyping the nested `conditions`/`rules` flags:

```bash
gh api --method POST repos/calllint/calllint/rulesets \
  --input artifacts/authority-distribution-closure/mcp-tag-ruleset.json
```

`actor_id=5` is the built-in **Repository admin** role. Confirm with
`gh api repos/calllint/calllint/rulesets/{id}` afterwards, and re-run the verifier — it must
print `PASS`.

**Why this is recorded rather than executed.** The `admin` bit is not the blocker:
`gh api repos/calllint/calllint --jq .permissions` reports `admin: true` for the authenticated
account, measured 2026-08-21. The blocker is that creating a ruleset is a write to shared
repository settings, which this project's agent policy does not perform unattended — the same
reason `new18.md` §45 says to *record the exact operator step* and "do not fabricate success"
instead. The step above is that record. It has not been run; the verifier's exit 1 is the
evidence, and it is left red on purpose.

## Rationale

- **Immutable npm versions**: once published, `calllint-mcp@X.Y.Z` cannot be unpublished
  (npm policy). Tag protection prevents accidental or malicious version burn.
- **Registry state finality**: MCP Registry updates are immediate and visible to every
  platform consuming it. Wrong version → wrong authority → trust violation.
- **OIDC supply chain**: the publish workflow uses GitHub OIDC (no stored tokens), so tag
  creation is the first gate before publish.

## Monitoring

`.github/workflows/distribution-watch.yml` runs the verifier **weekly** — `cron: '0 9 * * 1'`,
Mondays at 09:00 UTC. (An earlier revision of this file said "daily"; the workflow has never
carried a daily schedule.)

```yaml
- name: Check mcp-v* tag protection
  env:
    GH_TOKEN: ${{ github.token }}
  run: node scripts/verify-mcp-tag-protection.mjs
```

A `schedule:` block only fires once it is on the **default branch**. That happened when PR #325
merged as `a0076ff` on 2026-08-21: `gh api .../workflows/distribution-watch.yml` → `state: active`,
re-measured at `4bcedb5`. `gh run list --workflow=distribution-watch.yml` still returns `[]`, so
the schedule exists and has executed **zero times** — a weekly cron means the first firing is up
to 7 days out. These are three separate facts and none implies another.

**The first scheduled run is expected to fail**, and for a known reason: this verifier is step 3,
and it exits 1 while no tag ruleset exists. That red is the gate reporting its true subject, not a
broken check.

## Trade-offs

- **Pros**: prevents unauthorized `mcp-v*` release; aligns with npm and Registry finality.
- **Cons**: requires admin intervention for every MCP release tag (cannot be delegated to a
  CI write token).

**Decision**: accept the friction. MCP releases are infrequent (~monthly) and protection is a
hard supply chain requirement.
