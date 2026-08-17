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

**Status:** **CLOSED 2026-08-10 (M26-8, ADR 0068)** — half 1 only, by this row's own *revised*
condition. The original status line and the M26-7 amendment below both stand unedited; the closing
note is at the end of the row. Half 2 (vendoring for auth) is **not** closed and is **not** carried
here: it needs a claim CallLint actually makes, which is a new row's subject, not this one's residue.

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

### M-OPEN-1, amended by M26-7 (2026-08-10) — the row is still OPEN, but its **fix shape is refuted**

*Appended, not rewritten. Everything above is retained verbatim, including the fix shape this block
refutes. Read this block as current where the two differ.*

**Status stays OPEN.** No gate was added, F5/F6 still carry a `source` that is a URL, and vendoring
is still unauthorized. What changed is that the prescribed fix was **measured**, and most of the
work it asks for is unnecessary.

**Measured 2026-08-10 against the already-locked `schema.json`** (sha256 `ef70b61f…`, 181474 bytes,
155 `$defs`). The row's fix shape names four specific claims to assert *after* vendoring two pages.
Three of the four are **already in the locked bytes**:

| Named claim | Where it actually lives | Vendoring needed? |
| --- | --- | --- |
| the `_meta` version key | `$defs.RequestMetaObject.required` = both keys; `properties["io.modelcontextprotocol/protocolVersion"]` | **No** |
| the `MCP-Protocol-Version` header | that same property's `description`, verbatim: *"For the HTTP transport, this value MUST match the `MCP-Protocol-Version` header; otherwise the server MUST return a `400 Bad Request`"* | **No** |
| `UnsupportedProtocolVersionError` | `$defs.UnsupportedProtocolVersionError`, `error.code` `const` **-32022** under `allOf[1]`, `error.data` requiring `["requested","supported"]` | **No** |
| tasks are an opt-in **extension**, not core | **an absence**: `0` task-named `$defs`, `0` occurrences of `"tasks/"`, and the single case-insensitive `task` hit is an *example identifier* inside `$defs.ServerCapabilities.properties.extensions.description` | **No — but see below** |

So F5's entire recorded `observation` is derivable today, and F6's is derivable **as an absence**,
which is the harder and more interesting form: the claim "a core-only implementation is conformant
without tasks" is proven by tasks having no core `$defs` at all, not by reading the extension page.
That absence needs `[[absence-makes-a-gate-skip-itself]]` discipline — assert the schema parsed, the
def count is 155, **then** assert zero task defs, or the gate passes on an empty object.

**What genuinely is not in the locked bytes.** F5's requirement line says "transport / auth / cache
semantics". Measured: `cache` is covered (`$defs.CacheableResult` with `cacheScope` public/private
and TTL, 78 hits). `auth` is **not** — one `oauth` hit, and it is an example extension identifier.
`initialize` as a method name is **absent entirely** (`raw.includes("initialize") === false`); the
word survives only inside the `clientCapabilities` description saying capabilities are declared
*"per-request rather than once at initialization."* So a page vendoring would buy the auth semantics
and nothing else on this list.

**Why this matters more than the saved work.** The row's fix shape sent a future batch to vendor two
pages before writing any assertion. A batch that trusted it would have done the expensive,
authorization-requiring half first and discovered afterwards that the cheap half was already
possible. Same failure as `[[m26-3-first-artifact-reader]]`: a recorded *fix shape* is a claim about
the world, and nothing was reading it either.

**Revised fix shape, in two independently-authorizable halves:**

1. **No vendoring.** Add content-layer assertions for F5's three claims and F6's absence against the
   existing locked `schema.json`, and change F5/F6's `evidence.source` to name that file. This
   closes the *gate-backed* question for both rows. It needs no new bytes and no scoping decision.
2. **Vendoring, if ever authorized.** Only the auth semantics require it, and only if CallLint makes
   a claim that rests on them. Today it makes none — no HTTP transport exists in
   `packages/calllint-mcp/src/` (measured at M26-3, fact 4).

**What would make this row false, revised:** half 1 landing. At that point all eight gates are
gate-backed, and any residual auth question is a **new** row scoped to a claim CallLint actually
makes, not a leftover from this one.

**Careful:** the first probe of `UnsupportedProtocolVersionError` above read
`properties.error.properties.code` and returned `undefined`, which reads exactly like "upstream
doesn't pin the code." The real shape is `properties.error.allOf[1].properties.code`. The def was
right; the probe was wrong — `[[resolved-vs-raw-presentation-doc]]`, third instance in this
workstream. Any gate written for half 1 must resolve `allOf` rather than index `properties`
directly, or it will assert an absence that is really a wrong path.

