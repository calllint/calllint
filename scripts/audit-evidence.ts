#!/usr/bin/env tsx
/**
 * Evidence Audit Script
 *
 * Validates that all detector functions produce findings with complete evidence.
 *
 * Checks:
 * 1. Every finding has an `evidence` array
 * 2. Every evidence object has a `type` field
 * 3. Evidence includes at least one of: key, value, path, snippet
 * 4. Finding has `impact` and `fix` fields for actionability
 *
 * Exit codes:
 *   0 - All detectors pass
 *   1 - Validation failures found
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const ROOT = join(__dirname, "..")
const DETECTORS_DIR = join(ROOT, "packages", "static-analyzer", "src", "detectors")

interface ValidationIssue {
  file: string
  line: number
  issue: string
}

const issues: ValidationIssue[] = []

function findDetectorFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...findDetectorFiles(fullPath))
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(fullPath)
    }
  }
  return files
}

function auditDetectorFile(filePath: string): void {
  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const relPath = relative(ROOT, filePath)

  // Check 1: Findings must have evidence array
  const findingObjectPattern = /\{\s*id:\s*["'][^"']+["']/g
  let match: RegExpExecArray | null

  while ((match = findingObjectPattern.exec(content)) !== null) {
    const startPos = match.index
    const lineNum = content.substring(0, startPos).split("\n").length

    // Extract the finding object (rough heuristic: find matching braces)
    let braceDepth = 0
    let findingEnd = startPos
    let inFinding = false

    for (let i = startPos; i < content.length; i++) {
      const char = content[i]
      if (char === "{") {
        braceDepth++
        inFinding = true
      } else if (char === "}") {
        braceDepth--
        if (inFinding && braceDepth === 0) {
          findingEnd = i + 1
          break
        }
      }
    }

    const findingText = content.substring(startPos, findingEnd)

    // Check for evidence field
    if (!findingText.includes("evidence")) {
      issues.push({
        file: relPath,
        line: lineNum,
        issue: "Finding missing 'evidence' field",
      })
    }

    // Check for impact field
    if (!findingText.includes("impact:")) {
      issues.push({
        file: relPath,
        line: lineNum,
        issue: "Finding missing 'impact' field",
      })
    }

    // Check for fix field
    if (!findingText.includes("fix:")) {
      issues.push({
        file: relPath,
        line: lineNum,
        issue: "Finding missing 'fix' field",
      })
    }
  }

  // Check 2: Evidence objects must have required fields
  // Look for direct evidence object literals (skip helper function calls like poisonEvidence/hiddenEvidence)
  const evidenceObjectPattern = /\{\s*type:\s*["']([^"']+)["']/g

  while ((match = evidenceObjectPattern.exec(content)) !== null) {
    const startPos = match.index
    const lineNum = content.substring(0, startPos).split("\n").length
    const evidenceType = match[1]

    // Check if this is inside a helper function call (e.g., poisonEvidence, hiddenEvidence)
    const beforeMatch = content.substring(Math.max(0, startPos - 100), startPos)
    if (/Evidence\(/.test(beforeMatch)) {
      // Skip evidence created by helper functions - they handle field construction
      continue
    }

    // Extract evidence object
    let braceDepth = 0
    let evidenceEnd = startPos
    let inEvidence = false

    for (let i = startPos; i < content.length; i++) {
      const char = content[i]
      if (char === "{") {
        braceDepth++
        inEvidence = true
      } else if (char === "}") {
        braceDepth--
        if (inEvidence && braceDepth === 0) {
          evidenceEnd = i + 1
          break
        }
      }
    }

    const evidenceText = content.substring(startPos, evidenceEnd)

    // Evidence must have at least one identifying field
    const hasKey = evidenceText.includes("key:")
    const hasValue = evidenceText.includes("value:")
    const hasPath = evidenceText.includes("path:")
    const hasSnippet = evidenceText.includes("snippet:")

    if (!hasKey && !hasValue && !hasPath && !hasSnippet) {
      issues.push({
        file: relPath,
        line: lineNum,
        issue: `Evidence type '${evidenceType}' missing identifying fields (key/value/path/snippet)`,
      })
    }
  }

  // Check 3: Look for TODO or FIXME comments related to evidence
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (
      (line.includes("TODO") || line.includes("FIXME")) &&
      (line.toLowerCase().includes("evidence") || line.toLowerCase().includes("impact"))
    ) {
      issues.push({
        file: relPath,
        line: i + 1,
        issue: `TODO/FIXME related to evidence: ${line.trim()}`,
      })
    }
  }
}

function main(): void {
  console.log("🔍 Auditing detector evidence completeness...\n")

  const detectorFiles = findDetectorFiles(DETECTORS_DIR)
  console.log(`Found ${detectorFiles.length} detector files\n`)

  for (const file of detectorFiles) {
    auditDetectorFile(file)
  }

  if (issues.length === 0) {
    console.log("✅ All detectors have complete evidence\n")
    console.log("Validation passed:")
    console.log("  - All findings include evidence arrays")
    console.log("  - All evidence objects have required fields")
    console.log("  - All findings include impact and fix fields")
    console.log("  - No TODO/FIXME comments related to evidence")
    process.exit(0)
  } else {
    console.error(`❌ Found ${issues.length} evidence issues:\n`)

    // Group by file
    const byFile = new Map<string, ValidationIssue[]>()
    for (const issue of issues) {
      const existing = byFile.get(issue.file) || []
      existing.push(issue)
      byFile.set(issue.file, existing)
    }

    for (const [file, fileIssues] of byFile) {
      console.error(`\n${file}:`)
      for (const issue of fileIssues) {
        console.error(`  Line ${issue.line}: ${issue.issue}`)
      }
    }

    console.error(`\n❌ Evidence audit failed with ${issues.length} issues\n`)
    process.exit(1)
  }
}

main()
