# ADR 0073 — The thirteen tools were counted, never recognized

- **Status:** Accepted
- **Date:** 2026-08-11
- **Workstream:** S (adoption-index guards / MCP served surface)
- **Batch:** S batch 4
- **Supersedes:** nothing. **Amends:** the R-11 asymmetry note in
  `artifacts/adoption-index-v1/current-gaps.md` §1, by append (§6 there).
- **Closes:** nothing on the S0 ledger. This closes a **gate-strength** gap, not an open item.
- **Leaves open:** S0-OPEN-1, S0-OPEN-4, M-OPEN-1 (half 2), M-OPEN-3.

## §1 Numbering: 0073, and 0060 remains reserved

`ls adrs/` tops out at `0072`. **0060 is still not available** — its reservation is held by name for
the `propertyNames` defect in `artifacts/phase-2.4/presentation-plane-audit.json:135`, whose
`$comment` states it verbatim. Re-listed by `ls`, not inferred from the ADR that says so.

## §2 Context: a count is not an identity

`MCP = 13 tools / 19 resources` is a frozen product surface, and `pnpm pack:smoke:mcp` is the only
guard that reads it off the **wire** of the built, packed bundle rather than off the source array.
Until this batch its entire tools-side assertion was:

```js
if (list?.result?.tools?.length !== 13) fail(`tools/list expected 13 tools, got ${...}`)
```

Measured on this branch, then rolled back byte-identical: renaming the served
`calllint_verify_tool_install` to `calllint_verify_tool_installX` while holding the cardinality at 13
left `pnpm pack:smoke:mcp` at **EXIT 0**, printing `tools/list(13)` on its own success line, and
`pnpm typecheck` at **EXIT 0**. The wire served a tool that does not exist and the gate approved it.

This is INV-M8's resources defect — 3 of 19 served, 3548 tests and the smoke all green — reproduced on
the side that `current-gaps.md` §1 recorded as the **stronger** of the two.

**Bounded honestly.** `packages/calllint-mcp/test/tools.test.ts:33-45` hand-enumerates the 13 names,
so that rename *was* caught somewhere. This is a gate-strength gap, not an unguarded surface. The
distinction still matters for the reason the smoke's own comments give: every in-package assertion
reads the **source array**; only the smoke reads the **wire**.

## §3 The asymmetry inverted after it was recorded, and neither side moved wrongly

`current-gaps.md` §1 recorded, at R-11, that the tools side was pinned exactly while the resources side
was pinned at `>= 1` — "the first is gated, the second is a description." Both halves are now false:

- The resources side was rebuilt by INV-M8 to derive from the committed bundle, guard vacuity, and
  assert **set equality** with both differences named.
- The tools side stayed exactly where it was.

Nothing was weakened. One side was strengthened and the other stood still, and the *comparison* moved
around them. **A relative claim about two guards is a claim about two moving files, and it expires
without either file being wrong.** Prefer recording what each guard asserts over which is stronger.

## §4 The two sources must not be derived from one another

The obvious fix — compare the smoke's served names against the tool table — is a **tautology**. The
smoke's expectation is derived *from* `tools.ts`, so a rename in the table moves both sides at once and
the check stays green by construction. Measured: after the first draft of D1 landed, mutating `tools.ts`
left `pack:smoke:mcp` at EXIT 0 for exactly this reason ([[audit-keyed-on-its-own-subject]]).

The gate measure therefore pairs the table against the **hand-written enumeration** in
`test/tools.test.ts` — the only name list in the repository not derived from the table. That is why
control #198 can fail at all.

**What this does not cover, stated rather than implied.** A *paired* rename — table and enumeration
edited together — agrees with itself, and the set measure is green. Control #199 asserts that green
outcome deliberately, with the bound named, because a control that pretended otherwise would be testing
a claim the code does not make.

**Measured, and narrower than first written.** Applying #199 to real bytes (`explain_finding` →
`explain_findingX` in both files, 3 + 4 occurrences) left `pack:smoke:mcp` at **EXIT 0** as predicted —
and red **two other tests** that neither the plan nor the first draft of this ADR anticipated: the
ADR 0003 non-execution invariant (*"explain_finding spawns nothing"*) and the dual-revision serving
test. Both hardcode the tool name for their own unrelated purposes. So a paired rename is not invisible
to the repository; it is invisible to the **name-agreement guards**, and it is caught incidentally by
tests that happen to name a tool while asserting something else.

That distinction is worth keeping rather than rounding off in either direction. Incidental coverage is
real coverage — it reds — but it is coverage no one designed, keyed to whichever tools happen to be
mentioned elsewhere, and it would vanish the moment those tests were rewritten to loop over `TOOLS`.
Renaming a tool no other test names would still pass everything except the wire read and the frozen
`13`.

