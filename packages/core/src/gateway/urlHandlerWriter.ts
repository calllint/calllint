/**
 * The registration writer — the SECOND live writer in this repo, and the reason this
 * batch carries an ADR.
 *
 * `applyPlan` (packages/install-planner) remains the only writer of host CONFIG: it is
 * JSON-patch over a JSON file, and a registry value or an XDG mimeapps association is
 * neither. So this writer exists, and it is deliberately the narrowest thing that can
 * work: it can create/remove exactly the `HandlerRecord` kinds `planUrlHandler`
 * produces, and it has no code path that takes a caller-supplied verb.
 *
 * It inherits the shipped discipline rather than inventing one:
 *
 *   PLAN → planDigest → explicit `--approve <digest>` → APPLY → VERIFY → rollback
 *
 * Rollback is REAL, not best-effort. Every record's prior state is captured BEFORE the
 * first mutation; if verification fails, the captured states are restored in reverse
 * order. A record that did not exist before is removed rather than left with an empty
 * value — "restored" must mean the machine is as it was, including absence.
 *
 * All I/O is behind `HandlerRegistry`, so the same sequence runs in-memory under test
 * and against the real registry/filesystem in production — the pattern `ConfigFs`
 * already established for the config writer.
 */
import { hashJson } from "@calllint/fingerprint"
import type { HandlerRecord, UrlHandlerPlan } from "./urlHandlerPlan.js"

/**
 * The capability the writer needs. Narrow on purpose: there is no `exec`, no `spawn`,
 * and no generic "write anything" primitive, so the blast radius of this writer is
 * bounded by this interface rather than by review vigilance.
 */
export interface HandlerRegistry {
  /** Current value, or null when the record is absent. */
  read(record: HandlerRecord): string | null
  /** Create or overwrite the record. */
  write(record: HandlerRecord): void
  /** Remove the record entirely (absence, not an empty value). */
  remove(record: HandlerRecord): void
}

/** The digest a human approves. Covers the platform AND every record. */
export function planDigest(plan: UrlHandlerPlan): string {
  return hashJson(plan)
}

export type ApplyOutcome =
  | "REGISTERED"
  | "UNREGISTERED"
  | "ALREADY_APPLIED"
  | "APPROVAL_MISMATCH"
  | "UNSUPPORTED_PLATFORM"
  | "VERIFY_FAILED_ROLLED_BACK"
  | "VERIFY_FAILED_ROLLBACK_INCOMPLETE"

export interface ApplyResult {
  readonly outcome: ApplyOutcome
  readonly planDigest: string
  /** Records actually mutated. Empty on every refusal path. */
  readonly written: readonly string[]
  readonly detail?: string
}

/** A record's identity for reporting — never its value (a value may hold a path). */
function label(r: HandlerRecord): string {
  return r.kind === "REGISTRY_KEY" ? `${r.path}::${r.valueName || "(default)"}` : r.path
}

/** The value a record should hold once applied. */
function desiredValue(r: HandlerRecord): string {
  switch (r.kind) {
    case "REGISTRY_KEY":
      return r.value
    case "DESKTOP_FILE":
      return r.contents
    case "MIME_DEFAULT":
      return `${r.scheme}=${r.desktopFile}`
  }
}

/**
 * Register the handler. Writes ONLY when `approvalDigest` equals the plan digest the
 * human reviewed — a mismatch writes nothing, exactly like the config writer.
 */
