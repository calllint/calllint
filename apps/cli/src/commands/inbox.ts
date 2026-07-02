/**
 * `calllint inbox` command — inspect normalized agent inbox events.
 *
 * ADR 0031: Agent Inbox Runtime (R5 / v0.10.1).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzeAction } from '@calllint/action-analyzer'
import { loadPolicyOrDefault } from '@calllint/policy'
import { createReceipt } from '@calllint/core'
import type { ActionDescriptor } from '@calllint/action-analyzer'
import type { CommandResult } from './scan.js'
import type { ParsedArgs } from '../args.js'
import type { Verdict, Policy, Finding } from '@calllint/types'

interface InboxDeps {
  cwd: string
  toolVersion?: string
  generatedAt?: string
}

interface AgentInboxEvent {
  schema_version: string
  event_type: string
  timestamp: string
  source: {
    provider: string
    account_id?: string
    workspace_id?: string
  }
  normalized_content: {
    from: string
    [key: string]: unknown
  }
  action_candidate?: ActionDescriptor
  provenance?: unknown
}

export function inboxCommand(args: ParsedArgs, deps: InboxDeps): CommandResult {
  const subcommand = args.positionals[0]

  if (!subcommand || subcommand === 'help') {
    return {
      stdout: inboxHelp(),
      stderr: '',
      exitCode: 0,
    }
  }

  if (subcommand === 'inspect') {
    return inboxInspect(args, deps)
  }

  return {
    stdout: '',
    stderr: `Unknown inbox subcommand: ${subcommand}\nRun \`calllint inbox help\`.`,
    exitCode: 2,
  }
}

function inboxInspect(args: ParsedArgs, deps: InboxDeps): CommandResult {
  const eventFile = args.positionals[1]

  if (!eventFile) {
    return {
      stdout: '',
      stderr: 'Error: Missing event file\nUsage: calllint inbox inspect <normalized-event.json>',
      exitCode: 2,
    }
  }

  try {
    // Read and parse inbox event
    const absolutePath = resolve(deps.cwd, eventFile)
    const content = readFileSync(absolutePath, 'utf-8')
    const event: AgentInboxEvent = JSON.parse(content)

    // Validate schema version
    if (event.schema_version !== 'calllint.agent-inbox-event.v0') {
      return {
        stdout: '',
        stderr: `Error: Unsupported schema version: ${event.schema_version}\nExpected: calllint.agent-inbox-event.v0`,
        exitCode: 2,
      }
    }

    // Validate required fields
    if (!event.event_type || !event.timestamp || !event.source || !event.normalized_content) {
      return {
        stdout: '',
        stderr: 'Error: Invalid inbox event - missing required fields (event_type, timestamp, source, normalized_content)',
        exitCode: 2,
      }
    }

    // Load policy
    const policyPath = args.flags['policy'] as string | undefined
    const policy = loadPolicyOrDefault(policyPath ? resolve(deps.cwd, policyPath) : undefined)

    // Extract action_candidate (optional)
    const actionCandidate = event.action_candidate

    let verdict: Verdict
    let findings: Finding[]
    let stdout = ''

    if (!actionCandidate) {
      // No action candidate - event is informational only
      verdict = 'SAFE'
      findings = []

      if (args.flags['json']) {
        const report = {
          schema_version: 'calllint.inbox-report.v0',
          verdict,
          findings: [],
          event: {
            event_type: event.event_type,
            provider: event.source.provider,
            account_id: event.source.account_id,
            timestamp: event.timestamp,
          },
          action_candidate: null,
          scan_timestamp: deps.generatedAt || new Date().toISOString(),
        }
        stdout = JSON.stringify(report, null, 2)
      } else {
        stdout = `\n📬 Inbox Event: ${event.event_type} (${event.source.provider})\n` +
          `Verdict: ✅ SAFE\n` +
          `Action Candidate: None (informational only)\n`
      }
    } else {
      // Validate action_candidate schema
      if (actionCandidate.schema_version !== 'calllint.action.v0') {
        return {
          stdout: '',
          stderr: `Error: Unsupported action_candidate schema: ${actionCandidate.schema_version}\nExpected: calllint.action.v0`,
          exitCode: 2,
        }
      }

      // Analyze action via R4 analyzer
      findings = analyzeAction(actionCandidate)
      verdict = computeActionVerdict(findings, policy)

      if (args.flags['json']) {
        const report = {
          schema_version: 'calllint.inbox-report.v0',
          verdict,
          findings,
          event: {
            event_type: event.event_type,
            provider: event.source.provider,
            account_id: event.source.account_id,
            timestamp: event.timestamp,
          },
          action_candidate: {
            kind: actionCandidate.kind,
            schema_version: actionCandidate.schema_version,
          },
          scan_timestamp: deps.generatedAt || new Date().toISOString(),
        }
        stdout = JSON.stringify(report, null, 2)
      } else {
        const verdictEmoji = verdict === 'SAFE' ? '✅' : verdict === 'BLOCK' ? '⛔' : verdict === 'REVIEW' ? '⚠️' : '◇'
        stdout = `\n📬 Inbox Event: ${event.event_type} (${event.source.provider})\n` +
          `🔍 Action Candidate: ${actionCandidate.kind}\n` +
          `Verdict: ${verdictEmoji} ${verdict}\n` +
          `Findings: ${findings.length}\n`

        if (findings.length > 0) {
          stdout += '\n'
          for (const f of findings) {
            stdout += `  • ${f.id}: ${f.impact}\n`
          }
        }
      }
    }

    // Receipt generation (opt-in via --receipt)
    if (args.flags['receipt']) {
      const receiptError = writeInboxReceipt(event, content, verdict, findings, policy, args, deps)
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
      stderr = `Error: File not found: ${eventFile}`
    } else if (error instanceof SyntaxError) {
      stderr = `Error: Invalid JSON in ${eventFile}\n${error.message}`
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

function computeActionVerdict(
  findings: Finding[],
  policy: Policy
): Verdict {
  // Reuse R4 verdict logic (matches action.ts)
  if (findings.length === 0) {
    return 'SAFE'
  }

  const hasBlocker = findings.some(f => f.blocker || f.severity === 'critical')
  if (hasBlocker) {
    return 'BLOCK'
  }

  const hasHigh = findings.some(f => f.severity === 'high')
  if (hasHigh) {
    return 'REVIEW'
  }

  // Default to REVIEW if there are any findings
  return 'REVIEW'
}

function writeInboxReceipt(
  event: AgentInboxEvent,
  rawContent: string,
  verdict: Verdict,
  findings: Finding[],
  policy: Policy,
  args: ParsedArgs,
  deps: InboxDeps
): string | null {
  try {
    // Build target identifier
    const target = event.source.account_id
      ? `${event.source.provider}.${event.source.account_id}`
      : event.source.provider

    // Build a report structure compatible with createReceipt
    const inboxReport = {
      schema_version: 'calllint.inbox-report.v0',
      verdict,
      counts: {
        SAFE: verdict === 'SAFE' ? 1 : 0,
        REVIEW: verdict === 'REVIEW' ? 1 : 0,
        BLOCK: verdict === 'BLOCK' ? 1 : 0,
        UNKNOWN: verdict === 'UNKNOWN' ? 1 : 0,
      },
      reports: [{ findings }],
    }

    const toolVersion = deps.toolVersion || '0.0.0-dev'

    // Create receipt using R3 infrastructure (ADR 0028 schema)
    const receipt = createReceipt(
      {
        toolVersion,
        subject: { type: 'action', target }, // Use 'action' type (inbox extends action)
        inputForHash: rawContent,
        effectivePolicyForHash: policy || { policy: 'default' },
        scanReport: inboxReport,
        rulesetForHash: { tool: 'calllint', version: toolVersion },
        networkUsed: false,
      },
      deps.generatedAt || new Date().toISOString()
    )

    // Write receipt to file
    const receiptOutPath = (args.flags['receipt-out'] as string) || 'calllint-inbox-receipt.json'
    const absoluteReceiptPath = resolve(deps.cwd, receiptOutPath)
    writeFileSync(absoluteReceiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf-8')

    return null // Success
  } catch (error) {
    const err = error as Error
    return `Error writing receipt: ${err.message}`
  }
}

function inboxHelp(): string {
  return `
calllint inbox — Inspect normalized agent inbox events

USAGE
  calllint inbox inspect <normalized-event.json> [options]

DESCRIPTION
  Read a normalized agent inbox event (calllint.agent-inbox-event.v0),
  extract the optional action_candidate field, and analyze it using the
  R4 action analyzer. Returns SAFE/REVIEW/BLOCK/UNKNOWN verdict with
  evidence-backed findings.

  This command is a composition layer: it does NOT fetch messages, poll
  providers, or implement OAuth. Caller provides pre-normalized events.

OPTIONS
  --receipt              Write a receipt (calllint.receipt.v0) with subject.type="inbox"
  --receipt-out <path>   Receipt output path (default: calllint-receipt.json)
  --policy <path>        Custom policy file
  --json                 JSON output

EXIT CODES
  0  SAFE (no blockers observed)
  1  REVIEW / BLOCK / UNKNOWN
  2  Invalid input or schema violation

EXAMPLES
  # Inspect a normalized Gmail event with action candidate
  calllint inbox inspect gmail-reply.normalized.json

  # Generate receipt for audit trail
  calllint inbox inspect resend-invoice.json --receipt

  # JSON output for programmatic use
  calllint inbox inspect slack-mention.json --json

SEE ALSO
  docs/AGENT_INBOX_PREFLIGHT.md  — Usage guide + worked examples
  docs/AGENT_INBOX_ADAPTER_CONTRACT.md  — Provider → normalized transformation
  packages/fixtures/agent-inbox/  — 6 providers × 2 examples (reference)
  ADR 0031  — Agent Inbox Runtime design
  ADR 0030  — Agent Inbox Spec (v0.10.0 design)
  ADR 0029  — Unified External Action Preflight (R4)
`
}
