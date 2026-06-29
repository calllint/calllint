import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import {
  checkParsed,
  classifySurface,
  loadSurfaceText,
  inferOrigin,
  ConfigParseError,
} from "@calllint/core"
import type { CompactDecision } from "@calllint/types"
import {
  renderDecisionTable,
  NO_EMOJI_STYLE,
  DEFAULT_STYLE,
} from "@calllint/report-renderer"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface ScanAllDeps {
  cwd: string
  now: number
  generatedAt: string
}

/** Directories never descended into (default-path guarantee: ignore node_modules). */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
])

const MAX_DEPTH = 6
const MAX_FILE_BYTES = 256 * 1024

/** Walk the repo, returning files that classifySurface marks SCAN. */
function findSurfaces(root: string): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > MAX_DEPTH) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(full, depth + 1)
      } else if (e.isFile()) {
        // First-pass classify by path alone (cheap). For content-sensitive
        // surfaces, read a bounded slice and re-classify.
        if (classifySurface(full) === "SCAN") {
          found.push(full)
          continue
        }
        if (needsContentCheck(e.name)) {
          const content = readCapped(full)
          if (content && classifySurface(full, content) === "SCAN") found.push(full)
        }
      }
    }
  }

  walk(root, 0)
  return found
}

function needsContentCheck(name: string): boolean {
  return (
    name === "config.toml" ||
    name === "settings.json" ||
    /\.(md|markdown|ya?ml)$/.test(name)
  )
}

function readCapped(path: string): string | undefined {
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return undefined
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

/**
 * `calllint scan-all` — find every agent-tool surface in the repo and emit a
 * compact decision table. Ignores node_modules and other build/vendor dirs.
 * Offline, no-LLM, never executes a scanned server.
 */
export function scanAllCommand(args: ParsedArgs, deps: ScanAllDeps): CommandResult {
  const style = flagBool(args.flags, "no-emoji") ? NO_EMOJI_STYLE : DEFAULT_STYLE
  const opts = { now: deps.now, generatedAt: deps.generatedAt }

  const surfaces = findSurfaces(deps.cwd)
  const decisions: CompactDecision[] = []

  for (const abs of surfaces) {
    const rel = relative(deps.cwd, abs) || abs
    const text = readCapped(abs)
    if (!text) continue
    try {
      const loaded = loadSurfaceText(text, rel)
      const results = checkParsed(loaded.parsed, rel, inferOrigin(rel), opts)
      for (const r of results) decisions.push(r.decision)
    } catch (e) {
      if (e instanceof ConfigParseError) {
        // A surface we recognized but could not parse is UNKNOWN, not skipped.
        decisions.push(unknownDecision(rel))
        continue
      }
      throw e
    }
  }

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(decisions), exitCode: worstExit(decisions) }
  }

  return { stdout: renderDecisionTable(decisions, style), exitCode: worstExit(decisions) }
}

function unknownDecision(surface: string): CompactDecision {
  return {
    schemaVersion: "calllint.decision.v0",
    verdict: "UNKNOWN",
    surface,
    fingerprintHash: "",
    reasonCodes: [],
    nextAction: "gather_more_evidence",
  }
}

function worstExit(decisions: CompactDecision[]): number {
  let worst: number = EXIT.OK
  for (const d of decisions) {
    const code =
      d.verdict === "BLOCK"
        ? EXIT.BLOCK
        : d.verdict === "UNKNOWN"
          ? EXIT.UNKNOWN
          : d.verdict === "REVIEW"
            ? EXIT.REVIEW
            : EXIT.OK
    if (code > worst) worst = code
  }
  return worst
}
