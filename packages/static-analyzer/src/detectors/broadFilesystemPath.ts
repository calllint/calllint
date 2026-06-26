import type { Evidence, Finding } from "@calllint/types"
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
 * Does this string look like a host filesystem path (vs a docker named volume)?
 * A bind mount's host side is an absolute/home/env-rooted path; a named volume
 * (`myvolume:/container`) is a bare identifier with no path root and must NOT be
 * treated as a host path. We only extract a path-shaped source so named volumes,
 * container-internal destinations, and image refs stay invisible to the broad
 * check. (ADR 0012)
 */
function looksLikeHostPath(s: string): boolean {
  if (!s) return false
  return (
    s.startsWith("/") || // POSIX absolute (incl. /Users, /home, /etc, ...)
    s.startsWith("~") || // home
    s.startsWith(".") || // workspace-relative (handled as not-broad by isWorkspaceScoped/below)
    /^[A-Za-z]:[\\/]/.test(s) || // Windows drive, C:\ or C:/
    s.startsWith("$") || // $HOME / ${HOME}
    s.startsWith("%") // %USERPROFILE% / %APPDATA%
  )
}

/**
 * Extract the HOST-side path(s) a docker `run` invocation binds into the
 * container, from the two mount syntaxes docker accepts:
 *
 *   --mount type=bind,src=<host>,dst=<container>[,ro]   (CSV key=value; only bind)
 *   -v|--volume <host>:<container>[:opts]               (colon-separated)
 *
 * Only the host side is returned — never the container `dst`, never a named
 * volume source, never the image ref or the container-internal positional path.
 * The broad-path check then runs on the host side exactly as it does for a plain
 * path arg, so `--mount type=bind,src=/Users/me/Desktop,...` is flagged while a
 * named volume (`-v claude-memory:/app`) or container path (`/projects`) is not.
 */
function extractDockerHostPaths(args: readonly string[]): string[] {
  const hosts: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!

    // --mount type=bind,src=<host>,dst=<container>[,opts] — value may be the
    // next token (`--mount`, `<csv>`) or inline (`--mount=<csv>`).
    if (arg === "--mount" || arg.startsWith("--mount=")) {
      const csv = arg === "--mount" ? (args[i + 1] ?? "") : arg.slice("--mount=".length)
      if (arg === "--mount") i += 1
      const fields = new Map<string, string>()
      for (const part of csv.split(",")) {
        const eq = part.indexOf("=")
        if (eq === -1) continue
        fields.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
      }
      // Only bind mounts have a host path; volume/tmpfs mounts do not.
      const type = fields.get("type") ?? "volume"
      if (type !== "bind") continue
      const src = fields.get("source") ?? fields.get("src")
      if (src && looksLikeHostPath(src)) hosts.push(src)
      continue
    }

    // -v|--volume <host>:<container>[:opts] — value may be the next token or
    // inline (`-v=<spec>` / `--volume=<spec>`).
    let spec: string | undefined
    if (arg === "-v" || arg === "--volume") {
      spec = args[i + 1]
      i += 1
    } else if (arg.startsWith("-v=")) {
      spec = arg.slice("-v=".length)
    } else if (arg.startsWith("--volume=")) {
      spec = arg.slice("--volume=".length)
    }
    if (spec === undefined) continue
    // Split off the host side. A leading Windows drive (C:\...) itself contains a
    // colon, so find the separator that divides host from container: the first
    // colon that is not the drive-letter colon.
    const host = dockerVolumeHostSide(spec)
    if (host && looksLikeHostPath(host)) hosts.push(host)
  }
  return hosts
}

/** The host side of a `-v host:container[:opts]` spec, drive-letter aware. */
function dockerVolumeHostSide(spec: string): string | undefined {
  // Windows host path like C:\Users\me:/data — the first colon is the drive.
  const winDrive = /^[A-Za-z]:[\\/]/.test(spec)
  const searchFrom = winDrive ? 2 : 0
  const sep = spec.indexOf(":", searchFrom)
  if (sep === -1) return undefined // no container side → not a bind we parse
  return spec.slice(0, sep)
}

/**
 * Flags broad local filesystem access granted via command args (T04), including
 * docker bind-mount host paths (`--mount type=bind,src=...`, `-v host:container`)
 * per ADR 0012. Critical blocker: an agent-invoked tool could read sensitive
 * local files — directly via a path arg, or via a broad host directory bound
 * into a container.
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

  // Docker bind mounts hide the host path inside a compound arg; extract and
  // check the host side only (ADR 0012). Container dst paths and named volumes
  // are never surfaced here, so they cannot produce a false positive.
  if ((server.command ?? "").toLowerCase() === "docker") {
    for (const host of extractDockerHostPaths(server.args)) {
      if (looksLikeBroadPath(host)) {
        evidence.push({
          type: "config",
          path: server.sourceConfigPath,
          key: "args",
          value: host,
        })
      }
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