export function applyUrlHandler(
  plan: UrlHandlerPlan,
  approvalDigest: string,
  registry: HandlerRegistry,
): ApplyResult {
  const digest = planDigest(plan)

  if (!plan.supported) {
    return { outcome: "UNSUPPORTED_PLATFORM", planDigest: digest, written: [], detail: plan.detail }
  }
  if (approvalDigest !== digest) {
    return {
      outcome: "APPROVAL_MISMATCH",
      planDigest: digest,
      written: [],
      detail: "approval must name the exact plan digest you reviewed",
    }
  }

  // Idempotency by EFFECT, not bookkeeping: if every record already holds its desired
  // value, this is already in effect. Checked BEFORE any write so a re-register is
  // never mis-read as a change.
  if (plan.records.every((r) => registry.read(r) === desiredValue(r))) {
    return { outcome: "ALREADY_APPLIED", planDigest: digest, written: [] }
  }

  // Capture prior state BEFORE the first mutation — this is what makes rollback real.
  const prior = plan.records.map((r) => ({ record: r, value: registry.read(r) }))
  const written: string[] = []

  for (const r of plan.records) {
    registry.write(r)
    written.push(label(r))
  }

  // Verify by re-reading. A write that "succeeded" but did not take effect must not be
  // reported as registered.
  const bad = plan.records.find((r) => registry.read(r) !== desiredValue(r))
  if (bad !== undefined) {
    const failed = rollback(prior, registry)
    return {
      outcome: failed.length === 0 ? "VERIFY_FAILED_ROLLED_BACK" : "VERIFY_FAILED_ROLLBACK_INCOMPLETE",
      planDigest: digest,
      written,
      detail:
        failed.length === 0
          ? `verification failed at ${label(bad)}; all records restored`
          : `verification failed at ${label(bad)}; could not restore: ${failed.join(", ")}`,
    }
  }

  return { outcome: "REGISTERED", planDigest: digest, written }
}

/** Restore captured states in reverse order. Returns the labels it could NOT restore. */
function rollback(
  prior: readonly { readonly record: HandlerRecord; readonly value: string | null }[],
  registry: HandlerRegistry,
): string[] {
  const failed: string[] = []
  for (let i = prior.length - 1; i >= 0; i--) {
    const { record, value } = prior[i]!
    try {
      // Absence is a state: a record that did not exist is REMOVED, not blanked.
      if (value === null) registry.remove(record)
      else registry.write(withValue(record, value))
      const now = registry.read(record)
      if (now !== value) failed.push(label(record))
    } catch {
      failed.push(label(record))
    }
  }
  return failed
}

/**
 * Rebuild a record carrying a captured value. Constructed explicitly per kind — a
 * spread-and-cast would compile while silently restoring the wrong field.
 */
function withValue(r: HandlerRecord, value: string): HandlerRecord {
  switch (r.kind) {
    case "REGISTRY_KEY":
      return { kind: "REGISTRY_KEY", path: r.path, valueName: r.valueName, value }
    case "DESKTOP_FILE":
      return { kind: "DESKTOP_FILE", path: r.path, contents: value }
    case "MIME_DEFAULT": {
      // `read` returns `${scheme}=${desktopFile}`; restore the association half. An
      // unparseable capture keeps the planned association rather than inventing one.
      const eq = value.indexOf("=")
      return {
        kind: "MIME_DEFAULT",
        path: r.path,
        scheme: r.scheme,
        desktopFile: eq === -1 ? r.desktopFile : value.slice(eq + 1),
      }
    }
  }
}

/** Remove the handler. Absent records are not an error — unregister is idempotent. */
export function unregisterUrlHandler(
  plan: UrlHandlerPlan,
  approvalDigest: string,
  registry: HandlerRegistry,
): ApplyResult {
  const digest = planDigest(plan)

  if (!plan.supported) {
    return { outcome: "UNSUPPORTED_PLATFORM", planDigest: digest, written: [], detail: plan.detail }
  }
  if (approvalDigest !== digest) {
    return { outcome: "APPROVAL_MISMATCH", planDigest: digest, written: [], detail: "approval digest mismatch" }
  }
  if (plan.records.every((r) => registry.read(r) === null)) {
    return { outcome: "ALREADY_APPLIED", planDigest: digest, written: [] }
  }

  const removed: string[] = []
  for (const r of plan.records) {
    if (registry.read(r) === null) continue
    registry.remove(r)
    removed.push(label(r))
  }
  return { outcome: "UNREGISTERED", planDigest: digest, written: removed }
}

/** Read-only status: is every record in place? Never writes. */
export function urlHandlerStatus(
  plan: UrlHandlerPlan,
  registry: HandlerRegistry,
): { readonly registered: boolean; readonly missing: readonly string[] } {
  if (!plan.supported) return { registered: false, missing: [] }
  const missing = plan.records.filter((r) => registry.read(r) !== desiredValue(r)).map(label)
  return { registered: missing.length === 0, missing }
}
