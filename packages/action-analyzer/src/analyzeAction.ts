/**
 * Action analyzer — main entry point.
 *
 * Applies detectors to an action descriptor and returns Finding[].
 * ADR 0029 §3: reuses existing risk engine, no new verdict logic.
 */

import type { Finding } from '@calllint/types'
import type { ActionDescriptor } from './types.js'
import { KIND_RISK_PROFILES } from './types.js'

/**
 * Analyze a planned external action.
 *
 * @param descriptor - Normalized action descriptor (from calllint.action.v0 JSON)
 * @returns Finding[] — same schema as MCP scan findings
 */
export function analyzeAction(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []

  // Validate schema version
  if (descriptor.schema_version !== 'calllint.action.v0') {
    findings.push({
      id: 'action.unknown-schema-version',
      title: 'Unknown action schema version',
      severity: 'medium',
      blocker: false,
      symbol: 'ACTION',
      riskClass: 'S3',
      mode: 'OBSERVED',
      confidence: 'high',
      detectionMethod: 'config-analysis',
      evidence: [{
        type: 'config',
        path: 'schema_version',
        value: descriptor.schema_version,
      }],
      impact: `Unknown action schema version: ${descriptor.schema_version}`,
      fix: 'Use calllint.action.v0 schema version',
    })
    return findings
  }

  // Check if kind is recognized
  const riskProfile = KIND_RISK_PROFILES[descriptor.kind]
  if (!riskProfile) {
    findings.push({
      id: 'action.unknown-kind',
      title: 'Unknown action kind',
      severity: 'medium',
      blocker: false,
      symbol: 'ACTION',
      riskClass: 'S3',
      mode: 'OBSERVED',
      confidence: 'high',
      detectionMethod: 'config-analysis',
      evidence: [{
        type: 'config',
        path: 'kind',
        value: descriptor.kind,
      }],
      impact: `Unknown action kind: ${descriptor.kind}`,
      fix: 'Use one of the 9 defined action kinds (email.reply, email.forward, message.post, a2a.delegate, payment.authorize, account.register, github.write, npm.publish, cloud.modify)',
    })
    return findings
  }

  // Apply kind-specific detectors
  switch (descriptor.kind) {
    case 'email.reply':
    case 'email.forward':
      findings.push(...analyzeEmail(descriptor))
      break
    case 'message.post':
      findings.push(...analyzeMessaging(descriptor))
      break
    case 'a2a.delegate':
      findings.push(...analyzeDelegate(descriptor))
      break
    case 'payment.authorize':
      findings.push(...analyzePayment(descriptor))
      break
    case 'account.register':
      findings.push(...analyzeRegistration(descriptor))
      break
    case 'github.write':
      findings.push(...analyzeGitHub(descriptor))
      break
    case 'npm.publish':
      findings.push(...analyzeNpmPublish(descriptor))
      break
    case 'cloud.modify':
      findings.push(...analyzeCloud(descriptor))
      break
  }

  // Cross-cutting checks (apply to all kinds)
  findings.push(...analyzeSecretShapedHeaders(descriptor))

  return findings
}

/**
 * Analyze email actions (reply / forward).
 */
function analyzeEmail(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  const metadata = descriptor.metadata || {}

  // Check for attachments without hashes (ADR 0029 resolved question 1)
  const hasAttachments = (descriptor.parameters as any).has_attachments
  const attachmentHashes = metadata.attachment_hashes || []

  if (hasAttachments && attachmentHashes.length === 0) {
    findings.push({
      id: 'action.unverified-attachment',
      title: 'Unverified email attachments',
      severity: 'high',
      blocker: false,
      symbol: 'FILES',
      riskClass: 'S2',
      mode: 'OBSERVED',
      confidence: 'high',
      detectionMethod: 'config-analysis',
      evidence: [{
        type: 'config',
        path: 'parameters.has_attachments',
        value: String(hasAttachments),
      }],
      impact: 'Email action has attachments but no attachment_hashes provided',
      fix: 'Provide SHA-256 hashes for all attachments in metadata.attachment_hashes',
    })
  }

  return findings
}

/**
 * Analyze messaging actions (Slack, Discord, etc).
 */
