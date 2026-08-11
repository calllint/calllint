# ADR 0072 — The amendment resolver is keyed on the batch suffix, and one complement check could not fail

- **Status:** Accepted
- **Date:** 2026-08-11
- **Workstream:** M (MCP revision 2026-07-28)
- **Batch:** M batch M26-9
- **Supersedes:** nothing. **Amends:** ADR 0065's `AMENDMENT_KEY` (the resolver it introduced), and
  discharges the before/after measurement ADR 0068 §5 deferred.
- **Closes:** M-OPEN-6.
- **Leaves open:** M-OPEN-3 (awaiting an upstream date), M-OPEN-1 half 2 (spec surface, needs its own
  batch).

## §1 Numbering: 0072, and 0060 remains reserved

`ls adrs/` tops out at `0071` across 39 files, and `0060` does not exist. Its reservation is held by a
reader, not by prose: `artifacts/phase-2.4/presentation-plane-audit.json:135`'s `$comment` says so
verbatim. Re-listed rather than inferred from a neighbouring ADR.

## §2 The decision

`tests/invariants/mcp-artifact-claims.invariants.test.ts` resolves append-amended fields in the two
`artifacts/mcp-2026-07-28/**` JSON artifacts by scanning each object for keys that name an amendment.
That predicate becomes:

```
before: /^(?:\w+A|a)mendedByM26-/                    two casings, both taken from examples
after:  /M26-\d+$/   AND the value must be an object  the suffix every convention shares
```

`batchNoOf`, the newest-first sort, `resolveAmended` and `supersededBy` are unchanged. Only the
question "which keys are amendments" moved.

Two assertions come with it:

- **The complement.** Every object-valued key in either artifact whose name mentions a batch must be in
  the set the resolver recognizes, asserted as the **set of unrecognized names**.
- **The F8 distinction.** `gates[7].status` must still be `"PASS"` at the top level *and* must still
  resolve via `closedByM26-5` to prose beginning `"PASS as of "`. Both readings, pinned side by side.

## §3 Why a rule, and not a third alternation

M-OPEN-6 was filed because `finality-status.json` `gates[7].closedByM26-5` matched neither casing — its
verb is `closedBy`. Adding `closedBy` to the alternation would have worked, and would have been the
third guess of the same kind:

- M26-3's first draft matched `/AmendedByM26-/`. All five `protocol-delta-matrix.json` lookups fell
  through to stale top-level values **and reported success**.
- It was widened to two casings, from the examples then in hand.
- `closedByM26-5` was **already in the file** when that second widening landed. So the widening did not
  merely fail to anticipate a future key; it failed to cover a present one.

Measured over both artifacts: **21 occurrences / 11 distinct names**, and `/M26-\d+$/` matches **21 of
21**. Zero names fail to end in a batch suffix. That is what makes the suffix an invariant rather than a
larger enumeration — and it is the general lesson worth carrying: **a pattern widened from examples
covers exactly the examples in hand at each widening. Convergence requires switching to a property the
examples share.**

Control **#196** demonstrates the difference rather than arguing it: renaming `amendedByM26-1` to
`amendedByBatchM26-1` — a fourth naming convention, never seen — leaves the suite **green**. Under the
alternation it would have needed another edit.

## §4 Why `:358` still reads the raw `status`, on purpose

The eight-gate assertion filters `rows.filter((g) => g.status !== "PASS")` on the **raw** field while
everything else in the file resolves through amendments. After this batch that choice stops being
self-evident, because the resolver now *can* return a different answer for exactly one row.

F8's amendment replaces `status: "PASS"` with prose beginning `"PASS as of 2026-08-09. The observation
above described b136f44 and remains true OF THAT COMMIT…"`. Routed through `resolveAmended`, the
inequality is **true** and the test would report F8 as not passing. The question the assertion asks is
"do all eight gates read PASS", F8's top-level `status` **is** `"PASS"`, and the amendment dates the
observation rather than revoking the verdict. The raw read is the correct read.

So the batch changes the resolver and **not the call-site semantics**, and pins the distinction so it
cannot be silently unified later. Controls #193 and #194 separate the two readings: deleting the
amendment's `status` reds the resolver arm while the eight-gate filter stays green; mutating the
top-level value reds the filter alone.

**A strictly more correct resolution can turn a correct assertion wrong.** That is not an argument for
keeping a resolver that cannot see one of its own keys — it is an argument for pinning which reading
each call site wants, at the call site, with the reason attached.

## §5 The measurement ADR 0068 §5 deferred, and why it was the batch

M26-8 declined this fix because widening the predicate changes how *every* field in both artifacts
resolves, and that needs its own before/after. Done here, by walking both artifacts, collecting every
object that carries an amendment, and resolving each of its fields under both rules:

```
objects carrying amendments: 14      fields compared: 159      DIFFERING: 6
```

All six are `finality-status.json` `gates[7].*` (F8): `status`, `vendored`, `gate`, `inv-M4`,
`whatChangedForF1-F7`, `whatItCaughtImmediately`. **Five** were `<ABSENT>` under the old rule — the
field exists only inside the amendment block, so the old resolver had nothing to return. **One**,
`status`, is a genuine stale-value substitution.

Outside F8: **zero change.** The five `protocol-delta-matrix.json` lookups and `supersededBy` resolve
byte-for-byte as before. That is the safety result the deferral was asking for, and it is why the
measurement — not the one-line edit — was the work.

