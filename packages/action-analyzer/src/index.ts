/**
 * @calllint/action-analyzer — Action descriptor analyzer.
 *
 * Implements ADR 0029: Unified External Action Preflight.
 */

export { analyzeAction } from './analyzeAction.js'
export type { ActionDescriptor, ActionKind, ActionMetadata, ActionProvenance, RiskSymbol } from './types.js'
export { KIND_RISK_PROFILES } from './types.js'
