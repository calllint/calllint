import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { verifyReceipt } from "@calllint/core"
import type { CallLintReceipt } from "@calllint/core"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface ReceiptDeps {
  cwd: string
}

/**
 * `calllint receipt verify <file>` — structurally validate a local
 * `calllint.receipt.v0` (new5 R3, ADR 0028). Offline, no crypto, no cloud: it
 * checks shape, hash formats, integer counts, and trust-boundary invariants.
 * Exit 0 = valid structure, 1 = invalid/malformed. A receipt with no signature
 * is reported as an "unsigned local receipt" — not an error.
 */
export function receiptCommand(args: ParsedArgs, deps: ReceiptDeps): CommandResult {
  const sub = args.positionals[0]
  if (sub !== "verify") {
    return {
      stdout: "",
      stderr: "Usage: calllint receipt verify <receipt.json>",
      exitCode: EXIT.USAGE,
    }
  }

  const file = args.positionals[1]
  if (!file) {
    return {
      stdout: "",
      stderr: "Usage: calllint receipt verify <receipt.json>",
      exitCode: EXIT.USAGE,
    }
  }

  let raw: string
  try {
    raw = readFileSync(resolve(deps.cwd, file), "utf8")
  } catch (e) {
    return {
      stdout: "",
      stderr: `Could not read receipt ${file}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }

  // Parse first: malformed JSON is an invalid receipt, not a crash. verifyReceipt
  // validates the STRUCTURE of the parsed object (it never re-scans or re-judges).
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    const msg = `receipt is not valid JSON: ${e instanceof Error ? e.message : String(e)}`
    if (flagBool(args.flags, "json")) {
      return {
        stdout: JSON.stringify({ valid: false, errors: [msg], signed: false }, null, 2),
        exitCode: 1,
      }
    }
    return { stdout: "", stderr: `CallLint receipt: invalid\n  - ${msg}`, exitCode: 1 }
  }

  const result = verifyReceipt(parsed)

  if (flagBool(args.flags, "json")) {
    return {
      stdout: JSON.stringify(result, null, 2),
      exitCode: result.valid ? EXIT.OK : 1,
    }
  }

  if (!result.valid) {
    const lines = ["CallLint receipt: invalid", ...result.errors.map((e) => `  - ${e}`)]
    return { stdout: "", stderr: lines.join("\n"), exitCode: 1 }
  }

  // Valid: display from the parsed receipt (verifyReceipt confirmed its shape).
  const r = parsed as CallLintReceipt
  const signature = r.signature
    ? "present (shape-only, not cryptographically verified)"
    : "unsigned local receipt"
  const stdout = [
    "CallLint receipt: valid",
    `receipt_id: ${r.receipt_id}`,
    `schema: ${r.schema_version}`,
    `verdict: ${r.verdict}`,
    `signature: ${signature}`,
  ].join("\n")
  return { stdout, exitCode: EXIT.OK }
}
