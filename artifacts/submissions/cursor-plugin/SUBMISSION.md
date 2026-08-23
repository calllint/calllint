# `cursor` → `cursor-plugin` (ROI #2, P0)

Second-highest reach. No material gap: `server.json`, README, and logo are all in the tree.

Identity, copy, and assets: [MATERIALS.md](../MATERIALS.md). Do not retype them here.

## Where

Official source recorded in the SSOT: https://cursor.com/marketplace

Confirm the current submission route on that page before doing anything else — whether it is
a form, a GitHub PR against an index repo, or an email. The SSOT records the marketplace
URL, not the intake mechanism, and the mechanism is the part that changes.

## What to paste

- Name, description (short), category, tags — all from [MATERIALS.md](../MATERIALS.md)
- Repository: https://github.com/calllint/calllint
- MCP manifest: `packages/calllint-mcp/server.json`
- README to cite: `packages/calllint-mcp/README.md`
- Logo: `assets/brand/logo-mark-128.png`
- Cursor-specific example config: `examples/mcp-configs/cursor.json`

## Do not

Do not cite `docs/MCP_SERVER.md`. The whole `docs/` tree is gitignored (`.gitignore:44`), so
a reviewer cloning the repo will not find it. `packages/calllint-mcp/README.md` is tracked.

Do not describe CallLint as running, executing, or sandboxing MCP servers — see the claims
section of [MATERIALS.md](../MATERIALS.md).

## Recording the outcome

Per [README.md](../README.md): edit only the SSOT, then regenerate. This channel is `cursor`
→ `cursor-plugin`. If the listing goes live, set `liveUrl` in the same edit — presence and
verification are separate facts and the state records which one you have.
