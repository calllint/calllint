# ADR 0057 — The `calllint://` adoption deep link: a second live writer, and why one click still stops at a local approval

- Status: Accepted (2026-07-30); amended 2026-07-29 by PR R-2 (§6 — making the
  approval prompt §1 promises actually reachable). Authorizes the Workstream R build.
  Adds a CLI command and a second live writer; changes **no** verdict and **no**
  decision-plane input. R-1 changed no served byte; the §6 amendment changes install-page
  copy under 0058's plane.
- Date: 2026-07-30 (PR R-1); §6 amended 2026-07-29 (PR R-2)
- Refines: 0056 (safe-install acquisition projection — this ADR adds an OS-level
  *entry point* to 0056's route while leaving its projection, verdict route, and
  exact-target gate untouched), 0037 (the apply engine's port boundary — the pattern
  the new writer copies rather than extends)
- Related: 0036 (install-plan approval binding — the sealed plan whose digest a deep
  link may assert but never bypass), 0038 (public Trust Index boundaries — serving
  reads committed static assets only), 0058 (presentation control plane — the plane
  that will emit the link in PR R-2)

## Context

The install page's primary action currently sends a visitor to `calllint.com` to read
documentation and copy a command. A pilot measured the cost of that detour: the
primary CTA carried no subject, and the path to actually adopting a tool ran through
finding docs, finding the right command, and pasting it. "One click" was the
requested outcome.

An OS-registered URI scheme (`calllint://`) is the mechanism that makes one click
possible: the page emits a link, the OS hands it to the locally installed CallLint,
and the user is in front of the real thing without a documentation hop.

That mechanism raises exactly one hard question, and it is not a UX question.

## The problem this ADR actually solves

**A registered URI handler is reachable by any web page.** Once `calllint://` is
registered, `evil.example` can emit `calllint://…` as readily as `calllint.com` can.
So the design cannot rest on "the link comes from our page" — it does not.

Two consequences follow, and they pull in opposite directions:

1. The product's value claim is *"installs with only the authority you approve
   locally."* If a deep link could apply a config, that claim is false for anyone who
   ever clicks a hostile link — and CallLint would become the thing it exists to
   defend against.
2. The literal reading of "one click, no extra steps" would remove the approval.

These are irreconcilable, so this ADR resolves them explicitly rather than letting an
implementation split the difference.

Separately, the mechanism does not fit the repo's existing writer. Every live-config
write goes through `applyPlan`, which is **JSON-patch over a host config file**. A
Windows registry value and an XDG `.desktop` + mimeapps association are neither JSON
nor patchable. So registering a handler is a **second writer**, and this repo has had
exactly one until now.

## Decision

### 1. One click removes the detour, not the approval

`calllint://adoption/{slug}[@{version}]` opens the locally installed CallLint with the
plan resolved and the authority prompt on screen. The user approves there.

What one click removes: finding the documentation, finding the command, copying it,
and knowing the flag syntax. What it does not remove: the human authorizing a write.

This is not a hedge. It is the only reading under which the product's central claim
survives contact with a hostile link, and it is therefore load-bearing rather than
cautious. The alternative — silent apply — was considered and rejected: it converts
every registered CallLint install into a one-click config-rewrite primitive for the
entire web.

**Enforced structurally, not by convention.** `dispatchAdoptionUri` builds an argv
array and then asserts over the *produced* argv that no member appears in
`FORBIDDEN_ARGS` (`--apply`, `--approve`, `--host-config`, `--plan-out`). A future
edit that introduces a write flag fails closed instead of producing a silently more
powerful command.

### 2. The link is hostile input, and the origin is not the link's to choose

- **Strict parse, fail closed, name the reason.** `parseAdoptionUri` returns one of
  seven named rejections. A malformed link is never repaired into a nearby valid one,
  because "nearby" is attacker-controlled. An unknown query parameter is a *rejection*
  rather than something ignored, so a future meaningful parameter cannot inherit
  today's leniency on links already published.
- **The grammar matches the shipped MCP resource URI** (`calllint://adoption/…`, slug
  may contain `/`, version pins at the last `@`). One URI shape means one thing in both
  surfaces. The `calllint://safe-install/…` spelling stays banned (new14 open risks).
- **Argv, never a shell string.** There is no interpolation site, so shell
  metacharacters inside a URI are inert data even if the parser were later loosened.
- **The contract origin is a CLI-side constant.** Only the slug comes from the link;
  `https://calllint.com` is supplied locally and independently re-enforced by the
  existing fetch allowlist. A link cannot point CallLint at bytes of its choosing.
- **Digests are assertions, not sources of truth.** They are passed as the existing
  `--expect-*-digest` flags, which the shipped path re-checks against what it actually
  reads and **stops** on mismatch — never "not found", never a fresh anchor.

### 3. The second writer is admitted, and kept narrow

`applyPlan` cannot be reused, so `urlHandlerWriter` exists. It inherits the shipped
discipline rather than inventing one: **plan → digest → explicit `--approve <digest>`
→ apply → verify → rollback.**

Bounded by construction:

- All I/O sits behind a `HandlerRegistry` port with exactly three methods (`read`,
  `write`, `remove`) over three record kinds. There is no `exec`, no shell, and no
  generic "write anything" primitive, so the blast radius is the port's surface rather
  than reviewer vigilance. Production Windows shells out only to `reg.exe` with a fixed
  argv.
- **Per-user only.** `HKCU`, `~/.local/share/applications`, `~/.config/mimeapps.list`.
  Never `HKLM`. A handler that demanded elevation would push users toward running an
  installer as administrator.
