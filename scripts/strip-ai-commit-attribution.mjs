#!/usr/bin/env node
/**
 * Remove AI tool attribution lines from a git commit message file.
 * Used by .githooks/prepare-commit-msg (see pnpm hooks:install).
 */
import { readFileSync, writeFileSync } from "node:fs"

const msgFile = process.argv[2]
if (!msgFile) process.exit(0)

const STRIP =
  /^(Co-Authored-By:\s*(Claude|Cursor\b|.*cursoragent.*|.*@anthropic\.com|.*@cursor\.com)|Made-with:\s*Cursor\b)/i

let text
try {
  text = readFileSync(msgFile, "utf8")
} catch {
  process.exit(0)
}

const lines = text.split(/\r?\n/)
const filtered = lines.filter((line) => !STRIP.test(line.trim()))
const cleaned = filtered.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n")

if (cleaned !== text) writeFileSync(msgFile, cleaned, "utf8")
