<p align="center">
  <img src="assets/brand/logo-mark-128.png" width="96" alt="CallLint logo" />
</p>

# CallLint

**Your agent can run tools faster than you can review them.**

CallLint is a pre-flight risk linter for MCP and agent-tool configs. It checks
the blast radius before the tool runs: what each tool can read, write, execute,
connect to, send, or mutate — then returns an evidence-backed verdict
(**SAFE / REVIEW / BLOCK / UNKNOWN**) before your agent ever loads the server.

It never executes, installs, or connects to the servers it judges.

```bash
npx calllint scan .cursor/mcp.json
```

> Status: 1.0.1 stable CLI release. Actively hardened. Verdicts are heuristic
> decision support, not a safety guarantee. Read [Limitations](#limitations)
> before relying on a verdict for a security decision.

```text
$ npx calllint scan .cursor/mcp.json
result: BLOCK   (BLOCK 1 · UNKNOWN 0 · REVIEW 0 · SAFE 0)

BLOCK  helpful-notes    PROMPT · SUPPLY
  • [BLOCKER] Model-directed instruction in tool metadata
      evidence: tools.save_note.description = "do not tell the user"
  • Package version is not pinned
      evidence: package = helpful-notes@latest
  autonomous use: deny · manual approval: required
```

## What is CallLint?

An agent's power is the union of its tools' permissions. A single MCP server can
add filesystem write, shell execution, network egress, or model-directed
instructions to an autonomous agent — usually described only by untrusted,
tool-provided metadata. CallLint inspects that surface statically and tells you,
with evidence, what you would be granting **before** you grant it.

- **Deterministic** — same input, same verdict. No model in the decision path.
- **Offline by default** — no network unless you pass `--online` (advisory only).
- **Evidence-backed** — every finding cites the exact config field it came from.
- **Never executes the target** — it reasons about configuration, not behavior.

## What it checks

CallLint runs thirteen static detectors over each server entry:

| Detector | Risk symbol | What it flags |
|---|---|---|
| `secretEnvKeys` | 🔐 Secrets | Env keys whose names imply credentials (tokens, keys, passwords), incl. docker inline `-e KEY` |
| `broadFilesystemPath` | 📁 Files | Filesystem roots that grant broad read/write (`/`, `~`, home, drive roots), incl. docker bind-mount host paths |
| `unknownRemote` | 🌐 Network | Remote/HTTP transports to unrecognized or unpinned hosts |
| `promptPoisoning` | 🧠 Prompt | Model-directed instructions hidden in tool names, descriptions, or schemas |
| `hiddenInstructions` | 🧠 Prompt | Hidden/obfuscated content (zero-width, bidi, tag-char, HTML comments) in model-visible metadata |
| `dangerousCommand` | ⚙️ Exec | Shell-out / interpreter / package-runner commands (`bash -c`, `npx`, …) |
| `unverifiedLocalSource` | ⚙️ Exec | Local script/binary that is not a recognized package, pinned image, or remote |
| `externalMutation` | ✉️ Action | Tools that send or mutate external state (email, messages, posts) |
| `messagingSend` | ✉️ Action | Tools that send messages/email on your behalf (Slack, Twilio, SMTP, …) |
| `oauthScope` | ✉️ Action | OAuth scopes that are undeclared, broad, or expansive (`admin`, `*`, `repo`, …) |
| `gatewayRuntime` | ✉️ Action | Long-running gateway runtimes that proxy many downstream tools under one auth |
| `financialAction` | 💸 Money | Payment / transfer / irreversible financial actions |
| `unpinnedPackage` | 🧩 Supply | Unpinned package specs (`@latest`, no version) — rug-pull surface |

Findings roll up into a **risk class** (S0 metadata-only → S5
financial/irreversible) and an aggregate **verdict** per server and per config.

Drift detection (`baseline` / `verify`) records an approved risk surface and
flags **rug-pulls** (🔁) — a previously-approved server whose risk surface later
changed.

## What it does not check

This list matters more than the feature list. CallLint is a *pre-flight check*,
not a proof of safety.

- It **does not execute, install, or connect** to servers — so it cannot observe
  actual runtime behavior (what a server really reads, writes, or sends).
- It **does not read or validate secret values** — it inspects config *shape*
  (key names), never the contents of your `.env` or credential stores.
- It **does not analyze server source code** — only the configuration and any
  tool metadata you provide under `x-calllint.tools`.
- It **does not fetch anything** unless you pass `--online`, and online results
  are advisory — they never upgrade a verdict toward SAFE.
- It **does not certify** third-party tools, replace human security review, or
  guarantee an agent is safe.
- A clean run is **necessary, not sufficient.** Pair it with code review,
  least-privilege tokens, and runtime controls.

`UNKNOWN` is a real verdict: when CallLint cannot verify what a server will do,
it says so and never silently upgrades `UNKNOWN` to `SAFE`.

### What CallLint is — and is not

| CallLint is **not** | CallLint **is** |
|---|---|
| a runtime sandbox | a pre-run risk linter for agent-tool configs |
| a secret scanner (it never reads secret values) | a config-shape inspector that flags credential-shaped keys |
| `npm audit` (known package CVEs) | a blast-radius check on the authority you are granting |
| a server source-code analyzer | a static config + tool-metadata analyzer |
| a safety certificate | heuristic decision support, not a safety guarantee |
| a replacement for human review | the start of a review, with evidence attached |

## Install

```bash
# run without installing (recommended):
npx calllint scan ./mcp.json

# or install globally:
npm install -g calllint
```

Requires Node.js ≥ 20. The published package is a single self-contained bundle
with zero runtime dependencies. `calllint` on the `latest` tag is the current
stable CLI release; `@next` carries release candidates and `@preview`
older previews.

## Quick start

```bash
# scan a config file (auto-detects common locations if no path given)
calllint scan ./mcp.json

# scan from stdin, machine-readable JSON out
cat .cursor/mcp.json | calllint scan --stdin --json

# CI gate: non-zero exit per policy (BLOCK=30, UNKNOWN=20, REVIEW=10 if enabled)
calllint scan ./mcp.json --ci --no-emoji

# synthesize a config for an npm package (offline) or a GitHub repo (--online)
calllint scan npm:mcp-weather@1.0.0
calllint scan github:owner/repo --online

# record an approved baseline, then detect drift / rug-pulls later
calllint baseline ./mcp.json
calllint verify ./mcp.json --ci

# explain one server's verdict from the last scan
calllint explain filesystem

# structured diagnostics for editor / agent-host integration
calllint diagnostics ./mcp.json --json
```

Output formats: default terminal, `--compact`, `--json` (stable schema),
`--sarif` (GitHub Code Scanning), `--markdown` (PR comments / GitHub Step
Summary), `--html` (self-contained report). The
`diagnostics` command emits a separate editor/agent-host JSON
(`calllint.diagnostics.v0`).

See CallLint running in CI on a deliberately risky config —
[`calllint-demo-risky-mcp`](https://github.com/calllint/calllint-demo-risky-mcp)
publishes one Code Scanning alert per finding on every push.

## Beyond config scanning

The same engine and verdict semantics extend past MCP-config scanning to other
points where an agent grants authority:

```bash
# Preflight a planned external action before the agent runs it
calllint action inspect payment.json          # calllint.action.v0 descriptor
calllint action inspect email-reply.json --json

# Preflight a normalized agent inbox event (delegates to the action analyzer)
calllint inbox inspect gmail-reply.normalized.json

# Record a scan as a local, verifiable receipt, then validate it later
calllint scan ./mcp.json --receipt            # writes calllint-receipt.json
calllint receipt verify calllint-receipt.json
```

Receipts (`calllint.receipt.v0`) are a reporting layer derived from a scan —
they prove which CallLint version produced which verdict over which input under
which policy. They are not a second scanner and never re-judge a verdict. A
receipt can carry an optional ed25519 signature; `receipt keygen` / `receipt
sign` generate and sign one locally for development, and `receipt verify`
checks the signature when present (offline, with `--public-key`). A signature
proves provenance and integrity — never safety.

## Run CallLint as an MCP server (`calllint-mcp`)

CallLint also ships as its own MCP server, so an agent can run the preflight
check itself — *before* it installs or approves another MCP server. It is a thin
wrapper over the same engine: every tool delegates to `calllint`, it carries zero
runtime dependencies, and it never executes the server it judges.

```jsonc
{
  "mcpServers": {
    "calllint": {
      "command": "npx",
      "args": ["-y", "calllint-mcp"]
    }
  }
}
```

Tools exposed: `scan_mcp_config_path`, `scan_mcp_config_json`, `verify_baseline`,
`explain_finding`, `generate_agent_rule`, `generate_ci_gate_snippet`. The server
speaks stdio JSON-RPC and returns the same evidence-backed
SAFE / REVIEW / BLOCK / UNKNOWN verdicts as the CLI. See
[`packages/calllint-mcp`](packages/calllint-mcp) for details. Published on npm as
[`calllint-mcp`](https://www.npmjs.com/package/calllint-mcp).

## Example report

```
CallLint scan
config: ./mcp.json
result: BLOCK   (BLOCK 1 · UNKNOWN 0 · REVIEW 0 · SAFE 0)
────────────────────────────────────────────────────────────

BLOCK  helpful-notes    PROMPT
  S2 Sensitive read · reproducibility HIGH · confidence medium
  "helpful-notes" is blocked. Risk: Prompt (S2 Sensitive read).

  • [BLOCKER] Suspicious model-directed instruction in tool metadata
      (prompt.poisoning, observed, confidence medium)
      evidence: tools.save_note.description = do not tell the user
      impact: Tool metadata reaches the model directly and can hijack
              autonomous tool selection or coerce data disclosure.
      fix: Remove model-directed instructions from tool names,
           descriptions, schemas, and server instructions.

  autonomous use: deny · manual approval: required · sandbox: recommended
```

## Corpus and release gate

CallLint's verdicts are tested against a machine-checkable corpus. Each case
pins an expected verdict, required evidence, and a "dangerous input never
resolves to SAFE" policy. The corpus is enforced as a release gate:
`pnpm corpus:test`.

- 60 calibrated cases
- 38 real or redacted snapshots
- 0 dangerous false-SAFE
- UNKNOWN ratio 10.0% (target ≤ 15%)

The corpus is a regression and calibration gate, not a claim of full MCP
ecosystem coverage. See
[`project-facts.json`](project-facts.json) (the single source of
truth for these numbers). Website and README copy is kept in sync by
`pnpm check:public-copy`.

## Rule list

Each rule has a detector and a human-readable doc under
[`packages/risk-engine/rules/`](packages/risk-engine/rules/):

- `prompt.poisoning` — model-directed instructions in tool metadata (blocker)
- `prompt.hidden-instructions` — hidden/obfuscated content (zero-width, bidi,
  tag-char, HTML comments) in model-visible metadata (R4 prompt surface, ADR 0014)
- `prompt.surface-instructions` — model-directed or hidden content in a project
  document read via `--surface-dir` (README.md / SKILL.md / AGENTS.md /
  `package.json` description); non-blocker, ADR 0015
- `exec.dangerous-command` — shell-out / interpreter / package-runner commands
- `exec.unverified-local-source` — runs a local script/binary that is not a
  recognized package, pinned image, or remote (ADR 0011)
- `files.broad-path` — over-broad filesystem grants, incl. docker bind-mount host
  paths (`--mount type=bind,src=…`, `-v host:container`; ADR 0012)
- `supply.unpinned-package` — unpinned package specs (rug-pull surface)
- plus `secretEnvKeys`, `unknownRemote`, `externalMutation`, `financialAction`
  detectors (see [What it checks](#what-it-checks))

Verdicts are governed by **policy as code** (`calllint.policy.json`); run
`calllint policy init` to write the defaults and `calllint policy explain` to see
the effective policy.

## Badge

`calllint scan <config> --badge` emits a [shields.io endpoint][endpoint] JSON
object so an MCP author can show a truthful CallLint verdict in a README. It is
built for transparency: the badge shows whatever the verdict is, and **only
`SAFE` is green** — `REVIEW`, `UNKNOWN`, and `BLOCK` each carry a distinct
non-green colour. It is a projection of the aggregate verdict (no schema change),
and `SAFE` means no blockers observed, not a proof of runtime safety. See
[badge.md](badge.md) for the wiring and the verdict→colour map.

[endpoint]: https://shields.io/badges/endpoint-badge

## Security model

CallLint is a security tool, so its own boundaries are explicit and auditable.

- **No host execution.** It parses and reasons about configuration only; it never
  runs the server it judges. (See ADR 0003.)
- **Treats all config as attacker-controlled.** Tool names, descriptions, and
  schemas are untrusted input; report rendering escapes them.
- **Offline by default.** `--online` adds advisory registry lookups only and can
  never make a verdict *more* permissive.
- **Deterministic and reproducible.** No model, clock, or network in the decision
  path; the JSON output schema is stable (`calllint.report.v0`).

Full statement: [SECURITY.md](SECURITY.md) ·
trust boundaries: [LIMITATIONS.md](LIMITATIONS.md). Report issues to
security@calllint.com.

## Limitations

CallLint sees configuration, not behavior. It can miss risks a server only
reveals at runtime, and can flag surface that turns out benign. It depends on
the tool metadata you provide being accurate, and a server can change after you
approve it (use `baseline` / `verify` to catch that). It is heuristic: expect
both false positives and false negatives, and treat `REVIEW`/`BLOCK` as the
start of a review, not a complete threat assessment. See
[LIMITATIONS.md](LIMITATIONS.md) for the full trust-boundary document.

## Roadmap

- Broaden config-format coverage (more agent/host config dialects)
- Richer online supply-chain signals (still advisory, never auto-SAFE)
- More detectors and tunable policy packs
- Editor/CI integrations beyond SARIF

CallLint stays focused on pre-run risk linting for agent-tool configurations.
Hosted registries, gateways, and runtime enforcement are outside the current
release scope.

## Project

CallLint is the official Apache-2.0 open-source project published at
[calllint.com](https://calllint.com),
[github.com/calllint/calllint](https://github.com/calllint/calllint), and npm
packages [`calllint`](https://www.npmjs.com/package/calllint) (CLI) and
[`calllint-mcp`](https://www.npmjs.com/package/calllint-mcp) (MCP server). It is
maintainer-led — see [GOVERNANCE.md](GOVERNANCE.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The CallLint name and
logo are not licensed with the code; see [TRADEMARKS.md](TRADEMARKS.md).