> **CLOSED 2026-08-10 (M26-8, ADR 0068) — half 1. Read this note as current; everything above stands
> as the original measurement and its M26-7 refutation.**
>
> Half 1's condition was *"Add content-layer assertions for F5's three claims and F6's absence
> against the existing locked `schema.json`, and change F5/F6's `evidence.source` to name that
> file."* Both parts exist now, and the second one **could not be done as written** — see below.
>
> **The assertions.** Seven tests in the `M26-7` block of
> `tests/invariants/mcp-artifact-claims.invariants.test.ts`: the 155-`$defs` non-degeneracy guard
> first (`[[absence-makes-a-gate-skip-itself]]`), then F5's three claims, F6's absence, the
> auth-and-only-auth residue, and the row-state guard. The `allOf` warning above was followed: the
> `-32022` assertion resolves `properties.error.allOf[]` and pins `allOf.length === 2`, so a gate
> indexing `properties` directly reds instead of reporting a false absence.
>
> **The `evidence.source` change, and why the instruction was unfollowable verbatim.** Half 1 said to
> *change* F5/F6's `evidence.source`. Doing that would **overwrite** an append-only field, which
> M-OPEN-2 forbids for the reason that row exists. So the source moved by **append**: F5 and F6 each
> gained an `amendedByM26-8` block naming
> `third_party/mcp-spec/2026-07-28/schema.json (sha256 ef70b61f…, 181474 bytes, 155 $defs)`, and the
> top-level URLs are retained verbatim. Two rows of one file can prescribe contradictory things; the
> reader-side rule wins, because it is the one with a gate.
>
> **F5's amendment records what is still NOT in the locked bytes** — auth: one `oauth` occurrence, an
> example extension identifier, and zero auth `$defs`. An amendment that claimed full coverage would
> have been the same error as the fix shape M26-7 refuted, one layer down.
>
> **What this close cost, measured.** The guard M26-7 left behind
> (*"both rows still cite a URL — when that changes, THIS assertion is the one that must be edited by
> hand"*) counted URLs in F5/F6's **top-level** `evidence.source` and required exactly `2`. Append
> discipline **freezes** that field, so the count is 2 before and after half 1: the guard passes in
> both states and reds only if someone **overwrites** the top level — the action M-OPEN-2 forbids. It
> was structurally blind to the authorized change it was written to detect. Replaced with a two-layer
> assertion (top-level URL retained **and** `source` resolving via `amendedByM26-*` to the locked
> file, `via` asserted before the value), plus a derived-digest check so a re-vendor cannot leave both
> rows citing a stale sha256. **General form: on an append-only record, a guard bound to the
> top-level field measures whether the history was destroyed, never whether the claim advanced.**
>
> **Two defects the new assertions found in themselves, both while being written:**
>
> 1. **An absent field produced a category, not an error.** The end-state assertion classified each
>    gate's source as URL-or-FILE via `String(resolveAmended(g,"source").value)`. An **unamended**
>    source lives at `evidence.source`; only an **amended** one is flat. So the fallback read
>    `gate["source"]` = `undefined`, `String(undefined)` = `"undefined"`, which fails `/^https?:/` —
>    and F1/F2/F3 were silently classified **FILE**. The assertion would have certified "all eight
>    rest on committed bytes" from three missing keys. `MISSING` is now its own outcome.
> 2. **`closedByM26-5` is an amendment key the reader cannot see.** `AMENDMENT_KEY` is
>    `/^(?:\w+A|a)mendedByM26-/`; F8's amendment is named `closedByM26-5` and matches neither casing.
>    Ten distinct amendment keys across both artifacts match; that one does not. It is the same defect
>    class M26-3 found in this regex, one key shape further out — recorded as **M-OPEN-6** rather than
>    widened here, because widening the pattern is a change to how *every* field in both artifacts
>    resolves and belongs in a batch that can measure the effect.
>
> **Negative controls:** #157 (drop `amendedByM26-8` from F5) reds naming the missing amendment and
> printing the stale URL a naive reader would have taken as current; #158 (a re-vendor simulated by
> mutating one byte of `schema.json`) reds on the derived digest while both citations stay unchanged;
> #159 (restore the superseded top-level URL guard) passes in **both** row states, which is the
> measurement that condemned it.

### M-OPEN-1, amended by M26-10 (2026-08-17) — half 2 has **no subject**, and the two assertions proving that were **blind**

> **Read this note as current for half 2. Half 1 stays CLOSED as recorded above; this note does not
> reopen it, and the M26-7 refutation above still stands.**
>
> Half 2 (vendor the auth pages) was **authorized** in this batch. It was **not** done, because the
> measurement that would justify it came back empty — and the instrument that produced that answer
> turned out to be measuring one eighth of what it claimed.
>
> **The boundary, restated from M26-7 and re-verified at HEAD rather than trusted.** Vendoring buys
> **only** auth semantics, warranted *"only if CallLint makes a claim that rests on them."* It makes
> none: `packages/calllint-mcp/src` is 8 `.ts` files with **zero** transport constructs, and every
> `authorization` occurrence is prose — `requiresSeparateAuthorization` (a plan field), and receipt
> wording inside a tool-description **string**. So vendored auth pages would add bytes backing no
> claim. Half 2 stays open **for want of a subject, not for want of authorization**; the row's own
> reading is right that its subject is a new row's, not this row's residue.
>
> **What that re-verification found.** The two assertions holding up "no HTTP transport exists"
> (`D2 stays n/a…` and `what M-OPEN-1 genuinely still needs is AUTH, and only auth`) read
> **`server.ts` alone** while stating their conclusion over the whole package. ADR 0065 §209 describes
> the scan at **directory** scope — *"a comment-stripped scan of `packages/calllint-mcp/src/` … finds
> zero hits, and the gate asserts that"* — so the prose and the gate had disagreed since M26-3.
> **Same fault class as half 1's own cost above:** a guard that cannot observe its subject, here by
> scope rather than by append-only field.
>
> **Proven blind, not assumed blind.** A well-typed, correctly-imported
> `createServer(...).listen(port)` added to `version.ts` left **both assertions green and
> `pnpm typecheck` at EXIT 0**. (The first probe was weaker than claimed — it omitted the import, so
> `tsc`, not the guard, caught it. That loophole is why the second probe exists.)
>
> **The fix.** One shared scanner: a recursive walk of the package, cross-checked **twice** — against
> `git ls-files` and against Node's own `readdirSync({recursive:true})` — behind a premise block that
> asserts the instrument before its product
> ([[a-premise-block-keeps-a-blind-guard-from-reading-green]]). Derive the set, never hardcode it: a
> named file list covers exactly the files in hand.
>
> **Needle adoptability, measured in both directions.** A substring `Authorization` needle reds on the
> three legitimate prose occurrences in `tools.ts` — one inside a string no comment filter removes —
> and the tempting repair (drop the needle) is exactly what leaves `Authorization: Bearer`
> unobserved. Case-sensitive `\bAuthorization\b` matches the header and none of the three.
>
> **Mutants — 11 run, product *and* instrument. Four survivals, each of which changed the fix:**
>
> | # | mutant | verdict |
> |---|---|---|
> | M1 | `createServer`+`.listen` in `version.ts` | KILLED (named the file and both needles) |
> | M2 | `Authorization: Bearer` header in `tools.ts` | KILLED |
> | M3 / M3b / M3c | transport in a new file / an **untracked subdirectory** / on **trailing-comment** lines | KILLED |
> | M4 | walk narrowed to `server.ts` — *the original defect* | KILLED |
> | M5 | `createServer(` needle deleted | KILLED |
> | M6 | scan aimed at `packages/types/src` | **SURVIVED**, then KILLED |
> | M7 | walk skips subdirectories | **SURVIVED**, then KILLED |
> | M8 / M8b | comment filter widened to any `//` | **SURVIVED**, then KILLED |
> | M8c | comment filter deleted outright | **SURVIVED — and it is correct that it does** |
>
> 1. **M6: a path anchor interpolated from the constant under test moves with the mutation.** The
>    premise block anchored on `` `${MCP_SRC_DIR}/server.ts` ``, and `packages/types/src` *also* holds a
>    `server.ts` — so aiming the scan at the wrong package left all 20 tests green. Now anchored by
>    **content** (`runStdioServer`, `process.stdin`; there is no `StdioServerTransport` to look for —
>    ADR 0025 hand-rolls the loop), both absent from `packages/types/src`.
> 2. **M7: `git ls-files` cannot see the case that matters.** A subdir-skipping walk stayed green with a
>    transport planted in `src/transport/http.ts`, because the plant was **untracked** and the
>    cross-check had nothing to miss. A second, independent filesystem enumeration closes it — a defect
>    in my recursion cannot hide in Node's.
> 3. **M8: an already-empty result cannot change.** Widening the filter survived every check *until*
>    it was run against a real transport on trailing-comment lines. The filter is now measured through
>    the **same** `stripCommentLines` the scan uses, so the two cannot drift.
> 4. **M8c is a survival I am keeping, because it falsified my own docblock.** I had written that
>    `server.ts`'s docblocks *"would red an unfiltered scan."* Measured: **zero** needles fire on raw
>    bytes; the filter drops 678 of 2253 lines and not one carries a needle, because the needles were
>    already chosen to miss prose. The comment now says what is true — the filter is what lets the
>    needle set stay **strict** rather than being widened into un-adoptability later.
>
> **General form, and the reason this note is longer than its fix:** *a guard's scope claim is part of
> the claim.* Stating a conclusion over a package while reading one file is not a weaker measurement,
> it is a different one — and it reads identically to the true one right up until the file it does not
> read is the file that changes. **Mutate the instrument, not only the product**; four of these
> mutants survived the product-only pass.
>
> **Verification:** full suite **234 files / 4326 passed / 1 skipped** (baseline-identical),
> `pnpm typecheck` EXIT 0 on both projects. Every mutation reverted and confirmed by
> `git diff --stat`; each was applied by a probe that **asserts its own bytes changed** before the run,
> after one mutation silently failed to apply and reported a green that meant nothing.

