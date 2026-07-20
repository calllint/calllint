# secure-agent-install

An open, minimal skill for installing agent skills and MCP servers **safely**. It pairs a
content scanner (SkillSpector, which you run) with CallLint's authority layer, shows both
results side-by-side in a joint Trust Packet, and installs **only after human approval**.
It installs nothing by default.

> Two tools, two questions:
> **SkillSpector** — is the content malicious? · **CallLint** — is the requested authority acceptable?

## Why both

A package can be perfectly clean and still request authority you should not grant —
reading your whole home directory, an admin OAuth scope, or the ability to charge a card.
A content scan cannot answer that; an authority check can. Neither replaces the other,
and neither overrides the other.

## Contents

| File | Purpose |
| --- | --- |
| `SKILL.md` | The workflow, decision semantics, and guardrails. |
| `runner.sh` | Thin runner that shells to `calllint trust prepare` (installs nothing). |
| `hosts/claude-code.md` | Drop-in rule for Claude Code. |
| `hosts/cursor.md` | Drop-in project rule for Cursor. |
| `hosts/codex.md` | Drop-in instruction block for Codex-compatible agents. |

## Quick start

```bash
# 1. You run SkillSpector on the package content and save its report (never run here).
# 2. Ask CallLint whether the requested authority is acceptable, attaching that report:
./runner.sh <git-url|dir|SKILL.md|mcp.json> skillspector-report.json
# 3. Read the joint Trust Packet; install only after approval.
```

The runner exits with CallLint's own verdict code (0 SAFE / 10 REVIEW /
20 UNKNOWN|BLOCK-class). A non-zero exit means: do not install without human review.

## Guarantees

- Installs nothing on its own; no host config is modified without your approval.
- Never executes the MCP server or skill under evaluation (CallLint reads config statically).
- Never runs SkillSpector for you — its report is an input you provide.
- Does not merge the two results into one score; a degraded content scan is never a pass.

## Neutrality

This skill is open-source and neutral. It is **not** affiliated with, endorsed by, or a
partnership with SkillSpector, NVIDIA, or any scanner vendor. "SAFE" means no blockers
observed under current evidence — not a proof of runtime safety and never a guarantee.
