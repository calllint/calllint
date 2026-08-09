# ADR 0063 — Per-request protocol version negotiation, without claiming the revision

- Status: Accepted (2026-08-09). Adds a wire-level capability to `packages/calllint-mcp`
  and **no** public claim of MCP 2026-07-28 support. It changes no schema, no verdict, no
  served byte, and no tool or resource count. The advertised `PROTOCOL_VERSION` stays
  `2024-11-05` — and that constant is asserted by two independent gates.
- Date: 2026-08-09
- Implements: D1 (per-request version declaration) and D3
  (`UnsupportedProtocolVersionError`) of
  [artifacts/mcp-2026-07-28/protocol-delta-matrix.json](../artifacts/mcp-2026-07-28/protocol-delta-matrix.json)
- Refines: 0025 (the hand-rolled MCP stdio transport this changes)
- Related: 0062 (consumed the number this ADR was originally reserved as), 0061 §8.5.1
  (the append discipline used here)

## §1 Numbering: 0063, because 0062 was consumed and 0060 is reserved

`proposed-file-map.md` reserved **0062** for this batch and carried its own escape clause:
*"Re-`ls adrs/` when authorized rather than trusting this line."* Executed at authoring
time: `adrs/` now tops out at **0062** (taken by the T0 landing decision on 2026-08-08),
so this ADR is **0063**.

**0060 remains reserved, not free.** It is held for the `propertyNames` schema defect
recorded as *"RECORDED, NOT FIXED"* in drift-checked bytes at
`artifacts/phase-2.4/presentation-plane-audit.json:135`. Taking it would break a
reservation a gate reads.

## §2 The finding that reshaped this batch: `initialize` is deleted, not demoted

The delta matrix scoped D1 as *"replacing initialize-only negotiation as the sole
signal"*, and `proposed-file-map.md` scoped the work as *"`server.ts:59-62` `initialize`
— must compare the requested version instead of returning a fixed one."*

**Both describe a method that does not exist in 2026-07-28.** Measured against the
digest-locked vendored bytes:

| Measurement | Result |
| --- | --- |
| `grep -c 'nitialize' third_party/mcp-spec/2026-07-28/schema.ts` | **0** |
| `grep -c 'Initialize' third_party/mcp-spec/2026-07-28/schema.json` | **0** |
| `changelog.snapshot.md` Major changes #2 | *"Make MCP stateless: **remove the `initialize`/`notifications/initialized` handshake**"* |
| `grep -c '"ping"' schema.ts` | **0** (Major #5 removes `ping` and `logging/setLevel` too) |

So the real shape of D1 is not "change what one `case` returns" — it is *replace a
stateful handshake with a per-request declaration* (SEP-2575), which touches three `case`
arms this server currently serves. The matrix's own citation is the SEP that deletes the
method it describes as surviving.

This is the third time the M26-5 lock has paid off, and the mechanism is identical to the
first two: D1's wording was authored **before** the bytes existed, from a rendered page no
gate could read back. The correction is appended to the matrix rather than overwriting it,
because a deleted claim is indistinguishable from a claim never made.

## §3 Decision

Implement the **negotiation layer only**:

1. Read the per-request version from `_meta`, under the key
   `io.modelcontextprotocol/protocolVersion` — quoted from `schema.ts:76`, where upstream
   declares it a **required** field of `RequestMetaObject`.
2. Reject an unsupported declaration with `UnsupportedProtocolVersionError`, code
   **-32022**, quoted from `schema.ts:450`, carrying the `data: { supported, requested }`
   shape upstream requires at `schema.ts:483`.
3. Keep `initialize`, `notifications/initialized`, and `ping` **exactly as they are**.

### §3.1 What is deliberately NOT done, and why each omission is gated

| Not done | Why | What holds the line |
| --- | --- | --- |
| `2026-07-28` added to the supported set | Accepting the revision advertises a surface that does not exist | `SUPPORTED_PROTOCOL_VERSIONS` is parsed by a gate that asserts the string is absent |
| `server/discover` implemented | Upstream: **MUST implement**. Owned by M26-2, outside this authorization | a gate asserts `case "server/discover"` is absent from `server.ts` |
| `initialize` / `ping` removed | Removing a served method is a public-surface change, and `server/discover` is what replaces them | a gate asserts both cases are still present here **and** absent upstream |
| `PROTOCOL_VERSION` bumped | new17 §19 forbids the public claim until F1–F8 pass **and** a batch implements the surface | asserted in **two** files (the vendor gate and `server.test.ts`) |

The omissions are **asserted, not merely absent**. An omission with no gate is
indistinguishable from an oversight, and the batch that later flips one of these lines
should have to change a test that says why it existed.

## §4 Why the check runs before the method switch

The version check is evaluated **once, before** `switch (req.method)`, not inside each
arm. Three consequences, all deliberate:

- **A mismatched client cannot reach a tool handler.** A scan is the product's side effect;
  running one for a client whose protocol contract we have already rejected would be a
  silent success at the wrong version.
- **An unknown method still reds on the version**, not on `METHOD_NOT_FOUND`. Were the
  check per-arm, a mismatched client calling a 2026-07-28-only method would be told the
  method is missing and never learn the real reason.
- **One rejection path, not seven.** A per-arm check is seven places for the eighth arm to
  forget.

## §5 An undeclared version stays legal — and a malformed one does not

This server advertises 2024-11-05, whose wire shape has **no** version in `_meta`. So an
absent key is not an error: it is today's traffic, and it keeps working unchanged. That is
what makes this change additive rather than a break.

A **non-string** declaration is treated as a **mismatch, not an absence**. Reading
`{"io.modelcontextprotocol/protocolVersion": 20260728}` as "undeclared" would let a
malformed client succeed at a version it never actually agreed to — the exact silent
success D3 exists to end. `readRequestedProtocolVersion` therefore distinguishes three
states, not two: absent (`undefined`), declared-and-valid (the string), and
declared-but-malformed (`""`, which no supported set contains).

A **notification** with a bad version gets no reply. That is JSON-RPC — no `id` means
nowhere to send an error — not a version exemption.

## §6 Both constants are quotations, and both halves are parsed

`META_PROTOCOL_VERSION_KEY` and `ERR.UNSUPPORTED_PROTOCOL_VERSION` are values whose
correctness lives in **another file**. A comment naming the upstream source is a claim
about two files, and a test that reads only ours measures one — which is precisely where
drift hides.

So `tests/invariants/mcp-spec-vendor.invariants.test.ts` parses **both sides**: it
extracts `-32022` from upstream's `export const UNSUPPORTED_PROTOCOL_VERSION` and asserts
`server.ts` carries that same number, rather than asserting the literal twice. If upstream
reassigns the code at a future revision, the gate reds on the disagreement instead of
agreeing with a stale copy.

The bytes being digest-locked (M26-5) is what makes this meaningful: the quotation is
checked against a file that cannot change without the lock reding first.

## §7 What this ADR does not decide

- **Whether CallLint will support 2026-07-28 at all.** That needs M26-2
  (`server/discover`), a decision on removing `initialize`/`ping`, and its own
  authorization. Finality being met is permission to *scope* that work, not to claim it.
- **The HTTP transport.** D2 (`MCP-Protocol-Version` header) is `n/a` — this server is
  stdio-only. Adopting HTTP would make D2 live and is out of scope.
- **F5 and F6's evidence quality.** Still resting on an unvendored manual read; carried as
  **M-OPEN-1** in [artifacts/mcp-2026-07-28/open-items.md](../artifacts/mcp-2026-07-28/open-items.md).
  This batch does not narrow it.
