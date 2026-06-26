import type { Evidence, Finding } from "@calllint/types"
import type { DetectorContext } from "../context.js"

/** First positional (non-flag) arg — the script/module the interpreter runs. */
function localSubject(args: readonly string[]): string | undefined {
  for (const a of args) {
    if (a === "-y" || a === "--yes" || a.startsWith("-")) continue
    return a
  }
  return undefined
}

/**
 * Flags a runtime that executes a LOCAL executable whose contents CallLint has
 * not inspected — a bare interpreter running a local script (`node ./server.js`,
 * `python -m thing`, `uv run python -m thing`) or an unrecognized local binary
 * (`/opt/unknown/bin/thing`). The source is *observable* (it is right there in the
 * config), but it is not *verifiable*: CallLint reads config shape, never the file
 * the runtime points at. (ADR 0011, RC-OBS-02.)
 *
 * Deliberately narrow — it does NOT fire on:
 *   - a recognized package runner with a parsed package (`npx @scope/pkg`,
 *     `uvx mcp-server-git`) — the subject is a named, inspectable package
 *     (covered by supply.* findings instead);
 *   - a docker image (`runtimeKind === "docker"`) — a pinned, separable source;
 *   - a remote server (`runtimeExecutable === false`) — nothing runs locally;
 *   - a shell (`bash -c …`) — `sourceKnown` is false there, so it is already
 *     UNKNOWN and is the dangerous-command detector's surface, not this one.
 *
 * REVIEW, not BLOCK: the verdict asks a human to confirm the local source, it does
 * not assert the source is dangerous. SAFE stays reachable only for recognized,
 * inspectable sources (packages, pinned images, allowlisted remotes).
 */
export function detectUnverifiedLocalSource(ctx: DetectorContext): Finding[] {
  const { binding, server } = ctx

  // Only sources we positively recognize can be SAFE; an unrecognized source is
  // already UNKNOWN (ADR 0010) and not this finding's concern.
  if (!binding.sourceKnown) return []
  // A fixed remote URL runs no local code.
  if (!binding.runtimeExecutable) return []
  // A docker image is a recognized, separately-addressable source.
  if (binding.runtimeKind === "docker") return []
  // A recognized package runner with a parsed package name is inspectable by name.
  if (binding.packageName) return []

  const command = binding.declaredCommand ?? server.command
  if (!command) return []

  const subject = localSubject(binding.declaredArgs)
  const display = subject ? `${command} ${subject}` : command

  const evidence: Evidence[] = [
    {
      type: "runtime-binding",
      path: server.sourceConfigPath,
      key: "command",
      value: display,
    },
  ]

  return [
    {
      id: "exec.unverified-local-source",
      title: "Runs an unverified local executable",
      severity: "medium",
      blocker: false,
      symbol: "EXEC",
      riskClass: "S2",
      mode: "OBSERVED",
      confidence: "medium",
      detectionMethod: "runtime-binding",
      evidence,
      impact:
        "The runtime executes a local script or binary whose contents CallLint never inspects. It is not a recognized package or pinned image, so what actually runs cannot be verified from the config alone.",
      fix: "Confirm you trust the local source, or run it from a pinned, recognized package (e.g. npx pkg@1.2.3 / a pinned docker image) so the runtime is independently verifiable.",
      falsePositiveNote:
        "A developer running their own local server (e.g. node ./dist/server.js) is normal; this flags that the source is not independently verifiable, not that it is malicious.",
    },
  ]
}
