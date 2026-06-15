#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { run } from "./run.js"

function readStdin(): string {
  try {
    return readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

const result = run(process.argv.slice(2), {
  cwd: process.cwd(),
  readStdin,
  now: Date.now(),
  generatedAt: new Date().toISOString(),
})

if (result.stdout) process.stdout.write(result.stdout + "\n")
if (result.stderr) process.stderr.write(result.stderr + "\n")
process.exitCode = result.exitCode
