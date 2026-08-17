# ADR 0090 — A guard's scope claim is part of its claim

- **Status:** Accepted
- **Date:** 2026-08-17
- **Workstream:** M (MCP revision 2026-07-28)
- **Batch:** M batch M26-10
- **Supersedes:** nothing. **Amends:** ADR 0065 §209's description of the transport scan (the prose was
  right and the gate was not), and corrects one sentence this ADR's own first draft got wrong (§7).
- **Closes:** nothing.
- **Leaves open:** M-OPEN-1 half 2 — **authorized in this batch and deliberately not done**, because the
  re-verified measurement says it has no subject (§6); M-OPEN-3 (awaiting an upstream date);
  M-OPEN-5 (open by design).

## §1 Numbering: 0090, and the two ADR directories are separate sequences

`ls adrs/*.md` is 57 files topping out at `0089`, so this is `0090`, and `ls adrs/0090*` is empty.
Thirty-two numbers in `0001–0089` have no file in `adrs/`; that is **not** a set of free slots. The
early ADRs live in `docs/adr/`, which `.gitignore:44` excludes, and that directory tops out at `0042`.
So `0025`, cited below and in the code, resolves to
`docs/adr/0025-calllint-mcp-thin-wrapper.md` — untracked, present on disk. `0060` remains reserved by a
reader rather than by prose: `artifacts/phase-2.4/presentation-plane-audit.json:215`'s `$comment` says
so verbatim. Re-listed rather than inferred from a neighbouring ADR, per ADR 0072 §1.

## §2 Context

M-OPEN-1 half 2 asks whether CallLint should vendor the 2026-07-28 spec's auth pages. M26-7 refuted the
row's original fix shape and left a narrower condition: vendoring buys **only** auth semantics, and is
warranted *"only if CallLint makes a claim that rests on them. Today it makes none — no HTTP transport
exists in `packages/calllint-mcp/src/`."*

That last clause is load-bearing. If it is true, half 2 adds bytes backing no claim. If it is false,
vendored auth semantics start backing a live claim immediately. Two assertions in
`tests/invariants/mcp-artifact-claims.invariants.test.ts` were the reason to believe it:

- `it("D2 stays n/a because no HTTP transport exists to be affected")`
- `it("what M-OPEN-1 genuinely still needs is AUTH, and only auth")`

## §3 What was measured

**Both assertions read `packages/calllint-mcp/src/server.ts` alone, while stating their conclusion over
the whole package.** The package is 8 `.ts` files.

ADR 0065 §209 describes the intended scan at **directory** scope — *"a comment-stripped scan of
`packages/calllint-mcp/src/` for `createServer(`, `http.`, `https.`, `express`, `EventSource`,
`.listen(` finds **zero** hits, and the gate asserts that."* The prose was correct. The gate implemented
one file. They had disagreed since M26-3, and nothing could observe the disagreement, because at HEAD
both scopes return the same empty answer.

**Proven blind, not assumed blind.** A well-typed, correctly-imported
`createServer(...).listen(port)` added to `version.ts` left **both assertions green** and
`pnpm typecheck` at **EXIT 0**.

The first probe of this was weaker than I claimed: it omitted the `import`, so `tsc` — not the guard —
produced the red, and `TS2304` is not evidence about a scan. Recorded because the loophole is the
interesting part: **a mutant killed by the compiler tells you nothing about the assertion you are
testing.** The second probe imported properly, and that is the one that established blindness.

## §4 Decision

One shared scanner, replacing both single-file reads:

```
mcpSourceFiles()      recursive walk of MCP_SRC_DIR, sorted    — derive the set, never name it
scanForTransport()    10 needles over stripCommentLines(bytes) — returns `file: needle` pairs
assertEnumerationIsComplete()                                  — the premise block, run first
```

The premise block asserts the **instrument** before its product
([[a-premise-block-keeps-a-blind-guard-from-reading-green]]): a non-degenerate walk, a content anchor on
the package's identity, **two independent** enumeration cross-checks, a synthetic-transport check on the
needle set, and both directions of the comment filter. A walk that returned `[]` makes
`scanForTransport()` return `[]` too, and an empty scan over an empty file set reads exactly like "no
transport exists".

Needles are word-boundary and **case-sensitive** where a bare substring would collide with prose that
legitimately exists: `tools.ts` carries `requiresSeparateAuthorization` (a plan field) plus *"not a
current authorization"* and *"one authorization"* — the latter two inside a tool-description **string**
that no comment filter removes. A substring `Authorization` needle reds on all three, and the tempting
repair, dropping the needle, is precisely what leaves an `Authorization: Bearer` header unobserved.
Measured both directions: `\bAuthorization\b` case-sensitive matches the header and none of the three.

## §5 Four instrument mutants survived the product-only pass, and each one changed the fix

Eleven mutants, product **and** instrument. The five product mutants and two instrument mutants died on
the first pass. These four did not, and they are the reason this ADR exists:

1. **A path anchor interpolated from the constant under test moves with the mutation.** The premise
   block anchored on `` `${MCP_SRC_DIR}/server.ts` ``. Repointing `MCP_SRC_DIR` at `packages/types/src`
   — which *also* happens to contain a `server.ts` — left **all 20 tests green**. The anchor was
   re-derived from the thing it was supposed to pin. Now anchored by **content**: `runStdioServer` and
   `process.stdin`, both absent from `packages/types/src`. There is no `StdioServerTransport` to look
   for; ADR 0025 ("Thin MCP Wrapper + Hand-Rolled stdio Transport") rejected the SDK on supply-chain
   grounds and hand-rolls the JSON-RPC loop.
