# C053 — Clean config + clean project docs under --surface-dir (SAFE, false-positive guard)

## What this is

The **negative companion** to the prompt-surface cases (C046/C051/C052/C054). A clean
pinned `npx clean-mcp@1.0.0` config with a benign `surface/README.md` — ordinary
documentation including legitimate accented UTF-8 (café, naïve, Zürich).

## Verdict: SAFE

Scanned with `--surface-dir surface`, the README has no model-directed phrases and
no hidden/obfuscated content, so `prompt.surface-instructions` does **not** fire and
no `project-docs` report is emitted. Aggregate stays SAFE.

## Why this case matters

It is the **false-positive guard** for the document-surface scanner at the corpus
gate: the same scanner that flags C046/C051/C052/C054 must stay quiet on benign prose
and non-Latin scripts. `allowExtraFindings: false` with `prompt.surface-instructions`
forbidden makes a spurious flag fail the gate.

## Why synthetic

A pure contract seed; no provenance needed (it asserts the absence of a finding).
