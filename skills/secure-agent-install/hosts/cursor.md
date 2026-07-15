# secure-agent-install — Cursor

Add a Cursor project rule so the agent runs the secure-install workflow before installing
any MCP server.

Create `.cursor/rules/secure-agent-install.mdc`:

```markdown
---
description: Scan content + check requested authority before installing any MCP server or skill.
globs:
  - ".cursor/mcp.json"
  - ".vscode/mcp.json"
  - ".mcp.json"
  - "**/SKILL.md"
alwaysApply: false
---

Before adding or installing any MCP server or agent skill:

1. Run SkillSpector on the package content yourself; save its report.
2. Ask CallLint whether the requested authority is acceptable, attaching that report:
     npx -y calllint trust prepare <target> --evidence skillspector-report.json
   (or: npx -y calllint scan <mcp.json> --evidence skillspector-report.json)
3. Read the joint Trust Packet — content scan vs authority scan, shown unmerged.
4. Install only after approval: SAFE → continue; REVIEW → ask; BLOCK → stop;
   UNKNOWN → gather more evidence (never treat as SAFE).
```

CallLint is offline by default, never executes the server it judges, and installs
nothing on its own. This skill is open and neutral; it is not affiliated with or endorsed
by SkillSpector.