---

## M-OPEN-2 — the superseded top-level `verdict` has no reader-side guard

**Status:** **CLOSED 2026-08-09 (M26-3, ADR 0065).** Closed by this row's own stated condition; the
original text below stands unedited as the measurement that motivated it. See the closing note at the
end of the row.

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

> **CLOSED 2026-08-09 (M26-3, ADR 0065). Read this note as current; everything above stands as the
> original measurement.**
>
> Both halves of the stated condition now exist in
> `tests/invariants/mcp-artifact-claims.invariants.test.ts`, the **first machine reader** of this
> directory: `resolveAmended(obj, field)` prefers `*AmendedByM26-*` and falls back to the top level
> only when no amendment supplies the field, and five call sites route through
> `expectResolvedViaAmendment`, which reds when the resolution did **not** come from an amendment —
> printing the stale value that would otherwise have been read as current.
>
> Nothing was overwritten. The top-level `verdict` / `productionChangesAllowed` still read
> `PENDING_FINAL` / `false`, exactly as this row required.
>
> **Two things this row could not have anticipated, both found by the assertions failing:**
>
> 1. **There are two amendment-key casings.** This file writes `verdictAmendedByM26-5`
>    (field-prefixed, capital `A`); `protocol-delta-matrix.json` writes `amendedByM26-1` (bare,
>    lowercase `a`). The first draft matched `/AmendedByM26-/`, so **all five** matrix lookups fell
>    through to the stale top-level value **and reported success** — this row's exact hazard,
>    reproduced by the gate written to prevent it. It surfaced only because the assertions check
>    *which source answered* (`via`) and not just the value. A value-only assertion would have passed
>    for the wrong reason.
> 2. **There are two amendment shapes**, so one helper is not enough. Replacement blocks restate the
>    field; **supersede-in-prose-only** blocks do not — `summary.amendedByM26-1` carries no
>    `allBlockedBy`, and `D1.amendedByM26-1` carries no `why`. Folding both into one helper would make
>    a superseded-only claim indistinguishable from an unamended one, which is this row's conflation in
>    a different disguise. Hence a second helper, `supersededBy`, matching the `supersedes` prose
>    (which names its target in backticks).
>
> **Negative controls:** #150 (delete `verdictAmendedByM26-5` wholesale) reds naming the missing
> amendment and printing `false`; #151 (a `resolveAmended` that ignores amendments) reds **five times**,
> each printing the exact stale claim a naive reader would have believed. #151 is the control that
> directly demonstrates this row's requirement.

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

**Status:** **CLOSED 2026-08-10 (M26-8, ADR 0068).** Fixed in both places by this row's own stated fix
shape, and both halves of its stated verification hold. **Its premise below was falsified in the
process: the defect is not cosmetic.** The original text and both earlier amendments stand unedited;
the closing note is at the end of the row.

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

> **Amended 2026-08-09 (M26-2, ADR 0064 §6.2). Read this note as current; the text above stands as
> the original measurement.**
>
> The status above still holds for **this** location: the vendored file is digest-locked and CR-counted,
> so its CRLF path is unreachable in practice, and the defect remains a message-quality one. What has
> changed is the **premise used to defer it**. "Cosmetic, with no live failure" was true of the class
> as well when this was written; it no longer is.
>
> M26-2 shipped a gate in the *same file* that slices **un-locked** source (`server.ts`, which carries
> no `eol=lf` pin, correctly) on a `"\n\n"` delimiter. That gate passed ubuntu-latest and macos-latest
> and **failed windows-latest alone**, and it failed *naming the wrong method* — `indexOf` returned
> `-1`, `slice(start, -1)` silently ran to end-of-file, and the `initialize` arm absorbed the
> `server/discover` arm below it. Negative control **#149** reproduces it exactly. Fixed at source by
> normalizing the reader and asserting both slice bounds (ADR 0064 §6.2).
>
> So the generalizable rule, which did not exist when M-OPEN-4 was filed: **an unlocked file read by a
> gate is CRLF on one of the three CI OSes, so any delimiter search or line filter over it must
> normalize first — and any slice must assert its bounds, because `slice(start, -1)` widens scope
> instead of failing.** The distinction that decides which side a file falls on is *digest-locked vs
> not*, not *vendored vs ours*.
>
> This does not change M-OPEN-4's fix shape or its priority. It records that the fix is now the
> *second* instance of a known class rather than a one-off, which is the argument for doing it in
> whichever batch next edits these assertions for a substantive reason.

