# `copilot-cli` → `github-copilot-plugin` (ROI #3, P2)

Like Windsurf, the intake route is the unknown — and after measuring it on 2026-08-25, it is
**still** the unknown, but the shape of the unknown is now known: there are two candidate
routes and no evidence that either is *the* intake. The earlier "No material gap" line is
removed because it read as *ready to submit*; nothing here is ready until a route is
confirmed.

Identity, copy, and assets: [MATERIALS.md](../MATERIALS.md). Do not retype them here.

## Where — two candidates, neither confirmed

This channel has **no `officialSource` in the SSOT**, and this file will not invent one.
Record it as `officialSource` on this channel in the same edit that records the outcome.

Note this is a *different channel from the same host* than ROI #4
(`copilot-cli` → `mcp-registry-discovery`), which is verify-only and needs no submission.
Do not conflate them: one asks whether Copilot CLI consumes the Official MCP Registry (a
GET an agent may perform), this one is a plugin listing (a human action). The two can be
true independently.

### Candidate A — self-hosted, no submission at all

Copilot CLI has a real plugin system. A user adds a marketplace themselves:

```bash
copilot plugin marketplace add calllint/calllint
```

The CLI reads `.github/plugin/marketplace.json` **and also** looks for `marketplace.json` in
`.claude-plugin/`, with the same `source`-path semantics — and this repo already ships
`.claude-plugin/marketplace.json`. If that holds on a real install, this channel needs no
submission and no new artifact; it needs a **verification** that the add command works, then
`AVAILABLE` with the install command as its evidence.

Verify with: `copilot plugin install ./plugins/calllint`, `copilot plugin list`, `/plugin list`.

Caveat, measured: Copilot's own bundled plugins use `plugins/<name>/plugin.json` — the
manifest at the **plugin root**, not under `.claude-plugin/`. Ours is
`plugins/calllint/.claude-plugin/plugin.json`. The marketplace file is documented as dual-path;
the *plugin manifest* may not be. That is the one thing to check first, because it decides
whether candidate A costs nothing or costs a second manifest. (The two doc pages that would
settle it — `docs.github.com/en/copilot/concepts/agents/plugins` and
`.../how-tos/provide-context/use-plugins` — both 404 as of 2026-08-25.)

### Candidate B — a PR to the official collection

`github/copilot-plugins` ("The official GitHub Copilot plugins collection", 345★) does carry
**external** entries pointing at other repos, so a listing there is structurally possible.
The entry shape, read from its `.claude-plugin/marketplace.json`:

```json
{ "name": "calllint", "description": "…", "version": "0.1.0",
  "author": { "name": "saintL", "url": "https://calllint.com" },
  "homepage": "https://calllint.com",
  "keywords": ["mcp", "security", "audit", "preflight", "agent-tools"],
  "license": "Apache-2.0", "repository": "https://github.com/calllint/calllint",
  "source": { "source": "github", "repo": "calllint/calllint", "path": "plugins/calllint" } }
```

Two reasons this is not simply "the route": its `CONTRIBUTING.md` is the generic GitHub
template with **no plugin intake process** in it, and its README still marks MCP servers
*(coming soon)*. Opening a PR against a collection that has not declared it accepts
submissions of this kind is a guess, not a submission.

## What to submit

Nothing, until a route is confirmed. Candidate A is a verification (agent-safe: it is a local
install, no credentials, no form post). Candidate B is a PR — a human action under new18 §22,
and one worth an issue asking whether external MCP plugins are accepted *before* opening it.

If a route is confirmed and asks for fields: name, description (short), category, tags all
come from [MATERIALS.md](../MATERIALS.md); repository https://github.com/calllint/calllint;
MCP manifest `packages/calllint-mcp/server.json`; README `packages/calllint-mcp/README.md`;
logo `assets/brand/logo-mark-128.png`; closest example config `examples/mcp-configs/vscode.json`.

## Do not

Do not describe CallLint as running, executing, or sandboxing MCP servers — see the claims
section of [MATERIALS.md](../MATERIALS.md).

Do not record this channel as `AVAILABLE` on the strength of candidate A being *documented*.
A documented dual path and a working `copilot plugin marketplace add` are two different
facts, which is the same distinction that keeps every `mcp-stdio` channel at
`AUDIT_REQUIRED`.

## Recording the outcome

Per [README.md](../README.md): edit only the SSOT, then regenerate. This channel is
`copilot-cli` → `github-copilot-plugin` — make sure you edit that entry and not the
`mcp-registry-discovery` one directly above or below it.