## §5 A kept literal and a derived expectation, in the same file

`!== 13` is **kept** in the smoke. 13 is a frozen product surface; the resource count is a function of
the committed bundle and must be derived. An argued literal with no failing mode would be prose, so
control #201 (drop a tool to 12) exists to pay for it.

Assertion order is load-bearing and cannot be checked by running the script: **count, then vacuity
guard, then set equality.** Two empty captures compare equal, so a set claim placed before the vacuity
guard is satisfied by a scan that found nothing ([[assertion-order-decides-falsifiability]]). The order
is asserted over the smoke's **source**, which is the only place it is visible.

## §6 The capture class had to be loosened, and the reason is a failure mode

Control #198 under `/^ {4}name: "([a-z_]+)",$/gm` went red on **"captured 12 names"** — the vacuity
guard fired instead of the drift assertion, so the failure named the scan rather than the renamed tool.
Widened to `[^"]+`. Measured: both classes capture the same 13 names today, so the looser one costs no
precision and lets each assertion fail for **its own** reason. Both `mcp-pack-smoke.mjs` and
`scripts/phase-2.4-gates.ts` are asserted to carry the same class, so the two files cannot drift onto
different surfaces while each looks correct on its own.

### §6.1 Amendment, 2026-08-11 — the same defect was live in this ADR's own control file

Found by self-audit **before merge**, after the paragraph above was written. That paragraph names two
files, and both were correct. The **control file's own second scanner was not**: `scanEnumerated` in
`tests/invariants/mcp-tool-identity.invariants.test.ts` still carried `[a-z_]+` while every sentence
here argued for `[^"]+`. Only one side of the compared pair had been widened.

Measured on identical bytes, table side unchanged, enumeration side renamed
(`calllint_verify_tool_install` → `...installX`): **tight = 12 names captured, loose = 13**, and only
the loose class reported the renamed name at all. So a rename on the **enumerated** side reproduced
exactly the wrong failure mode §6 was written to remove — the vacuity guard firing in place of the
drift assertion, naming the scan instead of the tool. **A tight class does not report a name as
CHANGED; it reports it as ABSENT.**

Fixed, and control **#204** added as its failing mode: it renames on the enumerated side, asserts the
capture still reaches 13, and asserts the measure names the drifted tool *without* reporting a capture
shortfall. It also pins each scanner's exact regex literal, so a revert to the tight class reds here.

Two general findings, both larger than the typo they came from:

1. **Both sides of a compared pair must be scanned the same way**, or one of them silently reports the
   wrong failure. An asymmetric pair still *fails* — which is why the suite stayed green and the audit,
   not the gate, is what caught it — but it fails for a reason that sends the next reader to the regex
   instead of to the drifted name.
2. **A claim about "the files that carry this class" is a claim about a set someone has to keep
   closed.** §6 enumerated two files and was true of both; the set had a third member, in the very
   file whose job is to make §6 falsifiable. Prefer asserting the property over enumerating the
   holders ([[prose-justified-constant-is-ungated]]).

`#204`'s first draft also carried `expect(self).not.toContain('"([a-z_]+)",$/gm')`, which went **red on
the docblock above it** — prose quoting the tight class in order to argue against it
([[source-scan-must-read-code-not-prose]]). Dropped in favour of the two positive literal pins, which
catch the same revert without forbidding the file from discussing its own defect.

A citation was wrong in the same audit: `test/tools.test.ts:31` is `expect(TOOLS.map((t) => t.name)…`,
the **derived** side. The hand-written array is `:33-45`. Corrected in §2 above and in the control
file. The mechanism was never wrong — 13 matches, all inside 33–45 — only the address, which is
[[a-pointer-rots-faster-than-its-claim]] arriving one more time, on this ADR's own bytes.

## §7 The denominator moved with the measure, and its guard is external

`decideGate(measures, 5 + …)` → `6 + …`; `measures` 31 → 32. A denominator feeding only `<` has no
failing mode of its own ([[miscounted-denominator-is-a-false-green]]), and ADR 0071 §8 already recorded
that reverting the literal is **not observable** from outside — control #189 measured green because
lowering the floor leaves the comparison false either way. What discriminates is a **short measure
list**, asserted in both directions by *"refuses a SHORT measure list"*.

