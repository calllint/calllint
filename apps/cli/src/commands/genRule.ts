import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  renderHostRule,
  RULE_HOSTS,
  RULE_TARGETS,
  type RuleHost,
} from "@calllint/core"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface GenRuleDeps {
  cwd: string
  /** Injected for testability; defaults to the real fs writer. */
  writeFile?: (path: string, content: string) => void
}

function isRuleHost(v: string | undefined): v is RuleHost {
  return v !== undefined && (RULE_HOSTS as readonly string[]).includes(v)
}

/**
 * `calllint gen-rule --host <host>` — emit the CallLint agent-safety rule for a
 * host (P3.2). Declarative: renders the canonical rule (no logic). Prints to
 * stdout by default; `--write` writes the host's recommended file. `--out`
 * overrides the path. With no `--host`, lists the available hosts.
 */
export function genRuleCommand(args: ParsedArgs, deps: GenRuleDeps): CommandResult {
  const host = flagStr(args.flags, "host")

  if (!host) {
    const list = RULE_HOSTS.map(
      (h) => `  ${h.padEnd(10)} → ${RULE_TARGETS[h].path}  (${RULE_TARGETS[h].label})`,
    ).join("\n")
    return {
      stdout: `Usage: calllint gen-rule --host <host> [--write] [--out <path>]\n\nHosts:\n${list}`,
      exitCode: EXIT.OK,
    }
  }

  if (!isRuleHost(host)) {
    return {
      stdout: "",
      stderr: `Unknown host: ${host}\nRun \`calllint gen-rule\` to list hosts.`,
      exitCode: EXIT.USAGE,
    }
  }

  const content = renderHostRule(host)

  if (!flagBool(args.flags, "write")) {
    return { stdout: content, exitCode: EXIT.OK }
  }

  // --write: write the file. --out overrides the host's default path.
  const rel = flagStr(args.flags, "out") ?? RULE_TARGETS[host].path
  const abs = resolve(deps.cwd, rel)
  const write = deps.writeFile ?? defaultWrite
  try {
    write(abs, content)
  } catch (e) {
    return {
      stdout: "",
      stderr: `Failed to write ${rel}: ${e instanceof Error ? e.message : String(e)}`,
      exitCode: EXIT.ERROR,
    }
  }
  return { stdout: `Wrote ${rel} (${RULE_TARGETS[host].label})`, exitCode: EXIT.OK }
}

function defaultWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf8")
}

/** Render every host rule into `dir`. Used by the dogfood/docs generator. */
export function generateAllRules(
  dir: string,
  write: (path: string, content: string) => void = defaultWrite,
): string[] {
  const written: string[] = []
  for (const host of RULE_HOSTS) {
    const path = join(dir, RULE_TARGETS[host].path)
    write(path, renderHostRule(host))
    written.push(RULE_TARGETS[host].path)
  }
  return written
}
