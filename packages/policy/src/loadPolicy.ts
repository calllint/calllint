import { readFileSync } from "node:fs"
import type { Policy } from "@mcpguard/types"
import { defaultPolicy } from "./defaultPolicy.js"
import { validatePolicy } from "./validatePolicy.js"

export class PolicyLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PolicyLoadError"
  }
}

/** Load + validate a policy from disk. */
export function loadPolicyFile(path: string): Policy {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (err) {
    throw new PolicyLoadError(
      `Could not read policy file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new PolicyLoadError(
      `Policy file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return validatePolicy(parsed)
}

/** Load a policy from a path if given, else return the built-in default. */
export function loadPolicyOrDefault(path?: string): Policy {
  return path ? loadPolicyFile(path) : defaultPolicy()
}
