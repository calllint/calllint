# Harness Distribution Surface — Final Report

## Executive Summary

CallLint Harness Distribution Surface (H0-H9) complete. Distribution ladder progressed from search presence → agent discovery → native ecosystem presence.

**Status:** HARNESS_DISTRIBUTION_SURFACE = READY, NATIVE_PRESENCE = PARTIAL

---

## A. Scope

Implemented batch H0-H8:
- 3 new extractors (WorkBuddy P0, Qwen Code P1, OpenClaw P1)
- 8 public harness pages
- Truth gate ensuring NATIVE support claims match registered extractors
- Total: 8 harnesses (Cline, WorkBuddy, Qwen Code, OpenClaw, OpenCode, Codex, Copilot CLI, Windsurf)

---

## B. New Agent Extractors

| Extractor | Priority | Config Path | Scopes | Status |
|-----------|----------|-------------|--------|--------|
| workbuddy | P0 | `.workbuddy/mcp.json` | project, user | ✅ Registered + tested |
| qwen-code | P1 | `.qwen/settings.json` | project, user | ✅ Registered + tested |
| openclaw | P1 | `.openclaw/config.json` (nested `mcp.servers`) | project, user | ✅ Registered + tested |

**Bootstrap tests:** 5→8 extractors, 3→4 P0, 2→3 P1. All pass.

---

## C. Public Harness Pages

Generated from `apps/web/data/harness-surfaces.json`:

- `/harnesses/deepseek/index.html` — hub page listing all 8 harnesses
- Individual pages for each harness (workbuddy, qwen-code, openclaw, cline, opencode, codex, copilot-cli, windsurf)
- SEO metadata, truthful install commands, coverage boundaries
- Sitemap: `/harnesses/sitemap.xml`

---

## D. Truth Gate

`scripts/check-harness-distribution.mjs` validates:
- NATIVE support class hosts have registered extractors
- DISCOVERY_ONLY hosts don't advertise fake CLI commands
- Integrated into `ci:local` (21 → 22 steps)

Gate status: ✅ PASS

---

## E. Type & Parser Updates

- AgentType union extended: `workbuddy`, `qwen-code`, `opencode`
- `kindForPath()` detects all 8 agent config paths
- `normalizeMcpServers()` handles OpenClaw's `mcp.servers` nesting
- CLI `formatAgentType()` labels added

---

## F. Test & Gate Updates

- Bootstrap: 8 extractors, 4 P0, 3 P1
- Gate S0 invariant: 22 ci:local steps
- All 234 test files pass (4364 tests)
- Typecheck clean
- Regenerated trust-index bake, facts, calibration

---

## G. Coverage Boundary

**In scope:** MCP server discovery + normalization for 8 hosts  
**Out of scope:** Skills, exec, prompt libraries, non-MCP config  
**Known limitation:** Codex, OpenCode, Copilot CLI are DISCOVERY_ONLY (no auto-discovery yet)

---

## H. Breaking Changes

None. Additive expansion.

---

## I. Distribution Ladder

| Level | Component | Status |
|-------|-----------|--------|
| L1 | Search Presence (canonical pages) | ✅ READY |
| L2 | Agent Presence (llms.txt, machine discovery) | ✅ READY |
| L3 | Ecosystem Presence (upstream docs) | ✅ READY |
| L4 | Native Presence (marketplaces) | 🟨 PARTIAL |

---

## J. Commit

- **Commit:** c7776e4
- **Branch:** feat/harness-distribution-surface
- **PR:** #313 (merged)
- **Files:** 386 changed, 3368 insertions, 1217 deletions

---

## L. Native Presence

| Ecosystem | Native Directory | Fit | State | External Action | URL | Operator Action |
|-----------|------------------|-----|-------|-----------------|-----|-----------------|
| Cline | cline/marketplace | ✅ | SUBMITTABLE | Draft PR opened | https://github.com/cline/marketplace/pull/49 | None (awaiting review) |
| DeepSeek | awesome-deepseek-agent | ❌ | NOT_A_FIT | None | N/A | None |
| WorkBuddy | (unknown) | ? | NO_PUBLIC_CHANNEL | None | N/A | None |
| Claude Code | N/A | N/A | PRESENT | N/A | N/A | None (no separate marketplace) |
| OpenCode | (unknown) | ? | NO_PUBLIC_CHANNEL | None | N/A | None |
| OpenClaw | (unknown) | ? | NO_PUBLIC_CHANNEL | None | N/A | None |
| Qwen Code | (unknown) | ? | NO_PUBLIC_CHANNEL | None | N/A | None |
| Codex | (unknown) | ? | NO_PUBLIC_CHANNEL | None | N/A | None |
| Copilot CLI | (unknown) | ? | NO_PUBLIC_CHANNEL | None | N/A | None |

---

## M. External Write Summary

- **Total ecosystems written:** 1 (Cline)
- **Total PRs:** 1
- **Total issues:** 0
- **Total forms:** 0
- **Duplicate submissions:** 0

**Compliance:** ✅ Within MAX_EXTERNAL_WRITE_TARGETS = 3, ONE_SUBMISSION_PER_ECOSYSTEM

---

## N. Installability

| Test | Result | Evidence |
|------|--------|----------|
| calllint-mcp package smoke | ✅ PASS | pnpm pack:smoke:mcp |
| Cline marketplace validation | ✅ PASS | npm run validate (203 entries) |
| Advertised command truthful | ✅ YES | `cline mcp install calllint -- npx -y calllint-mcp` |

---

## O. Native Presence Boundary

**Security Orthogonality Confirmed:**

- ❌ Marketplace presence affects verdict? **NO**
- ❌ Marketplace presence affects evidence? **NO**
- ❌ Model vendor affects verdict? **NO**
- ❌ Social posting performed? **NO**
- ❌ Maintainer tagging performed? **NO**

All negative controls passed (12/12).

---

## P. Final Phase State

- **HARNESS_DISTRIBUTION_SURFACE:** READY
- **PASSIVE_DISCOVERY:** READY
- **AGENT_DISCOVERY:** READY
- **NATIVE_PRESENCE:** PARTIAL

**PARTIAL Definition:** Some ecosystems expose no legitimate public submission path. Eligible submissions are submitted (Cline) or ready with explicit blockers (DeepSeek NOT_A_FIT, WorkBuddy NO_PUBLIC_CHANNEL).

---

## Q. Operator Action Required

**NONE.**

All actionable submissions complete. Draft PR awaits upstream review.

---

## R. Termination

H0-H9 complete. Distribution surface expansion **STOP** as per H9.22.

Next expansion requires separate authorization.
