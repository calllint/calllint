#!/usr/bin/env node
import { runStdioServer } from "./server.js"
import { VERSION } from "./version.js"

// A stable, deterministic clock for scans (the wrapper adds no time-based
// behavior; reports stay reproducible per call). Tools that need "now" pass it
// through ScanOptions.generatedAt.
async function main(): Promise<void> {
  const generatedAt = new Date().toISOString()
  await runStdioServer(
    { name: "calllint", version: VERSION },
    { generatedAt, now: Date.parse(generatedAt) },
  )
}

void main()
