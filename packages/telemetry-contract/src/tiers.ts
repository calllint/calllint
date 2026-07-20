/**
 * The four telemetry tiers (ADR 0049 §2.6 / new11-integration §2.6, BINDING).
 *
 * Every tier is disableable (new11 §3.5 只要求可关闭). Local CLI is the ONLY
 * default-off tier — a personal machine never phones home without first-run
 * consent, preserving the offline/privacy brand (new10 §0.4). The other three
 * tiers observe your own web/API property, the click/redirect surface, or a CI
 * org-controller, so they are on-by-default (CI with a documented notice).
 */
import type { TelemetrySource } from "./events.js"

export interface TierPolicy {
  source: TelemetrySource
  /** Whether telemetry is ON without any explicit user action. */
  defaultEnabled: boolean
  /** True when the surface must show a notice / obtain consent before emitting. */
  requiresNotice: boolean
  rationale: string
}

export const TIER_POLICY: Record<TelemetrySource, TierPolicy> = {
  server: {
    source: "server",
    defaultEnabled: true,
    requiresNotice: false,
    rationale: "Own web/API property; no user machine involved (funnel top).",
  },
  install: {
    source: "install",
    defaultEnabled: true,
    requiresNotice: false,
    rationale: "Attributed at the click/redirect surface, not on the machine.",
  },
  ci: {
    source: "ci",
    defaultEnabled: true,
    requiresNotice: true,
    rationale: "The installing org is the controller; standard for CI tooling; disableable.",
  },
  cli: {
    source: "cli",
    defaultEnabled: false,
    requiresNotice: true,
    rationale: "Personal machine → consent-first (opt-in, default off, first-run consent).",
  },
}

/** Is this surface allowed to emit without explicit opt-in? Local CLI is never. */
export function isEnabledByDefault(source: TelemetrySource): boolean {
  return TIER_POLICY[source].defaultEnabled
}
