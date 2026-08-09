# ADR 0065 — the first machine reader of `artifacts/mcp-2026-07-28/`, and the four claims it falsified

- Status: Accepted (2026-08-09). Adds **one test file**. It changes no schema, no verdict, no served
  byte, no tool count (13) and no resource count (19). `PROTOCOL_VERSION` stays `2024-11-05`,
  `SUPPORTED_PROTOCOL_VERSIONS` stays without `2026-07-28`, and `initialize` /
  `notifications/initialized` / `ping` stay served. **Zero `src/` change.**
- Date: 2026-08-09
- Implements: the *"Shape of the fix, for whichever batch adds the first reader"* prescribed by
  **M-OPEN-2** in [artifacts/mcp-2026-07-28/open-items.md](../artifacts/mcp-2026-07-28/open-items.md),
  and discharges **D6.owner**'s standing debt (`"re-measure at M26-1"`) in
  [artifacts/mcp-2026-07-28/protocol-delta-matrix.json](../artifacts/mcp-2026-07-28/protocol-delta-matrix.json)
- Refines: 0064 §6.2 (the CRLF rule — **narrowed** here by measurement, see §6), 0061 §8.5.1 (the
  append discipline), 0063
- Related: 0060 (**still reserved**, see §1)

## §1 Numbering: 0065, and 0060 remains reserved

`proposed-file-map.md` carries a standing instruction — *"Re-`ls adrs/` when authorized rather than
trusting this line"* — executed again here: `adrs/` tops out at **0064**, so this is **0065**.

**0060 is still held.** It is reserved for the `propertyNames` schema defect recorded as *"RECORDED,
NOT FIXED … ADR 0060 is reserved for it"* in drift-checked bytes at
`artifacts/phase-2.4/presentation-plane-audit.json:135`. Five ADRs are now numbered around it.

## §2 The finding: a correction only reaches the copy that something reads

`artifacts/mcp-2026-07-28/` holds three files that the whole of Workstream M cites as its evidence
base. Measured before writing anything —
`grep -rn "artifacts/mcp-2026-07-28" --include=*.ts --include=*.mjs` returns **exactly one** hit, and
it is a **comment**. All three files had **zero machine readers**:

| Artifact | Readers |
| --- | --: |
| `finality-status.json` | **0** (5 grep hits, all prose) |
| `protocol-delta-matrix.json` | **0** |
| `open-items.md` | **0** |

This corrected my own prior belief. I had assumed `finality-status.json` was gated, because F7's clock
test lives in `mcp-spec-vendor.invariants.test.ts` — but that test asserts over the **vendored bytes**
and only mentions the artifact in a comment. Nothing would have gone red if the artifact's F7 row were
reverted to its refuted form.

**And that exact reversion had already happened somewhere else.** The over-precise claim *"earliest
removal is the first revision on or after 2027-07-28"* was found in `finality-status.json`, corrected
there, and gated at `mcp-spec-vendor.invariants.test.ts:180` — a test written deliberately as an
**inequality** (`dated.length >= 1` **and** `< rows.length`) so the gate could not agree with the
over-statement it exists to prevent. The identical claim then survived **verbatim** in
`protocol-delta-matrix.json` D6, for two batches, because nothing read that file.

So the cost of a zero-reader artifact is not "it might drift". It is that **a correction reaches only
the copy something reads**, and the uncorrected copy is indistinguishable from a current one.

## §3 Decision

Add **one** gate — `tests/invariants/mcp-artifact-claims.invariants.test.ts` — as the first machine
reader, in the shape M-OPEN-2 specified in advance. **Amend the artifacts by append; overwrite
nothing.**

Three layers, each making a claim the other two structurally cannot:

1. **Amendment resolution.** Resolve the append chain and assert the resolution, so a reader that
   silently takes the obvious top-level key **reds** instead of returning a false value.
2. **Pointer truth.** Every `path:line` an artifact cites must still point at what it claims —
   asserted on the line's **content**, not its existence.
3. **Cross-consistency.** An artifact claim must not contradict the digest-locked bytes, **derived**
   from those bytes rather than restated from the artifact.

M-OPEN-2 explicitly forbids the alternative: *"Do **not** overwrite the top-level fields to fix this:
that would destroy the append record and the falsified-claim history that made M26-5 worth doing."*
This batch therefore adds a reader and appends amendments; it never asks an artifact to forget.

### §3.1 The four claims the reader falsified on first run

| # | Location | Claim on record | Measured | Class |
| --: | --- | --- | --- | --- |
| 1 | `D3.why` | *"The current error set (server.ts ERR.*) **has no** version-mismatch member"* | **Refuted.** `ERR.UNSUPPORTED_PROTOCOL_VERSION: -32022` has existed at `server.ts:95` since M26-1 | present-tense false statement |
| 2 | `currentState.servedAt` | `server.ts:61` | **Points at a blank line.** The served location is `:171` | pointer drift |
| 3 | `D6.change` | *"earliest removal is the first revision on or after 2027-07-28"* | **Over-precise.** 4 of 6 locked rows carry that date; `includeContext` reads *"Follows Sampling ([SEP-2577](…))"*, HTTP+SSE reads *"Three months after SEP-2596 reaches Final"* | second copy of a corrected claim |
| 4 | `D6.owner` | `"re-measure at M26-1"` | M26-1 merged at `ec09a93` | spent debt |