## §6 The object-valued guard, and how it nearly shipped unfalsifiable

The old prefix excluded scalar keys for free. The suffix rule does not, so `amendmentKeysOf` requires an
object value. That is load-bearing on today's bytes rather than defensive:
`protocol-delta-matrix.json` `summary.amendedByM26-1.statusAfterThisBatch.amendedByM26-2` is a
**string** — an inline note among a map of D-row statuses. The old regex matched it too, and `asBlock`
dropped it silently.

The first draft of the guard **had no failing mode.** Removing `asBlock(obj[k]) !== null` from the
filter changes nothing observable: `resolveAmended` skips an unusable key either way, so the guard was a
claim with no way to be wrong — [[a-gate-that-cannot-pass-on-success]] in its quietest form. The fix is a
second complement, `recognizedButUnusable`: every key the resolver *recognizes* must be one it can
*use*. And the scalar exclusion is enumerated by **name**, not merely counted, so a second scalar key
has to be justified at the assertion instead of joining a tolerated class.

## §7 A complement check keyed on its own subject cannot fail

M-OPEN-6's fix shape says to enumerate every key matching `/M26-\d+/` and assert the resolver recognizes
all of them. Implemented literally, **that check can never red.** Control #191 renames
`closedByM26-5` → `closedAtStageM26x5`, dropping the suffix: the census loses the key at the same moment
the recognized set does, the complement stays empty, and the assertion passes while the resolver goes
blind to exactly the key this row was filed about.

The census is therefore `/M26/i` — the widest predicate that still means "this key names a batch",
deliberately looser than the thing it audits. Measured on today's bytes it yields exactly the 11 real
amendment names and zero noise, so the looseness costs nothing in precision. The count is pinned
(`census.size >= 11`) **before** the set claim, because an empty complement proves nothing if the walk
found nothing ([[assertion-order-decides-falsifiability]]).

**Generalized: an audit must be keyed more loosely than its subject. Sharing the subject's predicate
makes the two move together, and a check that moves with what it checks has no failing mode.**

## §8 Controls

Applied to the **artifacts**, never to the test's assertions, backed up with `cp` and restored from that
copy (not `git checkout --`), each rolled back to a byte-identical worktree. The positive control ran
first: 19/19 green unmutated.

| # | mutation | observed |
|---|---|---|
| 191 | rename `closedByM26-5` → `closedAtStageM26x5` (suffix dropped) | **RED**, naming `closedAtStageM26x5`. Also red on D3's resolver arm. This is why the census is `/M26/i` |
| 192 | inject scalar `"noteM26-7": "prose"` on `gates[7]` | **RED**, naming `noteM26-7` — via the enumerated scalar exclusion, so the failure says *why* it is excluded, not merely that it is unrecognized |
| 193 | delete `gates[7].closedByM26-5.status` | **RED** on D3's resolver arm only; the eight-gate filter stayed **green** (1 of 19 failed). The two readings are independent |
| 194 | top-level `gates[7].status` → `"PASS as of 2026-08-09"` | **RED** on the eight-gate filter, naming `F8=PASS as of 2026-08-09`. It reads the top level, not a coincidental agreement |
| 195 | revert `AMENDMENT_KEY` to the old prefix rule | **RED**, naming `closedByM26-5`. M-OPEN-6's defect, reproducible on demand |
| 196 | rename `amendedByM26-1` → `amendedByBatchM26-1` (suffix kept) | **GREEN**, as required. A naming convention never seen, recognized |
| 197 | both artifacts converted to CRLF (393 CR bytes) | **GREEN**, as required. No windows-latest-alone failure introduced |

**#195 is the only control that touched the test file, and the reason is that the constant *is* the
subject under test.** The standing rule forbids editing a test to make it green; this edit makes it
**red**, and it is the only way to show the new rule is not passing by accident. Recorded here so the
exception does not become a precedent by silence.

**#196 and #197 were predicted green.** Listing a control that must stay green is still a measurement:
had either red, it would have been a finding about this batch, not noise.

## §9 What this batch deliberately did not do

- **No artifact JSON bytes changed.** This is a fix to the **reader**, not to the record. Both files
  remain 0 CR bytes, verified on the worktree and index sides.
- **`closedByM26-5` was not renamed.** Fix shape 3 offered renaming or coverage; renaming edits an
  append-only record, so rule 1 covers it.
- **`:358` was not routed through the resolver** (§4).
- **ADR 0071 §6's `if:` gap stays open.** Measured today: 15 workflows / 19 jobs carry exactly **one**
  job-level `if:` (`build-and-test`'s deliberate `always()`), and `ci.yml#test`'s 27 steps carry
  **zero** — the gap is real, but no binding target falls under it. A partial expression evaluator would
  be worse than none, because it would invite belief that the gap is closed.
- **S0-OPEN-1 and S0-OPEN-4 untouched**; each remedy is an ingest-policy or served-bytes change needing
  its own authorization. **PR #234 untouched.**
- Zero verdict movement, zero schema change, zero served bytes, MCP stays 13 tools / 19 resources,
  `packages/calllint-mcp` runtime `dependencies` stays `{}`, `docs/` stays 0 tracked files.

Changed surface: **one test file, one artifact markdown (append), one new ADR.**
