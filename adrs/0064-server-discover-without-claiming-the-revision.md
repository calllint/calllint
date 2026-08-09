# ADR 0064 — `server/discover`, served at 2024-11-05 and still not claiming 2026-07-28

- Status: Accepted (2026-08-09). Adds one method to `packages/calllint-mcp`. It changes no
  schema, no verdict, no served byte, and neither the tool count (13) nor the resource
  count (19). `PROTOCOL_VERSION` stays `2024-11-05`, `SUPPORTED_PROTOCOL_VERSIONS` stays
  without `2026-07-28`, and `initialize` / `notifications/initialized` / `ping` stay served
  — each of those four still held by a gate.
- Date: 2026-08-09
- Implements: **D4** (`server/discover` — mandatory to implement, optional to call) of
  [artifacts/mcp-2026-07-28/protocol-delta-matrix.json](../artifacts/mcp-2026-07-28/protocol-delta-matrix.json),
  and item **(a)** of M-OPEN-5 in
  [artifacts/mcp-2026-07-28/open-items.md](../artifacts/mcp-2026-07-28/open-items.md)
- Refines: 0025 (the hand-rolled MCP stdio transport), 0063 (the negotiation layer this
  method sits beside)
- Related: 0060 (**still reserved**, see §1), 0062 (consumed the number 0063 was originally
  reserved as), 0061 §8.5.1 (the append discipline used on the artifacts amended here)

## §1 Numbering: 0064, and 0060 remains reserved

`proposed-file-map.md` carries a standing instruction — *"Re-`ls adrs/` when authorized
rather than trusting this line"* — and it has now been executed four times. Executed again
at authoring time: `adrs/` tops out at **0063**, so this ADR is **0064**.

**0060 is still held, not free.** It is reserved for the `propertyNames` schema defect
recorded as *"RECORDED, NOT FIXED"* in drift-checked bytes at
`artifacts/phase-2.4/presentation-plane-audit.json:135`. Four ADRs have now been numbered
around it; taking it would break a reservation a gate reads.

## §2 The finding that reshaped this batch: D4 understates its own obligation by four fields

D4's row reads, in full: *"`server/discover` — mandatory to implement, optional to call."*
Read literally, that scopes M26-2 as one `case` arm returning versions and capabilities.

**Measured against the digest-locked bytes, a conformant `DiscoverResult` requires five
fields, and D4's row names two of them.** From `third_party/mcp-spec/2026-07-28/schema.json`:

| `$defs` entry | `required` | `additionalProperties` |
| --- | --- | --- |
| `DiscoverResult` | `["cacheScope","capabilities","resultType","supportedVersions","ttlMs"]` | **ABSENT** |
| `CacheableResult` (its parent) | `["cacheScope","resultType","ttlMs"]` | **ABSENT** |
| `Result` (its grandparent) | `["resultType"]` | `{}` |
| `RequestParams` | `["_meta"]` | ABSENT |
| `RequestMetaObject` | `["io.modelcontextprotocol/clientCapabilities","io.modelcontextprotocol/protocolVersion"]` | ABSENT |

So three obligations were invisible in the delta matrix:

1. **`resultType`** is inherited from `Result`, which upstream requires on **every** result
   in this revision, not just on discover: *"Servers implementing this protocol version
   MUST include this field."* It appears in **14** `$defs`. It is an **open** type —
   `export type ResultType = "complete" | "input_required" | string` (`schema.ts:216`), and
   `schema.json` gives it a bare `"type": "string"` with **no** `enum` and **no** `const`.
