---
name: secure-agent-install
description: Before installing an agent skill or MCP server, scan its content with SkillSpector and check whether the authority it requests is acceptable with CallLint, then install only after human approval. Installs nothing by default.
license: Apache-2.0
---

# Secure Agent Install

A small, open workflow for installing an agent skill or MCP server **safely**. It
composes two independent tools that answer two different questions:

- **SkillSpector** inspects the package **content**: is the code malicious?
- **CallLint** decides whether the **authority** the package requests is acceptable:
  does it read your whole home directory, hold an admin OAuth scope, charge a card?

A package can be clean *and* request unsafe authority. This skill surfaces both
answers side-by-side in a **joint Trust Packet** and installs **only after you
approve**. It installs nothing by default.

> This skill is open and neutral. It is not affiliated with, endorsed by, or a
> partnership with SkillSpector or its authors. SkillSpector is run by you, out of
> band; CallLint never executes it and never executes the server it judges.

## When to use

Use this before you add or install:

- an MCP server (`.cursor/mcp.json`, `.vscode/mcp.json`, `.mcp.json`,
  `.claude/settings.json`, `claude_desktop_config.json`, `~/.claude.json`),
- an agent skill (`SKILL.md` + its files),
- or any package that will run inside your agent with tool access.

## The workflow

1. **Scan the content (SkillSpector, run by you).**
   Run SkillSpector on the package yourself and save its report
   (`skillspector-report.json` or SARIF). CallLint never runs it for you — this keeps
   the "never execute untrusted content" posture intact. Pin the SkillSpector version
   to a commit (it has no formal release).

2. **Decide on the authority (CallLint), attaching the content evidence.**
   Point CallLint at the *proposed* install config and attach the SkillSpector report
   as supporting evidence. CallLint resolves the artifact, builds an authority
   manifest, applies your local policy, and returns a verdict — **without re-scoring
   the SkillSpector report and without executing anything**:

   ```bash
   npx -y calllint trust prepare <git-url|dir|SKILL.md|mcp.json> \
     --evidence skillspector-report.json
   ```

   Or, to attach the evidence to a plain scan and see the joint Trust Packet directly:

   ```bash
   npx -y calllint scan <mcp.json> --evidence skillspector-report.json
   ```

3. **Read the joint Trust Packet.**
   It shows the two results unmerged:
   - **Content scan** — SkillSpector's provider, pinned version, completeness, and
     findings (kept verbatim, never re-scored).
   - **Authority scan** — CallLint's own verdict (SAFE / REVIEW / BLOCK / UNKNOWN) and
     the reason.
   plus one line explaining *why they differ*. A degraded or partial content scan is
   never treated as a pass.

4. **Approve, then install — never before.**
   - **SAFE** — no blockers observed under current evidence. Continue only after saying so.
   - **REVIEW** — confirm with a human before installing.
   - **BLOCK** — do not install unless a human explicitly overrides.
   - **UNKNOWN** — gather more evidence; UNKNOWN is never treated as SAFE.

   Only after an explicit approval do you run the host's install step. This skill does
   not install anything on its own.

## Decision semantics (from CallLint)

| Verdict | Meaning | Action |
| --- | --- | --- |
| SAFE | No blockers observed under current evidence | Continue; state that no blockers were observed. |
| REVIEW | Human confirmation needed | Explain findings; ask before installing. |
| BLOCK | Policy or rule blocked it | Stop. Do not install without an explicit override. |
| UNKNOWN | Insufficient evidence | Gather more; never round up to SAFE. |

SAFE means "no blockers observed under current evidence." It is not a proof of runtime
safety, and it is never a guarantee.

## What this skill deliberately does NOT do

- It does not run SkillSpector for you (you run it; the report is an input).
- It does not execute the MCP server or agent skill it evaluates.
- It does not merge the two results into a single score — they stay separate.
- It does not install, enable, or modify any host config without your approval.

## See also

- `runner.sh` — a thin, optional runner that wires steps 2–3 together.
- Host manifests in `hosts/` — Claude Code, Cursor, Codex.
- CallLint evidence-interoperability contract: `EVIDENCE.md` and ADR 0034 in the
  CallLint repository.
