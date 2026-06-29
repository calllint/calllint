import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { CompactDecision } from "@calllint/types"
import { classifySurface } from "./detect.js"
import { loadSurfaceText, inferOrigin } from "./load.js"
import { checkParsed } from "../decision/checkParsed.js"
import { ConfigParseError } from "@calllint/config-parser"

/** Directories never descended into (default-path guarantee: ignore node_modules). */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
])

const MAX_DEPTH = 6
const MAX_FILE_BYTES = 256 * 1024

export interface WalkOpts {
  now: number
  generatedAt: string
}

/** Walk the repo, returning files that classifySurface marks SCAN. */
export function findSurfaces(root: string): string[] {
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

export function readCapped(path: string): string | undefined {
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return undefined
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
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

/**
 * Discover every agent-tool surface under `root` and produce one CompactDecision
 * per server. The single source of surface walking for `scan-all`, `approve`,
 * and `verify --approved`. Offline, no-LLM, never executes a scanned server.
 */
export function decideRepoSurfaces(root: string, opts: WalkOpts): CompactDecision[] {
  const surfaces = findSurfaces(root)
  const decisions: CompactDecision[] = []

  for (const abs of surfaces) {
    const rel = relative(root, abs) || abs
    const text = readCapped(abs)
    if (!text) continue
    try {
      const loaded = loadSurfaceText(text, rel)
      const results = checkParsed(loaded.parsed, rel, inferOrigin(rel), opts)
      for (const r of results) decisions.push(r.decision)
    } catch (e) {
      if (e instanceof ConfigParseError) {
        decisions.push(unknownDecision(rel))
        continue
      }
      throw e
    }
  }

  return decisions
}
