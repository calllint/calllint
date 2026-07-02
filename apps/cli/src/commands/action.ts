/**
 * `calllint action` command — inspect planned external actions.
 *
 * ADR 0029: Unified External Action Preflight.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzeAction } from '@calllint/action-analyzer'
import { loadPolicyOrDefault } from '@calllint/policy'
import { renderTerminal, renderJson } from '@calllint/report-renderer'
import type { ActionDescriptor } from '@calllint/action-analyzer'
import type { CommandResult } from './scan.js'
import type { ParsedArgs } from '../args.js'
import type { Verdict } from '@calllint/types'

interface ActionDeps {
  cwd: string
}

export function actionCommand(args: ParsedArgs, deps: ActionDeps): CommandResult {
  const subcommand = args.positionals[0]

  if (!subcommand || subcommand === 'help') {
    return {
      stdout: actionHelp(),
      stderr: '',
      exitCode: 0,
    }
  }

  if (subcommand === 'inspect') {
    return actionInspect(args, deps)
  }

  return {
    stdout: '',
    stderr: `Unknown action subcommand: ${subcommand}\nRun \`calllint action help\`.`,
    exitCode: 2,
  }
}

function actionInspect(args: ParsedArgs, deps: ActionDeps): CommandResult {
  const actionFile = args.positionals[1]

  if (!actionFile) {
    return {
      stdout: '',
      stderr: 'Error: Missing action file\nUsage: calllint action inspect <file.json>',
      exitCode: 2,
    }
  }

  try {
    // Read and parse action descriptor
    const absolutePath = resolve(deps.cwd, actionFile)
    const content = readFileSync(absolutePath, 'utf-8')
    const descriptor: ActionDescriptor = JSON.parse(content)

    // Validate schema version
    if (descriptor.schema_version !== 'calllint.action.v0') {
      return {
        stdout: '',
        stderr: `Error: Unsupported schema version: ${descriptor.schema_version}\nExpected: calllint.action.v0`,
        exitCode: 2,
      }
    }

    // Load policy
    const policyPath = args.flags['policy'] as string | undefined
    const policy = loadPolicyOrDefault(policyPath ? resolve(deps.cwd, policyPath) : undefined)

    // Analyze action
    const findings = analyzeAction(descriptor)

    // Compute verdict based on findings and policy
    const verdict = computeActionVerdict(findings, policy)

    // Render output
    let stdout = ''

    if (args.flags['json']) {
      // JSON output
      const report = {
        schema_version: 'calllint.action-report.v0',
        verdict,
        findings,
        target: {
          type: 'action',
          kind: descriptor.kind,
          schema_version: descriptor.schema_version,
        },
        policy_applied: 'default',
        scan_timestamp: new Date().toISOString(),
      }
      stdout = JSON.stringify(report, null, 2)
    } else {
      // Terminal output (simplified)
      const header = `\n🔍 Action: ${descriptor.kind}\n`
      const verdictEmoji = verdict === 'SAFE' ? '✅' : verdict === 'BLOCK' ? '⛔' : verdict === 'REVIEW' ? '⚠️' : '◇'
      const verdictLine = `Verdict: ${verdictEmoji} ${verdict}\n`
      const findingsLine = `Findings: ${findings.length}\n`

      let body = verdictLine + findingsLine
      if (findings.length > 0) {
        body += '\n'
        for (const f of findings) {
          body += `  • ${f.id}: ${f.impact}\n`
        }
      }

      stdout = header + body
    }

    // Exit code: 0 = SAFE, 1 = REVIEW/BLOCK/UNKNOWN
    return {
      stdout,
      stderr: '',
      exitCode: verdict === 'SAFE' ? 0 : 1,
    }
  } catch (error) {
    const err = error as Error & { code?: string }
    let stderr = ''

    if (err.code === 'ENOENT') {
      stderr = `Error: File not found: ${actionFile}`
    } else if (error instanceof SyntaxError) {
      stderr = `Error: Invalid JSON in ${actionFile}\n${error.message}`
    } else {
      stderr = `Error: ${err.message}`
    }

    return {
      stdout: '',
      stderr,
      exitCode: 2,
    }
  }
}

function actionHelp(): string {
  return `calllint action — Inspect planned external actions

USAGE
  calllint action inspect <file.json>
  calllint action help

COMMANDS
  inspect <file>    Analyze a calllint.action.v0 descriptor
  help              Show this help

OPTIONS
  --json            Output JSON report
  --policy <file>   Use custom policy file
  --no-emoji        Disable emoji in output

EXAMPLE
  calllint action inspect payment.json
  calllint action inspect email-reply.json --json

See: https://calllint.com/docs/action-inspect (ADR 0029)
`
}

/**
 * Simple verdict computation for actions (simplified version).
 */
function computeActionVerdict(findings: any[], policy: any): Verdict {
  if (findings.length === 0) {
    return 'SAFE'
  }

  const hasBlocker = findings.some((f: any) => f.blocker || f.severity === 'critical')
  if (hasBlocker) {
    return 'BLOCK'
  }

  const hasHigh = findings.some((f: any) => f.severity === 'high')
  if (hasHigh) {
    return 'REVIEW'
  }

  return 'REVIEW' // Default to REVIEW if there are any findings
}

