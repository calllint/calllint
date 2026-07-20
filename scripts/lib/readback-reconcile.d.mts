// Type contract for the pure read-back reconcile core (new11 PR-03).
export type ReadbackStatus =
  | "MATCH"
  | "STALE"
  | "MISSING"
  | "MANUAL_REVIEW"
  | "UNREACHABLE"
  | "ERROR"

export const READBACK_STATUS: Record<ReadbackStatus, ReadbackStatus>
export const READBACK_ISSUE_MARKER: string

export interface ReconcileResult {
  id: string
  status: ReadbackStatus
  detail: string
  expected?: string
  observed?: string
}

export function isActionable(status: ReadbackStatus): boolean

export function reconcilePlatform(args: {
  expected: { package: string; repository: string; domain: string; version?: string }
  platform: Record<string, unknown> & { id: string; ownershipMethod: string }
  observed?: Record<string, unknown>
  fetchError?: { message: string; reachable?: boolean }
}): ReconcileResult

export function reconcileAll(args: {
  expected: { package: string; repository: string; domain: string; version?: string }
  platforms: Array<Record<string, unknown> & { id: string; ownershipMethod: string }>
  observations?: Record<string, { observed?: Record<string, unknown>; fetchError?: { message: string } }>
}): { results: ReconcileResult[]; actionable: ReconcileResult[]; summary: Record<string, number> }

export function renderIssueBody(args: {
  results: Array<{ id: string; status: string; detail: string }>
  actionable: unknown[]
  generatedAtIso: string
}): string
