# exec.unverified-local-source

Status: Accepted (ADR 0011, Direction 2)

Risk: Runs a local executable whose contents CallLint never inspects.

Verdict impact: Non-blocker → REVIEW when the runtime is a local executable that
is neither a recognized package (with a parsed package name), a docker image, nor
a remote. SAFE is reachable only for recognized, inspectable sources.

Symbol: EXEC · Risk class: S2 · Mode: OBSERVED · Severity: medium

Observed evidence: the resolved runtime binding — `command` plus the local script /
module it runs (e.g. `node ./dist/server.js`, `uv run python -m thing`,
`/opt/unknown/bin/thing`).

Firing condition (exact): `binding.sourceKnown` AND `binding.runtimeExecutable` AND
`binding.runtimeKind !== "docker"` AND `!binding.packageName`. This excludes
recognized package runners (npx/uvx with a parsed package), docker images, remotes
(nothing runs locally), and shells (already UNKNOWN — the dangerous-command rule's
surface).

Why it matters: A pre-flight check for agent tools should not return green for a
local script it has not seen. The source is observable (it is in the config) but
not independently verifiable — it is not a named package or a pinned image, so what
actually runs cannot be confirmed from the config alone.

False positives: A developer running their own local server (`node ./dist/server.js`)
is normal. The finding says "we did not inspect this source", not "this source is
malicious" — it is a confirmation prompt, carried by the `falsePositiveNote`.

Fix: Confirm you trust the local source, or run it from a pinned, recognized
package (e.g. `npx pkg@1.2.3` / a pinned docker image) so the runtime is
independently verifiable.

Golden fixtures:
- review-unverified-local-source.json (node ./dist/server.js) must trigger
- safe-time.json (npx @scope/pkg@1.0.0, recognized pinned package) must not trigger
