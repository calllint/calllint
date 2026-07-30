/**
 * `calllint url-handler` — register/inspect the OS handler for `calllint://adoption/…`,
 * and receive an invoked link.
 *
 * WHY THIS COMMAND EXISTS. An install page can offer one click only if something local
 * answers the click. This command is that something. It is also the most exposed
 * surface CallLint has: once registered, ANY web page can invoke it. So the design
 * question is not "does the happy path work" but "what is the worst a hostile link can
 * do", and the answer is enforced structurally rather than by review:
 *
 *   • `open` re-parses the URI with the strict parser and refuses on the first
 *     surprise, naming the reason (never repairs it into a nearby valid link).
 *   • the contract ORIGIN is a CLI-side constant. Only the SLUG comes from the link, so
 *     a link cannot point CallLint at bytes of the attacker's choosing.
 *   • digests in the link are ASSERTIONS the shipped safe-install path re-checks and
 *     STOPS on. A link asserting bytes CallLint cannot verify is a refusal, not a fetch.
 *   • `open` NEVER applies. It prints the exact reviewed command and stops. The write
 *     flags are unreachable by construction (`dispatchAdoptionUri` + `FORBIDDEN_ARGS`).
 *
 * `register` is plan-first like every other writer here: plan → digest → `--apply
 * --approve <digest>`. macOS reports UNSUPPORTED_PLATFORM with its cause, because a
 * link that looks clickable and silently does nothing is worse than an honest fallback.
 */
import {
  applyUrlHandler,
  buildAdoptionUri,
  dispatchAdoptionUri,
  parseAdoptionUri,
  planUrlHandler,
  unregisterUrlHandler,
  urlHandlerPlanDigest,
  urlHandlerStatus,
  type HandlerPlatform,
  type HandlerRegistry,
  type UrlHandlerPlan,
} from "@calllint/core"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import { CALLLINT_CONTRACT_ORIGIN } from "./safeInstall/contractFetch.js"
import type { CommandResult } from "./scan.js"

export interface UrlHandlerDeps {
  readonly platform: NodeJS.Platform
  readonly home: string
  /** Absolute path of the running `calllint` executable. */
  readonly binPath: string
  /** The OS registry/filesystem port. Injected so tests never touch a real machine. */
  readonly registry: HandlerRegistry
  /** Locally detected host id, or null when none was detected. */
  readonly detectHost: () => string | null
}

function usage(message: string): CommandResult {
  return { stdout: "", stderr: `Error: ${message}\n`, exitCode: EXIT.USAGE }
}

/** Only the three platforms the planner knows; anything else is an honest refusal. */
function asHandlerPlatform(p: NodeJS.Platform): HandlerPlatform | null {
  return p === "win32" || p === "linux" || p === "darwin" ? p : null
}

export function urlHandlerHelp(): string {
  return [
    "calllint url-handler — the OS handler for calllint://adoption/… links",
    "",
    "  status                              is the handler registered?",
    "  register [--apply --approve <d>]    plan, then register (per-user; no admin)",
    "  unregister [--apply --approve <d>]  plan, then remove",
    "  open <uri>                          receive an invoked link (never applies)",
    "",
    "A registered handler is reachable by any web page. `open` re-validates the link,",
    "resolves the contract from CallLint's own origin, and stops at the local authority",
    "prompt — it never writes a host config.",
    "",
  ].join("\n")
}

/** Resolve the plan for this machine, or an honest refusal. */
function planFor(deps: UrlHandlerDeps): UrlHandlerPlan | null {
  const platform = asHandlerPlatform(deps.platform)
  if (platform === null) return null
  return planUrlHandler({ platform, binPath: deps.binPath, home: deps.home })
}

export function urlHandlerCommand(args: ParsedArgs, deps: UrlHandlerDeps): CommandResult {
  const sub = args.positionals[0]
  if (sub === undefined || sub === "help") {
    return { stdout: urlHandlerHelp(), stderr: "", exitCode: EXIT.OK }
  }

  const plan = planFor(deps)
  if (plan === null) {
    return {
      stdout: "",
      stderr: `Error: platform ${deps.platform} is not supported by url-handler\n`,
      exitCode: EXIT.USAGE,
    }
  }

  switch (sub) {
    case "status":
      return statusResult(plan, deps)
    case "register":
      return mutate(plan, args, deps, "register")
    case "unregister":
      return mutate(plan, args, deps, "unregister")
    case "open":
      return open(args, deps)
    default:
      return usage(`unknown subcommand "${sub}"\n${urlHandlerHelp()}`)
  }
}