**And the revert now has a failing mode it did not have at ADR 0071.** Control #202 reverted `6 +` to
`5 +` on real bytes. Under 0071 the equivalent mutation (#189) measured **green**. This time it went
**red** — not on the arithmetic, which is still unobservable, but on the content-addressed pointer
`gate-s0-claims.invariants.test.ts` asserts on the row's behalf:

```
S0-OPEN-5's cited synced denominator: packages/trust-index/src/phase24Gates.ts:759 should contain
"6 + checks.length + served.length", but that line reads
"  return decideGate(measures, 5 + checks.length + served.length)"
```

So the gap ADR 0071 §8 recorded as *unguardable from outside* is now guarded — incidentally, by a
pointer written for a different purpose. An assertion on a line's **content** covers value drift that
no assertion on the value's *effect* could see, because the effect is invisible on today's inputs.

The 7th parameter of `evaluateNoRegression` defaults to two empty arrays, and empty **fails**. A
producer that forgets to observe cannot go green — asserted, because a passing default would be
undetectable from outside.

**Two deliberate arity pins had to be hand-edited** in `test/phase24-gates.test.ts` (5 → 6, and
7 → 8 in the `decideGate` case). That hand edit **is the guard working**: the literal exists so that
adding a measure cannot be silent. This is the opposite of
[[hardcoded-range-stops-covering-its-tail]], where a bound quietly stops covering what arrives after
it. Both are literals; only one has a reader that reds.

## §8 CRLF, predicted green and asserted anyway

`packages/calllint-mcp/**` carries no `eol=lf` pin, so a windows-latest checkout arrives CRLF. Under
`/m`, `$` treats `\r` as a line terminator, which makes `/^ {4}name: "…",$/gm` **accidentally**
tolerant ([[crlf-tolerance-is-accidental-under-regex-m]]). Predicted green before running, measured
green, and asserted (control #203) so the tolerance stops being accidental: a future tightening to
`[^"\r]+`, or an exact `toBe` on a line, now reds in the test suite instead of on the Windows runner
alone. The control also asserts no captured name carries a stray `\r`, which is the shape that would
poison a set difference into reporting every tool as drifted.

## §9 The controls are re-derived, never spawned

No control in `tests/invariants/mcp-tool-identity.invariants.test.ts` spawns a subprocess. A test's
conclusion must be its own assertion, never a child's exit code or stream
([[subprocess-negative-control-prints-fail]]) — so the smoke's assertion is re-derived over the same
bytes rather than run. The applied mutations were performed separately against real source bytes, with
`cp` backups and byte-identical rollback verified by `git diff`.

## §10 Five asserted pointers drifted, and one was wrong before this batch

D2 inserted `readToolNameSources()` into `scripts/phase-2.4-gates.ts` and a sixth measure into
`evaluateNoRegression`, which moved five of the six `path:line` pointers that
`tests/invariants/gate-s0-claims.invariants.test.ts` asserts on behalf of `artifacts/gate-s0/open-items.md`.
The batch could not reach its verification sequence until they resolved. Repaired by **append**: a new
amendment carrying live numbers, with the stale ones preserved verbatim as the record of what was true
when written.

Three findings from that repair, none of which was the batch's subject:

1. **A citation with no reader is not a weaker guarantee; it is none.** The pre-close text's
   `REGRESSION_CHECKS` (`:637`) was off by three *at HEAD* — line 637 was ` */`, the declaration sat at
   640. Nothing noticed, because nothing asserted it. The six pointers the test does assert were all
   correct at HEAD.
2. **Line 640 is now blank.** An existence-addressed pointer would still resolve there and point at
   nothing — the exact defect `assertPointer` was written for after M26-3 found `server.ts:61` blank
   with the real location at 171, now reproduced on this repository's own bookkeeping.
3. **A comment edit moved an asserted pointer.** Merging two duplicated denominator comments shifted
   the denominator line 756 → 759, re-reding a pointer that had just been re-anchored. Pointer drift is
   not caused only by code changes.

**A pointer's line number rots faster than its claim.** Every sentence in ADR 0071's amendment stayed
true; only its addresses expired, and they expired because of an edit in a different workstream with no
interest in that row. That is the argument for content-addressed pointers over existence-addressed
ones, and for keeping them in a test rather than in prose: prose cannot notice its own rot.

## §11 Consequences

- The MCP tools surface is now checked for **identity** on the wire, not only cardinality.
- `13` stays a literal, with control #201 as its failing mode; the resource count stays derived.
- A paired rename remains invisible to the set measure, covered by the wire read and the frozen count,
  and recorded as a **named bound** rather than presented as coverage.
- `mcp-tool-names-agree` is the sixth roll-up measure; the denominator is `6 + checks + served`.
- Zero verdict movement, zero schema change, zero served bytes; `dependencies: {}` unchanged; the
  13/19 surface unchanged. The only artifact byte change is `+1 measure` in
  `artifacts/phase-2.4/gate-H-no-regression.json`.
