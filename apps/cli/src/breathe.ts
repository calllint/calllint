/**
 * Tiny "breathing" brand mark shown on an interactive run — a small nod to the
 * CallLint shield, with a gentle fade-in/out pulse (à la a loading shimmer).
 *
 * Hard rules (a CLI security tool must never corrupt machine output):
 *   - Writes ONLY to stderr. stdout is reserved for report data (JSON/SARIF/…).
 *   - Shows ONLY when stderr is an interactive TTY.
 *   - Suppressed by: NO_COLOR, CI, --no-color, --no-emoji, and any
 *     machine-output mode (--json/--sarif/--html/--compact) or --stdin.
 *   - Best-effort and time-boxed; never delays or fails the actual command.
 */
import { parseArgs, flagBool } from "./args.js"

/** A compact shield glyph with the CallLint cross — one line, terminal-safe. */
const MARK = "⛨"
const WORDMARK = "CallLint"

export interface BreatheDeps {
  /** The stderr-like stream to animate on. */
  stream?: {
    isTTY?: boolean
    write: (s: string) => void
  }
  env?: NodeJS.ProcessEnv
  /** Sleep hook (injectable for tests); resolves after `ms`. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Decide whether the animated mark should render for this invocation.
 * Pure and synchronous so it is trivially testable.
 */
export function shouldBreathe(argv: string[], deps: BreatheDeps = {}): boolean {
  const env = deps.env ?? process.env
  const stream = deps.stream ?? process.stderr

  if (!stream.isTTY) return false
  if (env.NO_COLOR) return false
  if (env.CI) return false

  const { flags } = parseArgs(argv)
  // Any machine-readable or non-interactive mode → stay silent.
  if (flagBool(flags, "json")) return false
  if (flagBool(flags, "sarif")) return false
  if (flagBool(flags, "html")) return false
  if (flagBool(flags, "compact")) return false
  if (flagBool(flags, "no-color")) return false
  if (flagBool(flags, "no-emoji")) return false
  if (flagBool(flags, "stdin")) return false

  return true
}

/** ANSI fade frames (256-color reds) building to a bright shield, then settling. */
const FRAMES = [238, 240, 196, 203, 210, 203, 196] as const
const FRAME_MS = 70

/**
 * Render a short fade-in/out pulse of the brand mark on stderr, then leave a
 * clean final line. No-op (resolves immediately) when shouldBreathe is false.
 */
export async function breathe(argv: string[], deps: BreatheDeps = {}): Promise<void> {
  if (!shouldBreathe(argv, deps)) return

  const stream = deps.stream ?? process.stderr
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const line = (color: number) =>
    `\r\x1b[2K\x1b[38;5;${color}m${MARK}\x1b[0m \x1b[2m${WORDMARK}\x1b[0m`

  try {
    stream.write("\x1b[?25l") // hide cursor
    for (const color of FRAMES) {
      stream.write(line(color))
      await sleep(FRAME_MS)
    }
    // Settle on the brand red, drop to a fresh line, restore the cursor.
    stream.write(line(196) + "\n")
  } finally {
    stream.write("\x1b[?25h") // always restore the cursor
  }
}