function statusResult(plan: UrlHandlerPlan, deps: UrlHandlerDeps): CommandResult {
  if (!plan.supported) {
    // Not an error exit: "this platform cannot register" is a true answer to `status`.
    return {
      stdout: `calllint:// handler — UNSUPPORTED on ${plan.platform}\n  ${plan.detail}\n`,
      stderr: "",
      exitCode: EXIT.OK,
    }
  }
  const st = urlHandlerStatus(plan, deps.registry)
  const lines = [`calllint:// handler — ${st.registered ? "REGISTERED" : "NOT REGISTERED"}`]
  for (const m of st.missing) lines.push(`  missing: ${m}`)
  if (!st.registered) lines.push("", "  register with: calllint url-handler register")
  return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: EXIT.OK }
}

/** Plan-only by default; `--apply --approve <digest>` is the only path that writes. */
function mutate(
  plan: UrlHandlerPlan,
  args: ParsedArgs,
  deps: UrlHandlerDeps,
  verb: "register" | "unregister",
): CommandResult {
  const digest = urlHandlerPlanDigest(plan)

  if (!plan.supported) {
    return {
      stdout: "",
      stderr: `Error: cannot ${verb} on ${plan.platform} — ${plan.detail}\n`,
      exitCode: EXIT.USAGE,
    }
  }

  if (!flagBool(args.flags, "apply")) {
    const lines = [`Plan — ${verb} the calllint:// handler (${plan.platform})`, ""]
    for (const r of plan.records) {
      lines.push(
        r.kind === "REGISTRY_KEY"
          ? `  ${r.kind}  ${r.path}  ${r.valueName || "(default)"} = ${r.value}`
          : `  ${r.kind}  ${r.path}`,
      )
    }
    lines.push(
      "",
      `  plan digest: ${digest}`,
      "",
      `Nothing was written. To ${verb}:`,
      `  calllint url-handler ${verb} --apply --approve ${digest}`,
      "",
    )
    return { stdout: lines.join("\n"), stderr: "", exitCode: EXIT.OK }
  }

  const approve = flagStr(args.flags, "approve")
  if (!approve) {
    return usage(
      `Missing --approve <plan-digest>\nApproval must name the exact plan digest you reviewed:\n  calllint url-handler ${verb} --apply --approve ${digest}`,
    )
  }

  const result =
    verb === "register"
      ? applyUrlHandler(plan, approve, deps.registry)
      : unregisterUrlHandler(plan, approve, deps.registry)

  if (result.outcome === "APPROVAL_MISMATCH") {
    return usage(`approval digest does not match the plan\n  plan digest: ${result.planDigest}`)
  }

  const wrote = result.written.length === 0 ? "" : `\n${result.written.map((w) => `  ${w}`).join("\n")}`
  const failed =
    result.outcome === "VERIFY_FAILED_ROLLED_BACK" ||
    result.outcome === "VERIFY_FAILED_ROLLBACK_INCOMPLETE"

  return {
    stdout: failed ? "" : `${result.outcome}${wrote}\n`,
    stderr: failed ? `Error: ${result.outcome} — ${result.detail ?? ""}\n` : "",
    exitCode: failed ? EXIT.ERROR : EXIT.OK,
  }
}

/**
 * Resolve an invoked link into the safe-install argv it authorizes — the ONE source of
 * truth shared by `open` (which prints it) and the async CLI edge (which continues into
 * it). Pure: strict parse, local host detection, CallLint's own origin, then
 * `dispatchAdoptionUri`'s `FORBIDDEN_ARGS` assertion over the produced argv.
 *
 * Two callers, one resolution, so the command a user is shown can never differ from the
 * command that runs (R-2b). `--apply` is NOT added here: this function only ever yields
 * the reviewed prepare argv, and the write flag is the edge's local decision, gated on a
 * real terminal. A link therefore cannot reach a write flag through this path either.
 */
export type AdoptionRunResolution =
  | { readonly ok: true; readonly argv: readonly string[]; readonly slug: string; readonly version: string | null; readonly digestAsserted: boolean }
  | { readonly ok: false; readonly message: string }

