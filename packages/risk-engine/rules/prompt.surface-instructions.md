# prompt.surface-instructions

Status: Accepted (ADR 0015, R4 local-document prompt surface)

Risk: Model-directed or hidden/obfuscated content in a project document that
ships alongside an MCP server and is read by humans and agents but never appears
in the scanned config.

Verdict impact: Non-blocker → REVIEW when `calllint scan --surface-dir <dir>`
reads a bounded, offline allowlist of project documents and one of them contains
model-directed phrasing (the `prompt.poisoning` phrase set) or hidden/obfuscated
content (the `prompt.hidden-instructions` category set). Default behaviour is
unchanged — with no `--surface-dir`, nothing beyond the config is read and this
finding cannot fire.

Symbol: PROMPT · Risk class: S2 · Mode: OBSERVED · Severity: medium

Observed evidence: the scanned document surface — `README.md`, `SKILL.md`,
`AGENTS.md`, and the `description` field of `package.json` — read by the CLI
(never the core) from the directory passed to `--surface-dir`. Evidence reports
the surface kind (the file) and the phrase/category; it never reproduces raw
hidden bytes. Bounded: 256 KiB per file, named allowlist only, no globbing,
no recursion, no symlink following, offline, never executed.

Why it matters: a prompt-surface payload hidden in a README reaches any agent
that reads project docs alongside the tool, yet a human reviewer skims past it.
This is the project-document analogue of `prompt.poisoning` /
`prompt.hidden-instructions` (which read the config's tool metadata); the three
detectors share one scanner module so docs and metadata flag identically.

Scope (ADR 0015): offline project documents only. Registry metadata (npm/PyPI
description, keywords) and a server's remote README are network input and
therefore an `--online` concern (advisory per ADR 0006) — the next R4 increment,
not this one. Static shape detection only — it does not claim to detect prompt
injection or infer intent.

False positives: documentation legitimately discusses prompts, tool ordering, or
includes HTML comments and non-Latin scripts. The finding flags prompt-surface
shape in project docs, not a proven injection; review the cited file in context.
The `falsePositiveNote` carries this.

Fix: remove model-directed instructions and hidden/obfuscated characters from
project documents; keep their visible text equal to their intent.

Golden fixtures: none in `GOLDEN_CASES` — this finding reads CLI-supplied
surfaces, not a single config file, so it is exercised by the
`documentSurface.test.ts` unit suite and corpus cases C046 / C051 / C052 / C054
(positive) and C053 (negative, clean docs must not fire) instead.
