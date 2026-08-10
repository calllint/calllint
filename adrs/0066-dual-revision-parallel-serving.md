# ADR 0066 — Serving 2024-11-05 and 2026-07-28 in parallel, each whole

- Status: Accepted (2026-08-09). Makes the public claim of 2026-07-28 support and removes
  the handshake **at that revision only**. Changes no schema, no verdict, no served byte
  under `apps/web/public/**`, and neither the tool count (13) nor the resource count (19).
  `packages/calllint-mcp` runtime `dependencies` stays `{}`.
- Date: 2026-08-09
- Implements: items **(b)** and **(c)** of M-OPEN-5 in
  [artifacts/mcp-2026-07-28/open-items.md](../artifacts/mcp-2026-07-28/open-items.md), and
  **D1** / **D4** of
  [artifacts/mcp-2026-07-28/protocol-delta-matrix.json](../artifacts/mcp-2026-07-28/protocol-delta-matrix.json)
- Replaces: M-OPEN-5 itself. That row states its own terminal condition — *"all three
  landing, at which point `PROTOCOL_VERSION` itself becomes the open question and this row
  is replaced by an ADR, not by an amendment."* This is that ADR. §2 answers the question
  the row says becomes open.
- Refines: 0063 (per-request negotiation — the layer this batch discovered was necessary
  but not sufficient), 0064 (`server/discover` — item (a), and the reason (b) is
  survivable), 0065 (the artifact reader that had to be taught amendment ordering, §6)
- Related: 0025 (the hand-rolled stdio transport), 0060 (**still reserved**, see §1),
  0061 §8.5.1 (the append discipline used on the artifacts amended here)

## §1 Numbering: 0066, and 0060 remains reserved

`proposed-file-map.md` carries the standing instruction to re-`ls adrs/` rather than trust
its own line. Executed at authoring time: `adrs/` holds 33 files and tops out at **0065**,
so this ADR is **0066**.

**0060 is still held.** It is reserved for the `propertyNames` defect recorded as
*"RECORDED, NOT FIXED"* at `artifacts/phase-2.4/presentation-plane-audit.json:135`, which a
gate reads. Five ADRs have now been numbered around it.

## §2 The question M-OPEN-5 says becomes open, and the answer this batch chose

M-OPEN-5 predicted that landing all three items makes `PROTOCOL_VERSION` itself the open
question. It does, and the answer is not the obvious one.

The obvious answer is to bump it: one version constant, one identity, `2026-07-28`. That is
what the row's own ordering assumed, and it carries a cost the row also names — **a public
breaking change**. Every client speaking 2024-11-05 today loses the handshake, because at
2026-07-28 `initialize` does not exist. CallLint's MCP server is a published npm package
with no way to know who has it wired into a config file.

**Decision: `PROTOCOL_VERSION` keeps the value `2024-11-05` and loses its meaning.** It no
longer answers "what version is this server". It answers the narrower question "what does
the legacy handshake reply with", which is the only question it was ever actually used to
answer. The server's identity moves to the *set*:

```ts
const PROTOCOL_VERSION = "2024-11-05"
const STATELESS_PROTOCOL_VERSION = "2026-07-28"
const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION, STATELESS_PROTOCOL_VERSION]
```

So the answer to "which version is this" is "both, and the request decides". A request
declaring nothing gets 2024-11-05 unchanged; a request declaring `2026-07-28` gets that
revision whole, including the absence of `initialize`.

### §2.1 Why "each whole" is the load-bearing half of the decision

The failure mode this rules out is not "wrong version" — it is **a blend**. A server that
advertised `2026-07-28` while still answering `initialize` would be conformant to neither
revision, and a client would have no way to discover which parts it got. The rule is
therefore per-request and total:

> Every request is served entirely at one revision. No result mixes a field that exists at
> one revision with a method that exists only at the other.