**#1 is the one worth dwelling on.** D3 was the **only** row with `affectsCallLint: true` and **no
amendment at all** — D1 and D4 each got one when their batch landed, and D3's implementation arrived
inside M26-1 alongside D1's, so nothing prompted a second edit. A present-tense sentence stayed on the
page for two batches after it stopped being true. That is the shape that misleads a reader, which is
why it is amended in place by append rather than deleted.

## §4 Why the three layers cannot substitute for one another

This is the same discipline as ADR 0064 §6.1's `#145`/`#146` pair: two gates, two distinct claims.

- Layer 1 can be satisfied while every pointer rots — it never opens `server.ts`.
- Layer 2 can be satisfied while a claim contradicts upstream — a correct `path:line` says nothing
  about whether the sentence around it is true.
- Layer 3 can be satisfied while the naive read still returns a stale value — deriving the truth from
  locked bytes does not stop a future reader from taking the wrong key.

Negative controls #150/#151 (layer 1), #152 (layer 2) and #153 (layer 3) each red on **exactly one**
layer, which is the evidence that the split is real rather than decorative.

## §5 Two things measurement changed about the implementation

Neither was in the plan. Both came from the assertions failing in ways that named a design error
rather than a typo.

### §5.1 There are two amendment-key **casings**, and one regex silently read the stale value

Measured: `finality-status.json` writes `verdictAmendedByM26-5` — **field-prefixed**, capital `A`;
`protocol-delta-matrix.json` writes `amendedByM26-1` / `-2` / `-3` — **bare**, lowercase `a`.

My first draft matched `/AmendedByM26-/`. That matches the first form and **not** the second, so all
five matrix lookups fell through to the **top-level stale value** and the suite reported success —
which is precisely the failure mode M-OPEN-2 exists to forbid, reproduced by the gate written to
prevent it.

The only reason it surfaced: the assertions check **`via`** — *which source answered* — and not just
the value. A value-only assertion would have passed for the wrong reason. The key is now
`/^(?:\w+A|a)mendedByM26-/`, and asserting on the answering source is the transferable part.

### §5.2 There are two amendment **shapes**, so the reader needs two helpers

- **Replacement** — the block restates the field (`verdict`, `servedAt`, `change`, `owner`).
- **Supersede-in-prose-only** — the block says the claim is superseded and supplies **no replacement
  value**. Measured: `summary.amendedByM26-1` carries **no** `allBlockedBy` key; `D1.amendedByM26-1`
  carries no `why`.

Folding these into one helper makes a superseded-only claim **indistinguishable from an unamended
one** — the same conflation M-OPEN-2 objects to. So `resolveAmended` handles replacements and
`supersededBy` matches the `supersedes` prose, which names its target in backticks. The
`summary.allBlockedBy` site asserts **both**: superseded, **and** `resolveAmended(...).via === null`,
because a replacement value there would be a different claim.

### §5.3 A named absence, because `.toMatch(null)` complains about the matcher

`expect(via).toMatch(AMENDMENT_KEY)` is the obvious form and a bad one. When no amendment exists `via`
is `null` and vitest prints *".toMatch() expects to receive a string, but got object"* — a complaint
about the matcher's **argument type**, naming neither the field nor the amendment that went missing.
Control #150 produced exactly that: red on the right test, with a message that would send the next
reader to the wrong place.

`expectResolvedViaAmendment` separates and names the null case first, and prints **the stale value that
would have been read as current** — [[every-collapses-the-observed-value]] applied to an absence
rather than to a boolean.

## §6 The CRLF rule from 0064 §6.2 is correct; this batch's premise about it was not

The plan for this batch asserted that `artifacts/**` carries no `eol` pin and that the new reader
**must** therefore normalize. Measured with `git check-attr text eol` — **that is false**:

| Path read by the gate | `eol` | Held by |
| --- | --- | --- |
| `artifacts/mcp-2026-07-28/**` | **lf** | `.gitattributes:112`, added by M26-0 *for this exact trap* |
| `third_party/mcp-spec/2026-07-28/**` | **lf** | `.gitattributes:149` + sha256 lock + a `\r` counter |
| `packages/calllint-mcp/src/server.ts` | **unspecified** | nothing — correctly, nothing hashes it |

