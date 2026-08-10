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

---

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
