/**
 * E2E tests for `calllint inbox inspect` command (ADR 0031, R5 Runtime).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
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

test('inbox inspect: help', () => {
  const result = run(['inbox', 'help'], {
    cwd: FIXTURES_DIR,
    readStdin: () => '',
    now,
    generatedAt,
  })

  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /calllint inbox/)
  assert.match(result.stdout, /inspect/)
})

test('inbox inspect: missing file argument', () => {
  const result = run(['inbox', 'inspect'], {
    cwd: FIXTURES_DIR,
    readStdin: () => '',
    now,
    generatedAt,
  })

  assert.equal(result.exitCode, 2)
  assert.ok(result.stderr && result.stderr.includes('Missing event file'))
})

test('inbox inspect: file not found', () => {
  const result = runInboxInspect('nonexistent.json')

  assert.equal(result.exitCode, 2)
  assert.ok(result.stderr && result.stderr.includes('File not found'))
})

test('inbox inspect: invalid JSON', async () => {
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

  assert.equal(result.exitCode, 2)
  assert.ok(result.stderr && result.stderr.includes('Invalid JSON'))

  try {
    unlinkSync(invalidFile)
  } catch {
    // Ignore cleanup errors
  }
})

test('inbox inspect: unsupported schema version', async () => {
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

  assert.equal(result.exitCode, 2)
  assert.ok(result.stderr && result.stderr.includes('Unsupported schema version'))

  try {
    unlinkSync(badSchemaFile)
  } catch {
    // Ignore cleanup errors
  }
})

test('inbox inspect: event without action_candidate (informational)', () => {
  const result = runInboxInspect('discord/direct-message.normalized.json')

  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /SAFE/)
  assert.match(result.stdout, /None \(informational only\)/)
})

test('inbox inspect: gmail reply with secret headers (REVIEW)', () => {
  const result = runInboxInspect('gmail-api/reply-with-secret-headers.normalized.json')

  assert.equal(result.exitCode, 1) // REVIEW
  assert.match(result.stdout, /REVIEW/)
  assert.match(result.stdout, /email\.reply/)
})

test('inbox inspect: resend payment authorization (REVIEW)', () => {
  const result = runInboxInspect('smtp-imap/invoice-payment-candidate.normalized.json')

  assert.equal(result.exitCode, 1) // REVIEW
  assert.match(result.stdout, /REVIEW/)
})

test('inbox inspect: JSON output', () => {
  const result = runInboxInspect('slack/mention-detected.normalized.json', { json: true })

  assert.equal(result.exitCode, 0)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schema_version, 'calllint.inbox-report.v0')
  assert.ok(output.event)
  assert.equal(output.event.event_type, 'mention.detected')
  assert.equal(output.event.provider, 'slack')
})

test('inbox inspect: receipt generation', async () => {
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

  assert.equal(result.exitCode, 0)
  assert.ok(existsSync(receiptPath), 'Receipt file should exist')

  const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'))
  assert.equal(receipt.schema_version, 'calllint.receipt.v0')
  assert.ok(receipt.receipt_id.startsWith('clrec_'))
  assert.equal(receipt.tool.name, 'calllint')
  assert.equal(receipt.tool.version, '0.10.1-test')
  assert.equal(receipt.subject.type, 'action')
  assert.match(receipt.subject.target || '', /resend/)
  assert.equal(receipt.trust_boundaries.executed_target, false)
  assert.equal(receipt.trust_boundaries.network_used, false)
  assert.equal(receipt.trust_boundaries.llm_in_verdict_path, false)

  try {
    unlinkSync(receiptPath)
  } catch {
    // Ignore cleanup errors
  }
})

test('inbox inspect: all 12 fixture pairs parse successfully', async () => {
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
      assert.ok(result.exitCode === 0 || result.exitCode === 1,
        `${provider}/${file} should have valid exit code (0 or 1), got ${result.exitCode}`)
      assert.equal(result.stderr, '', `${provider}/${file} should have no stderr`)
      testedCount++
    }
  }

  assert.ok(testedCount >= 12, `Should test at least 12 fixtures, tested ${testedCount}`)
})
