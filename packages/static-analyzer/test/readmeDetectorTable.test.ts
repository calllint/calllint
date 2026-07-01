import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { DETECTORS } from "../src/index.js"

// ---------------------------------------------------------------------------
// Guard: the README "What it checks" table must stay in lock-step with the
// detectors the engine actually runs. This exists because the docs once said
// "ten static detectors" while DETECTORS carried 13 — for an evidence-honesty
// product, the docs under-claiming what it inspects is a correctness bug, not
// cosmetics. Machine-enforce the invariant instead of relying on vigilance.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const readme = readFileSync(join(repoRoot, "README.md"), "utf8")

const NUMBER_WORDS: Record<string, number> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
}

/** Extract the "What it checks" markdown table rows (the detector rows). */
function detectorTableRows(md: string): string[] {
  const start = md.indexOf("## What it checks")
  expect(start, "README must contain a '## What it checks' section").toBeGreaterThan(-1)
  const section = md.slice(start)
  const lines = section.split("\n")
  const rows: string[] = []
  let seenHeaderSeparator = false
  for (const line of lines) {
    if (/^\|\s*-+/.test(line.trim())) {
      seenHeaderSeparator = true
      continue
    }
    if (!seenHeaderSeparator) continue
    if (!line.trim().startsWith("|")) break // table ended
    rows.push(line.trim())
  }
  return rows
}

describe("README detector table stays in sync with DETECTORS", () => {
  it("has exactly one table row per registered detector", () => {
    const rows = detectorTableRows(readme)
    expect(rows.length).toBe(DETECTORS.length)
  })

  it("states the detector count in words, matching DETECTORS.length", () => {
    const m = readme.match(/runs (\w+) static detectors/i)
    const word = m?.[1]?.toLowerCase()
    expect(word, "README must say 'runs <word> static detectors'").toBeDefined()
    expect(
      NUMBER_WORDS[word ?? ""],
      `README count word "${word ?? "(none)"}" is not a known number word`,
    ).toBe(DETECTORS.length)
  })
})
