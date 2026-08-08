# Current MCP runtime surface — measured

Measured 2026-08-08 against `main` @ `b136f44`. Every row carries the `path:line` it was read
from. Nothing here is aspirational; where a claim could not be measured it says so.

## What the server advertises

| Claim | Measured value | Source |
| --- | --- | --- |
| Protocol version | `2024-11-05` | `packages/calllint-mcp/src/server.ts:13`, served at `:61` |
| Tools | **13** | `scripts/mcp-pack-smoke.mjs:112` asserts exactly 13 |
| Resources | **19** | one per committed contract, `packages/calllint-mcp/src/resources.ts:40` |
| Runtime dependencies | `{}` | gated at `scripts/mcp-pack-smoke.mjs:67-69` |
| Transport | stdio only | driven over stdin/stdout, `scripts/mcp-pack-smoke.mjs:105` |

`2024-11-05` is the accurate public state and this batch does not touch it. No CallLint surface
claims 2026-07-28 support (new17 §19).

## Methods handled

`initialize` · `tools/list` · `tools/call` · `resources/list` · `resources/templates/list` ·
`resources/read` (`server.ts:86-109`). **`server/discover` is not implemented** — mandatory to
implement under 2026-07-28, which is why it is D4 in `protocol-delta-matrix.json` rather than a
gap to close now.

## The resource chain, end to end

```
src/data/adoption-contracts.json      19 contracts, schema calllint.mcp-committed-contracts.v1
  └─ committedContracts.ts:85         COMMITTED_CONTRACT_SLUGS = Object.keys(BUNDLE.contracts)
       └─ resources.ts:40             RESOURCES = COMMITTED_CONTRACT_SLUGS.map(...)
            └─ server.ts:98           resources/list → { resources: RESOURCES }
                 └─ the wire          what an installed client actually receives
```

esbuild inlines the JSON into `dist/index.js`, which is what keeps runtime dependencies empty.

## INV-M8: measured, not inferred

new16-new17 §2.4 recorded the resource count as documented-but-ungated. That was correct, but the
gap was in a different place than the wording implied, and finding it took three attempts. Each
mutation below was applied to source (never to a test), rebuilt, run, then reverted and confirmed
byte-identical.

| Mutation | Result before the fix | What it proved |
| --- | --- | --- |
| Drop 1 contract from the bundle (19→18) | `pack:smoke:mcp` **PASS** at `resources(18)`, but `committed-contracts-drift.test.ts:49` **caught** it | A one-sided drop was already guarded. Not the gap. |
| Drop the contract **and** its baked sidecar | 139/139 MCP unit tests **PASS**; `pack:smoke:mcp` **PASS** at `resources(18)`; caught only by an unrelated trust-index gate (`configured-copy-plane.test.ts:132`) | Closer, but the catch is incidental — it fires on a copy-plane override, not on the served count. |
| `server.ts:98` → `RESOURCES.slice(0, 3)` | **220 test files / 3548 passed** — the exact baseline — and `pack:smoke:mcp` **PASS** printing `resources(3)` | **The real gap.** The server can serve 3 of 19 contracts, 84% of the surface silently gone, with every gate in the repo green. |

The third mutation leaves every committed byte intact, which is why every byte-comparison gate is
blind to it. Two in-package assertions look like they should catch it and cannot:

- `packages/calllint-mcp/test/resources.test.ts:14` — `expect(RESOURCES).toHaveLength(COMMITTED_CONTRACT_SLUGS.length)`
  is a **tautology**: `RESOURCES` is `.map()`-derived from those exact slugs at `resources.ts:40`,
  so the lengths are structurally equal and can never disagree.
- `packages/calllint-mcp/test/committed-contracts-drift.test.ts:49` — a real guard, but it compares
  the bundle to the baked sidecars. It cannot see a **wire** that ignores the bundle.

`mcp-pack-smoke.mjs:121` already asserted the URI *scheme*, so a foreign resource was guarded
before this batch. The unguarded surface was only the **count and the slug set on the wire** — one
notch narrower than the tracker recorded, and in a different layer.

### The fix

`scripts/mcp-pack-smoke.mjs` now compares the wire against the committed bundle: count equality,
set equality (named difference on both sides), plus a vacuity guard for an empty bundle. The
expected count is **derived from the bundle, never hardcoded**. A frozen `19` would go red the
moment a 20th contract lands — red exactly when the gate's own goal is met. The tool count at
`:112` stays a literal `13` on purpose: that is a frozen product surface, not a function of data.

Four controls, all applied to source and reverted byte-identically:

| Control | Mutation | Observed |
| --- | --- | --- |
| A | wire serves 3 of 19 | **RED**: `resources/list served 3 of 19 committed contracts` |
| B | 19 resources, one slug renamed | **RED**: `missing: [mcp-registry/ac.inference.sh-mcp], extra: [typo-slug]` |
| C | bundle grown to 20 contracts | **GREEN** — proves the count is derived, not frozen at 19 |
| D | bundle emptied | **RED**: `committed bundle exposes no contracts` (vacuity guard) |

Control C is the load-bearing one: it is the only control that must **pass**, and a hardcoded
expectation would have failed it.

## Reachability caveat

`pnpm pack:smoke:mcp` is **not** part of `pnpm ci:local`. It runs in CI and must be invoked by
hand locally. A regression in this gate is therefore green-local / red-remote, which has already
happened twice in this repo (new16-new17 §2.2). The assertion added here inherits that property.
