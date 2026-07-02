/**
 * Action analyzer types — internal representation for action inspection.
 *
 * ADR 0029: calllint.action.v0 schema → ActionDescriptor → Finding[]
 */

/**
 * Normalized action descriptor (parsed from calllint.action.v0 JSON).
 */
export interface ActionDescriptor {
  /** Schema version (always "calllint.action.v0" for this implementation) */
  schema_version: string

  /** Action kind — one of 9 closed vocabulary values */
  kind: ActionKind

  /** Kind-specific parameters (recipient, amount, target, scope) */
  parameters: Record<string, unknown>

  /** Observed metadata (header keys, hashes, lengths, OAuth scopes) */
  metadata?: ActionMetadata

  /** Optional provenance (agent session ID, timestamp) */
  provenance?: ActionProvenance
}

/**
 * Action kinds (ADR 0029 §2).
 */
export type ActionKind =
  | 'email.reply'
  | 'email.forward'
  | 'message.post'
  | 'a2a.delegate'
  | 'payment.authorize'
  | 'account.register'
  | 'github.write'
  | 'npm.publish'
  | 'cloud.modify'

/**
 * Observed metadata about the action.
 */
export interface ActionMetadata {
  header_keys?: string[]
  attachment_hashes?: string[]
  subject_length?: number
  body_length?: number
  oauth_scopes?: string[]
  delegate_target?: string
  amount?: number
  currency?: string
  recipient_account_hash?: string
  [key: string]: unknown
}

/**
 * Optional provenance tracking.
 */
export interface ActionProvenance {
  agent_session?: string
  workflow_step?: string
  timestamp?: string
  [key: string]: unknown
}

/**
 * Risk symbols that apply to an action kind (ADR 0029 §2).
 */
export type RiskSymbol =
  | 'PROMPT'
  | 'SUPPLY'
  | 'FILES'
  | 'NETWORK'
  | 'EXEC'
  | 'ACTION'
  | 'MONEY'
  | 'SECRETS'

/**
 * Kind → risk profile mapping (ADR 0029 §2 table).
 */
export const KIND_RISK_PROFILES: Record<ActionKind, RiskSymbol[]> = {
  'email.reply': ['ACTION', 'SECRETS', 'PROMPT'],
  'email.forward': ['ACTION', 'SECRETS', 'FILES', 'PROMPT'],
  'message.post': ['ACTION', 'SECRETS'],
  'a2a.delegate': ['ACTION', 'NETWORK', 'PROMPT'],
  'payment.authorize': ['MONEY', 'SECRETS'],
  'account.register': ['ACTION', 'SECRETS', 'SUPPLY'],
  'github.write': ['ACTION', 'SUPPLY'],
  'npm.publish': ['ACTION', 'SUPPLY', 'MONEY'],
  'cloud.modify': ['ACTION', 'EXEC', 'MONEY'],
}
