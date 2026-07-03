# CallLint MCP Configuration Examples

**Ready-to-use MCP config snippets for installing CallLint across different clients.**

## Quick Start

Copy the appropriate config for your client:

### Claude Desktop

**Config location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Config:**
```jsonc
{
  "mcpServers": {
    "calllint": {
      "command": "npx",
      "args": ["-y", "calllint-mcp"]
    }
  }
}
```

See: [`claude-desktop.json`](./claude-desktop.json)

---

### Cursor

**Config location:** `.cursor/mcp.json` in workspace root

**Config:**
```jsonc
{
  "mcpServers": {
    "calllint": {
      "command": "npx",
      "args": ["-y", "calllint-mcp"]
    }
  }
}
```

See: [`cursor.json`](./cursor.json)

---

### Claude Code

**Config location:** `.claude/mcp.json` in workspace root (optional — CallLint tools available by default)

**Config:**
```jsonc
{
  "mcpServers": {
    "calllint": {
      "command": "npx",
      "args": ["-y", "calllint-mcp"]
    }
  }
}
```

See: [`claude-code.json`](./claude-code.json)

---

### VS Code (with MCP extension)

**Config location:** `.vscode/mcp.json` in workspace root

**Config:**
```jsonc
{
  "mcpServers": {
    "calllint": {
      "command": "npx",
      "args": ["-y", "calllint-mcp"],
      "env": {}
    }
  }
}
```

See: [`vscode.json`](./vscode.json)

---

### Windsurf

**Config location:** `.windsurf/mcp.json` in workspace root

**Config:**
```jsonc
{
  "mcpServers": {
    "calllint": {
      "command": "npx",
      "args": ["-y", "calllint-mcp"]
    }
  }
}
```

See: [`windsurf.json`](./windsurf.json)

---

## Usage

After adding CallLint to your MCP config:

1. **Restart your client** (Claude Desktop, Cursor, etc.)
2. **Verify installation**: Ask your agent "List available MCP tools"
3. **Scan a config**: Ask your agent to scan an MCP config file

### Example prompts

```
Scan my MCP config at ~/.config/Claude/claude_desktop_config.json
```

```
Use calllint to check this server config before we add it:
{
  "mcpServers": {
    "new-server": {
      "command": "npx",
      "args": ["-y", "some-package@latest"]
    }
  }
}
```

```
Before installing that MCP server, run a CallLint scan to check for risks.
```

---

## What CallLint Checks

- 🔐 **Secrets**: Credential-shaped env keys (`API_KEY`, `TOKEN`, etc.)
- 📁 **Files**: Broad filesystem access (`/`, `~`, home directory)
- 🌐 **Network**: Unknown or unpinned remote hosts
- 🧠 **Prompt**: Hidden model-directed instructions
- ⚙️ **Exec**: Shell commands, unverified local scripts
- ✉️ **Action**: External mutations (email, messages, posts)
- 💸 **Money**: Payment or financial actions
- 🧩 **Supply**: Unpinned packages (`@latest`) — rug-pull risk

---

## Verdicts

| Verdict | Meaning |
|---------|---------|
| `SAFE` | No blockers observed (not a guarantee — pair with code review) |
| `REVIEW` | Human judgment required before use |
| `BLOCK` | Dangerous surface detected — do not use without mitigation |
| `UNKNOWN` | Cannot verify statically — treat as not-safe |

`UNKNOWN` is never treated as `SAFE`. A clean run means no blockers were observed, not that the server is proven safe.

---

## Requirements

- **Node.js**: >= 20
- **Internet**: Required for first `npx` run (package is cached afterward)
- **npm package**: `calllint-mcp@0.1.1` or later

---

## Alternative: Global Installation

If you prefer not to use `npx`:

```bash
npm install -g calllint-mcp
```

Then update your config to use the global binary:

```jsonc
{
  "mcpServers": {
    "calllint": {
      "command": "calllint-mcp"
    }
  }
}
```

---

## Links

- **Documentation**: https://github.com/calllint/calllint#readme
- **npm (MCP server)**: https://www.npmjs.com/package/calllint-mcp
- **npm (CLI)**: https://www.npmjs.com/package/calllint
- **Homepage**: https://calllint.com
- **Install Guide**: [docs/INSTALL_CLIENTS.md](../../docs/INSTALL_CLIENTS.md)