`const servedAt = requested ?? PROTOCOL_VERSION` (`server.ts:292`) is the single place that
resolves it, and every conditional emission and the removed-method guard both read that one
variable. Two things follow, and both are asserted:

- **Order in the array is an advertisement that must agree with the fallback** — and
  negative control #156 corrected this ADR's first draft on exactly that point. The draft
  said reversing the members "would silently move every existing client onto the new
  shapes". It would not. `servedAt` names the constant (`requested ?? PROTOCOL_VERSION`)
  and **never indexes the array**, so absence resolves to 2024-11-05 whatever the order is.
  A reversed array is still a defect, just a different one: the server would serve absence
  as 2024-11-05 while telling clients the stateless revision leads the list they pick a
  fallback from. The fallback rule is therefore pinned **once at its decision point**
  (`mcp-spec-vendor.invariants.test.ts:624`), and the order is asserted separately in three
  places — including `pack:smoke:mcp`, at the distribution boundary. Two claims, two gates;
  collapsing them into one is what produced the wrong sentence.
- **The removed-method guard runs after the version check, and that order is redundant
  rather than load-bearing** — negative control #160 corrected this ADR's second draft
  claim too. The draft said reversing them would report a missing method instead of an
  unsupported version. It would not: the two conditions are **disjoint**. `servedAt`
  equals `STATELESS_PROTOCOL_VERSION` only when `requested` has already been validated as
  supported, so an unsupported declaration can never reach the guard. Measured in both
  positions: `"1999-01-01"` + `ping` answers `-32022` either way, and the swapped build
  passed **92/92**. The order is kept because the disjointness lives in two lines that a
  later change could break independently, and this order is the one that survives if it
  does — which is a weaker and truthful reason.

## §3 Decision

1. `SUPPORTED_PROTOCOL_VERSIONS` becomes `[PROTOCOL_VERSION, STATELESS_PROTOCOL_VERSION]`,
   in that order. This is item **(c)**, and it is the public claim.
2. `REMOVED_AT_STATELESS` holds the methods the new revision deletes; when
   `servedAt === STATELESS_PROTOCOL_VERSION` they return `METHOD_NOT_FOUND` (-32601) with
   the revision named in the message. This is item **(b)**, scoped to one revision.
3. Result shape becomes a function of `servedAt`, via two helpers and not one — see §4.
4. `ttlMs: 0` and `cacheScope: "private"` on every cacheable result, carried over from
   ADR 0064 §3 unchanged, and gated as an **implication** rather than a literal — see §5.
5. `clientCapabilities` stays unread, now for a sharper reason — see §7.

### §3.1 (b) is four arms, not the three M-OPEN-5 names

| Arm | Why it is in the set |
| --- | --- |
| `initialize` | The handshake itself; `InitializeResult` does not exist at 2026-07-28 |
| `notifications/initialized` | The handshake's acknowledgement |
| `initialized` | A **bare alias** the server has always accepted. Missing it would leave one undocumented path into the removed handshake |
| `ping` | Removed upstream in the same revision |

The bare alias is the one worth recording: it is not in the spec, not in M-OPEN-5's prose,
and only appears by reading the switch. An enumeration derived from the row would have been
one short, and the gap would have been reachable.

### §3.2 What is deliberately NOT done, and what holds each line

| Not done | Why | What holds the line |
| --- | --- | --- |
| `PROTOCOL_VERSION` bumped to `2026-07-28` | §2 — it would break every current client, and the constant now means "what the legacy handshake replies" | asserted in **two** files, plus the artifact reader's layer 2 asserting the cited `path:line` content |
| The four arms deleted outright | They are the contract 2024-11-05 clients hold | every arm asserted **present** when nothing is declared and **absent** when `2026-07-28` is |
| `clientCapabilities` read | §7 | `mcp-spec-vendor.invariants.test.ts:581` asserts `server.ts` does not contain the key |
| `ttlMs` raised above 0 | §5 — there is no revocation channel | an implication-form gate, so a later batch may raise it *with* `listChanged` |
| `examples/*.json` gated byte-wise | not among the five vendored files (ADR 0064 §6) | unchanged |
| `resultType` on `tools/call` | upstream marks it non-cacheable; `CallToolResult.required = ["content","resultType"]` carries no cache hints | the `withResultType` / `withCacheable` split, §4 |

