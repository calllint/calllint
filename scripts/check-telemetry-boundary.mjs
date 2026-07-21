#!/usr/bin/env node
/**
 * Telemetry forbidden-field boundary guard (new11 §3.5, ADR 0049 §2.6).
 *
 * Defense-in-depth on top of the sanitizer's structural guarantee: scans the
 * telemetry package source for any forbidden field name appearing as an OBJECT
 * KEY (e.g. `secret:` / `"fileContents":`). The denylist itself is declared once
 * in events.ts (as a string[]), so that single declaration is allow-listed. Any
 * other occurrence as a key fails the build — a human must not hand-add a
 * forbidden field to an emitted event shape. Pure fs; no install needed.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// Both telemetry packages are in scope: the contract (definition + sanitizer) and the
// emit layer (gate + sink + emitter). The emit layer is where a network egress could be
// hand-added, so the no-network assertion below matters most there.
const pkgSrcDirs = [
  path.join(repoRoot, "packages/telemetry-contract/src"),
  path.join(repoRoot, "packages/telemetry-emit/src"),
]

const FORBIDDEN = [
  "rawConfig",
  "command",
  "environmentValue",
  "secret",
  "fileContents",
  "privateRepository",
  "userPrompt",
  "findingEvidenceText",
]

// Network modules/APIs that must never appear in the telemetry packages. Emission is
// definition + local-sink only; phoning home is a separate, explicitly-authorized
// decision that must live behind the TelemetrySink interface, not inside this layer.
const NETWORK_TOKENS = [
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:dgram",
  '"http"',
  "'http'",
  '"https"',
  "'https'",
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "undici",
  "axios",
  "node-fetch",
]

console.log("Telemetry boundary guard")
let violations = 0

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (entry.name.endsWith(".ts")) scan(p)
  }
}

function scan(file) {
  const rel = path.relative(repoRoot, file)
  const lines = fs.readFileSync(file, "utf8").split("\n")
  lines.forEach((line, i) => {
    // A comment line documents the boundary (e.g. names the forbidden set or the
    // network tokens it forbids); it is not code and is allow-listed.
    const isComment = /^\s*(\*|\/\/|\/\*)/.test(line)
    // The single denylist declaration in events.ts lists them as string literals
    // inside FORBIDDEN_FIELDS — those are quoted array items, never object keys.
    for (const f of FORBIDDEN) {
      // Match the name used as an object key: `name:` or `"name":`.
      const asKey = new RegExp(`(^|[^\\w"'])"?${f}"?\\s*:`)
      if (asKey.test(line) && !line.includes("FORBIDDEN_FIELDS") && !isComment) {
        console.log(`  ✗ ${rel}:${i + 1} — forbidden field "${f}" used as a key`)
        violations++
      }
    }
    // No-network assertion: telemetry emits to an injected sink, never over the wire.
    if (!isComment) {
      for (const tok of NETWORK_TOKENS) {
        if (line.includes(tok)) {
          console.log(`  ✗ ${rel}:${i + 1} — network token "${tok}" is forbidden in telemetry`)
          violations++
        }
      }
    }
  })
}

for (const dir of pkgSrcDirs) {
  if (fs.existsSync(dir)) walk(dir)
}

if (violations > 0) {
  console.error(`\nTelemetry boundary guard: FAIL — ${violations} violation(s).`)
  process.exit(1)
}
console.log("  ✓ no forbidden field appears as an event key")
console.log("  ✓ no network module/API appears in the telemetry packages")
console.log("\nTelemetry boundary guard: PASS")
