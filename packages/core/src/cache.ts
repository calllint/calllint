import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import type { ConfigSummaryReport } from "@mcpguard/types"

/** Default cache location for the most recent scan, used by `explain`. */
export function defaultCachePath(cwd = process.cwd()): string {
  return join(cwd, ".mcpguard", "last-scan.json")
}

export function writeCache(report: ConfigSummaryReport, path = defaultCachePath()): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8")
}

export function readCache(path = defaultCachePath()): ConfigSummaryReport | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ConfigSummaryReport
  } catch {
    return undefined
  }
}