> **Amended again 2026-08-09 (M26-3, ADR 0065 §6) — third instance, and the boundary is sharper than
> the note above states. Read this as current; both notes above stand.**
>
> M26-3 added `tests/invariants/mcp-artifact-claims.invariants.test.ts`, which reads three files in
> `artifacts/mcp-2026-07-28/` plus `packages/calllint-mcp/src/server.ts`. Its reader normalizes CRLF,
> applied at authoring time from the rule above rather than after a red windows job — so this is the
> third instance of the class, and the first where the rule was used **preventively**.
>
> **But the premise M26-3 started from was wrong, and measuring it narrowed the rule.** The plan
> asserted `artifacts/**` carries no `eol` pin and therefore *must* be normalized. Measured with
> `git check-attr text eol`:
>
> | Path | `eol` | Held by |
> | --- | --- | --- |
> | `artifacts/mcp-2026-07-28/**` | **lf** | `.gitattributes:112`, added by M26-0 for this exact trap |
> | `third_party/**` | **lf** | `.gitattributes:149` + sha256 lock + a `\r` counter |
> | `packages/calllint-mcp/src/server.ts` | **unspecified** | nothing — correctly, nothing hashes it |
>
> So `artifacts/**` is **unhashed yet on the safe side**, and the deciding line is not
> *digest-locked vs not* as the note above puts it, but **pinned-or-locked vs not**. Negative control
> **#154** — strip that reader's normalization *and* CRLF-ify `server.ts`, i.e. reproduce a
> windows-latest checkout exactly — leaves the suite **8/8 green**, because every assertion over the
> one unpinned file is `\r`-blind by construction (two `\s`-tolerant regexes; a `toContain` on a line,
> where a trailing `\r` sits past the match). The shape that *would* break is an exact `toBe` on a
> line. That is the same reason the M26-1 block at `mcp-spec-vendor.invariants.test.ts:223` was left
> un-normalized deliberately.
>
> The normalization in the new gate stays regardless, as **defensive rather than load-bearing** — the
> next assertion added there does not inherit that accidental tolerance. Recorded because a green
> negative control is either a weak gate or a false premise, and here it was the premise; the check
> that settled it was `git check-attr`, not argument.
>
> M-OPEN-4's own fix shape and priority are **unchanged**. Its location remains digest-locked and
> CR-counted, so its CRLF path stays unreachable in practice.

> **CLOSED 2026-08-10 (M26-8, ADR 0068). Read this note as current; the original text and both
> amendments above stand as written, including the premise this note falsifies.**
>
> **The fix.** `.replace(/\r$/, "")` now runs before the separator test, in **both** places — and the
> two places are no longer two: the filter and the table slice were extracted into `featureRows()` and
> `deprecatedTable()`, so the fix cannot be applied at one and forgotten at the other. That was the
> row's own risk (*"in both places"*) turned into something structural rather than remembered. The
> slice also asserts **both** bounds, per ADR 0064 §6.2, because `indexOf` returning `-1` makes
> `slice` widen scope silently instead of failing.
>
> **Both halves of the stated verification hold.** Control #130 re-run: the count reads **6**, and the
> file still cannot pass — 2 assertions red, `expected 5072 to be 5031` and `expected 41 to be +0`.
> The row insisted on both, and it was right to: *"a fix that made the count right by making the file
> pass would be strictly worse."*
>
> ---
>
> **The premise was false. This was never cosmetic.** Three notes above call it a message-quality
> defect with no live failure. Measured across four scenarios, the `\r`-blind filter makes F7's
> removal-clock **inequality unfalsifiable**:
>
> | Scenario | rows | dated | `dated < rows` |
> | --- | --- | --- | --- |
> | LF + blind filter, real bytes | 6 | 4 | PASSES (correct) |
> | LF + blind filter, uniformly dated | 6 | 6 | **REDS** (correct) |
> | **CRLF + blind filter, uniformly dated** | **7** | 6 | **PASSES — blind** |
> | CRLF + fixed filter, uniformly dated | 6 | 6 | **REDS** (correct) |
>
> The phantom separator row inflates `rows` to 7, so `6 < 7` passes — and the drift that assertion
> exists to catch is **exactly** upstream making every clock uniformly `2027-07-28`. On a
> windows-latest checkout the gate would have reported green while the property was gone. Control #156
> (uniformly date all six clocks) reds on LF; **#156b** (uniform dates **and** CRLF) is the scenario
> the blind filter passed, and it now reds too.
>
> **Why three passes over this row all called it cosmetic.** Control #130 only ever reported the
> *count* test failing, so every reading stopped at "the count is wrong, the outcome is right." Nobody
> asked what a **different** assertion did with the inflated count. The inequality is two lines below
> the filter and reads `rows.length`, so its correctness depends on a number the same defect corrupts.
> The general form is worth more than the fix: **a miscounted denominator does not fail — it makes an
> inequality above it satisfiable for the wrong reason.** An assertion is only as strong as the
> weakest quantity it reads, and "the message is bad but the outcome is right" is a judgement about
> one assertion made without checking its neighbours.
>
> **Ordering fixed as part of the same finding** (`[[assertion-order-decides-falsifiability]]`):
> `rows.length` is now pinned to `6` **before** the inequality, so the inequality can only be
> satisfied by the asymmetry it is about, never by an inflated denominator. The failure message prints
> all six observed clock cells, so a future red names what arrived instead of collapsing to a boolean.
>
> **Amended by M26-8, control #162 — the two halves of the fix guard OPPOSITE directions, and the
> four-scenario table above is missing the row that shows it.** The table omits *CRLF + blind filter +
> **real** bytes*. Measured over the full cross-product (bytes × claim × filter), that row reads
> `rows=7, dated=4` → the pinned count **REDS on bytes whose property holds**. So:
>
> - **Pinning the count** prevents a false **GREEN** (the bottom table row: the inequality still reads
>   `6 < 7` = PASS even after the pin; what reds is the count).
> - **Stripping `\r`** prevents a false **RED** on a legitimate CRLF checkout.
>
> Neither subsumes the other. My own framing at the time — *"without the ordering, stripping `\r` is a
> fix the next CRLF checkout can silently undo"* — had the shape wrong: with the pin in place a CRLF
> checkout makes the gate **loud**, not silent. The real cost of omitting the `\r` strip is a gate that
> reds on correct input until someone deletes it, taking the pin with it. **A gate that cries wolf is
> removed, and its true assertion dies with it** — which is a slower version of the same failure.
>
> **Control #162 was also INVALID as designed, and that is worth as much as the fix.** It specified
> CRLF-ifying `deprecated.snapshot.md` and claiming a uniform date. Applied, it red on the **digest
> lock** (`expected 5041 to be 5031`, `expected 41 to be +0`, plus a literal-content miss) — M26-5's
> assertions fire *before* the clock assertion is ever evaluated, so the mutation could not reach its
> own subject. A second flaw: only one of the two clock cells matched the replacement, because the real
> cell reads `Follows Sampling ([SEP-2577](…))` — a markdown link, not the bare prose assumed. **A
> control on a digest-locked file cannot test anything downstream of the digest**
> (`[[negative-control-validity-checklist]]`, question 2). Restated as a direct cross-product over the
> two filter functions with the locked file left byte-identical; restored and re-verified at
> `sha256 ef70b61f…`, 5031 bytes, 0 CR.
>
> **The recorded Location was also off by two.** It reads `:173`, `:192`; the separator filter was at
> `:175`. Small, and the reason it matters here: this row was read three times without anyone landing
> on the line, which is part of why the neighbouring assertion was never examined.

