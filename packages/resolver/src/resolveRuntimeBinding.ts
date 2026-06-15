import type {
  NormalizedMcpServer,
  RuntimeBinding,
  RuntimeKind,
} from "@mcpguard/types"
import {
  isPackageRunner,
  isPinnedVersion,
  parseNpmSpec,
  SHELL_COMMANDS,
} from "./npmSpec.js"

function runtimeKindFor(server: NormalizedMcpServer): RuntimeKind {
  if (server.url) {
    return server.transport === "sse" ? "sse" : "http"
  }
  const cmd = (server.command ?? "").toLowerCase()
  if (!cmd) return "unknown"
  if (cmd === "npx" || cmd === "bunx" || cmd === "pnpm" || cmd === "yarn") return "npx"
  if (cmd === "uvx" || cmd === "pipx") return "uvx"
  if (cmd === "node" || cmd === "node.exe") return "node"
  if (cmd === "python" || cmd === "python3" || cmd === "py") return "python"
  if (cmd === "docker") return "docker"
  if (SHELL_COMMANDS.has(cmd)) return "unknown"
  return "unknown"
}

/** First positional (non-flag) arg — the likely package/script subject. */
function firstPackageArg(args: string[]): string | undefined {
  for (const a of args) {
    if (a === "-y" || a === "--yes" || a.startsWith("-")) continue
    return a
  }
  return undefined
}

/**
 * Resolve what a server config will actually run. This is "runtime binding":
 * the real subject of an `npx` invocation is the package, not npx itself.
 */
export function resolveRuntimeBinding(server: NormalizedMcpServer): RuntimeBinding {
  const runtimeKind = runtimeKindFor(server)

  // Remote server.
  if (server.url) {
    return {
      declaredCommand: server.command,
      declaredArgs: server.args,
      transport: server.transport,
      runtimeKind,
      isVersionPinned: false,
      remoteUrl: server.url,
      sourceKnown: false,
      installMayRunScripts: false,
      runtimeExecutable: false,
    }
  }

  const command = server.command
  const args = server.args

  // Package runner (npx/uvx/...): the package arg is the subject.
  if (isPackageRunner(command)) {
    const pkgArg = firstPackageArg(args)
    const spec = pkgArg ? parseNpmSpec(pkgArg) : undefined
    const installMayRunScripts =
      args.includes("-y") || args.includes("--yes") || true // npx fetches+runs
    return {
      declaredCommand: command,
      declaredArgs: args,
      transport: "stdio",
      runtimeKind,
      packageName: spec?.name,
      packageVersionSpec: spec?.versionSpec,
      isVersionPinned: isPinnedVersion(spec?.versionSpec),
      sourceKnown: Boolean(spec?.name),
      installMayRunScripts,
      runtimeExecutable: true,
    }
  }

  // Shell command: arbitrary execution, source unknown.
  if (command && SHELL_COMMANDS.has(command.toLowerCase())) {
    return {
      declaredCommand: command,
      declaredArgs: args,
      transport: "stdio",
      runtimeKind: "unknown",
      isVersionPinned: false,
      sourceKnown: false,
      installMayRunScripts: false,
      runtimeExecutable: true,
    }
  }

  // node/python/docker/other local command.
  return {
    declaredCommand: command,
    declaredArgs: args,
    transport: server.transport === "unknown" ? "stdio" : server.transport,
    runtimeKind,
    isVersionPinned: false,
    // A bare local script path is "known" in that we can see it; a missing
    // command is genuinely unknown.
    sourceKnown: Boolean(command),
    installMayRunScripts: false,
    runtimeExecutable: Boolean(command),
  }
}
