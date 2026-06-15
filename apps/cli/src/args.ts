/**
 * Process exit codes. CI relies on these being stable.
 *   0  SAFE / nothing to fail on
 *   10 REVIEW (only when policy.ci.failOnReview)
 *   20 UNKNOWN
 *   30 BLOCK
 *   2  usage error
 *   3  parse error / runtime error
 */
export const EXIT = {
  OK: 0,
  USAGE: 2,
  ERROR: 3,
  REVIEW: 10,
  UNKNOWN: 20,
  BLOCK: 30,
} as const

export interface ParsedArgs {
  command: string | undefined
  positionals: string[]
  flags: Record<string, string | boolean>
}

/** Minimal, dependency-free flag parser. Supports --k=v, --k v, --bool, -short. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!
    if (tok.startsWith("--")) {
      const body = tok.slice(2)
      const eq = body.indexOf("=")
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1)
      } else {
        const next = rest[i + 1]
        if (next !== undefined && !next.startsWith("-")) {
          flags[body] = next
          i++
        } else {
          flags[body] = true
        }
      }
    } else if (tok.startsWith("-") && tok.length > 1) {
      flags[tok.slice(1)] = true
    } else {
      positionals.push(tok)
    }
  }

  return { command, positionals, flags }
}

export function flagStr(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const v = flags[key]
  return typeof v === "string" ? v : undefined
}

export function flagBool(
  flags: Record<string, string | boolean>,
  key: string,
): boolean {
  return flags[key] === true || flags[key] === "true"
}
