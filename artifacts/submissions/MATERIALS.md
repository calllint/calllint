# Shared submission materials

Every shelf asks the same questions. The answers live here once; per-platform files cite
this file rather than restating it, so a copy edit lands in one place instead of nine.

Verified against the tree on 2026-08-23.

## Identity

| Field | Value | Source of truth |
|---|---|---|
| MCP server name | `io.github.calllint/calllint` | `apps/web/data/distribution-surfaces.json` → `officialMcpRegistry.name` |
| npm package (MCP) | `calllint-mcp` **0.2.0** | `packages/calllint-mcp/package.json` |
| npm package (CLI) | `calllint` **1.8.0** | `apps/cli/package.json` |
| Claude plugin | `calllint` **0.1.0** | `plugins/calllint/.claude-plugin/plugin.json` |
| Repository | https://github.com/calllint/calllint | `git remote` |
| Homepage | https://calllint.com | |
| License | Apache-2.0 | |
| Node requirement | >= 20 | |
| Transport | stdio | `officialMcpRegistry.transport` |

The three version numbers are **deliberately independent**. They ship on different cadences;
a shared number would imply a coupling that does not exist. Do not "align" them, and never
copy a version into a marketplace entry — `plugin.json` wins silently when the two disagree.

## Assets

All present in the tree:

- Logo — `assets/brand/logo-mark-128.png`
- `server.json` — `packages/calllint-mcp/server.json`
- README — `packages/calllint-mcp/README.md`
- Example configs — `examples/mcp-configs/` (5 configs)

`docs/MCP_SERVER.md` also exists but the whole `docs/` tree is gitignored
(`.gitignore:44`), so do not cite it in an external submission: a reviewer cloning the repo
will not find it. Cite `packages/calllint-mcp/README.md` instead.

## Copy

**Short** (one line, ~100 chars):

> Static preflight safety gate for MCP servers — scan configs before you run them. Never executes.

**Long** (one paragraph):

> CallLint scans MCP servers, agent tools, and skills *before* they run — using offline,
> deterministic, evidence-backed analysis to expose authority surface and config risks
> without executing untrusted code. Produces SAFE/REVIEW/BLOCK/UNKNOWN verdicts with full
> evidence.

**Registry description** (as published, keep consistent):

> Deterministic static preflight inspection for MCP and agent-tool configurations. Shows
> authority and evidence before execution; never executes the server it judges.

## Categories / tags

Security · Developer Tools · Static Analysis · MCP Server · Agent Safety · Supply Chain · CLI

## Claims a submission must NOT make

The verdict vocabulary is load-bearing and a listing is not exempt from it:

- `SAFE` means "no blockers observed under current evidence" — never a guarantee.
- `UNKNOWN` never means safe, and never auto-upgrades to it.
- Do not describe CallLint as executing, sandboxing, or running MCP servers. It does not;
  Quick Scan's refusal to execute an unknown server is a product invariant.
- Do not claim a shelf listing that is not live. Presence and verification are separate
  facts, which is what the channel `state` records.