function analyzeMessaging(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  // Messaging-specific checks would go here
  return findings
}

/**
 * Analyze agent-to-agent delegation.
 */
function analyzeDelegate(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  const metadata = descriptor.metadata || {}

  // Check for unverified delegate target (ADR 0029 resolved question 2)
  const delegateTarget = metadata.delegate_target
  if (!delegateTarget) {
    findings.push({
      id: 'action.missing-delegate-target',
      title: 'Missing delegate target',
      severity: 'high',
      blocker: false,
      symbol: 'NETWORK',
      riskClass: 'S3',
      mode: 'OBSERVED',
      confidence: 'high',
      detectionMethod: 'config-analysis',
      evidence: [{
        type: 'config',
        path: 'metadata.delegate_target',
        value: 'null',
      }],
      impact: 'Agent delegation missing delegate_target in metadata',
      fix: 'Specify the delegate target (agent ID, API endpoint, or service name)',
    })
  } else if (typeof delegateTarget === 'string' && delegateTarget.startsWith('http://')) {
    findings.push({
      id: 'action.insecure-delegate-target',
      title: 'Insecure delegate target',
      severity: 'medium',
      blocker: false,
      symbol: 'NETWORK',
      riskClass: 'S3',
      mode: 'OBSERVED',
      confidence: 'high',
      detectionMethod: 'config-analysis',
      evidence: [{
        type: 'config',
        path: 'metadata.delegate_target',
        value: delegateTarget,
      }],
      impact: 'Delegate target uses insecure HTTP',
      fix: 'Use HTTPS for delegate targets',
    })
  }

  return findings
}

/**
 * Analyze payment authorization.
 */
function analyzePayment(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  const metadata = descriptor.metadata || {}

  // Check for monetary amount
  const amount = metadata.amount
  if (typeof amount === 'number' && amount > 0) {
    findings.push({
      id: 'action.financial-observed',
      title: 'Financial transaction observed',
      severity: 'high',
      blocker: false,
      symbol: 'MONEY',
      riskClass: 'S5',
      mode: 'OBSERVED',
      confidence: 'high',
      detectionMethod: 'config-analysis',
      evidence: [{
        type: 'config',
        path: 'metadata.amount',
        value: String(amount),
      }],
      impact: `Payment authorization for ${metadata.currency || 'unknown currency'} ${amount}`,
      fix: 'Verify payment amount and recipient before authorizing',
    })
  }

  return findings
}

/**
 * Analyze account registration.
 */
function analyzeRegistration(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  // Registration-specific checks would go here
  return findings
}

/**
 * Analyze GitHub write operations.
 */
function analyzeGitHub(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  // GitHub-specific checks would go here
  return findings
}

/**
 * Analyze npm publish.
 */
function analyzeNpmPublish(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  // npm-specific checks would go here (name squatting, version float, etc.)
  return findings
}

/**
 * Analyze cloud infrastructure modifications.
 */
function analyzeCloud(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  // Cloud-specific checks would go here
  return findings
}

/**
 * Check for secret-shaped header keys (cross-cutting).
 */
function analyzeSecretShapedHeaders(descriptor: ActionDescriptor): Finding[] {
  const findings: Finding[] = []
  const metadata = descriptor.metadata || {}
  const headerKeys = metadata.header_keys || []

  const secretPatterns = ['authorization', 'api-key', 'api_key', 'token', 'secret', 'password', 'bearer']

  for (const key of headerKeys) {
    const lowerKey = key.toLowerCase()
    if (secretPatterns.some(pattern => lowerKey.includes(pattern))) {
      findings.push({
        id: 'secrets.env-key',
        title: 'Secret-shaped header key',
        severity: 'medium',
        blocker: false,
        symbol: 'SECRETS',
        riskClass: 'S2',
        mode: 'OBSERVED',
        confidence: 'medium',
        detectionMethod: 'config-analysis',
        evidence: [{
          type: 'config',
          path: 'metadata.header_keys',
          value: key,
        }],
        impact: `Header key resembles a secret: ${key}`,
        fix: 'Verify that secret headers are properly secured and not logged',
      })
      break // Only report once per action
    }
  }

  return findings
}
