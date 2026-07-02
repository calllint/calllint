/**
 * E2E tests for `calllint inbox inspect` command (ADR 0031, R5 Runtime).
 */

import { describe, test, expect } from 'vitest'
import { resolve } from 'node:path'
import { run } from '../../../apps/cli/src/run.js'
import type { CommandResult } from '../../../apps/cli/src/commands/scan.js'

const FIXTURES_DIR = resolve(process.cwd(), 'packages/fixtures/agent-inbox')
const now = Date.now()
const generatedAt = new Date(now).toISOString()

function runInboxInspect(eventPath: string, flags: Record<string, unknown> = {}): CommandResult {
  const argv = ['inbox', 'inspect', eventPath]

  // Add flags
  for (const [key, value] of Object.entries(flags)) {
    if (value === true) {
      argv.push(`--${key}`)
    } else if (typeof value === 'string') {
      argv.push(`--${key}`, value)
    }
  }

  return run(argv, {
    cwd: FIXTURES_DIR,
    readStdin: () => '',
    now,
    generatedAt,
    toolVersion: '0.10.1-test',
  })
}

describe('inbox inspect', () => {
  test('help', () => {
    const result = run(['inbox', 'help'], {
      cwd: FIXTURES_DIR,
      readStdin: () => '',
      now,
      generatedAt,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('calllint inbox')
    expect(result.stdout).toContain('inspect')
  })

  test('missing file argument', () => {
    const result = run(['inbox', 'inspect'], {
      cwd: FIXTURES_DIR,
      readStdin: () => '',
      now,
      generatedAt,
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBeTruthy()
    expect(result.stderr!).toContain('Missing event file')
  })

  test('file not found', () => {
    const result = runInboxInspect('nonexistent.json')

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBeTruthy()
    expect(result.stderr!).toContain('File not found')
  })

  test('invalid JSON', async () => {
    const { writeFileSync, unlinkSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const tmpDir = mkdtempSync(join(tmpdir(), 'inbox-test-'))
    const invalidFile = join(tmpDir, 'invalid.json')
    writeFileSync(invalidFile, '{ invalid json', 'utf-8')

    const result = run(['inbox', 'inspect', invalidFile], {
      cwd: tmpDir,
      readStdin: () => '',
      now,
      generatedAt,
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBeTruthy()
    expect(result.stderr!).toContain('Invalid JSON')

    try {
      unlinkSync(invalidFile)
    } catch {
      // Ignore cleanup errors
    }
  })

  test('unsupported schema version', async () => {
    const { writeFileSync, unlinkSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const tmpDir = mkdtempSync(join(tmpdir(), 'inbox-test-'))
    const badSchemaFile = join(tmpDir, 'bad-schema.json')
    writeFileSync(badSchemaFile, JSON.stringify({
      schema_version: 'calllint.agent-inbox-event.v999',
      event_type: 'email.received',
      timestamp: '2026-07-02T12:00:00Z',
      source: { provider: 'test' },
      normalized_content: { from: 'test@example.com' },
    }), 'utf-8')

    const result = run(['inbox', 'inspect', badSchemaFile], {
      cwd: tmpDir,
      readStdin: () => '',
      now,
      generatedAt,
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBeTruthy()
    expect(result.stderr!).toContain('Unsupported schema version')

    try {
      unlinkSync(badSchemaFile)
    } catch {
      // Ignore cleanup errors
    }
  })

  test('event without action_candidate (informational)', () => {
    const result = runInboxInspect('discord/direct-message.normalized.json')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('SAFE')
    expect(result.stdout).toContain('None (informational only)')
  })

  test('gmail reply with secret headers (REVIEW)', () => {
    const result = runInboxInspect('gmail-api/reply-with-secret-headers.normalized.json')

    expect(result.exitCode).toBe(1) // REVIEW
    expect(result.stdout).toContain('REVIEW')
    expect(result.stdout).toContain('email.reply')
  })

  test('resend payment authorization (REVIEW)', () => {
    const result = runInboxInspect('smtp-imap/invoice-payment-candidate.normalized.json')

    expect(result.exitCode).toBe(1) // REVIEW
    expect(result.stdout).toContain('REVIEW')
  })

  test('JSON output', () => {
    const result = runInboxInspect('slack/mention-detected.normalized.json', { json: true })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.schema_version).toBe('calllint.inbox-report.v0')
    expect(output.event).toBeDefined()
    expect(output.event.event_type).toBe('mention.detected')
    expect(output.event.provider).toBe('slack')
  })

  test('receipt generation', async () => {
    const { existsSync, readFileSync, unlinkSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const tmpDir = mkdtempSync(join(tmpdir(), 'inbox-test-'))
    const eventFile = resolve(FIXTURES_DIR, 'resend/email-received.normalized.json')
    const receiptPath = join(tmpDir, 'test-receipt.json')

    const result = run(['inbox', 'inspect', eventFile, '--receipt', '--receipt-out', receiptPath], {
      cwd: tmpDir,
      readStdin: () => '',
      now,
      generatedAt,
      toolVersion: '0.10.1-test',
    })

    expect(result.exitCode).toBe(0)
    expect(existsSync(receiptPath)).toBe(true)

    const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'))
    expect(receipt.schema_version).toBe('calllint.receipt.v0')
    expect(receipt.receipt_id).toMatch(/^clrec_/)
    expect(receipt.tool.name).toBe('calllint')
    expect(receipt.tool.version).toBe('0.10.1-test')
    expect(receipt.subject.type).toBe('action')
    expect(receipt.subject.target).toMatch(/resend/)
    expect(receipt.trust_boundaries.executed_target).toBe(false)
    expect(receipt.trust_boundaries.network_used).toBe(false)
    expect(receipt.trust_boundaries.llm_in_verdict_path).toBe(false)

    try {
      unlinkSync(receiptPath)
    } catch {
      // Ignore cleanup errors
    }
  })

  test('all 12 fixture pairs parse successfully', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')

    const providers = ['discord', 'gmail-api', 'resend', 'sendgrid', 'slack', 'smtp-imap']
    let testedCount = 0

    for (const provider of providers) {
      const providerDir = join(FIXTURES_DIR, provider)
      if (!statSync(providerDir).isDirectory()) continue

      const files = readdirSync(providerDir).filter(f => f.endsWith('.normalized.json'))

      for (const file of files) {
        const result = runInboxInspect(`${provider}/${file}`)
        expect([0, 1]).toContain(result.exitCode) // SAFE or REVIEW/BLOCK/UNKNOWN
        expect(result.stderr).toBe('')
        testedCount++
      }
    }

    expect(testedCount).toBeGreaterThanOrEqual(12)
  })
})
