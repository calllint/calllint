/**
 * `calllint action` command — inspect planned external actions.
 *
 * ADR 0029: Unified External Action Preflight.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzeAction } from '@calllint/action-analyzer'
import { loadPolicyOrDefault } from '@calllint/policy'
import { createReceipt } from '@calllint/core'
import { renderTerminal, renderJson } from '@calllint/report-renderer'
import type { ActionDescriptor } from '@calllint/action-analyzer'
import type { CommandResult } from './scan.js'
import type { ParsedArgs } from '../args.js'
import type { Verdict } from '@calllint/types'

interface ActionDeps {
  cwd: string
  toolVersion?: string
  generatedAt?: string
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

    // Build action report (compatible with receipt schema)
    const actionReport = {
      schema_version: 'calllint.action-report.v0',
      verdict,
      findings,
      target: {
        type: 'action',
        kind: descriptor.kind,
        schema_version: descriptor.schema_version,
      },
      policy_applied: 'default',
      scan_timestamp: deps.generatedAt || new Date().toISOString(),
      counts: {
        SAFE: findings.filter(f => !f.blocker && f.severity !== 'high').length === 0 ? 1 : 0,
        REVIEW: findings.some(f => f.severity === 'high') ? 1 : 0,
        BLOCK: findings.some(f => f.blocker || f.severity === 'critical') ? 1 : 0,
        UNKNOWN: 0,
      },
      reports: [{ findings }],
    }

    // Render output
    let stdout = ''

    if (args.flags['json']) {
      stdout = JSON.stringify(actionReport, null, 2)
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

    // Receipt generation (opt-in via --receipt)
    if (args.flags['receipt']) {
      const receiptError = writeActionReceipt(descriptor, content, actionReport, policy, args, deps)
      if (receiptError) {
        return { stdout: '', stderr: receiptError, exitCode: 2 }
      }
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
  --receipt         Generate a calllint.receipt.v0 file
  --receipt-out <file>  Receipt output path (default: calllint-action-receipt.json)
  --no-emoji        Disable emoji in output

EXAMPLE
  calllint action inspect payment.json
  calllint action inspect email-reply.json --json
  calllint action inspect payment.json --receipt

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

/**
 * Write action receipt to disk (ADR 0028 receipt reuse for actions).
 */
function writeActionReceipt(
  descriptor: ActionDescriptor,
  rawContent: string,
  actionReport: any,
  policy: any,
  args: ParsedArgs,
  deps: ActionDeps,
): string | undefined {
  const toolVersion = deps.toolVersion ?? '0.0.0-dev'
  const receipt = createReceipt(
    {
      toolVersion,
      subject: { type: 'action', target: descriptor.kind },
      inputForHash: rawContent,
      effectivePolicyForHash: policy ?? { policy: 'default' },
      scanReport: actionReport,
      rulesetForHash: { tool: 'calllint', version: toolVersion },
      networkUsed: false,
    },
    deps.generatedAt || new Date().toISOString(),
  )

  const outPath = resolve(
    deps.cwd,
    (args.flags['receipt-out'] as string) ?? 'calllint-action-receipt.json',
  )

  try {
    writeFileSync(outPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8')
  } catch (e) {
    return `Could not write action receipt to ${outPath}: ${e instanceof Error ? e.message : String(e)}`
  }

  return undefined
}

