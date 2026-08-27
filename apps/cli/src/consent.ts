/**
 * First-run telemetry consent prompt (policy option B).
 *
 * Prompts ONLY when:
 *   - no state file exists (never asked before)
 *   - stdin is a TTY
 *   - not in CI
 *   - kill-switch not set
 *   - not in --json mode
 *
 * Prompt appears AFTER command output (preserves byte-identity), to stderr.
 * Timeout defaults to "no" — informed consent, never silent data collection.
 */
import { createInterface } from "node:readline"
import { existsSync } from "node:fs"
import { isTelemetryDisabledByEnv } from "@calllint/telemetry-emit"
import { getStatePath } from "./paths.js"
import { enableTelemetry, disableTelemetry } from "./state.js"

/** Check if conditions allow prompting for consent. */
export function shouldPromptConsent(opts: {
  stdinIsTty: boolean
  env: Record<string, string | undefined>
  jsonMode: boolean
}): boolean {
  // A state file means a decision was already made and persisted — by an explicit
  // `telemetry enable/disable/reset`, or by a previous run of this prompt. Its EXISTENCE
  // is the consent record; its contents are the answer. That is why declining must write
  // the file (see recordConsent): a decline that left no trace would re-ask every run.
  if (existsSync(getStatePath())) return false
  // Not a terminal ⇒ nobody can answer. Covers pipes, redirects, and daemonized runs.
  if (!opts.stdinIsTty) return false
  // CI is a machine the user is not sitting at, and the `ci` tier is a SEPARATE surface
  // with its own default (privacy doc: "on, with notice"). Prompting here would block a
  // build on an answer no one can give. Same detector `breathe.ts` already uses.
  if (opts.env.CI) return false
  // The documented universal opt-out. Reusing the gate's own predicate rather than
  // re-listing "0"/"false"/"off"/"no" here — one definition of "disabled by env".
  if (isTelemetryDisabledByEnv(opts.env)) return false
  // A `--json` consumer is a program. Even on stderr, a prompt that waits for stdin
  // stalls a pipeline that will never answer.
  if (opts.jsonMode) return false
  return true
}

/** How long to wait for an answer before taking silence as "keep it off". */
export const CONSENT_TIMEOUT_MS = 30_000

const PROMPT = [
  "",
  "CallLint can send anonymous usage events (verdict category, host family — never",
  "your config, paths, commands, prompts, or finding evidence).",
  "",
  "  Enable anonymous usage telemetry? [y/N] ",
].join("\n")

/**
 * Ask once, on stderr, and resolve to the user's answer.
 *
 * Resolves `false` for anything that is not an explicit yes — a bare Enter, "n", EOF
 * (stdin already drained by the command that just ran), or the timeout. Only an explicit
 * affirmative turns collection on, which is what makes this compatible with the
 * Blueprint's non-goal #15: silence is never consent.
 */
export function askConsent(
  out: (text: string) => void,
  timeoutMs = CONSENT_TIMEOUT_MS,
  /** Injected so a test can drive the answer without a real terminal. */
  input: NodeJS.ReadableStream = process.stdin,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const rl = createInterface({ input, terminal: false })
    const finish = (answer: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rl.close()
      resolve(answer)
    }
    // Unref'd so a pending timer cannot hold the process open past its work.
    const timer = setTimeout(() => {
      out("\n  No answer — telemetry stays OFF.\n")
      finish(false)
    }, timeoutMs)
    if (typeof timer.unref === "function") timer.unref()
    rl.on("line", (line) => finish(/^y(es)?$/i.test(line.trim())))
    // EOF with no line: stdin was consumed or closed. Not an answer, so: off.
    rl.on("close", () => finish(false))
    out(PROMPT)
  })
}

/**
 * Persist the answer and tell the user what just happened.
 *
 * BOTH branches write the state file. A decline that wrote nothing would leave
 * `shouldPromptConsent` seeing "no file" forever and re-ask on every single run — the
 * prompt would become nagware, and a user who said no would be asked again until they
 * said yes. `disableTelemetry()` is what records "asked, answered no".
 *
 * `enableTelemetry(env)` is the SAME entry point `calllint telemetry enable` uses, so the
 * identity and discovery-surface capture rules (new19 §21) are not re-implemented here.
 */
export async function recordConsent(
  granted: boolean,
  out: (text: string) => void,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (granted) {
    await enableTelemetry(env)
    out("\n  ✓ Telemetry ON — anonymous, resettable (calllint telemetry reset).\n")
    out("    Turn it off any time: calllint telemetry disable\n\n")
  } else {
    await disableTelemetry()
    out("    Turn it on any time: calllint telemetry enable\n\n")
  }
}

/**
 * The whole first-run consent flow, as one best-effort call. Returns silently when the
 * conditions do not allow prompting, so the caller needs no branching.
 *
 * NEVER throws: the caller runs this after stdout/stderr/exitCode are already written,
 * and a consent fault must not change a command's result.
 */
export async function maybePromptConsent(opts: {
  stdinIsTty: boolean
  env: Record<string, string | undefined>
  jsonMode: boolean
  out: (text: string) => void
  timeoutMs?: number
  /**
   * The stream to read the answer from. Threaded through so a test never falls back to
   * the real `process.stdin`: a test passes `stdinIsTty: true` as a LITERAL while the
   * worker's actual stdin is not a terminal, so without this seam any change that let a
   * test past the vetoes would attach readline to a vitest worker's stdin.
   */
  input?: NodeJS.ReadableStream
}): Promise<void> {
  try {
    if (!shouldPromptConsent(opts)) return
    const granted = await askConsent(opts.out, opts.timeoutMs, opts.input)
    await recordConsent(granted, opts.out, opts.env)
  } catch {
    // Consent is a side-channel like telemetry itself: a fault here must never surface.
  }
}
