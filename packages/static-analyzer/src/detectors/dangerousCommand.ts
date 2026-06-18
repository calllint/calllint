import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"
import { SHELL_COMMANDS } from "@calllint/resolver"

/** Inline-exec flags that run an arbitrary string. */
const INLINE_EXEC_FLAGS = new Set(["-c", "-e", "--eval", "--command"])

/**
 * Commands for which an inline-exec flag actually means "evaluate this string"
 * (e.g. `node -e`, `python -c`, `ruby -e`, `deno eval`). For wrapper commands
 * like `docker`/`podman`/`npx`/`uvx`, the same short flags mean something
 * benign (`docker run -e VAR` passes an environment variable, not code), so
 * matching them there is a false positive. Shell commands are handled
 * separately via SHELL_COMMANDS and do not depend on this set.
 */
const INLINE_EVAL_INTERPRETERS = new Set([
  "node",
  "nodejs",
  "deno",
  "bun",
  "python",
  "python2",
  "python3",
  "ruby",
  "perl",
  "php",
])

/**
 * Flags arbitrary command execution configured directly in the server command
 * (T05): a shell command, or an interpreter invoked with an inline-eval flag.
 * Critical blocker.
 */
export function detectDangerousCommand(ctx: DetectorContext): Finding[] {
  const { server } = ctx
  const command = server.command
  if (!command) return []

  const cmd = command.toLowerCase()
  const evidence: Evidence[] = []
  let reason: string | undefined

  if (SHELL_COMMANDS.has(cmd)) {
    reason = `Server command is a shell (${command}).`
    evidence.push({
      type: "config",
      path: server.sourceConfigPath,
      key: "command",
      value: command,
    })
  }

  // interpreter + inline eval flag (node -e, python -c, ruby -e). Only counts
  // when the command is an actual interpreter — `docker run -e VAR` and
  // `npx -y pkg` use these flags for non-eval purposes.
  if (INLINE_EVAL_INTERPRETERS.has(cmd)) {
    const inlineFlag = server.args.find((a) => INLINE_EXEC_FLAGS.has(a))
    if (inlineFlag) {
      reason = reason ?? `Server runs an inline command via ${command} ${inlineFlag}.`
      evidence.push({
        type: "config",
        path: server.sourceConfigPath,
        key: "args",
        value: inlineFlag,
      })
    }
  }

  if (evidence.length === 0) return []

  return [
    {
      id: "exec.dangerous-command",
      title: "Arbitrary command execution",
      severity: "critical",
      blocker: true,
      symbol: "EXEC",
      riskClass: "S4",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "config-analysis",
      evidence,
      impact:
        reason +
        " An agent invoking this server can run arbitrary commands on the host.",
      fix: "Run a specific, audited entrypoint instead of a shell or inline-eval command.",
      falsePositiveNote:
        "Some wrappers legitimately shell out; confirm the command is fixed and not agent-controllable.",
    },
  ]
}
