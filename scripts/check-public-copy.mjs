#!/usr/bin/env node
/**
 * CallLint public-copy guard.
 *
 * Asserts that public-facing copy (website, README, agent-readable docs) stays
 * in sync with docs/project-facts.json and within the safety boundary set by
 * LIMITATIONS.md / AGENTS.md. Run via `pnpm check:public-copy`.
 *
 * Checks:
 *   1. No primary install path uses `calllint@preview` (preview belongs only in
 *      release-channel / advanced notes).
 *   2. No forbidden overclaim phrases appear anywhere in public copy.
 *   3. Each required safety phrase appears at least once across public copy.
 *   4. SAFE verdict copy appears near "No blockers observed".
 *   5. Corpus numbers in the website match docs/project-facts.json.
 *   6. The website corpus section reflects the current corpus phase.
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks failed
 *   2  facts file or public files missing / unreadable
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const factsPath = path.join(repoRoot, "docs", "project-facts.json")
const publicFiles = [
  "apps/web/public/index.html",
  "apps/web/public/agent-instructions.md",
  "apps/web/public/llms.txt",
  "README.md",
]

const primaryPathRegex = /npx calllint@preview scan/i

let exitCode = 0
const fail = (msg) => {
  console.error(`  ✗ ${msg}`)
  exitCode = 1
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

if (!fs.existsSync(factsPath)) {
  console.error(`Facts file not found: ${factsPath}`)
  process.exit(2)
}
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"))

const readPublic = () =>
  publicFiles
    .map((rel) => path.join(repoRoot, rel))
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ rel: path.relative(repoRoot, p).split(path.sep).join("/"), text: fs.readFileSync(p, "utf8") }))

const files = readPublic()
if (files.length === 0) {
  console.error("No public files found to check.")
  process.exit(2)
}
const allText = files.map((f) => f.text).join("\n")

console.log("Public-copy guard")
console.log(`Facts source: ${path.relative(repoRoot, factsPath)}`)
console.log(`Public files: ${files.map((f) => f.rel).join(", ")}`)
console.log("")

// 1. No primary @preview install path.
{
  const offenders = files.filter((f) => primaryPathRegex.test(f.text))
  if (offenders.length === 0) ok("no primary `npx calllint@preview scan` path")
  else for (const f of offenders) fail(`primary @preview path found in ${f.rel}`)
}

// 2. No forbidden overclaim phrases (case-insensitive).
{
  const lc = allText.toLowerCase()
  const found = facts.forbiddenPhrases.filter((p) => lc.includes(p.toLowerCase()))
  if (found.length === 0) ok("no forbidden overclaim phrases")
  else for (const p of found) fail(`forbidden phrase present: "${p}"`)
}

// 3. Required safety phrases present (at least once across all public copy).
{
  const lc = allText.toLowerCase()
  const missing = facts.requiredPhrases.filter((p) => !lc.includes(p.toLowerCase()))
  if (missing.length === 0) ok("all required safety phrases present")
  else for (const p of missing) fail(`required safety phrase missing: "${p}"`)
}

// 4. SAFE appears near "No blockers observed" (within 120 chars, case-insensitive).
{
  const re = /SAFE[\s\S]{0,120}No blockers observed/i
  if (re.test(allText)) ok("SAFE appears near \"No blockers observed\"")
  else fail("SAFE is not accompanied by \"No blockers observed\" within 120 chars")
}

// 4b. UNKNOWN appears near "never" or "not" SAFE (within 160 chars).
{
  const re = /UNKNOWN[\s\S]{0,160}(never|not)[\s\S]{0,20}SAFE/i
  if (re.test(allText)) ok("UNKNOWN appears near \"never/not ... SAFE\"")
  else fail("UNKNOWN is not accompanied by \"never/not ... SAFE\" within 160 chars")
}

// 5. Corpus numbers in the website match project-facts.json.
{
  const site = files.find((f) => f.rel === "apps/web/public/index.html")
  if (!site) fail("apps/web/public/index.html not found; cannot verify corpus numbers")
  else {
    const c = facts.corpus
    const ratioEsc = c.unknownRatio.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const checks = [
      [`calibratedCases = ${c.calibratedCases}`, new RegExp(`\\b${c.calibratedCases} calibrated cases\\b`)],
      [`realOrRedactedSnapshots = ${c.realOrRedactedSnapshots}`, new RegExp(`\\b${c.realOrRedactedSnapshots} real or redacted snapshots\\b`)],
      [`unknownRatio = ${c.unknownRatio}`, new RegExp(`UNKNOWN ratio ${ratioEsc}`)],
    ]
    for (const [label, re] of checks) {
      if (re.test(site.text)) ok(`corpus number matches: ${label}`)
      else fail(`corpus number mismatch: expected ${label}`)
    }
  }
}

// 6. Website corpus section reflects the current corpus phase.
{
  const site = files.find((f) => f.rel === "apps/web/public/index.html")
  if (!site) fail("apps/web/public/index.html not found; cannot verify corpus phase")
  else if (site.text.includes(`${facts.corpus.phase} · `)) ok(`corpus phase tag present: ${facts.corpus.phase}`)
  else fail(`corpus phase tag not found: expected "${facts.corpus.phase} · "`)
}

console.log("")
if (exitCode === 0) {
  console.log("Public-copy guard: PASS")
} else {
  console.log("Public-copy guard: FAIL — see violations above")
}
process.exit(exitCode)
