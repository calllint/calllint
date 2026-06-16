import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Baseline, ConfigSummaryReport } from "@calllint/types"

/** Default cache location for the most recent scan, used by `explain`. */
export function defaultCachePath(cwd = process.cwd()): string {
  return join(cwd, ".calllint", "last-scan.json")
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

/** Default location for the approved baseline, used by `verify`. */
export function defaultBaselinePath(cwd = process.cwd()): string {
  return join(cwd, ".calllint", "baseline.json")
}

export function writeBaseline(baseline: Baseline, path = defaultBaselinePath()): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(baseline, null, 2), "utf8")
}

export function readBaseline(path = defaultBaselinePath()): Baseline | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Baseline
  } catch {
    return undefined
  }
}
