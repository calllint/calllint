/**
 * Action analyzer unit tests.
 */

import { describe, it, expect } from 'vitest'
import { analyzeAction, KIND_RISK_PROFILES } from '../src/index.js'
import type { ActionDescriptor } from '../src/types.js'

describe('analyzeAction', () => {
  it('should return empty findings for a clean email.reply', () => {
    const descriptor: ActionDescriptor = {
      schema_version: 'calllint.action.v0',
      kind: 'email.reply',
      parameters: {
        to: ['user@example.com'],
        subject: 'Re: Test',
        has_attachments: false,
      },
      metadata: {
        subject_length: 10,
        body_length: 50,
      },
    }

    const findings = analyzeAction(descriptor)
    expect(findings).toHaveLength(0)
  })

  it('should detect missing attachment hashes', () => {
    const descriptor: ActionDescriptor = {
      schema_version: 'calllint.action.v0',
      kind: 'email.reply',
      parameters: {
        to: ['user@example.com'],
        subject: 'Re: Test',
        has_attachments: true,
      },
      metadata: {},
    }

    const findings = analyzeAction(descriptor)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some(f => f.id === 'action.unverified-attachment')).toBe(true)
    const finding = findings.find(f => f.id === 'action.unverified-attachment')
    expect(finding?.symbol).toBe('FILES')
  })

  it('should detect secret-shaped header keys', () => {
    const descriptor: ActionDescriptor = {
      schema_version: 'calllint.action.v0',
      kind: 'email.reply',
      parameters: {
        to: ['admin@example.com'],
        subject: 'Re: Access',
        has_attachments: false,
      },
      metadata: {
        header_keys: ['Authorization', 'X-API-Token'],
      },
    }

    const findings = analyzeAction(descriptor)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some(f => f.id === 'secrets.env-key')).toBe(true)
  })

  it('should detect missing delegate target', () => {
    const descriptor: ActionDescriptor = {
      schema_version: 'calllint.action.v0',
      kind: 'a2a.delegate',
      parameters: {
        task: 'summarize',
      },
      metadata: {},
    }

    const findings = analyzeAction(descriptor)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some(f => f.id === 'action.missing-delegate-target')).toBe(true)
  })

  it('should detect insecure HTTP delegate target', () => {
    const descriptor: ActionDescriptor = {
      schema_version: 'calllint.action.v0',
      kind: 'a2a.delegate',
      parameters: {
        task: 'process',
      },
      metadata: {
        delegate_target: 'http://insecure.example.com/api',
      },
    }

    const findings = analyzeAction(descriptor)
    expect(findings.some(f => f.id === 'action.insecure-delegate-target')).toBe(true)
  })

  it('should detect financial amount in payment.authorize', () => {
    const descriptor: ActionDescriptor = {
      schema_version: 'calllint.action.v0',
      kind: 'payment.authorize',
      parameters: {
        recipient: 'merchant-xyz',
        amount: 99.99,
      },
      metadata: {
        amount: 99.99,
        currency: 'USD',
      },
    }

    const findings = analyzeAction(descriptor)
    expect(findings.some(f => f.id === 'action.financial-observed')).toBe(true)
    const finding = findings.find(f => f.id === 'action.financial-observed')
    if (finding) {
      expect(finding.symbol).toBe('MONEY')
      expect(finding.riskClass).toBe('S5')
    }
  })

  it('should reject unknown schema version', () => {
    const descriptor: ActionDescriptor = {
      schema_version: 'calllint.action.v999',
      kind: 'email.reply',
      parameters: {},
    }

    const findings = analyzeAction(descriptor)
    expect(findings.length).toBeGreaterThan(0)
    if (findings[0]) {
      expect(findings[0].id).toBe('action.unknown-schema-version')
    }
  })

  it('should reject unknown action kind', () => {
    const descriptor: ActionDescriptor = {
      schema_version: 'calllint.action.v0',
      kind: 'unknown.kind' as any,
      parameters: {},
    }

    const findings = analyzeAction(descriptor)
    expect(findings.length).toBeGreaterThan(0)
    if (findings[0]) {
      expect(findings[0].id).toBe('action.unknown-kind')
    }
  })
})

describe('KIND_RISK_PROFILES', () => {
  it('should define risk profiles for all 9 kinds', () => {
    const expectedKinds = [
      'email.reply',
      'email.forward',
      'message.post',
      'a2a.delegate',
      'payment.authorize',
      'account.register',
      'github.write',
      'npm.publish',
      'cloud.modify',
    ]

    for (const kind of expectedKinds) {
      expect(KIND_RISK_PROFILES).toHaveProperty(kind)
      expect(Array.isArray(KIND_RISK_PROFILES[kind as keyof typeof KIND_RISK_PROFILES])).toBe(true)
    }
  })

  it('should map email.reply to ACTION + SECRETS + PROMPT', () => {
    const profile = KIND_RISK_PROFILES['email.reply']
    expect(profile).toContain('ACTION')
    expect(profile).toContain('SECRETS')
    expect(profile).toContain('PROMPT')
  })

  it('should map payment.authorize to MONEY + SECRETS', () => {
    const profile = KIND_RISK_PROFILES['payment.authorize']
    expect(profile).toContain('MONEY')
    expect(profile).toContain('SECRETS')
  })
})
