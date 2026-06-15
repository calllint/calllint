# exec.dangerous-command

Status: Accepted

Risk: Arbitrary command execution.

Verdict impact: Critical blocker → BLOCK when the server command is a shell
(bash/sh/cmd/powershell) or an interpreter invoked with an inline-eval flag
(`-c`, `-e`, `--eval`).

Symbol: EXEC · Risk class: S4 · Mode: OBSERVED

Observed evidence: MCP config `command` / `args`.

Why it matters: An agent invoking this server can run arbitrary commands on the host.

False positives: Some wrappers legitimately shell out; confirm the command is fixed
and not agent-controllable.

Fix: Run a specific, audited entrypoint instead of a shell or inline-eval command.

Golden fixtures:
- block-dangerous-command.json must trigger
- safe-time.json must not trigger
