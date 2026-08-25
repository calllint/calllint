# `cursor` → `cursor-plugin` (ROI #2, P0)

Second-highest reach. **There is a material gap** — see below. The earlier note here said
"No material gap: `server.json`, README, and logo are all in the tree." Those three files are
real, but they are not the files Cursor reads, so that sentence was answering the wrong
question. Corrected 2026-08-25 by reading Cursor's published checklist and then measuring
this repo against it.

Identity, copy, and assets: [MATERIALS.md](../MATERIALS.md). Do not retype them here.

## Where

Official source recorded in the SSOT: https://cursor.com/marketplace

That URL is the **browse** page. Intake is https://cursor.com/marketplace/publish (verified
2026-08-25 — the page itself renders client-side and shows only "Loading…" to a fetch, so the
requirements below come from `https://cursor.com/docs/reference/plugins.md`, which carries the
same checklist as text).

The mechanism: submissions are **public Git repos reviewed by the Cursor team**. Quoting the
docs — "All plugins must be open source, and we review each update before publishing." So
there is no form to paste a manifest into; you submit a repo URL and Cursor reads the repo.
This is why the "What to paste" list below was the wrong shape.

## The gap, measured

Cursor requires, at the plugin directory:

- `.cursor-plugin/plugin.json` — only `name` is required; optional `description`, `version`,
  `author`, `homepage`, `repository`, `license`, `keywords`, `logo`, `rules`, `agents`,
  `skills`, `commands`, `hooks`, `mcpServers`, `variables`. (An Agent-Plugin root
  `plugin.json` with `$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
  is also accepted.)
- `mcp.json` at the **plugin root**, with a top-level `mcpServers` map. Cursor's style omits
  `type` and infers the transport from `command` / `url`.
- The logo committed and referenced **relatively** — Cursor resolves it to
  `raw.githubusercontent.com` by repo + commit SHA.
- A multi-plugin repo instead uses `.cursor-plugin/marketplace.json` (required `name`,
  `owner`, `plugins`; max 500).

What this repo has today (`find plugins/calllint -type f`, 2026-08-25):
`plugins/calllint/.claude-plugin/plugin.json`, `hooks/`, `skills/`, `README.md`. No
`.cursor-plugin/` anywhere, and `grep -rl mcpServers plugins/` returns nothing — so no
`mcp.json` either. Both required files are absent.

Cursor's checklist also asks that "Plugin has been tested locally", that no path contains
`..` or is absolute, and that every `${VAR}` used in `mcp.json` is declared in the manifest
schema. Local test route: `ln -s /path/to/my-plugin ~/.cursor/plugins/local/my-plugin`.

## What to submit

A repo URL, once the two files above exist: https://github.com/calllint/calllint

Everything else Cursor needs it reads from the repo. Name, description, category, tags,
license, homepage all come from [MATERIALS.md](../MATERIALS.md) and belong **in the
manifest**, not in a form field. `examples/mcp-configs/cursor.json` is a useful starting
point for the `mcpServers` block but is not itself the file Cursor loads.

## Do not

Do not cite `docs/MCP_SERVER.md`. The whole `docs/` tree is gitignored (`.gitignore:44`), so
a reviewer cloning the repo will not find it. `packages/calllint-mcp/README.md` is tracked.

Do not describe CallLint as running, executing, or sandboxing MCP servers — see the claims
section of [MATERIALS.md](../MATERIALS.md).

Do not hand-write `.cursor-plugin/plugin.json` by copying the Claude manifest. The two
schemas overlap but are not the same, and a manifest that merely parses is not one Cursor
accepts.

## Recording the outcome

Per [README.md](../README.md): edit only the SSOT, then regenerate. This channel is `cursor`
→ `cursor-plugin`. If the listing goes live, set `liveUrl` in the same edit — presence and
verification are separate facts and the state records which one you have.
