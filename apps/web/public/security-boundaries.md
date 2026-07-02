# CallLint security boundaries

A clean scan is necessary, not sufficient.

## What CallLint does

- Statically reads MCP and agent-tool configuration before the server runs.
- Returns `SAFE` / `REVIEW` / `BLOCK` / `UNKNOWN` with evidence for each finding.
- Runs deterministically and offline by default (no model, clock, or network in
  the decision path).
- Treats tool names, descriptions, and schemas as attacker-controllable input.

## What CallLint does not do

- It does not execute MCP servers.
- It does not sandbox runtime behavior.
- It does not inspect server source code.
- It does not read secret values (it inspects config shape — key names — never
  your `.env`).
- It does not certify third-party tools.
- It does not replace code review.
- It does not guarantee zero false positives or false negatives.

## How to use it well

Use CallLint before execution. Pair it with least-privilege tokens, code
review, sandboxing, and runtime controls. Treat `REVIEW` and `BLOCK` as the
start of a review, and never treat `UNKNOWN` as `SAFE`.

CallLint offers heuristic decision support, not
a safety guarantee.

See also the full project docs:
[LIMITATIONS.md](https://github.com/calllint/calllint/blob/main/LIMITATIONS.md)
and [SECURITY.md](https://github.com/calllint/calllint/blob/main/SECURITY.md).
