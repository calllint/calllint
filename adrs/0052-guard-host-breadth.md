# ADR 0052 — Guard Host Breadth & Hook Event/Write Safety Contract

- Status: Accepted
- Date: 2026-07-20
- Refines: 0045 (continuous guard command & hook — the H1 authority-change
  guard, and §4 "hooks are declarative shims"), 0042 (guard action-decision
  contract, H3 per-call blocking necessity gate), 0051 (preflight hook boundary —
  the P2 plugin `PreToolUse` recommend-only hook)
- Related: 0037 (host adapter safety contract), 0025 (declarative snippet
  generators carry no risk logic)

## Context

`calllint guard install --host <host>` (ADR 0045 §4) writes a **declarative
shim** — a host artifact whose only job is to shell out to `calllint guard`, the
audited authority-change drift engine. Today it ships **two** hosts:

- `git` → `.git/hooks/pre-commit` (a `npx -y calllint guard` wrapper)
- `github` → `.github/workflows/calllint.yml` (the shipped `renderCiGate` drift gate)

ADR 0045 §4 already named the intended expansion targets verbatim — *"a git
`pre-commit`/**`pre-push`** hook, a GitHub Actions workflow, **a Claude Code hook
snippet**."* This ADR widens the shipped surface from 2 to ≥5 hosts. Because each
new artifact runs inside a *different* agent host's execution lifecycle, widening
the surface reopens two questions that are safety-critical and must be settled
**once, before the renderers land**, exactly as ADR 0051 settled the P2 plugin
hook before PR-12:

1. **Which lifecycle event may a guard hook fire on?** Agent hosts expose
   *gating* events (fire before a tool call; a non-zero exit can **deny/block**
   the call) and *non-gating* lifecycle events (fire once when a session/workspace
   begins; cannot block anything). The guard is the **authority-change** guard
   (H1) — its cadence is "a config surface moved," not "a tool is about to run."
2. **May a guard artifact overwrite the file it is written to?** Some host hooks
   live in a **dedicated** CallLint-owned file (safe to write whole). Others live
   **inside a shared config file** the user also owns (`settings.json`,
   `tasks.json`) — overwriting it would destroy unrelated user configuration.

Getting (1) wrong would silently convert the H1 authority-change guard into the
H3 per-call **blocker** that ADR 0042 keeps deferred. Getting (2) wrong would make
`guard install` a destructive command. Both are resolved below in favor of the
invariants.

## Verified host mechanisms

Each host below was confirmed against its official documentation to have a **real**
run-a-command mechanism. No mechanism in this ADR is speculative; a host without a
verified real mechanism is **not** added.

| host id | mechanism | artifact file | dedicated / shared | gating? |
|---|---|---|---|---|
| `git` (shipped) | git `pre-commit` hook | `.git/hooks/pre-commit` | dedicated | aborts commit on non-zero — authority-change cadence |
| `git-pre-push` | git `pre-push` hook | `.git/hooks/pre-push` | dedicated | aborts push on non-zero — authority-change cadence |
| `github` (shipped) | GitHub Actions workflow | `.github/workflows/calllint.yml` | dedicated | PR gate (repo owner opts in) |
| `claude-code` | `SessionStart` hook | `.claude/settings.json` | **shared** | **non-gating** (exit 2 shows stderr only) |
| `copilot` | `sessionStart` hook | `.github/hooks/calllint.json` | dedicated | **non-gating** (session-lifecycle, cannot deny) |
| `gemini` | `SessionStart` hook | `.gemini/settings.json` | **shared** | non-gating lifecycle |
| `vscode` | task `runOptions.runOn: folderOpen` | `.vscode/tasks.json` | **shared** | non-gating (+ VS Code's own allow-automatic-tasks prompt) |

## Decision

### 1. Guard hooks fire on a session-start / workspace-open event — never a per-call gating event

Every agent-host guard artifact this ADR adds binds to a **SessionStart-class**
event (`SessionStart` / `sessionStart` / `folderOpen`), which runs **once when a
session or workspace begins** and **cannot block a tool call**. Guard artifacts
MUST NOT bind to a host's per-call gating event (`PreToolUse` / `BeforeTool` /
`preToolUse` / `permissionRequest`).

This is not a style choice — it is the H1/H3 boundary:

- The guard's job is to re-decide when the **authority surface changed** (ADR
  0045 §Context). Session start is the natural "authority-change may have
  happened since last session" checkpoint. A per-call event has the wrong cadence
  and the wrong object.
- Copilot `preToolUse` and Gemini `BeforeTool` are documented **fail-closed on
  non-zero exit** — they interpret a non-zero hook exit as *deny the call*.
  `calllint guard` deliberately exits non-zero on drift (`REVIEW=10`,
  `UNKNOWN=20`, `BLOCK=30`; ADR 0045 §2). Wiring guard to those events would turn
  its drift signal into a **hard per-call block** — precisely the runtime blocking
  ADR 0042 keeps behind the H3 necessity gate. Binding to the non-gating
  session-start event is what keeps `guard install` an H1 artifact.
- This ADR does **not** ship any blocking hook. Per-call enforcement remains
  deferred to ADR 0042 / H3, consistent with ADR 0051 §4.

### 2. Guard hooks display; they do not deny

Consistent with ADR 0051's recommend-only posture, a guard session-start hook
**surfaces** the drift result (as host `additionalContext` / stderr note) and does
not attempt to veto the session. It is the authority-change analogue of the P2
preflight hook: a renderer of an existing deterministic drift decision, never a
new judge, and never a runtime gate. It runs `calllint guard`, which is static and
offline and **never executes a scanned server** (ADR 0045 §6, INV1).

### 3. Dedicated-file hosts are written whole; shared-config hosts emit a fragment and never clobber

- **Dedicated-file hosts** (`git`, `git-pre-push`, `github`, `copilot`) own their
  artifact file entirely. `guard install` writes the whole file (creating parent
  dirs), the existing behavior.
- **Shared-config hosts** (`claude-code`, `gemini`, `vscode`) keep the guard hook
  **inside a file the user also owns**. For these, `guard install`:
  - By default **prints the exact JSON fragment to merge** into the shared file
    (to stdout) and does **not** write — the user pastes it. This is the safe
    default: `guard install` must never destroy a user's `settings.json` /
    `tasks.json`.
  - If `--out <path>` targets a file that **already exists**, `guard install`
    **refuses** (exit `EXIT.USAGE`) with a message telling the user to merge the
    printed fragment, rather than overwrite. It will write a whole file only to a
    path that does not yet exist.
  - Deep-merging into an arbitrary user JSON file is explicitly **out of scope**
    here (that is the audited install-planner writer's job, reused by `calllint
    integrate`, PR-11 / ADR 0051 §5). `guard install` stays a declarative snippet
    generator (ADR 0025), not a mutating writer.

### 4. Still declarative shims — no risk logic in any host artifact (ADR 0045 §4 preserved)

Every artifact this ADR adds carries **only** a `calllint guard` invocation (or,
for `github`, the shipped `renderCiGate` output). No detector, no verdict, no
threshold, no reason code is copied into a host file. The single source of truth
for the decision stays inside the audited engine. The renderers are pure,
deterministic text generators with positive/negative fixtures (project
discipline), exactly like `renderCiGate` and `gen-rule`.

### 5. This is distinct from the P2 plugin (ADR 0051)

PR-12 shipped a Claude **plugin** (`plugins/calllint/`) with a `PreToolUse`
*preflight* hook (recommend-only, per ADR 0051). This ADR's `claude-code` guard
host is a *different* artifact: a **SessionStart** hook fragment for the user's own
`.claude/settings.json` that runs the **authority-change guard**. They are
complementary (preflight-before-a-config-edit vs. drift-check-at-session-start),
both non-blocking, and neither enters the verdict path. Shipping both does not
create two blockers — it creates zero blockers.

## Consequences

- **Positive**: Guard retention (Engine 2) reaches ≥5 distribution surfaces with
  zero new schema, zero new verdict vocabulary, and zero new blocking behavior.
  The decision logic stays in one audited place; host artifacts remain inert
  shims.
- **The H1/H3 boundary is reinforced, not eroded.** By binding only to
  non-gating session-start events, a wider host surface cannot smuggle in per-call
  blocking. Reviewers may reject any guard renderer that targets a gating event or
  that clobbers a shared user config file.
- **Cost**: `GUARD_HOSTS` grows from 2 to 7 ids; the install path gains a
  fragment-print branch and an exists-refusal for shared-config hosts; `guard
  status` learns the new artifact paths. Each host ships a positive fixture (the
  rendered artifact) and negative coverage (unknown host, clobber-refusal).
- **Reversibility**: docs + additive renderers only. No `ScanReport`/policy schema
  change, no change to the shipped `git`/`github` artifacts, no change to the
  `guard` core verb or its exit codes. A host can be removed by deleting its
  registry entry and fixtures.

## Invariants preserved

`I-04` UNKNOWN/drift never becomes SAFE (guard reuses `verifyApproved`) · `I-06`
never executes the target (artifacts only shell out to static `calllint guard`) ·
no second verdict vocabulary · no second drift engine · **no runtime per-call
blocking** (session-start events only; blocking stays ADR 0042 / H3) · `guard
install` never destroys user configuration (shared-config hosts print a fragment
and refuse to clobber).
