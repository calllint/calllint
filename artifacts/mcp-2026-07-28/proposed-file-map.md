# Proposed file map for a 2026-07-28 adoption

Measured 2026-08-08 against `main` @ `b136f44`. **Nothing in this file is authorized by M26-0.**
This is the blast-radius estimate that lets a future batch be scoped and reviewed; M26-0 itself is
audit-only and changed exactly one source file.

Every row names the delta it serves (`protocol-delta-matrix.json`) and the batch that owns it.
Rows are ordered by the batch that must land first.

## M26-5 — vendor the spec bytes (unblocks everything)

| Path | Change | Why |
| --- | --- | --- |
| `third_party/modelcontextprotocol/2026-07-28/` | **new** | Currently ABSENT — this is F8, the only failing gate. INV-M4 forbids CI fetching the live spec, so F1-F7 have no offline basis until these bytes exist. **DELIVERED 2026-08-09 at `third_party/mcp-spec/2026-07-28/` — a different path than this row proposed.** This row and `docs/new16-new17-integration.md:261` disagreed: `third_party/modelcontextprotocol/` here, `third_party/mcp-spec/` there. The integration doc won, because it also fixes the file set and the lock's schema id (`calllint.mcp-spec-source-lock.v1`) — taking this row's path would have split one decision across two vocabularies. Recorded rather than silently resolved: a future reader finding both strings needs to know which was executed and why. Five files vendored (`schema.json`, `schema.ts`, `changelog.snapshot.md`, `deprecated.snapshot.md`, `LICENSE`) at upstream commit `271ecc9a`. |
| `third_party/**` in `.gitattributes` | **new pin** | Vendored bytes will be digest-locked; a CRLF checkout would move the digest and false-fail on windows-latest alone. Same trap as `packages/adoption-index/migrations/**`. **DONE.** And unlike the `deploy/**` and `artifacts/trajectory-v0/**` pins, this one is **not itself unguarded**: the digest lock has a reader, so a CRLF checkout reds the gate twice — the sha256 moves, and a dedicated assertion counts `\r` and names the file. |
| a digest lock + its gate | **new** | Per O-M1: a gate with no evidence artifact is not a gate. The lock is what makes F1-F7 re-checkable rather than a dated human note. **DONE** — `SOURCE.json` + `tests/invariants/mcp-spec-vendor.invariants.test.ts` (20 assertions, no network). It paid off on the first read: **two of the seven recorded observations were false.** F4's section names appear nowhere in the bytes, and F7's evidence is in `deprecated.mdx`, not the changelog it cited. Both had survived a merged batch, because both were transcriptions of a rendered page no gate could read back. |

## M26-1 — version negotiation (D1, D3)

| Path | Change | Why |
| --- | --- | --- |
| `packages/calllint-mcp/src/server.ts:13` | `PROTOCOL_VERSION` | The single advertised constant. |
| `packages/calllint-mcp/src/server.ts:20-25` | `JsonRpcRequest` | Must admit `_meta`; today the per-request version is silently discarded (see `current-parser-map.md`). |
| `packages/calllint-mcp/src/server.ts:31-37` | `ERR` | Needs an `UnsupportedProtocolVersionError` member; the current set is the five base JSON-RPC codes. |
| `packages/calllint-mcp/src/server.ts:59-62` | `initialize` | Must compare the requested version instead of returning a fixed one. |
| new ADR | **required** | A change to the advertised protocol version is a public-surface change. Next free number is **0062** (measured: `adrs/` tops out at `0061`; `0060` is reserved by drift-checked bytes at `artifacts/phase-2.4/presentation-plane-audit.json:135`). Re-`ls adrs/` when authorized rather than trusting this line. **Amended 2026-08-08, by executing that instruction:** re-`ls adrs/` returned `0061` as the top and `0062` as free, so the T0 trajectory-audit landing decision took it ([adrs/0062](../../adrs/0062-trajectory-audit-landing-site.md)). **M26-1's next free number is now 0063**; `0060` remains reserved as stated. Re-`ls adrs/` again when M26-1 is authorized rather than trusting this line either. **Amended 2026-08-09, by executing it a third time:** `adrs/` topped out at `0062`, so M26-1 took **0063** ([adrs/0063](../../adrs/0063-per-request-protocol-version-negotiation.md)). `0060` still reserved. |
| new17 §19 forbidden-copy surfaces | **same batch** | The version constant and every public claim must move together. Moving one first is either a false claim or a silent conformance bug. |

### Amended 2026-08-09 — M26-1 EXECUTED, and one row above is measurably wrong

The four `server.ts` rows are kept verbatim; read this subsection as current. M26-1 landed as
[ADR 0063](../../adrs/0063-per-request-protocol-version-negotiation.md).

**The `server.ts:59-62` row targets a method 2026-07-28 does not have.** Measured against the
digest-locked bytes: `grep -c 'nitialize' third_party/mcp-spec/2026-07-28/schema.ts` → **0**,
`schema.json` → **0**, and `changelog.snapshot.md` Major #2 reads *"Make MCP stateless: remove the
`initialize`/`notifications/initialized` handshake."* Major #5 removes `ping` and
`logging/setLevel`. So "`initialize` must compare the requested version" describes work that cannot
be done — SEP-2575 deletes the method rather than changing what it returns. The row was authored
before the bytes were vendored, from a rendered page no gate could read back; the same mechanism
that made F4's section names and F7's source URL wrong. Amended in `protocol-delta-matrix.json` D1
(`amendedByM26-1`) and explained in ADR 0063 §2.

