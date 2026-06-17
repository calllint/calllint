#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { run } from "./run.js"
import { computeOnlineEnrichment } from "./online.js"
import { resolveClock } from "./clock.js"
import { breathe } from "./breathe.js"

function readStdin(): string {
  try {
    return readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  // One clock for the whole run: reports' generatedAt and online findings'
  // fetchedAt share the same timestamp, so a report is internally consistent.
  // `--generated-at <iso>` pins it for deterministic output (corpus / CI).
  let clock
  try {
    clock = resolveClock(argv, () => new Date())
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 2
    return
  }
  const { generatedAt, now } = clock

  let online
  try {
    online = await computeOnlineEnrichment(argv, { fetchedAt: generatedAt })
  } catch (err) {
    process.stderr.write(`--online failed: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 3
    return
  }

  if (online?.note) process.stderr.write(`online: ${online.note}\n`)

  // A tiny breathing brand mark on interactive runs (stderr only, never on
  // machine output). Best-effort — must never delay or break the command.
  try {
    await breathe(argv)
  } catch {
    // ignore: branding is cosmetic
  }

  const result = run(argv, {
    cwd: process.cwd(),
    readStdin,
    now,
    generatedAt,
    online,
  })

  if (result.stdout) process.stdout.write(result.stdout + "\n")
  if (result.stderr) process.stderr.write(result.stderr + "\n")
  process.exitCode = result.exitCode
}

void main()
