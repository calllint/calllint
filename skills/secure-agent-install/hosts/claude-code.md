# secure-agent-install — Claude Code

Add this rule to your project so Claude Code runs the secure-install workflow before
installing any MCP server or skill.

Put the following in `CLAUDE.md` (or `.claude/rules`), adjusting paths as needed:

```markdown
## Secure agent install

Before adding, editing, approving, or installing any MCP server or agent skill
(.cursor/mcp.json, .vscode/mcp.json, .mcp.json, .claude/settings.json,
claude_desktop_config.json, ~/.claude.json, SKILL.md), run the secure-install workflow:

1. Run SkillSpector on the package content yourself and save its report.
2. Ask CallLint whether the requested authority is acceptable, attaching that report:
     npx -y calllint trust prepare <target> --evidence skillspector-report.json
3. Read the joint Trust Packet (content scan vs authority scan).
4. Install only after approval:
   - SAFE: continue after stating no blockers were observed.
   - REVIEW: explain findings, ask first.
   - BLOCK: stop unless the user explicitly overrides.
   - UNKNOWN: gather more evidence; never treat as SAFE.

Never install before the verdict. CallLint never executes the server it judges.
```

CallLint is offline by default and installs nothing on its own. This skill is open and
neutral; it is not affiliated with or endorsed by SkillSpector.
