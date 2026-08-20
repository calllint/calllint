/**
 * Turn a failed `wrangler d1 execute` invocation into one honest, safe line
 * (new18 §25, §28).
 *
 * This exists because the obvious thing to print is misleading. `execFileSync`
 * sets `error.message` to "Command failed: <the whole argv>", which says nothing
 * about *why* and echoes the interpolated SQL back into a CI log. The cause is on
 * a captured stream, and the distinction matters to whoever reads a degraded
 * report:
 *
 *   · "Authentication failed"  — a credentials fact someone can fix today
 *   · "no such table"          — a migration never ran
 *   · "wrangler is not installed" — the workspace was never installed
 *
 * Collapsing these into "Command failed" makes the degradation unactionable, and
 * an unactionable degradation is how a report quietly stays empty for a month.
 *
 * Lives in the Worker package rather than inside the generator script so it can
 * be unit-tested: the generator is an untested .mjs, and this is exactly the kind
 * of string handling that fails silently on a shape nobody anticipated.
 */

/** The shape of a child_process failure, as much of it as we rely on. */
export interface WranglerFailure {
  stdout?: unknown
  stderr?: unknown
  message?: unknown
  status?: number | null
  signal?: string | null
}

/** Longest line kept, so one runaway stack cannot flood a run log. */
export const MAX_CAUSE_LENGTH = 300

/**
 * Anything 32+ chars of token alphabet is masked. wrangler does not echo secret
 * values, so this is defence against a future version that does — not a fix for
 * a known leak. It deliberately runs last, after the cause is chosen.
 */
const REDACT_PATTERN = /[A-Za-z0-9_-]{32,}/g

const firstMeaningfulLine = (stream: unknown): string | undefined =>
  String(stream ?? "")
    .split("\n")
    .map((line) => line.trim())
    // Skip blanks and wrangler's decoration-only rules (── and friends).
    .find((line) => line.length > 0 && /[A-Za-z0-9]/.test(line))

/**
 * Pull the human-readable reason out of wrangler's `--json` error envelope.
 *
 * Under `--json`, wrangler reports failures as a JSON object on **stdout**, so a
 * plain line scan finds only `"error": {`. `notes` carries the Cloudflare API
 * reason (the auth code, the missing table) while `text` is usually the generic
 * wrapper, so both are joined with the specific part last.
 */
const fromJsonEnvelope = (stream: unknown): string | undefined => {
  const raw = String(stream ?? "")
  const start = raw.indexOf("{")
  if (start === -1) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start))
  } catch {
    // Truncated or interleaved output: fall through to the line scan rather than
    // reporting a parse failure, which would describe our own bug and not theirs.
    return undefined
  }

  const envelope = parsed as { error?: unknown } | null
  const node = (envelope?.error ?? parsed) as
    | string
    | { text?: unknown; message?: unknown; notes?: unknown }
    | null
  if (typeof node === "string") return node.trim() || undefined
  if (node === null || typeof node !== "object") return undefined

  const notes = Array.isArray(node.notes)
    ? node.notes
        .map((note) => (typeof note === "string" ? note : (note as { text?: unknown })?.text))
        .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
    : []

  const head = [node.text, node.message].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  )
  const parts = [head, ...notes].filter((part): part is string => typeof part === "string")
  return parts.length > 0 ? parts.join(" — ") : undefined
}

/**
 * Choose the most specific available description of a wrangler failure.
 *
 * Order matters: the JSON envelope is richest, then raw stream text, then the
 * process outcome. A signal means the timeout fired — which is what a wrangler
 * waiting on an interactive login looks like from outside, so it is named rather
 * than reported as a bare kill.
 */
export function describeWranglerFailure(error: WranglerFailure | null | undefined): string {
  const cause =
    fromJsonEnvelope(error?.stdout) ??
    fromJsonEnvelope(error?.stderr) ??
    firstMeaningfulLine(error?.stderr) ??
    firstMeaningfulLine(error?.stdout) ??
    (error?.signal
      ? `wrangler killed by ${error.signal} (the timeout fired, or it blocked on a prompt it could not show)`
      : typeof error?.status === "number"
        ? `wrangler exited ${error.status} with no diagnostic output`
        : firstMeaningfulLine(error?.message) ?? "wrangler failed with no diagnostic output")

  return cause
    .replace(/\s+/g, " ")
    .replace(REDACT_PATTERN, "[redacted]")
    .trim()
    .slice(0, MAX_CAUSE_LENGTH)
}
