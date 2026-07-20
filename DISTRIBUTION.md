# Distribution update automation — do I have to update each directory by hand?

Short answer: **the two channels that matter most update themselves, and a weekly
watchdog tells you when a downstream listing has fallen behind — you never poll by
hand.** The only genuinely manual step is the *one-time* maintainer claim on the few
directories that expose no API. This doc is the reference matrix behind that answer.

It is grounded entirely in workflows and files already in this repo — nothing here is
aspirational.

## The three tiers

### 1. Push — fully automated, already built (zero-touch on every release)

These publish on a tag/release with **no stored token** (OIDC end-to-end) and no manual
step after the tag:

| target | trigger | mechanism | source |
| --- | --- | --- | --- |
| npm `calllint` (CLI) | GitHub **Release published** (tag `v<version>`) | npm Trusted Publishing (OIDC) + provenance | `.github/workflows/release.yml` |
| npm `calllint-mcp` + **official MCP Registry** | push tag `mcp-v<version>` | npm Trusted Publishing, then `mcp-publisher login github-oidc` → `mcp-publisher publish` (the `io.github.calllint` namespace is proven by the workflow's own GitHub OIDC identity) | `.github/workflows/publish-mcp.yml` |

Ownership of the MCP Registry entry is bound by `mcpName` in the package plus a
version-parity gate in the workflow (`server.json` version must equal `package.json`),
so the registry can never advertise a version that was not published.

**Updating the version on these is nothing but cutting the release.**

### 2. Downstream mirror — automatic, no action from us

These directories do not take a push from us; they **re-read the upstream** (the official
MCP Registry / npm) on their own schedule:

- **PulseMCP** (`pulsemcp.com/servers/calllint`) — classified **official**, reads our
  published `server.json`. It follows the MCP Registry automatically once a `mcp-v*`
  release lands.
- **mcpservers.org** (`mcpservers.org/servers/calllint/calllint`) — a listing mirror; it
  re-scrapes upstream. (As of 2026-07-20 it still showed an older CLI version — that is a
  re-scrape lag on their side, not a manual step on ours.)

There is nothing to do here. When the push tier updates, these follow.

### 3. Manual — one-time claim, platform limitation (not ours to automate)

These expose **no anonymous public JSON API** for either submission or read-back, so a
maintainer claim/verification is a one-time human web action, and version refresh depends
on the platform re-scraping npm:

- **Forge** (`forgeregistry.com/registry/calllint-mcp`) — community-indexed; publisher
  claim is a manual, web-login verification. (As of 2026-07-20 the claim was still under
  review / unverified.)
- **GitHub Marketplace** (`github.com/marketplace/actions/calllint`) — publishing an
  Action listing is a UI-driven flow tied to a release; there is no public listing API to
  drive it from CI.

These are recorded in `distribution/registries/registry-manifest.json` with
`ownershipMethod: "manual"`, `manualActionRequired: true`, and an empty `readbackUrl` — so
the read-back workflow never pretends it verified them (see the watchdog below).

## The weekly watchdog — you are notified, you don't poll

`.github/workflows/release-readback.yml` runs `scripts/release-readback.mjs` on a schedule
(and on demand). It:

1. Reads the expected identity (`project-facts.json` → `registry-manifest.json`).
2. Fetches the **observed** identity from each platform that has an automatable read-back
   endpoint (npm registry JSON, GitHub release JSON).
3. Reconciles with a pure core (`scripts/lib/readback-reconcile.mjs`) that classifies each
   platform `MATCH` / `STALE` / `MISSING` / `UNREACHABLE` / `MANUAL_REVIEW`. A fetch
   failure is `UNREACHABLE`, never a false `MATCH` — a missing signal is never a clean
   result.
4. On actionable drift (`STALE` / `MISSING`), opens or updates **one** deduplicated GitHub
   issue. `MANUAL_REVIEW` platforms (the tier-3 directories) are surfaced but never
   auto-fail the run, so they cannot spam a drift issue.

So the manual directories show up every week as a standing `MANUAL_REVIEW` line — a
reminder to eyeball them — while the automatable channels are actually diffed and will
raise an issue the moment a version falls out of sync.

## Summary

| tier | directories | version update after release |
| --- | --- | --- |
| Push (built) | npm `calllint`, npm `calllint-mcp`, official MCP Registry | automatic (OIDC, on release/tag) |
| Downstream mirror | PulseMCP, mcpservers.org | automatic (they re-read upstream) |
| Manual (platform limit) | Forge, GitHub Marketplace | one-time human claim; refresh depends on platform re-scrape |

The read-back workflow is the safety net across all three: it never says "verified" for a
platform it could not actually reach, and it pings you (one issue, deduped) when an
automatable listing drifts.