2. **`ttlMs` + `cacheScope`** make discover a **cacheable** response, with semantics
   quoted from HTTP `Cache-Control`: `ttlMs` is `integer, minimum 0` (0 meaning *"the
   response SHOULD be considered immediately stale"*), and `cacheScope` is
   `enum ["private","public"]` where `"public"` explicitly permits *"any client or
   intermediary (e.g., shared gateway, caching proxy)"* to *"serve it across authorization
   contexts"*. Response caching is a thing CallLint has never decided anything about.
3. **A conformant `DiscoverRequest` must carry `params._meta` with two required keys** —
   `io.modelcontextprotocol/protocolVersion` **and**
   `io.modelcontextprotocol/clientCapabilities`. ADR 0063 shipped a reader for the first
   key only. Upstream is explicit that the second cannot be reconstructed from history:
   *"Capabilities are declared per-request rather than once at initialization … Servers
   MUST NOT infer capabilities from prior requests."*

### §2.1 And the changelog's description of the method is wrong about identity

`changelog.snapshot.md:16` reads: *"servers MUST implement this RPC to advertise their
supported protocol versions, capabilities, **and identity**."*

`DiscoverResult` has **no identity field**. Measured: the string `serverInfo` does not
appear anywhere in its `$defs` entry, and neither does any reference to `Implementation`.
Identity in this revision lives in `_meta` on the **response**, as
`ResultMetaObject["io.modelcontextprotocol/serverInfo"]?` (`schema.ts:157`) — **optional**,
a **SHOULD** (*"Servers SHOULD include this field on every response"*), and carrying its own
warning that clients *"SHOULD NOT rely on it for security decisions."*

A reader who implemented from that changelog sentence would have put `serverInfo` in the
result body, where the schema does not define it. This is the **fourth** time the M26-5
lock has caught a claim of exactly this kind — after F4's section names, F7's source URL,
and D1's `initialize` premise — and the mechanism is identical every time: prose authored
about a rendered page, which no gate could read back. The correction is appended to D4
rather than overwriting it.

## §3 Decision

Implement **`server/discover` only** — item (a) of M-OPEN-5, and nothing after it.

1. Serve `case "server/discover"` returning `supportedVersions` (the existing
   `SUPPORTED_PROTOCOL_VERSIONS` array, so there is one source of truth, not two),
   `capabilities` (the same object `initialize` returns), and `instructions` (the same
   string `initialize` returns).
2. Include the three fields §2 measured — `resultType: "complete"`, `ttlMs`, `cacheScope`
   — **on this result only**. See §4 for why not everywhere.
3. Read `io.modelcontextprotocol/clientCapabilities` **not at all**, and record that as a
   decision rather than an omission. See §5.
4. Keep `initialize`, `notifications/initialized`, and `ping` exactly as they are, and
   leave `PROTOCOL_VERSION` and `SUPPORTED_PROTOCOL_VERSIONS` untouched.

### §3.1 What is deliberately NOT done, and what holds each line

| Not done | Why | What holds the line |
| --- | --- | --- |
| `2026-07-28` added to the supported set | This is the public claim, and M-OPEN-5 orders it **last** — after (a) *and* (b) | the vendor gate parses the array and asserts the string is absent; `server.test.ts` asserts declaring it errors |
| `initialize` / `ping` removed | (b), and it needs its own authorization. Removing them while advertising 2024-11-05 would break the contract we actually serve | a gate asserts both cases are present here **and** absent upstream |
| `PROTOCOL_VERSION` bumped | new17 §19: no public claim until the surface exists | asserted in **two** files |
| `resultType` on the other 8 results | §4 | a gate asserts `tools/list`'s result carries **no** `resultType`, so adding it silently reds |
| `clientCapabilities` read or acted on | §5 | a test asserts a request declaring it is neither rejected nor behaviourally different |
| `examples/*.json` asserted byte-wise | those files are **not** among the five vendored; `{@includeCode}` targets bytes we do not have | §6 |

The omissions are **asserted, not merely absent** — the same discipline as ADR 0063 §3.1.
An omission with no gate is indistinguishable from an oversight.

## §4 Why `resultType` goes on discover only, and not on all nine results

Upstream requires `resultType` on **every** result at 2026-07-28. This server advertises
**2024-11-05**, and upstream writes the backward-compatibility rule from the client's side:
*"when a client receives a result from a server implementing an earlier protocol version
(which does not include `resultType`), the client MUST treat the absent field as
`"complete"`."* So omitting it is the **defined** behaviour for a server at our version,
not a gap.

Adding it to `tools/list`, `tools/call`, `resources/read` and the rest would change the
bytes every existing client receives today, for a revision we do not serve — a public-surface
change with no client asking for it. Adding it **only** to `server/discover` changes bytes
no client has ever received, because the method did not exist before this batch.

The asymmetry is therefore deliberate, and it is gated in the direction that can go wrong
silently: a test asserts `tools/list`'s result has **no** `resultType` key. A future batch
that adopts the revision must add it everywhere and delete that assertion — which is the
point of writing the assertion.

`ttlMs` is **0** and `cacheScope` is **"private"**, which are the conservative ends of both
enums: 0 means *"immediately stale"* (no client caches a stale capability list), and
`"private"` forbids sharing across authorization contexts. Picking `"public"` with a long
TTL would let an intermediary serve one server's capability list to another authorization
context — a caching decision masquerading as a default. CallLint's stdio server has no
authorization context to speak of, which is an argument for the *narrow* value, not the
broad one.

## §5 `clientCapabilities` is required upstream and unread here — on purpose

`RequestMetaObject` requires it. This server does not read it, and would behave identically
if it did, because there is nothing in the 13-tool / 19-resource surface whose shape depends
on a client capability: every tool is a synchronous pure delegator (ADR 0025) and every
resource is a committed byte string.

Rejecting a request that omits it would be worse than ignoring it: at 2024-11-05 there is no
`_meta` at all, so a strict read would reject **every** request today's clients send. That is
the same trap ADR 0063 §5 avoided for the version key, and the answer is the same — an
absent declaration is today's traffic, not an error.

What this batch does **not** do is pretend the field is handled. It is recorded here, in
M-OPEN-5, and in D4's amendment, as work that belongs to whichever batch adopts the revision
— at which point *"Servers MUST NOT infer capabilities from prior requests"* becomes a real
constraint on a real feature, rather than an unused field on an unclaimed version.

## §6 What the vendored bytes cannot gate

`schema.ts` documents discover with three `{@includeCode ./examples/…}` directives. The
`examples/` directory is **not** among the five files M26-5 vendored, so those bytes cannot
be asserted offline, and INV-M4 forbids fetching them in CI.

The gate therefore parses what *is* locked — the interface declarations and the JSON Schema
`required` arrays — and this ADR records the bound rather than leaving a reader to assume
example payloads were checked. `SOURCE.json`'s `files[]` is enumerated **from disk** against
a `>= 5` **floor**, so a later batch that vendors `examples/` extends the covered set without
reding anything, exactly as M-OPEN-1 describes for F5/F6.

## §6.1 Negative controls — what each gate was measured to catch

Eight mutations applied to **source** (never to a test), each run against the same runner, each rolled
back and confirmed byte-identical by sha256. A **positive control** ran first on unmutated source
(77/77 green), so a red below cannot be a broken importer. #142–#148 were run before the first push;
**#149 was run against a red CI job** and is written up in §6.2 because it falsified the gate itself,
not the source.

| # | Mutation | Failed naming | Which layer caught it |
| --: | --- | --- | --- |
| 142 | drop `resultType` from the discover arm | `expected [ 'resultType' ] to deeply equal []` | **both** — the vendor gate derived the name from upstream's own `required` array; three wire tests also red |
| 143 | add `2026-07-28` to `SUPPORTED_PROTOCOL_VERSIONS` | 7 tests + `server/discover must advertise exactly ["2024-11-05"], got ["2024-11-05","2026-07-28"]` | vendor gate, wire tests, **and** `pack:smoke:mcp` at the distribution boundary |
| 144 | put `serverInfo` in the discover result body | `not to contain 'serverInfo'` / `to not include 'serverInfo'` | both — the §2.1 claim |
| 145 | `cacheScope: "public"` | `expected 'public' to be 'private'` | **wire only, correctly** — `"public"` is legal upstream, so a gate checking enum membership cannot object. Picking the inert end is CallLint's decision, not upstream's, so only a test asserting the decision can hold it |
| 146 | replace `[...SUPPORTED_PROTOCOL_VERSIONS]` with the literal `["2024-11-05"]` | `to match /supportedVersions:\s*\[\s*\.\.\.SUPPO…/` | **source-shape only** — every wire test stayed green, because the value is identical *today*. A second literal is only wrong later, when the set moves and the copy does not |
| 147 | exempt `server/discover` from the version check | `discover must not bypass version negotiation: expected { jsonrpc, id, …(1) } to have property "error.code" with value -32022` | wire — see below |
| 148 | add `resultType` to the `initialize` arm | `expected [ 'resultType', …(4) ] to not include 'resultType'` | both — the §4 asymmetry |
| 149 | convert `server.ts` to CRLF, i.e. reproduce a windows-latest checkout | `the server/discover arm must be a blank-line-delimited block: expected -1 to be greater than 8324` ×4 + the same for `initialize` | **the gate itself** — see §6.2 |

**#145 and #146 are the informative pair.** They fail in *different* layers and neither layer could
have caught the other: an upstream-derived gate cannot object to a legal-but-wrong value, and a wire
test cannot see a duplicated constant whose value is still correct. Two gates, two distinct claims.

**#147 improved a test rather than merely passing.** The control did red, but with
`Cannot read properties of undefined (reading 'code')` — which names neither the bypass nor what
arrived, because a bypassed request returns a *result* and `.error.code` reads off `undefined`. The
assertion was rewritten to `toHaveProperty("error.code", -32022)` with a message, so the failure now
prints the result object that should have been an error. This is
[[every-collapses-the-observed-value]] in a different disguise: an assertion that reaches *through* a
missing object prints the reach, not the absence.

## §6.2 The gate was wrong on windows-latest, and its failure named the wrong claim

The first push went green on **ubuntu-latest** and **macos-latest** and red on **windows-latest**
alone — `1 failed | 221 passed (222)`, five tests, all in this batch's new block. Four reded on the
arm slice; the fifth printed
`expected 'case "initialize":\r\n      return re…' not to contain 'resultType'`.

**That fifth message was a false accusation.** `server.ts` does not put `resultType` on `initialize`
(§4 is intact, and #148 proves the assertion catches it when it does). The `\r\n` in the printed
string is the whole diagnosis: on a CRLF checkout a blank line is `\r\n\r\n`, so
`src.indexOf("\n\n", start)` never matches and returns **-1**. `String.prototype.slice(start, -1)`
does not throw — it slices to one-before-end — so the `initialize` slice ran to **end of file** and
swallowed the `server/discover` arm below it, where `resultType` legitimately lives. A gate that
silently widens its own scope reports a defect in the wrong method.

The direction of the error is worth stating, because it is not symmetric: the same -1 makes a
`not.toContain` assertion a **false red** and a `toContain` assertion a **false green**. This batch
happened to get the loud half.

`server.ts` arrives CRLF on windows because it carries **no** `text eol=lf` pin — which is correct.
Nothing hashes it, unlike `third_party/**`, and adding a pin no gate reads would itself be unguarded
([[served-asset-source-split-pattern]]). So the fix normalizes the **reader**, not the file:
`readText(...).replace(/\r\n/g, "\n")`. The vendored bytes' CRLF remains a real defect, held by the
digest lock plus a dedicated `\r`-count assertion — the two claims are kept apart on purpose.

Two changes, because the message mattered as much as the pass:

1. The unguarded slices became one helper, `arm(caseLabel)`, which asserts **both** bounds before
   slicing. An unmatched delimiter now reds *naming the delimiter*, instead of quietly measuring
   every arm below the target.
2. The `initialize` test, which had its own hand-rolled slice, now calls that helper — so there is
   one scoping implementation, not two.

Measured, not assumed: with the source CRLF and the normalization stripped (#149), the suite
reproduces CI's five failures exactly, and the fifth now reads
`the initialize arm must be a blank-line-delimited block` rather than blaming `resultType`. With the
normalization restored and the source still CRLF: **77/77 green**. The `M26-1` block at
`tests/invariants/mcp-spec-vendor.invariants.test.ts:223` keeps a second, **un-normalized** reader; it
was run against the CRLF source too and passed 6/6, because every one of its patterns is either
`\s`-tolerant or a single-line literal. Left alone deliberately — normalizing a reader whose
assertions cannot see line endings would be a change no test could justify.

This is the same class as **M-OPEN-4** (the deprecated-table row filter that does not strip `\r`) and
as [[lockfile-crlf-unpinned]]: a `"\n"` anchor passes two of three OSes. The general rule this batch
adds — **a gate that slices source on a line-ending-bearing delimiter must normalize first, and must
assert its bounds** — is recorded here so the next such gate is written correctly rather than
debugged from a red windows job.

## §7 What this ADR does not decide

- **Whether CallLint will support 2026-07-28.** (a) is now landed; (b) — removing the
  handshake — and (c) — the public claim — are untouched, still gated, and still need their
  own authorization. M-OPEN-5 keeps the work order.
- **Response caching as a policy.** `ttlMs: 0` / `cacheScope: "private"` are chosen to be
  inert (§4), not as a considered caching strategy. A batch that wants discover cached must
  decide that on its own terms.
- **Whether `resultType` should carry a value other than `"complete"`.** The type is open
  upstream (`"complete" | "input_required" | string`), so no closed-set gate is possible;
  `"input_required"` describes an interaction shape this server does not have.
- **The HTTP transport.** D2 stays `n/a` — stdio only.
