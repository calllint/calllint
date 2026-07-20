# secure-agent-install — Codex-compatible

For Codex-compatible agents, add the secure-install workflow to your agent instructions
(`AGENTS.md` or the host's instruction file).

Add this section:

```markdown
## Secure agent install

Before installing any MCP server or agent skill (.codex/config.toml, .mcp.json,
mcp.json, SKILL.md), run the secure-install workflow:

1. Run SkillSpector on the package content yourself; save its report.
2. Ask CallLint whether the requested authority is acceptable, attaching that report:
     npx -y calllint trust prepare <target> --evidence skillspector-report.json
3. Read the joint Trust Packet (content scan vs authority scan, unmerged).
4. Install only after approval:
   - SAFE: continue after stating no blockers were observed.
   - REVIEW: explain findings; ask first.
   - BLOCK: stop unless explicitly overridden.
   - UNKNOWN: gather more evidence; never treat as SAFE.

Never install before the verdict.
```

CallLint is offline by default, never executes the server it judges, and installs
nothing on its own. This skill is open and neutral; it is not affiliated with or endorsed
by SkillSpector.
