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

/**
 * Scan scopes. The forbidden-field rule applies everywhere telemetry data is
 * shaped; the no-network rule applies only to the client-side packages.
 *
 * `apps/usage-worker/src` is the SERVER ingress. It is in scope for the
 * forbidden-field rule because that is where a field could be hand-added to a
 * persisted row — and without it this guard could not observe the one place that
 * actually writes telemetry to a database.
 *
 * The no-network rule deliberately does NOT apply there: a Cloudflare Worker's
 * inbound entrypoint is *named* `fetch`, so the `fetch(` token would fire on the
 * handler declaration. That is an inbound request handler, not an egress. The
 * Worker makes no outbound calls (the npm fetch lives in the report generator,
 * outside this scope), and `noOutboundFetch` below asserts that directly.
 */
const SCOPES = [
  { dir: "packages/telemetry-contract/src", network: true, outbound: false },
  { dir: "packages/telemetry-emit/src", network: true, outbound: false },
  { dir: "apps/usage-worker/src", network: false, outbound: true },
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

function walk(dir, options) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, options)
    else if (entry.name.endsWith(".ts")) scan(p, options)
  }
}

function scan(file, options) {
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
    if (!isComment && options.network) {
      for (const tok of NETWORK_TOKENS) {
        if (line.includes(tok)) {
          console.log(`  ✗ ${rel}:${i + 1} — network token "${tok}" is forbidden in telemetry`)
          violations++
        }
      }
    }
    // Outbound-egress assertion for the Worker: it answers requests and writes to
    // D1, and must never call out. `fetch(` cannot be used as the token here (the
    // Worker's inbound handler is named `fetch`), so match a CALL to global fetch.
    if (!isComment && options.outbound) {
      if (/(^|[^.\w])fetch\s*\(/.test(line) && !/async\s+fetch\s*\(/.test(line)) {
        console.log(`  ✗ ${rel}:${i + 1} — outbound fetch() is forbidden in the ingress`)
        violations++
      }
      // The hash secret must never be logged or echoed.
      if (/console\.(log|warn|error|info|debug)/.test(line) && line.includes("USAGE_HASH_KEY")) {
        console.log(`  ✗ ${rel}:${i + 1} — USAGE_HASH_KEY must never be logged`)
        violations++
      }
    }
  })
}

for (const scope of SCOPES) {
  const dir = path.join(repoRoot, scope.dir)
  if (fs.existsSync(dir)) walk(dir, scope)
}

if (violations > 0) {
  console.error(`\nTelemetry boundary guard: FAIL — ${violations} violation(s).`)
  process.exit(1)
}
console.log("  ✓ no forbidden field appears as an event key")
console.log("  ✓ no network module/API appears in the telemetry packages")
console.log("  ✓ the usage ingress makes no outbound call and never logs its secret")
console.log("\nTelemetry boundary guard: PASS")