## §4 Two helpers, because one would have been wrong

The conditional emission is 13 fields across 5 result types, each field derived from a
`required` array in the digest-locked schema:

| Result | Helper | Fields added at 2026-07-28 |
| --- | --- | --- |
| `tools/list` | `withCacheable` | `resultType`, `ttlMs`, `cacheScope` |
| `tools/call` | `withResultType` | `resultType` only |
| `resources/list` | `withCacheable` | `resultType`, `ttlMs`, `cacheScope` |
| `resources/templates/list` | `withCacheable` | `resultType`, `ttlMs`, `cacheScope` |
| `resources/read` | `withCacheable` | `resultType`, `ttlMs`, `cacheScope` |

`tools/call` is the reason there are two helpers. `CallToolResult` requires `resultType`
and **not** the cache hints, so a single helper covering all five would have emitted
`ttlMs` on a result upstream declares non-cacheable. That is the field that matters most
here: **a cache hint on `tools/call` would let a client hold a stale CallLint verdict**. The
split is measured off the locked schema, not assumed, and the absence is asserted.

`server/discover` emits the same three fields unconditionally, because the method does not
exist at 2024-11-05 at all — it can only ever be answered at the new revision's shape.

### §4.1 Every conditional assertion is two-sided

A test that only checks a field is **present** at 2026-07-28 passes when the condition never
fires and the field is emitted always. A test that only checks it is **absent** at
2024-11-05 passes when the feature was never built. So each of the 13 emissions and each of
the 4 removed arms is asserted at both revisions. This is the same discipline as ADR 0063
§3.1, applied to a branch rather than to an omission.

`pack:smoke:mcp` re-measures the whole thing on the **published tarball** in a third
spawn — the envelope on the cacheable results, the payloads identical across revisions, and
the handshake refused with the revision named. ADR 0065 §2's finding is why: INV-M8's
3-of-19 truncation was a wire defect that 3548 unit tests could not see.

## §5 Cacheability is gated as an implication, so a later batch can move it

`ttlMs: 0` says "immediately stale". It is correct **because** the server advertises no
`listChanged` capability, so it has no way to tell a client that a cached list went bad.
A gate asserting the literal `0` would freeze a decision that is really a consequence:

> if `ttlMs > 0` then `listChanged` must be advertised

plus a non-vacuity guard, so the implication cannot pass by there being no `ttlMs` at all.
A future batch that adds a revocation channel may then raise the TTL without editing the
gate — and cannot raise it without one. This is the shape [[prose-justified-constant-is-ungated]]
asks for: the reason is in the gate, not only in a comment.


`cacheScope: "private"` is the end of the enum that cannot mis-permit. `"public"` would let
one context's response serve another; `"private"` only restricts. Upstream permits both, so
no schema gate can object to `"public"` — only a test asserting *this* decision holds it.

## §6 What measurement changed, and the near-miss that is the real lesson

Two things this batch found that the plan did not predict.

### §6.1 The artifact reader resolved the WRONG amendment, and stayed green

ADR 0065's reader resolves a claim through its `amendedByM26-*` chain. `currentState` became
the first object to carry **two** amendments supplying the same field, and the helper sorted
its keys **lexicographically ascending**. Two defects in one `.sort()`:

- Ascending made the **oldest** amendment win. `servedAt` resolved to M26-3's
  `server.ts:171` instead of M26-4's `:325` — the gate read a superseded pointer as current.
