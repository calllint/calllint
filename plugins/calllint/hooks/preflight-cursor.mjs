#!/usr/bin/env node
/**
 * CallLint preflight `preToolUse` hook — the CURSOR edge over preflight-core.mjs.
 * Bound by ADR 0051, exactly as the Claude edge (preflight.mjs) is.
 *
 * WHY A SECOND EDGE AND NOT A SHARED ONE. The decision is identical on both hosts
 * and lives in `preflightFor` — one pure, total function, one vocabulary. What
 * differs is only the OUTPUT ENVELOPE, and it differs in a way no shared shape
 * could satisfy:
 *
 *   Claude  `systemMessage` + `hookSpecificOutput.hookEventName: "PreToolUse"`
 *   Cursor  `user_message` / `agent_message`, and `permission` for a verdict
 *
 * Emitting Claude's envelope to Cursor is not a soft failure — Cursor ignores the
 * unknown fields, so the recommendation is computed and then silently dropped. A
 * hook that runs and says nothing is the fault class this repo names most often:
 * a guard that cannot observe its subject. Hence a real edge, not a cast.
 *
 * ADR 0051 INVARIANTS — recommend / display-only and NON-BLOCKING. On Cursor the
 * blocking levers are different, so the floor is restated in Cursor's own terms:
 *   - NEVER emits a `permission` field. Cursor treats `"deny"` as a hard block and
 *     `preToolUse` is the one hook that can veto a write. Absent the field, the
 *     call proceeds untouched.
 *   - NEVER emits `updated_input`. Rewriting the agent's arguments is a silent
 *     mutation of its control flow, which is worse than a visible veto, not better.
 *   - ALWAYS exits 0. Cursor equates exit code 2 with a deny.
 *   - `failClosed` is deliberately left unset (default false) in hooks.json, so a
 *     crash or timeout here fails OPEN. A recommender must never break the loop.
 *   - Runs NO scan, executes nothing, connects to nothing (INV1). Never asserts
 *     SAFE; UNKNOWN is never SAFE.
 *
 * Cursor's `preToolUse` payload is `tool_name` + `tool_input`, structurally the
 * same as Claude's, so the core reads it unchanged. Cursor documents the INNER
 * shape of `tool_input` only for Shell calls, not for Write — which is why the
 * core tolerates `file_path` / `filePath` / `path` rather than assuming one.
 */

import { preflightFor } from "./preflight-core.mjs"

/** Read all of stdin (the preToolUse JSON). Resolves "" on any error/timeout. */
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

/**
 * Re-envelope the shared recommendation for Cursor. Deliberately drops nothing
 * but the Claude-specific wrapper: `user_message` is what a human sees,
 * `agent_message` is what the model reads — the same split as
 * systemMessage/additionalContext, under Cursor's names.
 *
 * No `permission`, no `updated_input`: see the ADR 0051 block above.
 */
function toCursorEnvelope(rec) {
  return {
    user_message: rec.systemMessage,
    agent_message: rec.hookSpecificOutput.additionalContext,
  }
}

async function main() {
  const raw = await readStdin()
  let event
  try {
    event = JSON.parse(raw)
  } catch {
    process.exit(0) // no parsable event → stay silent, never block
  }
  const rec = preflightFor(event)
  if (rec) process.stdout.write(JSON.stringify(toCursorEnvelope(rec)))
  process.exit(0) // recommend-only, never blocking (ADR 0051)
}

main().catch(() => process.exit(0))
