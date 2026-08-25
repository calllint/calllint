# Weekly Discovery Review

**Replaces**: "weekly discovery job" (implied continuous crawling, contradicted new18 §22 read-only stance)

**What this is**: A scheduled workflow that checks BOUNDED sources for change, records what
it saw as an internal artifact, and stops. No crawler, no scraper, no dynamic expansion.
Read-only by contract (new18 §22).

---

## This extends an existing workflow. It is not a new one.

`.github/workflows/distribution-watch.yml` already **is** the weekly review: Mondays 09:00
UTC plus `workflow_dispatch`, with baseline restore from the previous run's artifact,
week-over-week change detection, 90-day retention, and the report-only exit-0 discipline.
`scripts/check-official-sources.mjs` is its observation stage.

An earlier draft of this contract sketched a second workflow (`weekly-discovery-review.yml`)
with its own scripts. That would have duplicated the cron, the baseline mechanism, the
artifact upload, and the read-only rules — two half-working systems where one works. What
this contract actually adds is a **third URL kind** inside the existing script.

---

## The bounded-source contract

The review reads from EXACTLY THREE source classes, and no others.

### 1. MCP Registry — `registry.modelcontextprotocol.io`

- Checked by `scripts/verify-registry-presence.mjs`, already a step in the workflow.
- Asserts that `io.github.calllint/calllint` is present and its `calllint-mcp` package is
  resolvable. Bounded because it queries one known server id, not the whole index.
- **Fails the job** when unreadable, unlike the other two sources. This is deliberate and
  the reasoning is worth keeping straight: Registry presence is a fact about *our own*
  publication, so an unverified claim about ourselves must red. A vendor moving *their* page
  is not a CallLint defect and must not.

### 2. Agent harness watch list — checked-in YAML

- File: `artifacts/distribution/agent-harness-watch-list.yml` — 12 entries.
- Read by `check-official-sources.mjs` as `kind: HARNESS_RELEASE_FEED`, alongside the two
  kinds it already read from the SSOT projection: `HOST_SOURCE` (26 URLs / 18 hosts) and
  `CANDIDATE_FEED` (3 URLs / 3 curated lists). 41 URLs total.
- Bounded because the list is VERSION-CONTROLLED. Adding a watch target takes a commit, not
  a config flag, and the job polls exactly the listed URLs — it never follows a link out of
  one.
- Every URL was probed on 2026-08-24 and returns 200 after redirects. `github-releases`
  entries were additionally confirmed to have ≥1 published release: **a releases page with
  no releases is not a signal**, which is why `cursor/cursor` is watched at its website
  changelog instead (the repo exists and publishes none).

  Four of twelve entries were wrong as first written — `sst/opencode` had moved to
  `anomalyco/opencode`, `getcursor/cursor` to `cursor/cursor`, `stackblitz-labs/kiro` never
  existed (Kiro is AWS), and the Qwen URL pointed at model weights rather than the CLI. The
  GitHub API follows renames silently, so a stale `owner/name` keeps returning 200 and reads
  as healthy. That is the fault mode this list's `repo:` field exists to make checkable.

### 3. CallLint's own release surface — `github.com/calllint/calllint`

- Covered by `scripts/verify-mcp-tag-protection.mjs` (the `mcp-v*` supply-chain gate) and by
  `verify-registry-presence.mjs` above.
- **Deliberately not a fetched feed.** Watching our own release list to discover our own
  releases is near-vacuous: we cause them, and the published *state* they produce is what
  the two checks above already assert. A feed poll would add a fetch and no signal.

---

## What it is NOT

- **NOT a web crawler**: no recursive link-following, no dynamic scraping, no "seed URLs
  and expand".
- **NOT a search scraper**: does not query any search API for "new agent tools" or "MCP
  servers mentioning calllint".
- **NOT a social listener**: does not monitor Twitter, Reddit, Hacker News, or Discord.
- **NOT a package registry poller**: does not enumerate npm / PyPI / crates.io.

All of those would violate new18 §22's passive-collection constraint.

---

## What each kind licenses

The kinds are separate because they permit different reactions, and the artifact is read by
a human who must not have to remember which is which. Conflating them is the specific way
this feature turns dangerous — a curated third-party list asserting "supports X" would
become a support claim about CallLint.

| kind | a change licenses |
| --- | --- |
| `HOST_SOURCE` | editing that host's recorded `supportClass`, `truthfulCommands`, `configEvidence` |
| `CANDIDATE_FEED` | recording candidate evidence, nothing more — no extractor, no support page, no support claim, no external submission (§86, new18 §35). Admission is `DEFERRED` or `DISCOVERY_ONLY` only; `NATIVE` needs a bootstrapped extractor (HD-01). |
| `HARNESS_RELEASE_FEED` | checking whether a config path moved, then updating the extractor and the watch list by commit |

For release feeds, **`STATUS` and `REDIRECT` are the load-bearing signals, not `BODY`.**
Codex, gemini-cli and qwen-code publish nightlies, so a body-hash change there is expected
traffic. A 404 or a new final URL means the repo moved, and an extractor's assumptions may
have moved with it.

---

## Output

`artifacts/distribution-watch/official-sources.json` — one observation per URL: `kind`,
HTTP status, ETag / Last-Modified when offered, body SHA-256, byte length, and
`unreachableReason` when the fetch threw. Uploaded with 90-day retention and restored by the
next run as its baseline.

Change classes: `NEW`, `STATUS`, `REACHABILITY`, `BODY`, `REDIRECT`, `DROPPED`. `NEW` is
separate from `BODY` because a first observation has no previous state to differ from.

A body-hash change is **not** an assertion about content — on a marketing page it is usually
a rotated banner. A human decides whether it matters. Do not add a heuristic that guesses.

---

## Why weekly, not daily

Every check here observes a fact that moves on the order of weeks. Daily polling bought no
earlier detection of anything and would spend 7× the Actions minutes re-asserting the same
measurement. `workflow_dispatch` covers "I need an answer now".

---

## Two properties that are easy to lose

**No automatic PRs.** The job never opens an external PR or issue, submits a form, or
contacts a maintainer. It records; a human decides.

**Anti-vacuity per kind, with its own denominator.** Each kind fails the run if it is
declared but contributes zero URLs. This matters because the pattern has already bitten:
until 2026-08-22 the script read `sources` alone, so candidate feeds were fetched *zero*
times while the job stayed green — the existing floor (`sources.length === 0`) could not see
it, because its denominator did not include the thing being missed. The watch list carries
the same floor: present-but-empty fails, absent is allowed.

Note the asymmetry that keeps this honest: an unreachable *source* is data (exit 0), but an
unreadable *watch list* is this script failing at its own job (exit 1).

---

## What this replaces

"Weekly discovery job" implied continuous monitoring, automatic integration of findings, and
unbounded scope. "Weekly Discovery Review" is scheduled not continuous, records reports not
PRs, and reads bounded sources enumerated above. The constraints are now observable and
testable — `node scripts/check-official-sources.mjs --offline` verifies the manifest and
watch-list shape without a single fetch.