- Lexicographic breaks at the tenth batch: `["M26-3","M26-4","M26-10","M26-2"].sort()` puts
  `M26-10` **first**. Fixed now, while it is a one-line comparator and not a debugging
  session.

The first is the dangerous one, and specifically **because the gate stayed green**.
`expectResolvedViaAmendment` asserts that a non-obvious source answered — and one did, just
the wrong one, so `via` was non-null and the assertion passed. What caught it was layer 2
asserting the cited line's **content**: `server.ts:171` is now a docblock line. A pointer
check that only verified the line exists would have passed on the stale pointer.

This sharpens [[assert-which-source-answered]]. Its recorded form is "assert `via`, not just
the value". The sharper form: **asserting THAT a non-obvious source answered is not the same
as asserting the CURRENT one did.** Where several amendments can supply one field, `via`
must be pinned to the expected key, and the resolved value must be checked against the world
it describes.

### §6.2 `nonClaims` was stale with zero readers, one field from the reader M26-3 installed

All three entries of `finality-status.json`'s `nonClaims` went false at this batch — entry 1
asserts the server *does NOT support* 2026-07-28. Measured: `grep -rn nonClaims --include='*.ts'
--include='*.mjs'` returns only the artifact. M26-3 installed a reader on this very file and
these entries still drifted, because the reader named other fields.

**A reader is a property of a FIELD, not of a FILE.** ADR 0065 §2's finding — a correction
only reaches the copy something reads — recurs one field away from the reader written to fix
it. The `nonClaims` layer added here closes that instance; the general lesson is that adding
the file to the gate proves nothing about the fields the gate does not mention.

The amendment renames the replacement list to `nonClaimsNow` deliberately. A same-key value
would let a consumer read the new list as the old one; a renamed one forces the
`supersededBy` path, which is the shape ADR 0065 §5.2 built for exactly this case.

## §7 `clientCapabilities` stays unread, and the reason got stronger

ADR 0064 §5 kept it unread because rejecting its absence would reject **every** request
today's clients send. That still holds, and at 2026-07-28 there is now a second reason to
record rather than fix.

`RequestMetaObject.required` is, verbatim from the locked schema:

```
["io.modelcontextprotocol/clientCapabilities","io.modelcontextprotocol/protocolVersion"]
```

Both keys. So a strict read at 2026-07-28 would reject a client that declares only the
version key — and the version key is precisely what a client must send to reach the new
revision at all. Enforcing the requirement would make the new revision unreachable by the
minimal request that selects it. Recorded, gated by
`mcp-spec-vendor.invariants.test.ts:581`, and left for a batch that has a client to test
against.

## §8 What M-OPEN-5 got right, and the one thing it got wrong

Right, and kept: **(a) before (b)**. `server/discover` is reachable at both revisions with a
byte-identical body, so a client that loses the handshake at 2026-07-28 still has a way to
learn capabilities. The ordering constraint was satisfied, not bypassed — serving both
revisions in parallel is what let (b) and (c) land together *without* the public break the
row priced.

Wrong, and it was the load-bearing claim — verbatim from the row:

> So (c) is genuinely a one-line change to that array once (a) and (b) exist — no rework of
> the negotiation path, and no second code path for the new revision.

The array change is one line. There **is** a second code path: 13 conditional emissions and
a removed-method guard. The negotiation layer is genuinely version-agnostic, exactly as the
row recorded — it validates against a set, not a string. The missed step is that
**validating a version and serving at it are different jobs**. The set decides admission;
nothing in ADR 0063 decided *shape*. The row measured the admission cost and called it the
adoption cost.

That distinction is the transferable part: a negotiation layer being version-agnostic is
evidence about how cheap it is to *accept* a revision, and no evidence at all about how
expensive it is to *speak* one.

## §9 Negative controls — what each was measured to catch

Each mutation was applied to source or artifact bytes, **never to a test**, run, observed to
fail naming its own claim, then reverted with `git diff` confirming byte-exact restoration.
A positive control ran first, so a red could not be an importer fault.
Numbering continues from ADR 0065's #155.

