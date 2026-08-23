/**
 * WHERE THE `discoverySurface` VALUE COMES FROM (new19 §21, §9 feedback loop).
 *
 * The contract, sanitizer, ingress, aggregation and D1 column for `discoverySurface`
 * all shipped before this file existed. They formed a complete conduit with NO SOURCE:
 * nothing in the CLI ever set the field, so every event carried the storage default and
 * the question the dimension exists to answer — "which discovery surface actually
 * works?" — was unanswerable no matter how much traffic arrived. This module is that
 * missing producer.
 *
 * THE VALUE IS CAPTURED AT INSTALL TIME AND PERSISTED, NOT RE-DERIVED PER RUN.
 * Provenance is knowable exactly once. Three weeks after `npx calllint`, a `scan` run
 * has no way to recover which shelf the user came through — the environment that knew
 * is gone. So the surface is read from the environment on the run that creates the
 * installation identity and stored beside it; later runs stamp the stored value. A
 * per-run read would report "unattributed" for every run after the first and make the
 * aggregate a measure of install recency rather than of discovery.
 *
 * WHY AN OFF-VOCABULARY VALUE IS REJECTED HERE AND NOT LEFT TO THE SANITIZER.
 * `sanitizeEvent` THROWS on an unknown `discoverySurface`, and `emit()` catches that and
 * returns `dropped` — discarding the ENTIRE EVENT, not just the bad dimension. So a
 * typo'd env var, or a shelf name added upstream before this enum learns it, would
 * silently delete real usage data: the install would look like it never ran. Validating
 * at the source converts that into a dropped *dimension* (the event still counts, under
 * a narrower key), which is the strictly safer failure. The contract's throw remains the
 * backstop; this is the guard that keeps it from ever firing on a live path.
 *
 * NOT A NEW CONSENT SURFACE. This reads an env var and writes a word from a 6-member
 * enum into the existing state file. It does not enable telemetry, does not widen the
 * gate, and is inert while telemetry is off (the default) — a stored surface with a
 * gated emitter still emits nothing.
 */
import { DISCOVERY_SURFACES, type DiscoverySurface } from "@calllint/telemetry-contract"

/**
 * The env var an installer/shelf sets to declare how the user arrived.
 *
 * Deliberately explicit rather than sniffed. CallLint could guess from ambient signals
 * (npm user-agent, a parent process name, an MCP-ish env var), but a guess would be
 * wrong in exactly the direction that flatters us: ambiguous installs would land on
 * whichever surface we happened to test, and the resulting number would look like
 * evidence. An unset variable honestly means "unattributed".
 */
export const DISCOVERY_SURFACE_ENV = "CALLLINT_DISCOVERY_SURFACE"

/**
 * Read + validate the declared discovery surface.
 *
 * Returns `undefined` for absent, empty, whitespace, or off-vocabulary input — all four
 * mean the same thing downstream ("no attribution"), and none of them may become a
 * stored value. Never throws: this sits on the install path, and a malformed env var
 * must not be able to fail an install.
 */
export function readDiscoverySurface(
  env: Record<string, string | undefined>,
): DiscoverySurface | undefined {
  const raw = env[DISCOVERY_SURFACE_ENV]
  if (typeof raw !== "string") return undefined
  const value = raw.trim()
  if (value === "") return undefined
  // Exact match against the contract enum — no case-folding, no aliasing. The published
  // surface types are lowercase kebab and the ingress compares them byte-for-byte; a
  // value normalized here but not there would pass locally and be rejected on arrival.
  if (!(DISCOVERY_SURFACES as readonly string[]).includes(value)) return undefined
  return value as DiscoverySurface
}