## M-OPEN-5 — the surface 2026-07-28 requires is not implemented, and each omission is gated

**Status:** OPEN **by design**. Measured 2026-08-09 against the M26-1 working tree (ADR 0063).
This is the deliberate residue of M26-1, not an oversight — the distinction is that every item
below is **asserted by a test**, so the batch that lands one must edit a named assertion.

| | |
| --- | --- |
| **Measured** | `grep -c 'nitialize'` over `third_party/mcp-spec/2026-07-28/schema.ts` → **0**; over `schema.json` → **0**; `grep -c '"ping"' schema.ts` → **0**; `changelog.snapshot.md` Major #2 and #5 |
| **Location** | `packages/calllint-mcp/src/server.ts` (the served method table); `SUPPORTED_PROTOCOL_VERSIONS` at `:26` |
| **Recorded in** | ADR 0063 §3.1 (the four omissions and what holds each line) |

M26-1 implemented **D1 and D3 only** — the per-request `_meta` version read and
`UnsupportedProtocolVersionError` (-32022). Three things a real adoption of 2026-07-28 needs are
therefore still absent:

| # | Absent | Upstream status | Owner |
| --- | --- | --- | --- |
| a | `server/discover` | **MUST implement** (`schema.ts:665`/`:678`/`:707`) | M26-2 (D4) |
| b | Removal of `initialize` / `notifications/initialized` / `ping` | deleted by SEP-2575 (stateless MCP) | unassigned |
| c | `2026-07-28` in `SUPPORTED_PROTOCOL_VERSIONS` | — | the batch that finishes a + b |

**Why none of this is a bug today.** The server advertises **2024-11-05**, whose wire shape
contains all three methods. Serving a method a *later* revision deleted is only wrong once you
claim that later revision. So (b) is not dead code — it is the current contract, and removing it
would be a public-surface break made for the sake of a revision we do not serve.

**The ordering is the finding, and it is not obvious from the delta matrix.** (a) must land
**before** (b): `server/discover` is what *replaces* the handshake. A batch that reads "2026-07-28
removes `initialize`" and removes it first leaves a client with no way to learn the server's
capabilities at all — strictly worse than the pre-batch state, and it would pass any test written
only about absence. Then (c) last, because (c) is the public claim and new17 §19 forbids it until
the surface exists.

**Shape of the fix — the assertions a later batch must deliberately edit.** Each was written to
red on exactly this change, so this list is the work order:

| To land | Assertion that must be changed | Where |
| --- | --- | --- |
| a | `expect(serverSource()).not.toContain('case "server/discover"')` | `tests/invariants/mcp-spec-vendor.invariants.test.ts` ("server/discover is NOT implemented here") |
| a | `server/discover` reds `-32601` | `packages/calllint-mcp/test/server.test.ts` ("server/discover is still absent") |
| b | `expect(ours).toContain('case "initialize":')` and `'case "ping":'` | `mcp-spec-vendor.invariants.test.ts` ("initialize and ping are REMOVED upstream") |
| b | `initialize` returns `protocolVersion` / `ping` replies `{}` | `server.test.ts` (two long-standing tests) |
| c | `expect(m![1]).not.toContain("2026-07-28")` | `mcp-spec-vendor.invariants.test.ts` ("2026-07-28 is absent from the supported set") |
| c | declaring `2026-07-28` must error; `PROTOCOL_VERSION` regex | `server.test.ts` ("no premature claim"), and the vendor gate's `2024-11-05` pin |

**One engineering fact worth not re-deriving.** The negotiation layer M26-1 shipped is
**version-agnostic**: it validates a declared version against a *set*
(`SUPPORTED_PROTOCOL_VERSIONS`), not against a hardcoded string. So (c) is genuinely a one-line
change to that array once (a) and (b) exist — no rework of the negotiation path, and no second
code path for the new revision. The cost of adoption lives entirely in the surface, which is why
M26-1 could be authorized separately at all.

**What would make this row false:** all three landing, at which point `PROTOCOL_VERSION` itself
becomes the open question and this row is replaced by an ADR, not by an amendment.

### M-OPEN-5, amended by M26-2 (2026-08-09) — (a) is LANDED; (b) and (c) are unchanged

*Appended, not rewritten. Everything above is retained verbatim: a deleted claim is
indistinguishable from a claim never made. Read this block as current where the two differ.*

**(a) is CLOSED.** `case "server/discover"` is served in
`packages/calllint-mcp/src/server.ts`, recorded in **ADR 0064**, and both assertions named in row
(a) of the work-order table above were **deliberately inverted** — they now assert the method is
present rather than absent, which is exactly what that table was written to force. The 7th stdio
request in `scripts/mcp-pack-smoke.mjs` proves it answers from the published tarball.

**(b) and (c) are untouched and still gated.** `initialize` / `notifications/initialized` / `ping`
stay served; `SUPPORTED_PROTOCOL_VERSIONS` stays `["2024-11-05"]`; `PROTOCOL_VERSION` stays
`2024-11-05`. Rows (b) and (c) of the work-order table remain the live work order, and their
assertions are unedited. The ordering finding above is what made this batch stop at (a).

**What M26-2 measured that this row did not know.** D4's own row in the delta matrix names two
fields; the digest-locked bytes require **five**. From `schema.json`'s `required` arrays:
`DiscoverResult` = `["cacheScope","capabilities","resultType","supportedVersions","ttlMs"]`, via
`CacheableResult` = `["cacheScope","resultType","ttlMs"]` and `Result` = `["resultType"]`. So three
obligations were invisible here:

| Newly measured | What it means | Where it is decided |
| --- | --- | --- |
| `resultType` | required on **every** result at 2026-07-28 (14 `$defs`), and an **open** type — `"complete" \| "input_required" \| string`, no `enum`/`const` in `schema.json` | ADR 0064 §4 — emitted on **discover only**, because 2024-11-05 *defines* its absence as `"complete"`; a gate asserts the other results still lack it |
| `ttlMs` + `cacheScope` | discover is a **cacheable** response; `cacheScope: "public"` would let an intermediary serve one capability list across authorization contexts | ADR 0064 §4 — `0` / `"private"`, the inert ends of both enums, chosen to decide nothing |
| `params._meta` requires **two** keys | `io.modelcontextprotocol/clientCapabilities` **and** `…/protocolVersion`; upstream: *"Servers MUST NOT infer capabilities from prior requests"* | ADR 0064 §5 — the second key is **read at all**, and that is recorded as a decision, not an omission |

