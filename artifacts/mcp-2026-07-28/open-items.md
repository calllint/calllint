# Workstream M — carried open items

Measured 2026-08-09 against `main` @ `669ebf9` (M26-5 merged). **Nothing here is authorized.** This
file exists so a later batch can *fix* these without first *re-deriving* them: each row already
carries the measurement, the exact location, and the shape of the fix, so the analysis cost is paid
once.

Every row states how it was measured and what would make it false. A row whose fix lands should be
amended in place (append, never rewrite) the way `finality-status.json` amends its gates — a deleted
row is indistinguishable from a row that was never true.

## Why this file rather than a note under `docs/`

The previous carried item of this kind was parked at `docs/deferred-adr-0061-8.5-cwd-asymmetry-note.md`.
`docs/` is gitignored (`git ls-files docs/` → **0**), so that note was invisible to every reader who
was not on the authoring machine — the same defect that made T0 undeliverable, arriving by a different
route. `artifacts/` is committed and, per `proposed-file-map.md`, entered no gate until a named script
read it, so a record here is durable without becoming a build input.

That note's content **has since been folded into ADR 0061 §8.5.1** and is no longer open; the local
file is now a stale duplicate of committed prose. Recorded because "the note is parked in `docs/`"
was still being carried as an open item after it had actually been closed.

---

## M-OPEN-1 — F5 and F6 rest on unvendored pages

**Status:** OPEN. Narrowed by M26-5, not closed.

| | |
| --- | --- |
| **Measured** | `finality-status.json` `verdictAmendedByM26-5.unevenEvidenceQuality`; F5/F6's `evidence.source` fields |
| **Location** | `artifacts/mcp-2026-07-28/finality-status.json` (gates F5, F6) |
| **Not recorded elsewhere** | `proposed-file-map.md` has **0** occurrences of `F5` — no row scopes this work |

All eight gates PASS, but not on equal footing. F1, F2, F3, F4, F7 now rest on digest-locked bytes a
gate re-reads every CI run. **F5 and F6 still rest on the 2026-08-08 manual read** of pages M26-5 did
not vendor:

- **F5** (transport / auth / cache semantics) — `https://modelcontextprotocol.io/specification/2026-07-28`
- **F6** (task / consequence semantics) — `.../2026-07-28/extensions/tasks/overview`

So the gap narrowed from "nothing is re-checkable" to "**two of eight** are not". That is an
improvement worth naming precisely, and it is also the exact residue.

**Shape of the fix.** Vendor those two pages into `third_party/mcp-spec/2026-07-28/` and extend
`SOURCE.json`'s `files[]` — the lock and its gate already generalize, because the file **SET** is
enumerated from **disk**. A new file therefore *extends* the covered set automatically, and the `>= 5`
floor was written as a floor for this reason: a sixth vendored file must never red that line. Then add
content assertions for the specific F5/F6 claims (the `_meta` version key, the
`MCP-Protocol-Version` header, `UnsupportedProtocolVersionError`, and tasks being an opt-in
**extension** rather than core).

**Why it was out of scope for M26-5.** F5/F6's evidence is normative prose spread across many
documentation pages, not one file with one constant. Vendoring the whole documentation tree is a
scoping decision, and M26-5 was authorized to close **F8**, whose failure was blocking.

**What would make this row false:** those two pages appearing in `SOURCE.json` with content-layer
assertions, at which point all eight gates are gate-backed and this row closes.

---

## M-OPEN-2 — the superseded top-level `verdict` has no reader-side guard

**Status:** OPEN. A documentation hazard, not a correctness bug.

| | |
| --- | --- |
| **Measured** | `grep -rn "finality-status" --include=*.ts --include=*.mjs` → matches are **comments only**, zero code readers |
| **Location** | `artifacts/mcp-2026-07-28/finality-status.json` top-level `verdict` / `productionChangesAllowed` |

The top-level fields still read `PENDING_FINAL` / `false`, describing the state at `b136f44`. They are
retained **verbatim and on purpose** — append discipline, and `verdictAmendedByM26-5.supersedes` says
in the file that a reader must take the amendment as current.

The hazard is that append discipline puts the **stale** value **first** and the current value in a
nested object further down. A reader — human or a future script — who reads the obvious top-level key
gets `PENDING_FINAL` / `false`, which is now false. Today nothing breaks, because **no machine reads
this artifact at all**: every match is a comment citing it as prose.

That "nothing reads it" is the whole reason to write this down rather than fix it now. The first batch
to add a real reader is the batch that turns a documentation hazard into a bug, and it will be looking
at the amendment (which is where the interesting content is), not at the stale key it must actually
guard against.

