import { join } from "node:path"
import { readCache } from "@mcpguard/core"
import { renderExplain, NO_EMOJI_STYLE, DEFAULT_STYLE } from "@mcpguard/report-renderer"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface ExplainDeps {
  cwd: string
}

/** Explain one server's verdict from the cached last scan. */
export function explainCommand(args: ParsedArgs, deps: ExplainDeps): CommandResult {
  const serverName = args.positionals[0]
  if (!serverName) {
    return {
      stdout: "",
      stderr: "Usage: mcpguard explain <server>",
      exitCode: EXIT.USAGE,
    }
  }

  const summary = readCache(join(deps.cwd, ".mcpguard", "last-scan.json"))
  if (!summary) {
    return {
      stdout: "",
      stderr: "No cached scan found. Run `mcpguard scan` first.",
      exitCode: EXIT.ERROR,
    }
  }

  const report = summary.reports.find((r) => r.target.name === serverName)
  if (!report) {
    const names = summary.reports.map((r) => r.target.name).join(", ")
    return {
      stdout: "",
      stderr: `Server "${serverName}" not in last scan. Available: ${names || "(none)"}`,
      exitCode: EXIT.USAGE,
    }
  }

  const style = flagBool(args.flags, "no-emoji") ? NO_EMOJI_STYLE : DEFAULT_STYLE
  return { stdout: renderExplain(report, style), exitCode: EXIT.OK }
}
