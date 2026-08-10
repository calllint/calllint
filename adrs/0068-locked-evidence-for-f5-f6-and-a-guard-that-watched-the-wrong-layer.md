# ADR 0068 — Moving F5/F6's evidence onto locked bytes, and replacing a guard that could not observe its own subject

- Status: Accepted (2026-08-10). Closes **half 1** of M-OPEN-1 and **all** of M-OPEN-4.
  Changes no behaviour: no schema, no verdict, no served byte under `apps/web/public/**`,
  neither the tool count (13) nor the resource count (19). `packages/calllint-mcp` runtime
  `dependencies` stays `{}`. `PROTOCOL_VERSION` and `SUPPORTED_PROTOCOL_VERSIONS` are
  untouched. **Zero `src/` semantic change** — the diff is two test files and two artifacts.
- Date: 2026-08-10
- Closes: **M-OPEN-1 half 1** (F5/F6's evidence now rests on digest-locked bytes) and
  **M-OPEN-4** (the `\r`-blind separator filter), both in
  [artifacts/mcp-2026-07-28/open-items.md](../artifacts/mcp-2026-07-28/open-items.md)
- Files: **M-OPEN-6** — one amendment key in these artifacts is invisible to the reader that
  resolves them. Measured, deliberately not fixed. See §5.
- Refutes: **M-OPEN-4's own premise.** That row read *"Cosmetic; the assertion is correct, its
  failure message can mislead."* The assertion was **not** correct: under CRLF it passed an
  over-precise claim. See §4 — this is the ADR's most transferable content.
- Refines: 0065 (the artifact reader this batch extends and whose `AMENDMENT_KEY` §5 measures),
  0064 §6.2 (the normalize-then-assert-both-bounds rule, applied here to the fix rather than
  as a retrofit), 0061 §8.5.1 (the append discipline that made half 1's literal instruction
  unfollowable — §3)
- Related: 0060 (**still reserved**, see §1), 0063 / 0066 (the negotiation and dual-revision
  serving whose gates this batch leaves untouched)

## §1 Numbering: 0068, and 0060 remains reserved

`proposed-file-map.md` carries the standing instruction to re-`ls adrs/` rather than trust its
own line. Executed at authoring time: `adrs/` holds **35** files and tops out at **0067**, so
this ADR is **0068**.

**0060 is still held**, now for the seventh consecutive numbering. It is reserved for the
`propertyNames` defect recorded as *"RECORDED, NOT FIXED"* at
`artifacts/phase-2.4/presentation-plane-audit.json:135`, which a gate reads. Verified this
batch: `ls adrs/ | grep -c '^0060'` = **0**.

## §2 The guard that was replaced could not have observed the thing it was written to watch

This is the finding that shaped the batch. It was produced by a **wrong prediction**, and the
wrong prediction was worth more than the fix.

M26-7 had left a guard over F5/F6 in `mcp-artifact-claims.invariants.test.ts` whose message read:

> both rows still cite a URL — when that changes, THIS assertion is the one that must be
> edited by hand

I predicted that closing half 1 would red it, and that editing it would be the batch's routine
bookkeeping. It did not red. Measured over the three reachable states:

| State of the record | The guard |
|---|---|
| half 1 not done — F5/F6 cite only the upstream URL | **PASSES** |
| half 1 done — F5/F6 resolve to `schema.json` through `amendedByM26-8` | **PASSES** (indistinguishable) |
| someone overwrites F5/F6's top-level `evidence.source` | **REDS** |

The guard counted `https://modelcontextprotocol.io` in F5/F6's **top-level** `evidence.source`
and required `.toBe(2)`. Under the append discipline of 0061 §8.5.1 that field is **frozen**:
a correction never touches it, it gains a sibling amendment. So the guard's subject cannot move
in the direction the guard was written to detect. It reds on exactly one action — overwriting an
append-only field — which is the action **M-OPEN-2 explicitly forbids**.

**The general form, worth carrying:** *on an append-only record, a guard bound to the top-level
key measures whether the history was **destroyed**, never whether the claim **advanced**.* The
stale value is the one sitting at the obvious key; the current value is the non-obvious read.
A guard written against the obvious key is therefore inverted with respect to progress: it is
green while the work is undone, green after the work is done, and red only on vandalism.

This also explains why the guard's instruction — *"THIS assertion is the one that must be edited
by hand"* — was unfollowable **as written**. A hand-edit is only reachable by a reader who
already knows the assertion is inverted, and the assertion is what was supposed to tell them.

### §2.1 What replaced it

Not an edit. A hand-edit to `.toBe(2)` would preserve the inversion at a different number.
Three assertions with three separate subjects:

1. **The append record survives.** F5/F6's top-level `evidence.source` must still contain the
   original URL. This keeps the only property the old guard actually had.
2. **The current source is the locked file, and it answered from an amendment.**
   `expectResolvedViaAmendment` asserts `via === "amendedByM26-8"` **before** looking at the
   value, so a reader that silently took the top level reds on `via`, not on a value comparison.
   Then the value must contain `third_party/mcp-spec/2026-07-28/schema.json`.
3. **The cited digest is derived, not restated.** The test re-hashes `schema.json` at run time
   and asserts each row's cited `sha256 <prefix>` is a prefix of the **actual** hash
   `ef70b61f…`. A citation that pins nothing (`NO-DIGEST-CITED`) is its own named failure, in
   set form so the missing row is printed rather than collapsed to `expected false to be true`.

(1) and (2) are opposites on purpose — one requires the stale URL present, the other requires
the resolved value to not be it. That pairing is what makes "quietly overwrote the top level"
and "quietly read the top level" *both* reachable failures.

## §3 Half 1's literal instruction contradicted M-OPEN-2, and the reader-side rule won

M-OPEN-1 half 1 said, verbatim, to *change F5/F6's `evidence.source`* to the vendored path.
M-OPEN-2, two rows down in the same file, forbids overwriting a top-level artifact field
because it destroys the append record and the falsification history M26-5 exists to preserve.

Both are instructions in `open-items.md`. They cannot both be followed.

**Resolution: the reader-side rule wins, because it is the one with a gate.** M-OPEN-2's
prohibition is enforced by an assertion that reds; half 1's phrasing is prose with no enforcement.
So the source moved by **append** — a new `amendedByM26-8` block on each of F5 and F6 — and half 1
is recorded closed *by its own revised condition*, not by its original literal wording. The
contradiction is written into M-OPEN-1's closing note rather than silently resolved, because the
next batch will meet the same pair.

> Two rows of one file can prescribe contradictory things. Prefer the one a gate can enforce;
> record the other as superseded in place.

### §3.1 What half 1 did *not* close

F5's amendment records that its **auth-flow residue** is still an unvendored claim. Half 2 of
M-OPEN-1 stays **OPEN** and untouched: it needs a real assertion over a real subject, not a
vendored page. Half 1 is only the digest-locked-evidence half.

## §4 M-OPEN-4's premise was false: the defect was not cosmetic, and the inequality above it was satisfiable for the wrong reason

M-OPEN-4 had been read three times as cosmetic — *"the assertion is correct, its failure message
can mislead"* — and carried forward each time on that reading. It is wrong. Measured across the
four reachable combinations of separator style × filter:

| Bytes | Filter | Rows counted | Result |
|---|---|---|---|
| LF | `\r`-blind | 6 (4 dated) | PASS — correct |
| LF | `\r`-blind, uniform-date claim | 6 (6 dated) | **REDS** — correct |
| **CRLF** | **`\r`-blind, uniform-date claim** | **7** (6 dated) | **PASSES** — wrong |
| CRLF | fixed, uniform-date claim | 6 (6 dated) | REDS — correct |

Row 3 is the defect. The `\r`-blind filter admits one extra phantom row, so the denominator
becomes 7 while 6 rows carry the date. The clock assertion is
`dated.length >= 1 && dated.length < rows.length` — and `6 < 7` is **true**. The over-precise
claim that F7's gate was specifically built to reject therefore **passes**.

**The transferable finding:** *a miscounted denominator does not fail. It makes the inequality
above it satisfiable for the wrong reason.* An off-by-one in a count that only ever feeds
`<` or `>` has no failing mode of its own — it surfaces as a **false green** in whatever claim
consumes it. That is why three readings called it cosmetic: nothing was ever red to look at.

### §4.1 The fix is two changes guarding opposite directions, and control #162 measured which does what

Two changes:

1. Strip `\r` in the separator filter, in **both** places (`featureRows()` and
   `deprecatedTable()`, extracted so the two cannot drift apart again).
2. **Pin `rows.length` to 6 *before* the inequality.** Per
   `[[assertion-order-decides-falsifiability]]`, an inequality placed above the literal that
   supports it makes that literal unreachable.

I had recorded (2) as "the durable half" and (1) as cosmetic-adjacent. Control #162 measured the
full cross-product of separator style × claim shape × filter, and the honest reading is that
**each guards a different direction and neither is redundant**:

| Bytes | Claim | Filter | rows | dated | pin | inequality | verdict |
|---|---|---|---|---|---|---|---|
| LF | real | fixed | 6 | 4 | OK | PASS | GREEN — correct |
| LF | real | blind | 6 | 4 | OK | PASS | GREEN — correct |
| LF | uniform | fixed | 6 | 6 | OK | RED | RED — correct |
| LF | uniform | blind | 6 | 6 | OK | RED | RED — correct |
| CRLF | real | fixed | 6 | 4 | OK | PASS | GREEN — correct |
| **CRLF** | **real** | **blind** | **7** | 4 | **RED** | PASS | **RED — false alarm** |
| CRLF | uniform | fixed | 6 | 6 | OK | RED | RED — correct |
| **CRLF** | **uniform** | **blind** | **7** | 6 | **RED** | **PASS** | RED, but *by the pin* |

- **(2) prevents a false GREEN.** Bottom row: the inequality still reads `6 < 7` = PASS even after
  the fix. What reds is the pinned count. So without (2), a blind filter on a CRLF checkout passes
  the over-precise claim — §4's row 3, exactly as recorded.
- **(1) prevents a false RED.** Row 6: with the pin in place but `\r` unstripped, a *legitimate*
  CRLF checkout reds on a property that holds. A gate that reds on correct input gets deleted by
  whoever hits it on Windows, and then (2) goes with it.

So (2) is not a superset of (1). The earlier framing — "(1) is a fix the next CRLF checkout can
silently undo" — was the wrong shape: with (2) present, a CRLF checkout makes the gate **loud**,
not silent. The real cost of omitting (1) is a gate that cries wolf until someone removes it.

### §4.2 Control #162 could not reach its subject as designed, and that is itself the finding

The control was specified as *"convert the deprecation table to CRLF and claim a uniform date."*
Applied to `third_party/.../deprecated.snapshot.md`, it red — on the **wrong layer**:

```
expected 5041 to be 5031          <- byte count
expected 41 to be +0              <- CR count
expected '## Deprecated\r\n…' to contain 'Three months after SEP-2596 reaches F…'
```

Those are M26-5's digest-lock assertions. They fire **before** the clock assertion is evaluated, so
the mutation can never demonstrate anything about the inequality. A second flaw surfaced too: only
one of the two clock cells matched my replacement, because the real cell reads
`Follows Sampling ([SEP-2577](…))` — a markdown link, not the bare prose the plan assumed.

**This is `[[negative-control-validity-checklist]]` failing on question 2** (can the mutation reach
the assertion under test?). A control on a digest-locked file cannot test anything *downstream* of
the digest. Restated as a direct cross-product over the filter functions, with the locked file left
byte-identical — which is how the table above was produced. The locked bytes were restored and
re-verified at `sha256 ef70b61f…`, 5031 bytes, 0 CR.

### §4.3 Location drift, recorded

The row cited `:173`; the real line is **`:175`**. Recorded in the closing note. Line numbers in
prose rot; this is the second batch in a row to find one (M26-3 found `server.ts:61` pointing at
a blank line). The reader's `assertPointer` helper — which asserts the line's **content**, not
its existence — is the standing answer, and it is why this drift was cheap to find.

## §5 M-OPEN-6, filed and not fixed

While resolving F5/F6 I walked both artifacts for keys matching `/M26-\d+/`:

- **20 occurrences / 10 distinct names** match `AMENDMENT_KEY` = `/^(?:\w+A|a)mendedByM26-/`
- **1** does not: `finality-status.json` `gates[7].closedByM26-5` (F8)

F8's amendment is invisible to the reader. Nothing is broken today — no assertion resolves F8
through the chain — but a future batch that does will read F8's **superseded** observation
(*"third_party/ measured ABSENT"*) as current, and that has been false of every commit since
M26-5.

**This is the same defect class 0065 found in this same regex.** M26-3's first draft matched
only `/AmendedByM26-/`; five `protocol-delta-matrix.json` lookups fell through to stale values
**and reported success**. The pattern was widened to two casings from the examples then in
hand — and the third convention was *already in the file*. Widening from examples has now
failed to converge twice.

**Deliberately deferred**, because widening the pattern changes what **every** field in both
artifacts resolves to, including the five delta-matrix lookups and `supersededBy`. That needs
its own before/after measurement. The fix shape recorded in M-OPEN-6 is a rule, not a third
alternation: key on the shared **batch suffix** `/M26-\d+$/`, and assert the **complement** —
that the set of keys the resolver recognizes equals the set present. A widened pattern with no
complement check is the same guess, made a third time.

## §6 A defect this batch's own new code shipped for one run: an absent field became a category

The end-state assertion partitions all eight gates' current sources into URL / FILE. First run:

```
F1=FILE  F2=FILE  F3=FILE  F4=FILE  F5=FILE  F6=FILE  F7=FILE  F8=FILE
```

Expected F1/F2/F3/F7 to be URL. Root cause measured: `gate.source` is `undefined` for **all
eight** gates. An **unamended** source lives nested at `evidence.source`; only an **amended**
one is flat inside the amendment block. `resolveAmended`'s fallback read the flat key, got
`undefined`, and `String(undefined)` = `"undefined"` — which fails `/^https?:/` and so
**classified as FILE**.

Had the expectation been written to match, this assertion would have certified *"all eight gates
rest on committed bytes"* out of three missing keys.

**Fixed two ways, both necessary.** A `sourceOf()` helper resolving amendment → nested
`evidence.source` → `""`; and **`MISSING` as its own third outcome**, so an absent field can
never be silently sorted into a real category. The second is the durable half: a two-way
partition over possibly-absent data will always launder absence into whichever branch the
falsy value happens to satisfy.

> A categorizer over optional fields needs a category for *absent*. Otherwise absence votes.

A sibling slip in the same test: the "every F-row is named by an `it()` title" check used
`it\("${id}[\s/]`, anchoring the id to the title's start, and returned `["F2"]` — F2 is named
mid-title in `it("F1/F2 — the revision string is upstream's own…`. Now `it\("[^"]*\b${id}\b`,
word-bounded so `F1` cannot later satisfy `F11`.

## §7 Why the end state was re-derived instead of asserted as a slogan

The batch's stated goal was *"all eight gates have a gate watching them."* That sentence is not
the same property as *"every gate's `source` names a committed file"*, and asserting the latter
would have been false:

- **F1/F2/F3** legitimately cite upstream versioning pages. Their **content** is locked under
  F1/F2/F3's own vendor gate; moving their `source` to a file would claim a lock that lives
  elsewhere.
- **F7**'s `amendedByM26-5` carries no `source` at all, so its current source is still its URL.
- **F8**'s subject is *this repository*. There is no upstream file to cite.

So the test asserts the **exact partition**
`["F1=URL","F2=URL","F3=URL","F4=FILE","F5=FILE","F6=FILE","F7=URL","F8=FILE"]` plus the
separate claim that every F-row except F8 is named by at least one `it()` title across the two
invariant files. F8 is exempted with its reason stated inline: it is covered by the vendor
directory's `SOURCE.json` digests existing at all, not by one test.

Two claims, because they fail independently: a gate could be watched while citing the wrong
thing, and could cite the right thing while unwatched.

## §8 Negative controls — what each was measured to catch

Continuing the numbering from #156. Each applied to **source or artifact, never to a test**,
run, observed to fail **naming its own subject**, rolled back, and confirmed byte-identical by
`git diff`.

| # | Mutation | Required failure mode |
|---|---|---|
| 157 | delete F5's `amendedByM26-8` block | reds naming the **missing amendment key**, and prints the stale URL it fell back to — not `expected false to be true` |
| 158 | flip one byte of `third_party/.../schema.json` | reds on the **derived** digest while both citations stay unchanged — proves the hash is computed, not restated |
| 159 | restore the superseded top-level-URL guard | **PASSES in both row states** — the measurement that condemns it (§2); a control whose *pass* is the finding |
| 160 | remove F1's `evidence.source` | reds as `F1=MISSING`, not silently as `F1=FILE` (§6) |
| 161 | probe `properties.error.properties.code` instead of `…error.allOf[1].properties.code` | reds naming the unresolved `allOf` path, per `[[resolved-vs-raw-presentation-doc]]` |
| 162 | convert the deprecation table to CRLF **and** claim a uniform date | **INVALID as designed** — the digest lock reds first, so the mutation never reaches the clock assertion. Restated as a cross-product over the filters; see §4.1–§4.2 |

**#159 is the unusual one.** Every other control is validated by turning red. #159 is validated
by turning **green in two states that must be distinguishable** — a passing control as evidence
of a defect. Recorded because `[[negative-control-validity-checklist]]` otherwise reads a green
control as invalid by construction, and here green *is* the datum.

**#161 is worth one line of its own.** It flattens the `allOf` composition so that `-32022` becomes
reachable at the *naive* path. The gate still reds — `expected +0 to be 2` on the composition
arity — even though the constant it ultimately cares about is present and correct. That is the
intended shape: the gate asserts the structure it must traverse, not only the value at the end of
it, so a schema that stops composing reds instead of silently agreeing.

**#162's own failure is recorded rather than discarded.** Two of the six controls in this batch were
defective on first authoring (#157's message printed `undefined` as if it were the record's content;
#162 could not reach its assertion at all). Both were found by running them and reading the message
rather than the exit code.

## §9 What this ADR does not decide

- **M-OPEN-1 half 2** stays OPEN. It needs a real assertion over a real subject; vendoring a
  page is not that.
- **M-OPEN-3** stays OPEN, blocked on upstream.
- **M-OPEN-6** stays OPEN by construction (§5).
- **`AMENDMENT_KEY` is unchanged.** Widening it is M-OPEN-6's batch.
- **The F7 clock gate at `mcp-spec-vendor.invariants.test.ts` is not replaced**, only reordered
  and its row-count pinned (§4.1). Its inequality form is correct and stays.
- **No served bytes, no `src/` semantics, no schema, no verdict movement.** PR #234 remains
  untouched and unmerged.