**Shape of the fix, for whichever batch adds the first reader.** Resolve the amendment chain
explicitly — read `verdictAmendedByM26-*` if present and fall back to the top-level field only when
absent — and assert that resolution, so a reader that silently takes the top-level value reds. Do
**not** overwrite the top-level fields to fix this: that would destroy the append record and the
falsified-claim history that made M26-5 worth doing. Cf. [prose-justified-constant-is-ungated] — a
value justified only by neighbouring prose is a claim about two files, and tests measure one.

**What would make this row false:** an amendment-resolution helper plus an assertion that the stale
top-level value cannot be read as current.

---

## M-OPEN-3 — the SEP-2596 removal clock is unresolvable from vendored bytes

**Status:** OPEN by upstream dependency. Cannot be closed unilaterally.

| | |
| --- | --- |
| **Measured** | `deprecated.snapshot.md`: 4 of 6 rows read "First revision released on or after 2027-07-28"; HTTP+SSE reads "Three months after SEP-2596 reaches Final" |
| **Location** | `third_party/mcp-spec/2026-07-28/deprecated.snapshot.md`; asserted at `tests/invariants/mcp-spec-vendor.invariants.test.ts` |

The HTTP+SSE deprecation's removal date is defined relative to an event — SEP-2596 reaching Final —
**that this registry does not record**. So the removal clock for that row is genuinely unknown from
the vendored bytes, and no amount of care with these files can resolve it.

This does **not** move F7's verdict: F7 asks for no pending breaking *erratum*, deprecation is not
removal, removal is a future-revision act by Core Maintainer decision, and `## Removed` is empty
(asserted structurally — zero table rows — rather than by trusting the prose, since upstream could add
a row and keep the sentence). The unknown date bounds only the **precision** of any sentence
describing the clock.

**The standing constraint this creates.** Do not restate "earliest possible removal is 2027-07-28" as
though it were uniform — it holds for 4 of 6 rows. The gate pins this as an **inequality** (`some`
rows carry the date, strictly fewer than `all`) precisely so that asserting the uniform version would
red. Encoding the over-precise claim into the gate would make the gate agree with the error it exists
to prevent.

**What would close it:** upstream publishing a concrete date, or CallLint dropping HTTP+SSE from any
claim whose correctness depends on that clock. Neither is a CallLint code change.

---

## M-OPEN-4 — the deprecated-table row filter does not strip `\r`

**Status:** OPEN. Cosmetic; the assertion is correct, its failure *message* can mislead.

| | |
| --- | --- |
| **Measured** | negative control #130 (CRLF-ify `deprecated.snapshot.md`) reported the row count moving 6 → **7** |
| **Location** | `tests/invariants/mcp-spec-vendor.invariants.test.ts:173`, `:192` |

The filter that drops a Markdown table's `| --- |` separator is `!/^\|[\s|:-]+\|$/`, which does not
account for a trailing `\r`. On a CRLF file the separator line ends `|\r`, fails that test, and is
counted as a **feature row** — so control #130 reported "7 rows" when no seventh feature exists.

The control still red for the right **outcome** (a CRLF file must not pass), and it red on three
assertions including the dedicated `\r` counter, which names the real cause. But one of the three
printed a row count that invites the wrong diagnosis.

This is recorded rather than fixed because fixing it means editing an assertion to make a *rolled-back
control* print a nicer message, and touching gate logic for message quality — with no live failure —
is how a gate quietly loses its edge. The digest and CR assertions already make CRLF impossible to
reach in practice; this only shapes the diagnostic if it somehow does.

**Shape of the fix:** normalize with `.replace(/\r$/, "")` before the separator test, in both places,
and re-run control #130 to confirm the count now reads **6** while the CR counter still reds. Both
halves matter — a fix that made the count right by making the file pass would be strictly worse.

---

## Not open — closed items recorded so they are not re-analyzed

| item | state | where it is recorded |
| --- | --- | --- |
| ADR 0061 §8.5's cwd-asymmetry prose amendment | **CLOSED** — folded into **§8.5.1** | `adrs/0061-…md` §8.5.1. The `docs/` copy is a stale duplicate. |
| The R-9 daily backup (destination / window / credential) | **CLOSED** | ADR 0061 **§8.6** |
| A restore has never been exercised | **OPEN, but already recorded** | ADR 0061 §8.6 "What §8.6 still does not deliver" — needs host access and somewhere to restore *to*; not a code change |
| F8 (vendored bytes absent) | **CLOSED** by M26-5 | `finality-status.json` F8 `closedByM26-5` |
| ADR number collision (0062) | **CLOSED** | consumed by the T0 landing decision; M26-1 uses **0063**; 0060 stays reserved |
