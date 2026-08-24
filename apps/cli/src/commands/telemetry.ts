/**
 * `calllint telemetry` command family — consent management.
 *
 * Subcommands:
 *   status  — show current telemetry state
 *   enable  — opt in, generate installation ID
 *   disable — opt out
 *   reset   — rotate installation ID
 */
import { loadState, enableTelemetry, disableTelemetry, resetTelemetry } from "../state.js"

interface TelemetryArgs {
  positional: string[]
}

export async function executeTelemetryCommand(args: TelemetryArgs): Promise<number> {
  const subcommand = args.positional[1]

  switch (subcommand) {
    case "status":
      return await telemetryStatus()
    case "enable":
      return await telemetryEnable()
    case "disable":
      return await telemetryDisable()
    case "reset":
      return await telemetryReset()
    default:
      console.error(`Unknown telemetry subcommand: ${subcommand ?? "(none)"}`)
      console.error("Available: status, enable, disable, reset")
      return 1
  }
}

async function telemetryStatus(): Promise<number> {
  const state = await loadState()
  const enabled = state.telemetryEnabled

  if (enabled) {
    console.log("Anonymous usage telemetry: ON\n")
    console.log("Installation identity:")
    console.log("  anonymous, local, resettable\n")
  } else {
    console.log("Anonymous usage telemetry: OFF\n")
    console.log("When enabled, CallLint records coarse usage events such as")
    console.log("preflight completion and verdict category.\n")
    console.log("Never sent:")
    console.log("  config contents")
    console.log("  file paths")
    console.log("  commands")
    console.log("  secret values")
    console.log("  prompts")
    console.log("  finding evidence\n")
    console.log("Enable:")
    console.log("  calllint telemetry enable")
  }

  return 0
}

async function telemetryEnable(): Promise<number> {
  const state = await enableTelemetry(process.env)
  console.log("✓ Telemetry enabled\n")
  console.log("CallLint will record anonymous usage events:")
  console.log("  - Preflight completions")
  console.log("  - Verdict categories (SAFE/REVIEW/BLOCK/UNKNOWN)")
  console.log("  - Aggregate dimensions (host, input kind)\n")
  /* DISCLOSED, NOT SILENT. If a surface was captured, an extra dimension is now stored and
   * will ride on every event — the user must be able to see that from the command that
   * turned it on, not by reading the state file. Printed only when non-empty: an
   * "unattributed" line on every install would be noise about nothing. */
  if (state.discoverySurface) {
    console.log("Discovery attribution (how this install was reached):")
    console.log(`  ${state.discoverySurface} — a surface category, not an identifier`)
    console.log("  Cleared by: calllint telemetry reset\n")
  }
  console.log("Never sent:")
  console.log("  - Config contents")
  console.log("  - File paths or commands")
  console.log("  - Secret values")
  console.log("  - Prompts or finding evidence\n")
  console.log("Your installation ID is:")
  console.log("  Anonymous (crypto.randomUUID)")
  console.log("  Not derived from hardware")
  console.log("  Resettable (calllint telemetry reset)")
  return 0
}

async function telemetryDisable(): Promise<number> {
  await disableTelemetry()
  console.log("✓ Telemetry disabled")
  console.log("\nNo usage events will be sent.")
  console.log("Your installation ID is preserved (for potential re-enable).")
  return 0
}

async function telemetryReset(): Promise<number> {
  const stateBefore = await loadState()
  await resetTelemetry()
  const stateAfter = await loadState()

  console.log("✓ Telemetry reset complete\n")
  if (stateBefore.telemetryEnabled) {
    console.log("Installation ID rotated to a fresh random identity.")
    console.log("Telemetry remains: ON")
  } else {
    console.log("Installation ID cleared.")
    console.log("Telemetry remains: OFF")
  }
  // Deliberately NOT printed: the installation ID itself, in full or truncated. It is a
  // pseudonymous identifier, and a terminal is a logged, screen-shared, CI-captured
  // surface. Printing a 16-char prefix also contradicted the "Old ID: (removed)" line
  // directly above it — it disclosed the NEW id while claiming discretion about the old
  // one. The rotation is the fact worth reporting; the value is not. This restores the
  // invariant every OTHER surface already held: `telemetry status` describes the identity
  // ("anonymous, local, resettable") and never prints it, so this was the only leak.
  if (stateBefore.anonymousInstallationId && stateAfter.anonymousInstallationId) {
    console.log("\nInstallation identity rotated.")
  }
  return 0
}

