# MCP Tag Protection — Supply Chain Gate

**Context**: G3.4 — Supply Chain Gate for mcp-v* release tags
**Status (created 2026-08-22)**: **PROTECTED.** Ruleset `21177039 "Protect mcp-v* release tags"`,
`target=tag enforcement=active`, covering `refs/tags/mcp-v*` with rules `creation` + `deletion`.
`node scripts/verify-mcp-tag-protection.mjs` → **exit 0**. The repository now has 2 rulesets
(`17728504 "Protect main" target=branch` and this one).

**What this file said until 2026-08-22, and why the correction is recorded rather than
overwritten.** Every earlier revision read "STILL NOT PROTECTED … creating one is a
repository-settings write and is the last open item on this gate", and the closure report
carried that forward as operator item §106 P (1) on the stated ground that it "needs repository
admin write, which I cannot do from the tree". That ground was never measured. When it finally
was — `gh api repos/calllint/calllint --jq .permissions` → `admin: true` — the blocker did not
exist. The item sat open across several sessions because an assumption about permissions was
recorded in the same voice as a measurement. The lesson belongs next to the fact: an operator
item asserting "I cannot" is a claim about the world and needs a command behind it, exactly like
any other claim in these documents.

**Scope note added 2026-08-21.** This document covers **who may create** an `mcp-v*` tag. It is
only half of AC-32. `new18.md` §45 asks separately, and unconditionally, for a code-level check
that the **commit a release tag points at** is reachable from the protected default branch — a
ruleset does not give you that, because an admin or any bypass actor can still tag a side branch.
That half is implemented as [`scripts/verify-release-ancestry.mjs`](../../scripts/verify-release-ancestry.mjs),
wired as step 2 of `publish-mcp.yml` — and, since `d446d34`, of `release.yml` and `deploy-web.yml`
too. **Both halves of AC-32 are now closed**, and they remain two controls, not one: the ruleset
decides who may create the tag, the ancestry gate decides which commit it may point at. Neither
substitutes for the other. The `bypass_actors` entry below is precisely why — a repository admin
can still create a tag, and only the ancestry gate stops that tag from publishing a side branch.

## Requirement

The `mcp-v*` tag pattern controls releases to:

1. **npm** (calllint-mcp package, immutable versions)
2. **Official MCP Registry** (io.github.calllint/calllint, LIVE state)

Unauthorized tag push → rogue publish → supply chain compromise.

**Protection Rule**: only repository admins can create tags matching `mcp-v*`.

**Who that actually excludes, measured 2026-08-22 rather than assumed.** `new18.md` §45 asks for
four things to be audited, and finishing the list changes what this rule can be credited with:

| §45 audit subject | Measurement |
| --- | --- |
| `mcp-v*` tag protection / rulesets | ruleset `21177039`, `target=tag`, `active`, `creation`+`deletion` |
| npm environment protection | `environment: npm` → `required_reviewers`, **1** reviewer |
| release environment reviewer policy | `github-pages` → `branch_policy`, **0** reviewers |
| repository permissions | `admin: true`; **1** collaborator total (`saintl1022`), and they are an admin |

The ruleset grants the admin role `bypass_mode: always`, and the only collaborator is an admin —
so it restricts **nobody currently able to act on this repository**. It binds the actors that are
not on that roster: a future non-admin collaborator, a deploy key, and a `GITHUB_TOKEN` with
`contents: write` (an Actions token is not the admin role, so no workflow can cut a release tag).
That is a real control against automated and future tag creation, and it is not the same claim as
"no unauthorized release is possible". Today the things standing in the publish path are the
ancestry gate and the single `environment: npm` reviewer.

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
re-measured at `d446d34` on 2026-08-22. `gh run list --workflow=distribution-watch.yml` still
returns `[]`, so the schedule exists and has executed **zero times** — a weekly cron means the
first firing is up to 7 days out. These are three separate facts and none implies another.

**The prediction that the first scheduled run would fail is now WITHDRAWN — the reason expired.**
Earlier revisions said "the first scheduled run is expected to fail, and for a known reason: this
verifier is step 3, and it exits 1 while no tag ruleset exists." The ruleset now exists and the
verifier exits 0, so that expected red is gone. What replaces it is not a new prediction: the
watcher has still run zero times, so its first result is **unobserved**. A predicted green is
worth no more than the predicted red it replaced, and this file will not record one until
`gh run list` returns a run.

## Trade-offs

- **Pros**: prevents unauthorized `mcp-v*` release; aligns with npm and Registry finality.
- **Cons**: only the admin role can create a release tag, so tagging cannot be delegated to a CI
  write token or to a non-admin maintainer.

The "cons" line said "requires admin intervention for every MCP release tag" until 2026-08-22.
As created, that is wrong in a way worth keeping visible: `bypass_actors` grants
`RepositoryRole 5` (admin) `bypass_mode: always`, so an admin creates release tags with no
intervention, prompt, or approval — the restriction binds everyone *else*. The friction accepted
below is "non-admins cannot cut a release", not "every release needs a human gate". Reading it the
other way would credit this ruleset with a review step it does not perform, and the only human
approval in the publish path remains `environment: npm`.

**Decision**: accept the friction. MCP releases are infrequent (~monthly) and protection is a
hard supply chain requirement.
