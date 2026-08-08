# Proposed file map for a 2026-07-28 adoption

Measured 2026-08-08 against `main` @ `b136f44`. **Nothing in this file is authorized by M26-0.**
This is the blast-radius estimate that lets a future batch be scoped and reviewed; M26-0 itself is
audit-only and changed exactly one source file.

Every row names the delta it serves (`protocol-delta-matrix.json`) and the batch that owns it.
Rows are ordered by the batch that must land first.

## M26-5 — vendor the spec bytes (unblocks everything)

| Path | Change | Why |
| --- | --- | --- |
| `third_party/modelcontextprotocol/2026-07-28/` | **new** | Currently ABSENT — this is F8, the only failing gate. INV-M4 forbids CI fetching the live spec, so F1-F7 have no offline basis until these bytes exist. |
| `third_party/**` in `.gitattributes` | **new pin** | Vendored bytes will be digest-locked; a CRLF checkout would move the digest and false-fail on windows-latest alone. Same trap as `packages/adoption-index/migrations/**`. |
| a digest lock + its gate | **new** | Per O-M1: a gate with no evidence artifact is not a gate. The lock is what makes F1-F7 re-checkable rather than a dated human note. |

## M26-1 — version negotiation (D1, D3)

| Path | Change | Why |
| --- | --- | --- |
| `packages/calllint-mcp/src/server.ts:13` | `PROTOCOL_VERSION` | The single advertised constant. |
| `packages/calllint-mcp/src/server.ts:20-25` | `JsonRpcRequest` | Must admit `_meta`; today the per-request version is silently discarded (see `current-parser-map.md`). |
| `packages/calllint-mcp/src/server.ts:31-37` | `ERR` | Needs an `UnsupportedProtocolVersionError` member; the current set is the five base JSON-RPC codes. |
| `packages/calllint-mcp/src/server.ts:59-62` | `initialize` | Must compare the requested version instead of returning a fixed one. |
| new ADR | **required** | A change to the advertised protocol version is a public-surface change. Next free number is **0062** (measured: `adrs/` tops out at `0061`; `0060` is reserved by drift-checked bytes at `artifacts/phase-2.4/presentation-plane-audit.json:135`). Re-`ls adrs/` when authorized rather than trusting this line. |
| new17 §19 forbidden-copy surfaces | **same batch** | The version constant and every public claim must move together. Moving one first is either a false claim or a silent conformance bug. |

## M26-2 — `server/discover` (D4)

| Path | Change | Why |
| --- | --- | --- |
| `packages/calllint-mcp/src/server.ts:59-113` | new `case` | Mandatory to implement, optional to call. Absent today. |
| `scripts/mcp-pack-smoke.mjs` | new stdio assertion | The gate already drives 6 requests over stdio; a 7th proves the method answers from the *published tarball*, not just in unit tests. |

## Gates that will need updating in whichever batch changes the surface

| Path | Why |
| --- | --- |
| `scripts/mcp-pack-smoke.mjs:109` | asserts `initialize` returns *some* `protocolVersion`; it does not pin the value. Pinning it is how a version bump becomes visible in the published artifact. |
| `packages/calllint-mcp/test/*` | 139 tests measured on this branch; the version-shape tests move with `server.ts`. |

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