So only `server.ts` can arrive CRLF, and negative control **#154** — strip the reader's `.replace`
**and** convert `server.ts` to CRLF, i.e. reproduce a windows-latest checkout exactly — leaves the
suite **8/8 green**. Measured rather than inferred: every assertion over that file is `\r`-blind by
construction. Two are `\s`-tolerant regexes; `assertPointer` uses `toContain` on a single line, where
a trailing `\r` sits harmlessly past the match. The shape that **would** break is an exact `toBe` on a
line, which nothing here does.

**The normalization stays anyway**, and the docblock now says why in the honest form: it is
**defensive, not load-bearing**. The next assertion added to this gate does not inherit that
accidental tolerance, and §6.2 was paid for by a gate that sliced un-normalized source, got `-1`, and
silently widened its own scope via `slice(start, -1)` to blame the wrong method.

What this ADR narrows is the **boundary**, not the rule. 0064 §6.2 says the deciding line is
*digest-locked vs not*; measured against `.gitattributes`, the line is **pinned-or-locked vs not** —
`artifacts/**` is unhashed yet on the safe side, because M26-0 pinned it. **M-OPEN-4 is amended by
append with this as its third instance**, and the sharpened wording; its text and priority stand.

## §7 Negative controls — what each was measured to catch

Six mutations, each applied to **source or artifact and never to a test**, each rolled back and
confirmed byte-identical by sha256 plus an empty `git diff`. A **positive control** ran first on
unmutated inputs (8/8 green), so a red below cannot be a broken importer.

| # | Mutation | Failed naming | Layer |
| --: | --- | --- | --- |
| 150 | delete `verdictAmendedByM26-5` wholesale | `productionChangesAllowed: no amendment block supplies it, so the STALE top-level value false would be read as current … Amendment keys present: []` | 1 — **after** the §5.3 fix; before it, the message blamed the matcher |
| 151 | make `resolveAmended` ignore amendments | **5 reds**, each printing the exact stale claim a naive reader would have believed (`false`, `…server.ts:61`, `"…has no version-mismatch member"`, `"re-measure at M26-1"`, `"…on or after 2027-07-28."`) | 1 — the control that most directly proves M-OPEN-2's requirement |
| 152 | point `servedAt` at a line that **exists** with different content | `currentState.servedAt: …:100 should contain "protocolVersion: PROTOCOL_VERSION", but that line reads "}"` | 2 |
| 153 | restore D6's uniform-clock claim | `D6's resolved change must name the off-clock removal condition "Follows Sampling ([SEP-2577]", derived from …deprecated.snapshot.md where 4 of 6 rows carry … and 2 do not` | 3 — **after** hardening; see below |
| 154 | strip the reader's normalization **and** CRLF-ify `server.ts` | **nothing — 8/8 green** | see §6; the green is the finding |
| 155 | `PROTOCOL_VERSION = "2026-07-28"` | **13 failures across 3 files** — the vendor gate, the wire tests, the `-32022` negotiation path, **and** layer 2 | proves the new reader loosened nothing |

**#153 improved a test rather than merely passing**, the same way 0064 §6.1's #147 did. The control did
red, but on `expected '6 features deprecated; Removed sectio…' to contain 'SEP-2596'` — a missing
substring naming neither the uniform-date claim nor the measurement refuting it, and satisfiable by
mentioning a **SEP** rather than a **clock**. The assertion now **derives** each off-clock condition
from the locked bytes (longest URL-free run of the row's clock cell), asserts the fragment appears in
**0** dated rows so it genuinely discriminates, and prints the claim on record beside the measured
4-of-6.

**#152 was predicted to be the most likely to stay green** — it passes if layer 2 asserts only that a
line *exists*. It red correctly, printing the line's actual content. The prediction was wrong in the
useful direction.

**#154's green is the informative one.** A control that fails to red is either a weak gate or a false
premise; measuring which is the whole job. Here it was the premise (§6), and the check that settled it
was `git check-attr`, not argument.

## §8 What this ADR does not decide

- **Whether CallLint will support 2026-07-28.** M-OPEN-5's (b) — removing the handshake — and (c) —
  the public claim — are untouched, still gated, and still need their own authorization.
- **D2 / the HTTP transport.** Measured n/a rather than assumed: a comment-stripped scan of
  `packages/calllint-mcp/src/` for `createServer(`, `http.`, `https.`, `express`, `EventSource`,
  `.listen(` finds **zero** hits, and the gate asserts that. So the HTTP+SSE deprecation row citing
  `/specification/2024-11-05/…` — the very version we serve — is not an exposure surface. Recorded so
  the next reader does not re-derive it.
- **M-OPEN-4's fix.** Amended with a third instance; deliberately not fixed here, because editing gate
  assertions for message quality with no live failure is how a gate loses its edge.
- **M-OPEN-1 (vendoring F5/F6).** A scope decision needing its own authorization.
- **Whether `mcp-spec-vendor.invariants.test.ts:180` should change.** It should not. It is already the
  correct shape, and this gate sits **beside** it asserting a different claim — that the artifact must
  not contradict the bytes — rather than replacing it.
