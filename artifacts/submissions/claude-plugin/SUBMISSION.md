# `claude-code` → `claude-plugin` (ROI #1, P0)

Highest reach of the actionable rows. The plugin itself was finished for months; what was
missing was the shelf manifest, so there was no way for anyone to install it. That gap closed
on 2026-08-23.

Identity, copy, and assets: [MATERIALS.md](../MATERIALS.md). Do not retype them here.

## Where

Official docs: https://code.claude.com/docs/en/plugin-marketplaces

Claude Code has no central marketplace to submit to. Distribution is by **users adding this
repository as a marketplace**, so "submitting" here means publishing the install line and
getting it in front of people — a README section, a release note, a directory of
marketplaces. There is no form and no review queue.

## What a user runs

```
/plugin marketplace add calllint/calllint
/plugin install calllint@calllint
```

The first command reads `.claude-plugin/marketplace.json` at the repo root; the second
resolves `./plugins/calllint` relative to it.

## Pre-flight

```bash
claude plugin validate . --strict          # must pass
claude plugin tag plugins/calllint --dry-run   # must report 0.1.0 (from plugin.json)
```

`--strict` does **not** look inside the `source` object — an unknown key there produces no
warning. So a passing validation is not evidence the source resolves. The relative form
`./plugins/calllint` is what the docs prescribe when the plugin lives in the same repo as
the marketplace, and it is what `plugin tag` resolves.

One caveat worth knowing before you publish the line: a relative source resolves against
the marketplace root, which works for `marketplace add <owner>/<repo>` because the whole
repo is fetched. It does **not** work if someone adds the marketplace by direct URL to
`marketplace.json` alone — only that one file gets fetched. Publish the `owner/repo` form,
not a raw URL.

## Do not

Do not put a `version` field in the marketplace entry. When `marketplace.json` and
`plugin.json` disagree, `plugin.json` wins **silently** — the marketplace number is not
validated against it, so a stale copy misreports the version with no error anywhere.

## Recording the outcome

Per [README.md](../README.md): edit only the SSOT, then regenerate. This channel is
`claude-code` → `claude-plugin` in `apps/web/data/distribution-surfaces.json`.
