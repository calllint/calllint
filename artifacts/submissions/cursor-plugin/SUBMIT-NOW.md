# cursor-plugin — the one real form, ready to submit

Everything verifiable from this machine is verified. What remains is one URL paste, which
requires a browser session and an account — the two things new18 §22 keeps out of my hands.

**Verified 2026-08-25.** Do not redo any of it.

## What you do

1. Open **https://cursor.com/marketplace/publish**
   (`/marketplace` alone is the browse page, not the intake.)
2. Paste the repo URL: **`https://github.com/calllint/calllint`**
3. Submit. That is the whole form.
4. Expect a review, not an instant listing — Cursor's own words: *"All plugins must be open
   source, and we review each update before publishing."*

There are **no fields to fill in**. Name, description, category, tags, license and homepage
are all read from `plugins/calllint/.cursor-plugin/plugin.json`, so nothing needs to be typed
from `MATERIALS.md`.

## Why nothing else is needed

| checked | result |
|---|---|
| manifest validates | Cursor's own `validate-template.mjs` → passed; the validator was itself checked by breaking `name` and watching it reject |
| local install | NTFS junction into `~/.cursor/plugins/local/`; every manifest path resolves **through the link**, hook runs at Cursor's cwd, exit 0 |
| `logo` path resolves | `plugins/calllint/assets/logo-mark-128.png`, 10 968 bytes, git-tracked |
| hook event casing | `hooks/cursor-hooks.json` uses `preToolUse` (lowerCamel). Claude's `hooks/hooks.json` keeps `PreToolUse`. Two files on purpose — one file cannot serve both |
| all materials committed | 7 files under `.cursor-plugin/` + `hooks/`, all in `git ls-files` |

The casing split is the defect worth remembering: Cursor discovers `hooks/hooks.json` **by
default**, so a single Claude-shaped file would have matched no key and **silently never
fired** — exit 0, empty stderr. Cursor's validator only checks that a hooks file exists, never
its event names.

## After it goes live

Edit **only** the SSOT, then regenerate:

```bash
# apps/web/data/distribution-surfaces.json → cursor / cursor-plugin
#   state:   "AVAILABLE"
#   liveUrl: "https://cursor.com/marketplace/<slug>"   ← the real listing URL
#   submission: { "date": "<the day you submitted>" }
node scripts/generate-distribution-surfaces.mjs
pnpm check:distribution-drift
pnpm check:harness-distribution
```

Three things the gates will enforce, so getting them wrong fails loudly rather than silently:

- `liveUrl` must be `https://` — and it may **only** sit under `AVAILABLE` (schema arm 2).
  A pending state with a live URL is rejected.
- `AVAILABLE` on a shelf channel **requires** `liveUrl`; this family carries no `upstream`
  arm. Flipping the state alone is exactly the 2026-08-23 defect that passed all four gates
  green before the evidence rule existed.
- `submission.date` must be the day **you acted**, not the day you recorded it (ADR 0002).
  HD-08 rejects a future date and a non-calendar day.

If it is **rejected**, that is `state: BLOCKED` plus a `blocker` naming the reason — HD-05
checks that pairing in both directions.
