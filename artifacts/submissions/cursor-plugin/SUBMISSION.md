# `cursor` → `cursor-plugin` (ROI #2, P0)

Second-highest reach. **Materials are now complete and validated** — see below. The note here
originally said "No material gap: `server.json`, README, and logo are all in the tree." Those
three files are real, but they are not the files Cursor reads, so that sentence was answering
the wrong question. Corrected 2026-08-25 by reading Cursor's published requirements, measuring
this repo against them, then building what was missing and validating it with Cursor's own
validator.

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

## The gap — CLOSED 2026-08-25

Cursor requires, at the plugin directory:

- `.cursor-plugin/plugin.json` — only `name` is required; optional `displayName`,
  `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`,
  `logo`, and the component-path fields `rules`, `skills`, `agents`, `commands`, `hooks`,
  `mcpServers`, `variables`. (An Agent-Plugin root `plugin.json` with
  `$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` is also accepted.)
- `mcp.json` at the **plugin root**, with a top-level `mcpServers` map. Cursor's style omits
  `type` and infers the transport from `command` / `url`. Not strictly required — Cursor's own
  validator emits a *warning*, not an error, "only needed when using MCP servers" — but we do
  ship an MCP server, so it belongs here.
- The logo committed and referenced **relatively**; Cursor resolves it to
  `raw.githubusercontent.com` by repo + commit SHA. Relative paths may not contain `..` or be
  absolute, which the validator enforces.
- A multi-plugin repo registers each plugin in `.cursor-plugin/marketplace.json` at the repo
  root (required `name`, `owner.name`, `plugins`; max 500). `source` is the path from the repo
  root to the plugin folder, and its `name` must equal the plugin manifest's `name`.

All of that now exists. Added:

| File | Why |
|---|---|
| `.cursor-plugin/marketplace.json` | repo-root registry; without it Cursor cannot locate the plugin |
| `plugins/calllint/.cursor-plugin/plugin.json` | the manifest Cursor reads |
| `plugins/calllint/mcp.json` | the `calllint-mcp` stdio server, Cursor's shape |
| `plugins/calllint/assets/logo-mark-128.png` | byte-identical copy of `assets/brand/logo-mark-128.png`; a `../` reference is rejected |
| `plugins/calllint/hooks/cursor-hooks.json` | Cursor's `preToolUse` wiring — see below |
| `plugins/calllint/hooks/preflight-cursor.mjs` | Cursor's output envelope over the shared core |

Verified with Cursor's own validator (`scripts/validate-template.mjs` from
`github.com/cursor/plugin-template`, fetched and run against this tree): **Validation passed.**
Confirmed it actually observes our plugin by breaking the manifest `name` and watching it
reject — a validator that passes on an unread tree proves nothing.

### The one thing that was not a file

Cursor's hook events are lowerCamel (`preToolUse`, `afterFileEdit`, `beforeShellExecution`, …);
Claude's are PascalCase (`PreToolUse`). Cursor discovers `hooks/hooks.json` by default, so it
would have read our Claude-shaped file, found no key it recognizes, and **silently never fired** —
the hook computing a recommendation nobody ever sees. Cursor's validator does not catch this: it
checks only that a hooks file exists, never the event names.

Putting both spellings in one file was the obvious fix and it does **not** work: `claude plugin
tag` rejects it with `hooks.preToolUse: Invalid key in record`, because Claude validates hook
keys against an enum. So the two are split — Claude keeps `hooks/hooks.json` (its default
discovery path), and Cursor is pointed at `hooks/cursor-hooks.json` via the manifest's `hooks`
field. Both validators pass; `tests/invariants/preflight-hook-non-blocking.invariants.test.ts`
pins the split, and a negative control confirms reintroducing the merged shape fails both the
test and the real `claude plugin tag`.

The Cursor edge holds ADR 0051's floor restated in Cursor's blocking vocabulary: it emits no
`permission` field (Cursor's `preToolUse` is the one hook that *can* veto a write), no
`updated_input`, always exits 0 (Cursor equates exit 2 with a deny), and `failClosed` is left
unset so a crash fails **open**. The decision itself is unchanged — same `preflightFor`, same
vocabulary, no second verdict path.

## What to submit

A repo URL: https://github.com/calllint/calllint

Everything else Cursor reads from the repo. Name, description, category, tags, license,
homepage all live **in the manifest**, not in a form field. Cursor's checklist also asks that
the plugin "has been tested locally" — route:
`ln -s /path/to/plugins/calllint ~/.cursor/plugins/local/calllint`. That is a local install on
your own machine, so it is yours to run, not something this repo can assert.

## Do not

Do not cite `docs/MCP_SERVER.md`. The whole `docs/` tree is gitignored (`.gitignore:44`), so
a reviewer cloning the repo will not find it. `packages/calllint-mcp/README.md` is tracked.

Do not describe CallLint as running, executing, or sandboxing MCP servers — see the claims
section of [MATERIALS.md](../MATERIALS.md).

Do not hand-write `.cursor-plugin/plugin.json` by copying the Claude manifest. The two
schemas overlap but are not the same, and a manifest that merely parses is not one Cursor
accepts. (Concretely: the hook-event keys differ, and merging them breaks Claude.)

## Recording the outcome

Per [README.md](../README.md): edit only the SSOT, then regenerate. This channel is `cursor`
→ `cursor-plugin`. If the listing goes live, set `liveUrl` in the same edit — presence and
verification are separate facts and the state records which one you have.