**What was executed instead**, per the authorized scope (negotiation layer only):

| Row | Executed as |
| --- | --- |
| `:13` `PROTOCOL_VERSION` | **UNCHANGED at `2024-11-05`** — deliberately, and asserted in two files. A new `SUPPORTED_PROTOCOL_VERSIONS` set was added beside it; `2026-07-28` is absent from it and a gate parses the array to prove so. |
| `:20-25` `JsonRpcRequest` | **DONE** — `params?._meta` admitted via a `RequestMeta` interface, plus exported `readRequestedProtocolVersion`. |
| `:31-37` `ERR` | **DONE** — `UNSUPPORTED_PROTOCOL_VERSION: -32022`, extracted from upstream's own `export const` by the vendor gate rather than restated. |
| `:59-62` `initialize` | **NOT DONE, and correctly so.** The version check runs **once before** `switch (req.method)`, not inside any arm — so a mismatched client cannot reach a tool handler and an unknown method still reds on the version. `initialize`/`ping` are left served, and a gate asserts they are *still present here* while *absent upstream*. |

**The last row of this table is now the load-bearing one, inverted.** It reads "the version constant
and every public claim must move together" — correct, and it is exactly why M26-1 moved **neither**.
Adopting the revision needs `server/discover` (**MUST implement** upstream, M26-2's D4), so the
constant stays put and the negotiation layer ships underneath it. The residue is enumerated as
**M-OPEN-5** in [open-items.md](./open-items.md), including the ordering constraint that
`server/discover` must land *before* `initialize` is removed, and the exact assertions a later batch
must deliberately edit.

## M26-2 — `server/discover` (D4)

| Path | Change | Why |
| --- | --- | --- |
| `packages/calllint-mcp/src/server.ts:59-113` | new `case` | Mandatory to implement, optional to call. Absent today. **Still absent after M26-1 — but its absence is now ASSERTED, not merely pending:** two gates red if `case "server/discover"` appears here (`mcp-spec-vendor.invariants.test.ts`, and a wire test expecting `-32601`). M26-2 must edit both deliberately; see M-OPEN-5. Upstream declares it at `schema.ts:665`/`:678`/`:707`. |
| `scripts/mcp-pack-smoke.mjs` | new stdio assertion | The gate already drives 6 requests over stdio; a 7th proves the method answers from the *published tarball*, not just in unit tests. |

## Gates that will need updating in whichever batch changes the surface

| Path | Why |
| --- | --- |
| `scripts/mcp-pack-smoke.mjs:109` | asserts `initialize` returns *some* `protocolVersion`; it does not pin the value. Pinning it is how a version bump becomes visible in the published artifact. |
| `packages/calllint-mcp/test/*` | 139 tests measured on this branch; the version-shape tests move with `server.ts`. **M26-1 raised `test/server.test.ts` from 16 to 29 tests**; the three new describe blocks (D1, D3, and "no premature claim") are where a version bump will red first. |

## Explicitly NOT in scope for any M batch

These are forbidden paths (new16-new17 §7.1), restated here so a future reader of this map cannot
mistake an omission for an oversight:

- `packages/adoption-index/**` and ADR 0061 semantics
- `computeVerdict` — the sole adjudicator; no M batch moves a verdict
- the four stable schemas
- served bytes under `apps/web/public/**`
- the tool count (**13**) and resource count (**19**)
- `packages/calllint-mcp` runtime `dependencies` — must stay `{}`, gated at `mcp-pack-smoke.mjs:67-69`

## Sequencing, on measured grounds

F8 is the **only** failing gate. That makes the order non-negotiable: **M26-5 first**, because
until vendored bytes exist, F1-F7 rest on the dated manual reads in `finality-status.json` and no
CI job can re-derive them. This confirms O-M1's stated default of "lock first" — now on measured
grounds rather than as an editorial preference.

**Amended 2026-08-09, M26-5 having merged (`669ebf9` #274).** F8 is now PASS and all eight gates
pass, so this section's premise is spent — kept verbatim because it is the record of *why* M26-5 went
first, and that reasoning was correct. The sequencing constraint it imposed no longer binds: M26-1…
M26-4 are unblocked on finality and may be authorized on their merits.

What M26-5 did **not** close is now enumerated in [open-items.md](./open-items.md) rather than left
to be re-derived: **F5 and F6 still rest on unvendored pages** (this table has no row scoping that
work — M-OPEN-1 supplies one), the superseded top-level `verdict` has no reader-side guard
(M-OPEN-2), the SEP-2596 removal clock is unresolvable from vendored bytes (M-OPEN-3), and the
deprecated-table row filter does not strip `\r` (M-OPEN-4). Read that file before scoping any M
batch; it also records which carried items are already **closed**, since two were being tracked as
open after they had in fact landed.

**Amended 2026-08-09, M26-1 having been authorized and executed (ADR 0063).** D1 and D3 are closed;
**D4 is the whole remaining gap**, and it is a `MUST implement` upstream. So the sequencing constraint
that replaces the spent F8 one is *within* the surface work rather than before it: **M26-2's
`server/discover` must land before `initialize`/`ping` are removed**, because `server/discover` is
what replaces the handshake — removing it first leaves a client no way to discover capabilities at
all, and would pass any test written only about absence. `SUPPORTED_PROTOCOL_VERSIONS` is the last
line to move, not the first. Recorded as **M-OPEN-5** with the per-assertion work order.