Two controls falsified **this ADR's own prose** rather than the code: #156 and #160. Those
rows say what the drafts claimed and how the controls proved otherwise. This is not
embarrassing — it is the whole reason to run negative controls on a design doc's
justifications rather than only on its implementation.

| # | Mutation | Failed naming | Layer |
| --: | --- | --- | --- |
| 156 | reverse `SUPPORTED_PROTOCOL_VERSIONS` order | **3 reds**: `expected [ 'STATELESS_PROTOCOL_VERSION', …(1) ] to deeply equal [ 'PROTOCOL_VERSION', …(1) ]`, `expected [ '2026-07-28', '2024-11-05' ] to deeply equal [ '2024-11-05', '2026-07-28' ]`, and the `-32022` `data.supported` shape | source-shape + wire. **It also falsified this ADR's own §2.1 sentence** — the two tests asserting an undeclared request is served at 2024-11-05 stayed **green**, because `servedAt` reads the constant. Prose corrected in 5 places, in the same commit as the control |
| 157 | emit `ttlMs` on `tools/call` | *pending* | the §4 split; a stale verdict |
| 158 | make `withResultType` unconditional | *pending* | two-sided at 2024-11-05, §4.1 |
| 159 | drop `initialized` (the bare alias) from `REMOVED_AT_STATELESS` | *pending* | §3.1's fourth arm |
| 160 | move the removed-method guard **before** the version check | **nothing — 92/92 green.** The first attempt was an *invalid* control: lifting the guard without its `requested` declaration threw `Cannot access 'requested' before initialization` on 7 tests, which is a TDZ crash and not the claim. Rebuilt so only the order differs → green, and a direct trace showed `"1999-01-01"` + `ping` still answers `-32022` in both positions | **the green is the finding** — §2.1's second draft claim was unfalsifiable because the two conditions are disjoint. Prose corrected in the ADR and the source docblock |
| 161 | restore `amendmentKeysOf`'s ascending sort | **2 reds**, on the `via` pin: `expected 'amendedByM26-3' to be 'amendedByM26-4'` | the pin added as §6.1's fix |
| 161b | ascending sort **and** the `via` pin deleted | **2 reds** still, now naming the bytes: `currentState.servedAt: …server.ts:171 should contain "protocolVersion: PROTOCOL_VERSION", but that line reads "   * \`tests/invariants/mcp-spec-vendor.invariants.test.ts\`."` | proves the content layer is an **independent** backstop, not shadowed by the pin. Without 161b, the pin could have been the only thing holding §6.1 |
| — | *(unplanned)* the §2.1 docblock correction from #160 shifted `protocolVersion: PROTOCOL_VERSION` from `:325` to `:335` | `currentState.servedAt: …:335 … but that line reads ""` | **the gate catching its own designed case, mid-batch.** A pointer moved twice inside one batch. Fixed in this batch's own amendment rather than by appending a second one — the append rule protects *committed* claims, and nothing here was committed yet |

## §10 What this ADR does not decide

- **Whether `PROTOCOL_VERSION` is ever bumped.** §2 narrows its meaning and keeps its
  value. Retiring 2024-11-05 is a deprecation with a client-facing timeline, and it needs
  its own ADR and its own authorization.
- **Whether `ttlMs` goes positive.** §5 makes it movable by adding a revocation channel,
  and forbids moving it without one.
- **F5 / F6's basis.** Still unvendored pages (M-OPEN-1). Unchanged here.
- **`examples/*.json`.** Still unvendored (ADR 0064 §6). Unchanged here.
- **Anything outside `packages/calllint-mcp` and `artifacts/mcp-2026-07-28`.** No schema,
  no verdict, no `packages/adoption-index/**`, no served byte, 13 tools / 19 resources
  unchanged, runtime `dependencies` still `{}`.
