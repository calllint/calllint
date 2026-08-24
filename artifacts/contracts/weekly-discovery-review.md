# Weekly Discovery Review

**Replaces**: "weekly discovery job" (implied continuous crawling, contradicted new18 §22 read-only stance)

**What this is**: A scheduled GitHub workflow that checks BOUNDED sources for new agent
harness releases, generates a structured report, and stops. No crawler, no scraper, no
dynamic expansion. Read-only by contract (new18 §22).

---

## The bounded-source contract

The review reads from EXACTLY THREE source classes, and no others:

### 1. MCP Registry (api.mcp.run API)
   - Endpoint: `GET /registry/servers` (public, read-only)
   - What it returns: All published MCP servers, including those that bundle CallLint
   - Why it's bounded: The MCP Registry is a curated, finite list (not a web crawler)
   - Update frequency: API reflects publisher pushes (real-time)

### 2. Known watch list (checked-in YAML)
   - File: `artifacts/distribution/agent-harness-watch-list.yml` (to be created in PR #4)
   - What it contains: Explicit URLs for agent harness release pages (GitHub repos,
     changelog pages, official blogs)
   - Why it's bounded: The list is VERSION-CONTROLLED. Adding a new watch target requires
     a commit, not a config flag.
   - Update frequency: Manual (operator commits when a new harness is worth tracking)

### 3. Existing GitHub org releases (github.com/calllint/* only)
   - API: `GET /repos/calllint/{repo}/releases` for each repo in the `calllint` org
   - What it returns: Release tags and notes for repos we control
   - Why it's bounded: We own the `calllint` org; its repo count is finite and under
     operator control.
   - Update frequency: API reflects our own releases (triggered by us)

---

## What it is NOT

- **NOT a web crawler**: No recursive link-following, no dynamic site scraping, no
  "start from seed URLs and expand" logic.
  
- **NOT a search scraper**: Does not query Google, Bing, or any search API for "new
  agent tools" or "MCP servers mentioning calllint".

- **NOT a social listener**: Does not monitor Twitter, Reddit, Hacker News, or Discord
  for mentions.

- **NOT a package registry poller**: Does not enumerate all of npm / PyPI / crates.io
  looking for CallLint integrations.

All of those would violate new18 §22's "passive collection only" constraint. The Weekly
Discovery Review is bounded by design: it reads from a finite, explicit list.

---

## Output format

The workflow produces a structured report (Markdown + JSON) uploaded as a workflow
artifact:

```markdown
# Weekly Discovery Review — 2026-W35

## New MCP Registry entries
- `example-server` (v1.0.0) — first seen this week
- `another-server` (v0.2.1) — version bump from v0.2.0

## Watch list updates
- Claude Desktop: release 1.5.0 (2026-08-20) — mentions MCP improvements
- Cursor: no new releases this week

## CallLint org releases
- calllint-mcp-server: v0.3.0 (2026-08-19) — added preflight caching
- calllint-www: no deploy this week

## Action items
- [ ] Verify `example-server` actually bundles CallLint (may be false positive)
- [ ] Document Cursor 1.5.0 MCP changes in harness-distribution matrix
```

The JSON companion carries the same data in machine-readable form for downstream tooling.

---

## Schedule and retention

- **Cron**: Weekly, off-peak (e.g. Sunday 06:00 UTC)
- **Artifact retention**: 90 days (enough to compare a quarter of runs)
- **No automatic PRs**: The workflow NEVER opens a PR or commits findings. It generates
  a report; a human decides what to do with it.

---

## Why weekly, not daily

Daily polling of GitHub APIs and the MCP Registry would burn rate limits for marginal
gain: agent harness releases are infrequent (weeks-to-months cadence), and the MCP
Registry updates when a publisher pushes (not on a schedule we control). Weekly captures
"what changed this week" without treating every check as urgent.

---

## Implementation sketch

```yaml
name: weekly-discovery-review
on:
  schedule:
    - cron: "0 6 * * 0"  # Sunday 06:00 UTC
  workflow_dispatch:

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Fetch MCP Registry snapshot
        run: |
          curl -s https://api.mcp.run/registry/servers > mcp-registry.json
      - name: Check watch list for updates
        run: node scripts/check-watch-list.mjs  # reads agent-harness-watch-list.yml
      - name: List CallLint org releases (last 7 days)
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release list --repo calllint/calllint --limit 10 > calllint-releases.txt
      - name: Generate discovery report
        run: node scripts/generate-discovery-report.mjs  # outputs Markdown + JSON
      - name: Upload report artifact
        uses: actions/upload-artifact@v4
        with:
          name: discovery-review-${{ github.run_number }}
          path: dist/discovery-review/
          retention-days: 90
```

Scripts live in `scripts/` (e.g. `check-watch-list.mjs`, `generate-discovery-report.mjs`).

---

## What this replaces

"Weekly discovery job" implied:
- Continuous monitoring (contradicts read-only stance)
- Automatic integration of findings (violates human-in-loop)
- Unbounded scope (crawl the web for mentions)

"Weekly Discovery Review" is explicit:
- Scheduled, not continuous
- Generates reports, not PRs
- Bounded sources, enumerated above

The new name makes the constraints observable and testable.
