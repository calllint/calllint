# Current MCP protocol-parsing surface — measured

Measured 2026-08-08 against `main` @ `b136f44`. This is the inventory of every place CallLint
*parses* an MCP protocol shape, which is the set of places a 2026-07-28 adoption would have to
touch. It is deliberately separate from `current-runtime-map.md`: that one records what we
**emit**, this one records what we **accept**.

## The wire decoder

`packages/calllint-mcp/src/server.ts:118-129` — `decodeLine`. One line of JSON per request.

| Accepted / rejected | Measured behaviour | Source |
| --- | --- | --- |
| `jsonrpc` must be `"2.0"` | anything else → `INVALID_REQUEST` (-32600) | `server.ts:123-124` |
| `method` must be a string | otherwise → `INVALID_REQUEST` | `server.ts:123` |
| Malformed JSON | → `PARSE` (-32700) | `server.ts:128` |
| Unknown method | → `METHOD_NOT_FOUND` (-32601) | `server.ts:113` |
| Handler throw | → `INTERNAL` (-32603) | `server.ts:169` |

Error codes are the five base JSON-RPC codes (`server.ts:31-37`). There is **no MCP-specific
error member**, which is exactly why `UnsupportedProtocolVersionError` is a real delta (D3) rather
than a rename.

## The request shape we accept

```ts
interface JsonRpcRequest {          // server.ts:20-25
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}
```

**`_meta` is not in this interface and is read nowhere.** Measured: no occurrence of `_meta` in
`packages/calllint-mcp/src/`. Under 2026-07-28 the per-request protocol version arrives as
`_meta["io.modelcontextprotocol/protocolVersion"]`, so today it would be silently discarded by
`params`' index signature — accepted, ignored, and answered at `2024-11-05` with no mismatch
signalled. That silence is the substance of D1.

## Version handling today

`initialize` returns a single fixed `protocolVersion` (`server.ts:59-62`) and advertises
`capabilities: { tools: {}, resources: {} }`. There is no negotiation: the client's requested
version is not inspected, not compared, and not echoed. A client asking for 2026-07-28 receives
`2024-11-05` and a success.

This is honest under the current advertised version and becomes a conformance bug the instant any
surface claims 2026-07-28 — which is why new17 §19's forbidden-copy list and the version constant
must move in the *same* batch, never one before the other.

## What is NOT parsed

- `_meta` (any key) — absent from the interface, absent from `src/`
- `server/discover` — no case in the method table (`server.ts:59-113`); mandatory to implement
  under 2026-07-28 (D4)
- Task lifecycle messages — the Tasks extension is opt-in and declined by silence (D5); every
  tool is a synchronous pure delegator per ADR 0025
- Any HTTP-level artifact, including the `MCP-Protocol-Version` header — stdio transport only (D2)

## Boundary note

Nothing in this map is a config parser. `packages/config-parser` reads `.cursor/mcp.json` and
`.claude/settings.json` — a *scan target*, never protocol traffic. The two surfaces are unrelated
and a 2026-07-28 adoption does not touch the config parser, which is why it is absent from
`proposed-file-map.md`.

Neither surface executes, imports, starts, connects to, or authenticates against a target
(ADR 0025). That remains true of every delta named in `protocol-delta-matrix.json`.