2. **`git ls-files` cannot see the case that matters.** A walk mutated to skip subdirectories stayed
   green with a transport planted in `src/transport/http.ts`, because the plant was **untracked** — so
   `git ls-files` never listed it and the cross-check had nothing to miss. A guard against unscanned
   code cannot be keyed on tracked-ness, because new code is untracked first. Closed by a second
   enumeration through Node's own `readdirSync({recursive:true})`: a defect in my hand-rolled recursion
   cannot hide inside Node's.
3. **An already-empty result cannot change.** Widening the comment filter to drop any line containing
   `//` survived every check, because with no transport in the tree the scan was empty either way. It
   only failed against a real transport written on **trailing-comment** lines. The filter is now
   exercised through the **same** `stripCommentLines` the scan uses — not re-implemented in the test,
   which would let the two drift apart silently.
4. **One survival is correct, and it falsified this ADR's own draft.** See §7.

## §6 Half 2 was authorized, and not doing it is the finding

Vendoring was authorized in this batch. It was not done, because the measurement that would justify it
came back empty — re-verified at HEAD with the repaired instrument rather than trusted from M26-3:
**8 files, zero transport constructs**, and every `authorization` occurrence prose.

So half 2 stays open **for want of a subject, not for want of authorization**. The row's own reading is
right that its subject belongs to a new row, not to this row's residue. The repaired assertion is what
makes that boundary *measurable* rather than asserted: it reds the moment an auth-bearing or
transport-bearing construct appears anywhere in the package, which is exactly when vendored auth
semantics would begin backing a live claim.

An authorization is permission to act on a measurement, not a substitute for one.

## §7 The correction: the comment filter is not load-bearing at HEAD

The docblock I wrote for `scanForTransport` claimed the docblocks in `server.ts` *"discuss HTTP at
length and would red an unfiltered scan."* Deleting the filter entirely survived as a mutant, which
sent me to measure the claim instead of defending it:

- **zero** needles fire on the raw, unfiltered bytes of all 8 files;
- the filter drops **678 of 2253** lines, and not one of them carries a needle.

The claim was false. The needles were *already* chosen to miss prose (case-sensitive
`\bAuthorization\b`, member-access `\bhttps?\.` — in `"https://…"` the next character is `:`, so a URL
literal does not satisfy it), and that is what makes the filter redundant today. It keeps its place for
a different, true reason: it is what lets the needle set stay **strict** instead of being widened into
un-adoptability later, against the 21 comment lines in this package (10 in `tools.ts`, 9 in
`server.ts`) that a looser scan would red. The comment now says that.

**M8c is deliberately left alive.** A mutant that survives because the code under it is genuinely
insensitive is a fact about the system, not a hole to be plugged with a test that pins the redundancy in
place.

## §8 Consequences

**The general rule this batch is named for: a guard's scope claim is part of its claim.** Stating a
conclusion over a package while reading one file is not a *weaker* measurement of the same thing — it is
a measurement of something else, and it reads identically to the true one right up until the file it
does not read is the file that changes.

This is the same fault class as half 1's own recorded cost — *"on an append-only record, a guard bound
to the top-level field measures whether the history was destroyed, never whether the claim advanced"* —
one axis over. There the guard could not observe its subject because of **which field** it read; here,
because of **which files**. Both were green. Both were green for reasons unrelated to the claim.

Two practices follow, and they are what to carry forward:

- **Mutate the instrument, not only the product.** Four of these eleven mutants survived a product-only
  pass. A product mutant tells you the guard can see a change; an instrument mutant tells you the guard
  can still see anything at all.
- **Derive the set; never name it.** A hardcoded file list covers exactly the files in hand, and reports
  the same green about the ones it has never heard of.

## §9 Controls run

- **Product:** transport in `version.ts` (M1) · `Authorization: Bearer` in `tools.ts` (M2) · transport
  in a new top-level file (M3) · in an **untracked subdirectory** (M3b) · on **trailing-comment** lines
  (M3c) — **all KILLED**, M1 naming the file and both needles.
- **Instrument:** walk narrowed to `server.ts`, i.e. the original defect (M4) · `createServer(` needle
  deleted (M5) · scan aimed at `packages/types/src` (M6) · walk skipping subdirectories (M7) · comment
  filter widened (M8, M8b) — **all KILLED**, M6/M7/M8 only after the fixes in §5. Filter deleted
  outright (M8c) — **SURVIVED, kept, and documented as §7.**
- **Suite:** `pnpm test` → **234 files / 4326 passed / 1 skipped**, baseline-identical.
  `pnpm typecheck` → **EXIT 0**, both projects, read from pnpm rather than from `tail`'s exit code.
- **Hygiene:** every mutation reverted and confirmed by `git diff --stat`. Each was applied by a probe
  that **asserts its own bytes changed before running the suite**, adopted after one mutation silently
  failed to apply and reported a green that meant nothing — a mutation run that cannot confirm its own
  mutation is the very fault class this ADR is about.
- **Record:** M26-10's note was **appended** to `artifacts/mcp-2026-07-28/open-items.md`
  (84 insertions, **0 deletions**, verified via `git diff --numstat`), per M-OPEN-2.