- **Rollback restores absence as a state.** Prior values are captured before the first
  mutation; a record that did not exist is *removed* on rollback, not blanked. A
  half-registered handler is a worse outcome than a failed registration, and
  `VERIFY_FAILED_ROLLBACK_INCOMPLETE` reports honestly when residue is left.
- **Idempotency by effect**, not bookkeeping: already-in-place is detected by reading
  the records, so a re-register is never mis-reported as a change.

### 4. macOS is an honest refusal, not a silent omission

Launch Services honours `CFBundleURLTypes` only inside an `.app` bundle, and CallLint
ships as an npm CLI. So `planUrlHandler` returns `UNSUPPORTED_PLATFORM` **with its
cause**, and the install page's visible fallback command is the macOS path — still with
no `calllint.com` detour.

A partially-registered handler was rejected as the worse failure: a link that looks
clickable and silently does nothing teaches the user the product is broken. Shipping a
minimal `.app` wrapper is deferred, because it is a distribution-layer change
(packaging, Gatekeeper, likely notarization) that CI cannot fully verify.

### 5. `open` prints the command; it does not spawn a terminal

Spawning differs per platform and per terminal emulator, and failing at it silently is
worse than showing the user the command. The command is also the thing they should be
reading before they approve it.

### 6. The approval prompt has to actually be reachable (amended 2026-07-29, PR R-2)

§1 says the click leaves the user "with the authority prompt on screen. The user
approves there." As built in R-1 there was no *there*. Three independent gaps sat
between the click and any prompt, and each one alone was enough to make the route dead:

1. The dispatched argv carried no write flag at all, so the run ended at `PREPARED` —
   a plan with no way to accept it.
2. Interactive `--apply` read stdin via `readFileSync(0)` having printed **nothing**.
   The one path that asked for a human decision showed the human no plan. That is a
   blind signature, and it is worse than the missing prompt it was standing in for.
3. The page's own escape hatch had the same defect as the link: a prepare-only command.

§1 is unchanged and is not weakened here. Silent apply stays rejected for exactly the
reason stated: it would convert every registered install into a one-click
config-rewrite primitive for the whole web. What changes is that the approval it
demands now exists.

**The prompt is real before any flag can reach it.** `safe-install` gained two ports,
`promptOut` and `stdinIsTty`. Interactive `--apply` renders the resolved plan —
enumerated from `plan.operations`, so it cannot describe a write the plan does not
contain — and *then* blocks. It fails closed twice: with no TTY it refuses and names
the two-step script route (otherwise `yes | calllint … --apply` is non-interactive
auto-apply wearing interactive clothes), and with no `promptOut` it refuses rather than
read a decision it could not ask for.

**`--apply` is appended at the local edge, never carried by the link.**
`computeAdoptionRewrite` rewrites argv in `main()` before anything reads it, and only
when all of: the invocation is exactly `url-handler open <uri>`, the URI resolves `ok`,
and stdin is a real TTY. The link-derived argv is built by `dispatchAdoptionUri` and
still asserted against `FORBIDDEN_ARGS` first, so the flag is a *local* decision about
a *locally validated* plan — not a value any URL can supply. `--approve`, the flag that
skips the human, stays unreachable from every link-facing path.

The worst case from a hostile link is therefore unchanged in kind and stated plainly: a
console opens showing an install plan the user did not ask for, and waits. Refusal is
the default and costs one keystroke.

**One resolver, two callers.** `resolveAdoptionRun` is shared by `open` (which prints)
and the edge (which continues), because a printed command that differs from the command
actually run is the failure this whole ADR is about. §5 still holds — nothing is
spawned; the rewrite happens inside the process the OS already started.

**The page's from-nothing route is now honest.** The visible
`npx calllint@<pinned> safe-install --contract … --expect-artifact-digest … --apply`
finishes what it offers, because the plan is shown and a TTY is required. `--approve`
and `--plan-out` remain absent from anything published on a web page.

## Consequences

**What this buys.** The page can offer a real one-click path on Windows and Linux.
CallLint's central claim survives a hostile link, and the property is asserted over
produced argv rather than argued in review.

**What it costs.** A second live writer exists; "one writer" is now "one config writer
plus one narrowly-scoped OS-registration writer", and that distinction has to be kept
true. `url-handler open` is the most exposed surface in the product and should be
treated as such in every future edit.

**What is now permanently true.**

- A deep link may never produce a write flag. Asserted over the built argv.
- A deep link may never choose the contract origin.
- `--approve` is unreachable from any link-facing path. Non-interactive apply keeps
  requiring **both** `--approve <digest>` and `--plan <file>`.
- Interactive `--apply` requires a real TTY **and** a preview port. Without either it
  refuses; it never reads a decision it did not first show.
- The approval preview is enumerated from `plan.operations`, so it cannot describe a
  write the sealed plan does not contain.
- `url-handler open` and the local edge resolve the run through one function, so the
  command shown can never differ from the command run.
- Registration is per-user; no path in this writer requires elevation.
- macOS reports an unsupported platform with a reason; it never half-registers.
- The `calllint://safe-install/…` spelling stays rejected.

**What this ADR does not decide.** Whether to ship a macOS `.app` wrapper (deferred,
its own PR and its own distribution decision); whether a future
`--allow-contract-origin` exists (0056 open decision #5, still deferred); and how the
install page presents the link — that is PR R-2 under ADR 0058's plane.