export function resolveAdoptionRun(uri: string, deps: Pick<UrlHandlerDeps, "detectHost">): AdoptionRunResolution {
  const parsed = parseAdoptionUri(uri)
  if (!parsed.ok) return { ok: false, message: `refused link (${parsed.reason}): ${parsed.detail}` }

  const host = deps.detectHost()
  if (host === null) {
    return {
      ok: false,
      message:
        "no supported agent host detected on this machine — run `calllint url-handler open` again after installing one, or pass --host to `calllint safe-install`",
    }
  }

  // The ORIGIN is ours, not the link's. Only the slug came from the page, and the
  // fetcher independently enforces this same origin allowlist.
  const contractRef = `${CALLLINT_CONTRACT_ORIGIN}/install/${parsed.request.canonicalSlug}/index.json`
  const dispatch = dispatchAdoptionUri(parsed.request, contractRef, host)
  if (!dispatch.ok) return { ok: false, message: `refused link (${dispatch.reason}): ${dispatch.detail}` }

  return {
    ok: true,
    argv: dispatch.dispatch.argv,
    slug: parsed.request.canonicalSlug,
    version: parsed.request.version,
    digestAsserted: dispatch.dispatch.digestAsserted,
  }
}

/** The one flag the edge may append, and the only place it is spelled. */
const LOCAL_APPLY_FLAG = "--apply"

/**
 * Continue a click INTO the authority prompt (R-2b) — an argv rewrite at the async
 * edge, the same shape `protect` → `guard install` already uses.
 *
 * ADR 0057 §1 decided a click "opens the locally installed CallLint with the plan
 * resolved and the authority prompt on screen". The shipped `open` stopped one step
 * short: it printed a command for the user to copy, so the prompt was never on screen
 * and the click did not, on its own, do anything. This closes that gap without touching
 * what §1 refused — the human still types the approval.
 *
 * WHY APPENDING `--apply` HERE IS NOT A LINK-REACHABLE WRITE FLAG:
 *   • the URI is parsed and dispatched FIRST, and `FORBIDDEN_ARGS` still asserts over
 *     that produced argv — no link can contribute `--apply`, `--approve`, `--plan-out`
 *     or `--host-config`;
 *   • `--apply` alone is not authority. Interactive `--apply` shows the plan and reads a
 *     typed confirmation; `--approve` (the flag that skips the human) stays unreachable,
 *     and non-interactive apply additionally demands `--plan`;
 *   • it is appended ONLY with a real terminal. Without one, this returns null and the
 *     click falls through to `open`'s printer — the previous behavior, unchanged.
 *
 * So the worst a hostile link can now cause is: a console opens, showing a plan the user
 * did not ask for, waiting for them to type `yes`. Returns null for every other argv, so
 * all non-link paths are untouched.
 */
export function computeAdoptionRewrite(
  argv: readonly string[],
  deps: { readonly detectHost: () => string | null; readonly stdinIsTty: boolean },
): readonly string[] | null {
  if (argv[0] !== "url-handler" || argv[1] !== "open") return null
  const uri = argv[2]
  if (uri === undefined) return null
  // No terminal ⇒ no way to collect a typed approval, so do not rewrite; `open` prints.
  if (!deps.stdinIsTty) return null

  const resolved = resolveAdoptionRun(uri, deps)
  // A refusal keeps its existing path: `open` re-resolves and reports the named reason.
  if (!resolved.ok) return null

  return [...resolved.argv, LOCAL_APPLY_FLAG]
}

/**
 * Receive an invoked link. This is the hostile-input entry point.
 *
 * It prints the exact command and stops. It does not spawn a terminal: that step
 * differs per platform and per emulator, and failing at it silently is worse than
 * showing the command. On the platforms where the OS handler already gives us a
 * console, the async edge continues into the prompt instead of reaching this printer —
 * see `computeAdoptionRewrite`. Either way the user reads the command before approving.
 */
function open(args: ParsedArgs, deps: UrlHandlerDeps): CommandResult {
  const uri = args.positionals[1]
  if (uri === undefined) return usage("Missing <uri>\nUsage: calllint url-handler open <calllint://adoption/…>")

  const resolved = resolveAdoptionRun(uri, deps)
  if (!resolved.ok) {
    // Fail closed and name the reason. A malformed link is never repaired.
    return { stdout: "", stderr: `Error: ${resolved.message}\n`, exitCode: EXIT.USAGE }
  }

  const cmd = ["calllint", ...resolved.argv].join(" ")
  const lines = [
    `CallLint link — ${resolved.slug}${resolved.version ? `@${resolved.version}` : ""}`,
    "",
    resolved.digestAsserted
      ? "  The link pins exact bytes. CallLint stops if what it reads does not match."
      : "  The link pins no digest, so CallLint will report what it actually reads.",
    "",
    "  Review and approve locally:",
    `    ${cmd}`,
    "",
  ]
  return { stdout: lines.join("\n"), stderr: "", exitCode: EXIT.OK }
}

/** Re-exported so the page emitter and the handler cannot drift on the URI grammar. */
export { buildAdoptionUri }
