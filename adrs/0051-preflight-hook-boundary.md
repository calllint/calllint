# ADR 0051 — Preflight Hook Boundary (new11 P2 agent-native distribution)

- Status: Accepted
- Date: 2026-07-20
- Refines: 0010 (fail-closed verdict), 0042 (guard action-decision contract,
  H3 necessity gate), 0045 (continuous guard authority-change watch),
  0049 (priority-execution boundary §canonical naming: `calllint integrate`)

## Context

new11 P2 ships CallLint's first **agent-native distribution** surface: an
idempotent host installer (`calllint integrate`, PR-11), a Claude plugin with a
`PreToolUse` hook, and a fork-safe GitHub PR auto-review (PR-12). The plugin hook
is the sharp edge — it runs *inside the agent's execution loop*, immediately
before a tool call. This ADR settles, once, before any P2 code lands, what that
hook is permitted to do, so PR-12 does not reopen the question and so the hook
cannot silently become a second, non-deterministic verdict path.

Two established boundaries constrain the design:

1. **INV1 — CallLint never executes, installs, or connects to the target it
   judges** (project principle 6; `project-facts.json.claims.executesTargetServer
   = false`). A hook that ran the pending tool call to decide about it would
   violate INV1 outright.
2. **ADR 0042 froze runtime *blocking* as design-only**, gated behind an H3
   necessity test that has not been met. The `calllint.guard.request.v0` /
   `calllint.guard.decision.v0` contract exists on paper precisely so that a
   future blocking gate has a schema — but nothing today is authorized to *block*
   an agent's action at runtime.

The open question new11 §5 raises ("Agent 在 10 类危险动作前能触发 preflight …
BLOCK 不可被 Agent 自行绕过") could be read as requiring the hook to *enforce* a
BLOCK. That reading collides with both boundaries above. This ADR resolves the
tension in favor of the invariants.

## Decision

For new11 P2, the plugin `PreToolUse` hook and every P2 distribution surface are
bound by the following. These are invariants for the phase, not defaults:

1. **The hook is preflight recommend / display-only, non-blocking.** It surfaces
   the pre-computed verdict and its evidence to the human and the agent; it does
   **not** veto, cancel, or gate the pending tool call. The agent's control flow
   is unchanged by CallLint's presence. Exit status is advisory (`0` always for
   the recommend path); the hook never returns a non-zero "deny" that the host
   would interpret as a hard block.

2. **Neither the hook nor an LLM enters the verdict path.** The verdict shown is
   produced by the same deterministic engine (`computeVerdict`), over
   configuration/evidence that already exists, read from a prior scan or baked
   Trust Page. The hook performs **no new scan of the pending action's target**,
   runs nothing, and connects to nothing. It is a *renderer of an existing
   verdict*, never a judge. (Upholds project principles 4, 5, 6; INV1.)

3. **UNKNOWN and the absence of a verdict are shown as themselves.** If no
   verdict exists for the target, the hook says so ("not yet scanned") and
   recommends running `calllint scan` / `calllint integrate`. It never fabricates
   SAFE, and UNKNOWN is never rendered as SAFE (ADR 0010).

4. **Blocking enforcement stays deferred to ADR 0042 / H3.** If a future
   necessity gate justifies a hard runtime block, it is designed under 0042's
   `guard.decision.v0` contract in its own ADR — **not** bolted onto the P2 hook.
   P2 ships the recommend rung only. The new11 §5 "BLOCK 不可被 Agent 自行绕过"
   acceptance line is therefore **explicitly descoped from P2** and recorded as a
   0042/H3 obligation (see Consequences).

5. **`integrate` writes config, never runtime behavior.** `calllint integrate`
   (PR-11) may write a host's *static configuration* (installing the plugin/hook,
   adding a scanned server) through the audited install-planner writer
   (detect → plan → approve → atomic apply → verify → rollback; ADR 0036/0037).
   That is a config write the user approves, wholly distinct from the hook's
   runtime posture. Installing the hook does not install a blocker.

6. **The GitHub PR auto-review (PR-12) is read-only and fork-safe.** It scans
   changed files only, publishes SARIF / a PR summary / inline annotations, and
   **never reads secrets in a fork PR context** nor uploads the repository to a
   third party (new11 §5.5). It recommends; it does not fail a merge gate unless
   the repository owner opts in via their own branch-protection rule — CallLint
   does not impose one.

## Consequences

- **PR-12 is unblocked and constrained.** The hook is implemented as a
  display-only preflight; no `guard.decision.v0` emission, no process-kill, no
  non-zero deny. Reviewers can reject any P2 diff that makes the hook block.
- **INV1 and ADR 0010 hold across the new distribution surface.** The wider blast
  radius (a hook in the agent loop) does not widen what CallLint *does* — it still
  only reads and renders an existing deterministic verdict.
- **The descoped acceptance line is tracked, not dropped.** new11 §5's
  "BLOCK 不可被 Agent 自行绕过" moves to ADR 0042's H3 obligation list; P2's
  acceptance is met by the recommend-path funnel
  (`preflight → approval → apply → verify`), not by runtime blocking.
- **Reversibility.** This ADR is docs-only and changes no runtime behavior. It
  can be superseded when — and only when — the 0042/H3 necessity gate is
  demonstrably met, at which point a blocking rung is added *beside* the recommend
  rung, never replacing it.
