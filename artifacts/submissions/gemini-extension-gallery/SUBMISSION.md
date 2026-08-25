# `gemini-cli` → `gemini-extension-gallery` (ROI #6, P2)

The only actionable channel whose material gap is not a form field: it needs a **GitHub repo
topic**, because the gallery discovers extensions automatically rather than reviewing
submissions.

Identity, copy, and assets: [MATERIALS.md](../MATERIALS.md). Do not retype them here.

## Where

Official source recorded in the SSOT: https://geminicli.com/docs/extensions/

The SSOT note on this channel reads: *auto-discovery via GitHub topic + manifest*. Read that
page for the exact topic string and the manifest shape it expects — both are upstream facts
that can change, and neither is recorded here on purpose.

## The one action

Adding a topic to `calllint/calllint` is a **repository settings change on a public repo**,
not a file edit. It is outward-facing and it is a human action; new18 §87 puts it outside
what an agent may do. Nothing in this repo needs to change for it.

Whether the extension manifest Gemini expects is satisfied by an existing file or needs a new
one is the thing to determine from the docs page before touching repo settings — if a
manifest is required and missing, the topic alone will surface a repo the gallery cannot
index.

## Recording the outcome

Per [README.md](../README.md): edit only the SSOT, then regenerate. This channel is
`gemini-cli` → `gemini-extension-gallery`.

Auto-discovery makes the timing different from every other row: the topic being set is not
the same fact as the extension appearing in the gallery. Record the topic as done, and leave
the state at `AUDIT_REQUIRED` until you have seen the listing — an unverified listing is not
`AVAILABLE`.