**A fourth prose claim falsified by the M26-5 lock.** `changelog.snapshot.md:16` says discover
advertises versions, capabilities *"and identity"*. `DiscoverResult` has **no identity field** —
neither `serverInfo` nor any reference to `Implementation` appears in its `$defs` entry. Identity
lives in `_meta` on the **response**, as `ResultMetaObject["io.modelcontextprotocol/serverInfo"]?`
(`schema.ts:157`): optional, a **SHOULD**, and carrying its own *"SHOULD NOT rely on it for
security decisions"*. A reader implementing from that sentence would put `serverInfo` in the result
body, where the schema does not define it — so a gate asserts our discover arm has no such key.
This is the same failure mode as F4's section names, F7's source URL, and D1's `initialize`
premise: prose authored about a rendered page, which no gate could read back.

**Still open after M26-2, and belonging to whichever batch adopts the revision:**
`clientCapabilities` is required upstream and unread here (ADR 0064 §5 — rejecting its absence
would reject **every** request today's 2024-11-05 clients send); `resultType` must go on the other
eight results, deleting the assertion that currently forbids it; and `examples/*.json` remains
unvendored, so discover's three `{@includeCode}` payloads cannot be gated offline (ADR 0064 §6).

### M-OPEN-5, amended by M26-4 (2026-08-09) — (b) and (c) are LANDED, and the row's own cost estimate was wrong

*Appended, not rewritten. Everything above is retained verbatim. Read this block as current where
the two differ. This row's closing condition — "all three landing" — is now met, so per its own
**What would make this row false** it is replaced by an ADR: **ADR 0066**.*

**(b) is CLOSED, scoped to the revision that removes it.** `REMOVED_AT_STATELESS` holds **four**
members, not the three this row names: `initialize`, `notifications/initialized`, the bare
`initialized` alias, and `ping`. A request declaring `2026-07-28` gets `-32601` with the revision
named in the message; the same request declaring nothing, or declaring `2024-11-05`, is served
exactly as before. So the methods were not deleted — their availability became a function of the
declared revision.

**(c) is CLOSED.** `SUPPORTED_PROTOCOL_VERSIONS` is `[PROTOCOL_VERSION, STATELESS_PROTOCOL_VERSION]`
= `["2024-11-05", "2026-07-28"]`, and `server/discover` advertises exactly that. Both work-order
assertions for (c) were deliberately inverted, and every test that used `2026-07-28` as its
*unsupported* version moved to `1999-01-01` — a test still using it would have passed for the
opposite reason and read as green.

**The one engineering fact above is the one thing this row got wrong, and it was the load-bearing
one.** Verbatim: *"(c) is genuinely a one-line change to that array once (a) and (b) exist — no
rework of the negotiation path, and no second code path for the new revision."* Both halves are
false as executed:

| The row's claim | What M26-4 measured |
| --- | --- |
| "a one-line change to that array" | The array line is one line. It forced **13 conditional field emissions** across 5 result types, each derived from a `required` array in the locked schema, plus a removed-method guard placed *after* the version check so a mismatch is not misreported as a missing method. |
| "no second code path for the new revision" | There is one: `servedAt === STATELESS_PROTOCOL_VERSION` branches the envelope and the handshake. Every branch is asserted on **both** sides, because a one-sided assertion on a conditional emission passes when the condition never fires. |

**Why the row was wrong is more useful than that it was wrong.** The negotiation layer *is*
version-agnostic, exactly as recorded — validating against a set, not a string. That made the
row's author conclude the cost was in the surface only. The missed step is that *validating* a
version and *serving at* it are different jobs: the set decides admission, and nothing in M26-1
decided **shape**. The row measured the admission cost and called it the adoption cost.

**What the row's ordering finding got right, and kept.** (a) before (b) held, and it is why (b)
could be scoped rather than breaking: `server/discover` is reachable at **both** revisions with a
byte-identical body, so a client that loses the handshake at 2026-07-28 still has a way to learn
capabilities. Serving both revisions in parallel is what made (b) and (c) landable in one batch
without the public-surface break this row priced — the ordering constraint was satisfied, not
bypassed.

**Still open, unchanged by this batch:** `clientCapabilities` remains required upstream and unread
here — now for a sharper reason than before. At 2026-07-28 a strict read would be conformant, but
`RequestMetaObject.required` names **both** keys, so a client declaring only the version key would
be rejected; the version key is exactly what a client must send to reach the new revision at all.
Recorded in ADR 0066 §7, gated by `mcp-spec-vendor.invariants.test.ts:581`. `examples/*.json` is
still unvendored (ADR 0064 §6), and F5/F6 still rest on unvendored pages (M-OPEN-1).

### `clientCapabilities`, amended by M26-6 (2026-08-10) — CLOSED, and the reason above is refined

*Appended, not rewritten. Everything above is retained verbatim, including the sentence this block
refines. Read this block as current where the two differ.*

**CLOSED by ADR 0067.** Both required `_meta` keys are now read on every request at 2026-07-28.
`readClientCapabilities(req)` returns `{declared, capabilities}` and decides nothing: a request
omitting the key is served byte-identically to one declaring it, asserted as such.

**The reason recorded above is true and its framing is not.** The paragraph above argues that a
strict read would reject a client sending only the version key, and that the version key is exactly
what selects the new revision — both correct. The frame it builds on them is that conformance and
usability conflict here, so we decline to read the key. Reading further in the same digest-locked
schema removes the conflict:

| What the paragraph above rests on | What M26-6 measured in the same locked bytes |
| --- | --- |
| `RequestMetaObject.required` names **both** keys, so a strict read rejects the minimal request | True. But `required` governs the object's **shape**, not the consequence of a missing capability. |
| (not known when that paragraph was written) | `$defs.MissingRequiredClientCapabilityError` pins `error.code` to `const` **-32021** and **requires** `error.data.requiredCapabilities`. Verbatim: *"Returned when processing a request requires a capability the client did not declare in `clientCapabilities`."* An **on-demand** refusal, naming what the server needs. |
| (not known when that paragraph was written) | `ClientCapabilities.required` is **`null`**; all five members are optional, and *"an empty object means the client supports no optional capabilities."* |

So a tolerant read is **what upstream asks for**, not a deviation we are tolerating. And because no
CallLint tool needs a capability — the 13 tools read committed bytes, run deterministic rules, and
return a verdict — there is nothing this server could put in `requiredCapabilities`. **We can never
legitimately send -32021**, and that is now derived in a gate from `ClientCapabilities.required ===
null` rather than asserted in prose. Before this batch, `grep -rn "32021"` over `packages/ tests/
scripts/` returned **0 hits**: the error code upstream defines for this exact situation was
unmentioned anywhere in the repo, in either direction.

**Two properties gained a guard that had none.** Upstream's *"Servers MUST NOT infer capabilities
from prior requests"* was asserted only as **vendored text existing**; nothing checked our
compliance. There is now a gate that the reader is request-scoped and that no module-scope binding
is assigned from it — a capabilities cache returns a plausible value, so no behavioural test could
see it. Separately, `RequestMetaObject`'s `clientInfo` carries *"SHOULD NOT rely on it for security
decisions"*, which for a verdict engine is product principles 3/4/5 restated by upstream;
`server.ts` reads it zero times today and now a gate keeps it that way. Zero source change for that
one — it guards a property that is already true.

**A pointer in the paragraph above has already drifted.** It cites
`mcp-spec-vendor.invariants.test.ts:581`; that test is now at **`:599`**, moved by this batch's own
edits. The line number is not corrected above, per the append discipline — this is the second batch
in a row where a `path:line` pointer went stale inside the committed record, which is why the
artifact gate anchors pointers **by content** rather than by existence (ADR 0065; M26-4's own
pointer moved twice inside one batch).

**Still open, untouched by this batch, and each still needing its own authorization:**
`examples/*.json` remains unvendored (ADR 0064 §6); F5/F6 still rest on unvendored pages (M-OPEN-1);
`resultType` on the other eight results is unchanged; M-OPEN-3 and M-OPEN-4 are unedited. This
batch's scope was fixed at `clientCapabilities` alone.

---

## M-OPEN-6 — one amendment key in these artifacts is invisible to the reader that resolves them

**Status:** ~~OPEN~~ → **CLOSED** by M26-9 (ADR 0072). See the `closedByM26-9` note at the end of this
row; the original text below is preserved verbatim, including the census numbers that have since drifted.

Filed by M26-8 (ADR 0068 §5), which found it while closing M-OPEN-1 and deliberately
did **not** fix it — the fix changes how *every* field in both artifacts resolves.

| | |
| --- | --- |
| **Measured** | a recursive walk over both artifacts for keys matching `/M26-\d+/`: **20 occurrences / 10 distinct names** match `AMENDMENT_KEY`; **1 occurrence / 1 name** does not |
| **Location** | `tests/invariants/mcp-artifact-claims.invariants.test.ts` `AMENDMENT_KEY = /^(?:\w+A\|a)mendedByM26-/`; the unmatched key is `finality-status.json` `gates[7].closedByM26-5` (F8) |

The reader resolves an append-amended field by scanning for keys matching `AMENDMENT_KEY`. F8's
amendment is named **`closedByM26-5`**, not `amendedByM26-5`, so it matches neither the bare nor the
field-prefixed casing. Every other amendment in both files matches:

```
verdictAmendedByM26-5   amendedByM26-1   amendedByM26-2   amendedByM26-3   amendedByM26-4
amendedByM26-5          amendedByM26-6   amendedByM26-8   nonClaimsAmendedByM26-4
measuredThisBatchAmendedByM26-4                                    <- 10 matched
closedByM26-5                                                      <- 1 MISSED
```

**Why nothing is broken today.** F8's top-level `evidence.source` reads `"this repository"` and its
`observation` describes `b136f44`, where `third_party/` was absent. No assertion resolves F8 through
the chain, so the miss costs nothing *now*. The hazard is the ordinary one this file exists for: the
next batch that asserts over F8 will read its **superseded** observation — *"third_party/ measured
ABSENT"* — as current, and that sentence is false of every commit since M26-5.

**This is the same defect class M26-3 found in this very regex.** That batch's first draft matched only
`/AmendedByM26-/`, so all five `protocol-delta-matrix.json` lookups silently fell through to stale
top-level values **and reported success** (M-OPEN-2's closing note, finding 1). The pattern was widened
to two casings. It is now measurably three naming conventions, and the third was already in the file
when the second was added — so widening twice from examples has not converged. That is the argument
for the fix shape below being a *rule*, not a third alternation.

**Shape of the fix.** Do not add `closedBy` to the alternation. Instead:

1. Match the **batch suffix** — any key matching `/M26-\d+$/` whose value is an object — and treat it
   as an amendment regardless of its verb. The suffix is the part every convention shares.
2. Assert the **complement**: enumerate every key in both artifacts matching `/M26-\d+/` and assert
   that the set the resolver recognizes equals it. A resolver that recognizes *most* keys is exactly
   the failure this row records, and only a complement check can see it.
3. Then either rename `closedByM26-5` for consistency **or** leave it and let (1) cover it — but
   renaming is an edit to an append-only record, so (1) is preferred.

**Why M26-8 did not do it.** Widening `AMENDMENT_KEY` changes resolution for **every** field in both
artifacts, including the five `protocol-delta-matrix.json` lookups and the `supersededBy` helper. That
needs its own before/after measurement of what each field resolves to, which is a batch, not a
line — and M26-8's authorized scope was M-OPEN-1 half 1 plus M-OPEN-4.

**What would make this row false:** a resolver keyed on the batch suffix, plus a complement assertion
that no `/M26-\d+/` key in either artifact is unrecognized. Either alone is insufficient: a widened
pattern with no complement check is the same guess that has now been made twice.

### closedByM26-9 — 2026-08-11, M26-9 (ADR 0072)

**Status: CLOSED**, by this row's own falsification condition and by both halves of it. `AMENDMENT_KEY`
is now `/M26-\d+$/` with an object-valued guard (fix shape 1), and
`amendmentKeysCoverEveryBatchKey` asserts the complement as the **set of unrecognized names** (fix
shape 2). Control **#195** reverts the constant to the old prefix rule and the complement reds naming
`closedByM26-5` — the defect this row records, reproducible on demand. Fix shape 3 chose **(1) over
renaming**, as this row preferred: renaming is an edit to an append-only record.

**M26-8's deferral is discharged, and the answer is narrower than it expected.** The before/after
measurement it required — every field of every amended object, resolved under both rules — is:

```
objects carrying amendments: 14      fields compared: 159      DIFFERING: 6
```

All six are `finality-status.json` `gates[7].*` (F8): `status`, `vendored`, `gate`, `inv-M4`,
`whatChangedForF1-F7`, `whatItCaughtImmediately`. Five were `<ABSENT>` under the old rule (the field
exists only inside the amendment block); one is a real stale-value substitution — `status` was `"PASS"`
and now resolves via `closedByM26-5` to prose beginning `"PASS as of 2026-08-09…"`. **Outside F8,
nothing moved:** the five `protocol-delta-matrix.json` lookups and `supersededBy` resolve byte-for-byte
as before. That is the safety result M26-8 wanted, and it is why this was a batch rather than a line —
the measurement, not the edit, was the work.

**One number in this row was already stale, and the correction matters more than the digits.** It
records 20 occurrences / 10 distinct names + 1 miss; today it is **21 / 11** + the same 1 miss, because
M26-8 added `amendedByM26-8` while filing this row. The diagnosis did not rot; the census did. A census
written into prose is a snapshot, so the gate now pins `census.size >= 11` rather than trusting this
paragraph.

**Two things measured while implementing that this row did not anticipate.**

1. **A scalar-valued batch key already exists.** `protocol-delta-matrix.json`
   `summary.amendedByM26-1.statusAfterThisBatch.amendedByM26-2` is a **string** — an inline note among
   a map of D-row statuses. The old prefix regex matched it too and `asBlock` dropped it silently, so
   the object guard in fix shape 1 is load-bearing on today's bytes rather than a precaution: without
   it that key would enter the *recognized* set unusable, and the complement assertion would report a
   coverage it does not have. It is excluded by name, not by count, so a second one has to be justified
   at the assertion.
2. **The complement's census must be keyed more loosely than the resolver.** Written as `/M26-\d+/` —
   this row's own wording — the census cannot fail: control **#191** renames `closedByM26-5` to
   `closedAtStageM26x5`, which drops the suffix, so census and recognized set shrink **together** and
   the check passes while the resolver goes blind. The census is therefore `/M26/i`, the widest pattern
   that still means "this key names a batch". Measured over today's bytes it yields exactly the 11 real
   names and zero noise, so the looseness costs nothing. **A complement check keyed on the same
   predicate as the thing it audits is not a complement check.**

**What this batch did *not* fix, deliberately.** `tests/invariants/mcp-artifact-claims.invariants.test.ts`
`:358` still reads the **raw** `status` when asserting all eight gates pass, and that is correct: F8's
top-level `status` **is** `"PASS"`, and its amendment dates the observation rather than revoking the
verdict. Routed through the resolver, `!== "PASS"` would be true and a correct assertion would report
F8 as failing. Both readings are now pinned side by side (control **#193** reds the resolver arm while
the eight-gate filter stays green; **#194** reds the filter alone), so an edit that "helpfully" unifies
them fails against a message saying why. **A strictly more correct resolution can make a correct
assertion wrong — that is not a reason to keep the wrong resolver, but it is a reason to pin the
distinction.**

**This row's own "why nothing is broken today" still holds, and it is why the value here is
prospective.** No assertion resolved F8 through the chain before this batch, so nothing was silently
wrong. What changes is that the next batch to assert over F8 reads its **current** observation instead
of *"third_party/ measured ABSENT"*, a sentence false of every commit since M26-5.

---

## Not open — closed items recorded so they are not re-analyzed

| item | state | where it is recorded |
| --- | --- | --- |
| ADR 0061 §8.5's cwd-asymmetry prose amendment | **CLOSED** — folded into **§8.5.1** | `adrs/0061-…md` §8.5.1. The `docs/` copy is a stale duplicate. |
| The R-9 daily backup (destination / window / credential) | **CLOSED** | ADR 0061 **§8.6** |
| A restore has never been exercised | **OPEN, but already recorded** | ADR 0061 §8.6 "What §8.6 still does not deliver" — needs host access and somewhere to restore *to*; not a code change |
| F8 (vendored bytes absent) | **CLOSED** by M26-5 | `finality-status.json` F8 `closedByM26-5` |
| ADR number collision (0062) | **CLOSED** | consumed by the T0 landing decision; M26-1 uses **0063**; 0060 stays reserved |
| D1's "`initialize`-only negotiation" premise | **REFUTED, and amended in place** | `protocol-delta-matrix.json` D1 `amendedByM26-1`; ADR 0063 §2. 2026-07-28 **deletes** `initialize`; it does not demote it. |
| D1 / D3 (per-request version + -32022) | **CLOSED** by M26-1 | ADR 0063; gated two-sidedly in `mcp-spec-vendor.invariants.test.ts` |
| D4 (`server/discover`) / M-OPEN-5 item (a) | **CLOSED** by M26-2 | ADR 0064; `protocol-delta-matrix.json` D4 `amendedByM26-2`; M-OPEN-5's own amendment above. D4's row understated the obligation by **four** fields — see that amendment before re-reading the row. |
| "all three deltas blocked by F8" | **SPENT** | `protocol-delta-matrix.json` `summary.amendedByM26-1` — F8 is PASS, so the blocker named in `allBlockedBy` is no longer live |
| M-OPEN-5 items (b) + (c) | **CLOSED** by M26-4 | ADR 0066; M-OPEN-5's `amendedByM26-4` block above. The row's "(c) is a one-line change" estimate is the one thing it got wrong — read that amendment before re-costing anything from this row. |
| `clientCapabilities` required upstream and unread | **CLOSED** by M26-6 | ADR 0067; the `amendedByM26-6` block above. Read tolerantly on every request, decides nothing. The earlier reason ("both keys required, so a strict read rejects the minimal request") is **refined**, not reversed: `-32021` is an on-demand error, so tolerance is upstream's design. |
| Whether this server may ever send `-32021` | **DECIDED: no** | ADR 0067 §3. Derived, not chosen — `ClientCapabilities.required` is `null` and no CallLint tool needs a capability, so `requiredCapabilities` would have nothing to name. A gate asserts `server.ts` does not contain the code. |
| M-OPEN-1 **half 1** (F5/F6 gate-backed) | **CLOSED** by M26-8 | ADR 0068; M-OPEN-1's closing note above. Half 1's literal instruction (*"change* F5/F6's `evidence.source`") was **unfollowable** — that would overwrite an append-only field. Moved by amendment instead. Half 2 (vendoring for auth) is **not** carried: it needs a claim CallLint makes. |
| M-OPEN-4 (the `\r`-blind row filter) | **CLOSED** by M26-8 | ADR 0068 §4; M-OPEN-4's closing note above. **Its "cosmetic" premise is falsified** — the inflated row count made F7's removal-clock inequality *unfalsifiable* on a CRLF checkout. Read that note before believing any "message-quality only" assessment in this file. |
| M-OPEN-6 (the invisible amendment key) | **CLOSED** by M26-9 | ADR 0072; M-OPEN-6's `closedByM26-9` note above. The resolver is keyed on the batch **suffix** with an object-valued guard, and the complement is asserted as a set of names. Two things worth reading before touching this resolver: a **scalar-valued** batch key already exists (so the object guard is load-bearing today), and the complement's census is `/M26/i` on purpose — keyed on `/M26-\d+/` it **cannot fail**. The before/after is **6 of 159 fields, all on F8**; `:358` still reads the raw `status` deliberately. |
| The superseded top-level-URL guard on F5/F6 | **REPLACED** by M26-8 | M-OPEN-1's closing note. It could only red on the action M-OPEN-2 **forbids** (overwriting the top level) and was blind to the authorized amendment. General form: on an append-only record, a top-level-bound guard measures whether history was destroyed, not whether the claim advanced. |
