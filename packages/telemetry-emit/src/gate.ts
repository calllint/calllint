/**
 * The emission gate (new11 §3.5, ADR 0049 §2.6). PURE decision: given a source, the
 * caller's consent state, and the environment, may this surface emit right now?
 *
 * This is the ONLY place tier policy is applied at emit time. It mirrors the contract's
 * `TIER_POLICY` (telemetry-contract/tiers.ts) and adds the two runtime overrides the
 * privacy doc promises: a global env kill-switch, and consent-first for local CLI.
 *
 *   - `CALLLINT_TELEMETRY=0` (or "false"/"off") disables EVERY tier — the documented
 *     universal opt-out ("every tier is disableable").
 *   - Local CLI (`source=cli`) is default-OFF and requires explicit `consented=true`
 *     (first-run consent). No env value can force it on without consent.
 *   - The three observed tiers (server/install/ci) are on by default; `ci` is the
 *     "on-with-notice" tier and honors the same env kill-switch.
 *
 * No clock, no fs, no network. Deterministic in (source, state).
 */
import { isEnabledByDefault, type TelemetrySource } from "@calllint/telemetry-contract"

export interface GateState {
  /** Explicit user consent (only meaningful / required for the local `cli` tier). */
  consented?: boolean
  /** Environment for the kill-switch; injected for testability. */
  env?: Record<string, string | undefined>
}

/** The disable values the env kill-switch recognizes (case-insensitive). */
const DISABLED_VALUES = new Set(["0", "false", "off", "no"])

/** True when the global env kill-switch is set to a disable value. */
export function isTelemetryDisabledByEnv(env: Record<string, string | undefined>): boolean {
  const v = env["CALLLINT_TELEMETRY"]
  return v != null && DISABLED_VALUES.has(v.trim().toLowerCase())
}

/**
 * The single emit-time authorization check. Fails CLOSED: any ambiguity (unknown
 * source, missing consent for cli) resolves to "do not emit".
 */
export function shouldEmit(source: TelemetrySource, state: GateState = {}): boolean {
  const env = state.env ?? {}
  // Universal kill-switch beats every tier default.
  if (isTelemetryDisabledByEnv(env)) return false
  // Local CLI: consent-first, default off. No env can force it on without consent.
  if (source === "cli") return state.consented === true
  // Observed tiers (server/install/ci): on unless the kill-switch fired above.
  return isEnabledByDefault(source)
}
