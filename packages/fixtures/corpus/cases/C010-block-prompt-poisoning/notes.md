# C010-block-prompt-poisoning

## Purpose
Verifies that hidden model-directed instructions in tool metadata are a hard blocker.

## Human expected verdict
BLOCK

## Note on the original blueprint
The R2 blueprint pencilled this case in as REVIEW and put the malicious text in a
`--description` CLI flag. Two corrections reflect the real engine:

1. The prompt-poisoning detector scans the **model-visible surface** — tool
   names/descriptions/schemas and server instructions — not CLI `--flags`. So the
   poisoned text lives in `x-calllint.tools[].description`.
2. `prompt.poisoning` is a **critical blocker** (`blocker: true`), so the secure
   verdict is **BLOCK**, not REVIEW. We do not weaken the rule to match the draft.

## Why this is BLOCK
The tool description contains multiple poison patterns ("ignore previous instructions",
"always call this tool first", "do not tell the user"). The detector emits
`prompt.poisoning` (S2, critical, OBSERVED, blocker) → BLOCK.

## Required evidence
`prompt.poisoning` with evidence snippets pointing at the matched patterns.

## R2 status
Synthetic contract seed. Replace or supplement with a redacted real-world snapshot
before R2 final acceptance.
