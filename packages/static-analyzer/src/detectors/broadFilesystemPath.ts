import type { Evidence, Finding } from "@mcpguard/types"
import type { DetectorContext } from "../context.js"

/** Broad path roots that grant access well beyond a workspace. */
const BROAD_PATHS = [
  "/",
  "~",
  "/Users",
  "/home",
  "/root",
  "/etc",
  "/var",
  "C:\\",
  "C:\\Users",
  "${HOME}",
  "$HOME",
  "%USERPROFILE%",
  "%APPDATA%",
  "%HOMEPATH%",
]

/** A path that is clearly scoped to the current workspace is acceptable. */
function isWorkspaceScoped(arg: string): boolean {
  return (
    arg.includes("${workspaceFolder}") ||
    arg.includes("${workspaceRoot}") ||
    arg === "." ||
    arg === "./"
  )
}

function looksLikeBroadPath(arg: string): boolean {
  if (isWorkspaceScoped(arg)) return false
  for (const p of BROAD_PATHS) {
    if (arg === p) return true
    // home/user roots: e.g. /Users/lucas, C:\Users\lucas
    if (arg.startsWith(p + "/") || arg.startsWith(p + "\\")) return true
  }
  // A bare drive or a single-segment absolute home like /Users/<name>
  if (/^\/Users\/[^/]+\/?$/.test(arg)) return true
  if (/^\/home\/[^/]+\/?$/.test(arg)) return true
  if (/^[A-Za-z]:\\Users\\[^\\]+\\?$/.test(arg)) return true
  return false
}

/**
 * Flags broad local filesystem access granted via command args (T04).
 * Critical blocker: an agent-invoked tool could read sensitive local files.
 */
export function detectBroadFilesystemPath(ctx: DetectorContext): Finding[] {
  const { server } = ctx
  const evidence: Evidence[] = []

  for (const arg of server.args) {
    if (looksLikeBroadPath(arg)) {
      evidence.push({
        type: "config",
        path: server.sourceConfigPath,
        key: "args",
        value: arg,
      })
    }
  }

  if (evidence.length === 0) return []

  return [
    {
      id: "files.broad-path",
      title: "Broad local filesystem access",
      severity: "critical",
      blocker: true,
      symbol: "FILES",
      riskClass: "S2",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "arg-analysis",
      evidence,
      impact:
        "An agent-triggered tool could read private local files outside the project.",
      fix: "Restrict filesystem access to the current workspace, e.g. ${workspaceFolder}.",
      falsePositiveNote:
        "A developer may intentionally grant broad access for a local-only experiment.",
    },
  ]
}
