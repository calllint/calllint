# exec.dangerous-command

Status: Accepted

Risk: Arbitrary command execution.

Verdict impact: Critical blocker → BLOCK when the server command is a shell
(bash/sh/cmd/powershell) or an actual interpreter (node/python/ruby/deno/bun/…)
invoked with an inline-eval flag (`-c`, `-e`, `--eval`, `--command`).

Symbol: EXEC · Risk class: S4 · Mode: OBSERVED

Observed evidence: MCP config `command` / `args`.

Why it matters: An agent invoking this server can run arbitrary commands on the host.

False positives: Some wrappers legitimately shell out; confirm the command is fixed
and not agent-controllable. Inline-eval flags only count for real interpreters:
`docker run -e VAR` (env-var flag) and `npx -y pkg` are not inline eval and do
not trigger this rule.

Fix: Run a specific, audited entrypoint instead of a shell or inline-eval command.

Golden fixtures:
- block-dangerous-command.json (bash -c) must trigger
- block-node-inline-eval.json (node -e) must trigger
- safe-docker-env-flag.json (docker run -e VAR) must not trigger
- safe-time.json must not trigger
