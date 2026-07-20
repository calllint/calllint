#!/usr/bin/env node
/**
 * CallLint preflight PreToolUse hook (new11 P2, PR-12) — thin edge over
 * preflight-core.mjs. Bound by ADR 0051.
 *
 * When Claude Code is about to Write/Edit an agent-tool CONFIG file (an MCP
 * server list or a skill manifest), this hook surfaces a recommendation to run
 * CallLint's preflight first. Compiled from the `secure-agent-install` skill.
 *
 * ADR 0051 INVARIANTS — preflight recommend / display-only and NON-BLOCKING:
 *   - ALWAYS exits 0. Never exits 2 (which would block the call) and never
 *     emits `permissionDecision`. The agent's control flow is unchanged.
 *   - Runs NO scan, executes nothing, connects to nothing (INV1). It only
 *     recognizes a config surface and recommends the `calllint` command. No LLM.
 *   - Never asserts SAFE; UNKNOWN is never SAFE.
 *
 * On any parse/logic error it still exits 0 silently — a preflight recommender
 * must never break the agent loop.
 */

import { preflightFor } from "./preflight-core.mjs"

/** Read all of stdin (the PreToolUse JSON). Resolves "" on any error/timeout. */
async function readStdin() {
  return await new Promise((resolve) => {
    let data = ""
    let settled = false
    const done = () => {
      if (!settled) {
        settled = true
        resolve(data)
      }
    }
    try {
      process.stdin.setEncoding("utf8")
      process.stdin.on("data", (c) => (data += c))
      process.stdin.on("end", done)
      process.stdin.on("error", done)
      setTimeout(done, 2000).unref?.()
    } catch {
      done()
    }
  })
}

async function main() {
  const raw = await readStdin()
  let event
  try {
    event = JSON.parse(raw)
  } catch {
    process.exit(0) // no parsable event → stay silent, never block
  }
  const payload = preflightFor(event)
  if (payload) process.stdout.write(JSON.stringify(payload))
  process.exit(0) // recommend-only, never blocking (ADR 0051)
}

main().catch(() => process.exit(0))
