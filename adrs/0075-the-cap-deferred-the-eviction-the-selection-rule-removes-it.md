# ADR 0075 — The cap deferred the eviction; the selection rule removes it

- **Status:** Accepted
- **Date:** 2026-08-12
- **Workstream:** S (adoption-index guards / Gate S0 ledger)
- **Batch:** S batch 6
- **Supersedes:** nothing. **Amends:** ADR 0074 §11 (its "this workstream does not touch
  `packages/adoption-index/**`" framing — see §2), and `artifacts/gate-s0/open-items.md` S0-OPEN-4 by
  **append**.
- **Closes:** nothing on the S0 ledger. S0-OPEN-4 stays **OPEN**, and §8 is why — but for the first
  time the reason is not a defect in the code.
- **Leaves open:** S0-OPEN-1, S0-OPEN-4 (observation clause only), M-OPEN-1 (half 2), M-OPEN-3.
- **Authorizes:** the **third** S0-OPEN-4 remedy — "replace alphabetical slicing with a considered
  selection", which that row has called *"the honest fix, and the largest"* since it was filed.

## §1 Numbering: 0075, and 0060 remains reserved

`ls adrs/` tops out at `0074`. `0060` is **still unoccupied and still reserved** — the reservation has
a live reader, `artifacts/phase-2.4/presentation-lock`'s sibling audit at
`artifacts/phase-2.4/presentation-plane-audit.json:135`, whose `$comment` states verbatim that the
`propertyNames` defect *"is RECORDED, NOT FIXED by PR P-5 — that is a schema change requiring an ADR,
and ADR 0060 is reserved for it."* Re-measured for this batch by listing the directory, not by
trusting the previous batch's note.

## §2 The decision

Replace the bare alphabetical cap with a **reserved-first selection**, at both sites that implement it:

```ts
export const RESERVED_COHORT_NAMES: readonly string[] = ["io.github.calllint/calllint"]

export function selectCohortEntries<T extends { readonly name: string }>(entries: readonly T[], max: number): T[] {
  const byName = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (byName.length <= max) return byName
  const isReserved = (e: T): boolean => RESERVED_COHORT_NAMES.includes(e.name)
  const reserved = byName.filter(isReserved).slice(0, max)
  const rest = byName.filter((e) => !isReserved(e)).slice(0, Math.max(0, max - reserved.length))
  return [...reserved, ...rest].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
```

Quoted in full rather than elided, because "the shipped comparator, character for character" is a claim
a reader should be able to check against the two files without taking my word for it. The comparator is
`<`/`>` on the raw string and never `localeCompare`, which would make the committed bytes
locale-dependent. Both copies were measured **token-identical with comments stripped** — 10 lines, 574
normalized characters, byte-equal on both sides.

Four clauses, each asserted rather than described:

1. the output is in **name order** — reserved-first is an internal step, not an output property;
2. the cap is an **absolute ceiling**: `length === min(entries.length, max)`, so a reserved name takes
   a slot and never an extra one;
3. every reserved name present in the input is retained whenever `max >= 1`;
4. when the cap does not bind, the function **is** the old bare sort.

Clause 4 is why this batch cannot move a byte of the committed snapshot: today's cohort is 19 against a
cap of 100, so the early return fires and the reserved branch never executes. That is **structural, not
coincidental** — which is a claim worth distinguishing, because a byte-identical artifact usually means
a test did not reach the change, and here it means the change provably has no effect at this input.

**This ADR also amends ADR 0074 §11.** That section left `snapshotProjection.ts`'s docblock stale and
justified it as *"that file is `packages/adoption-index/**`, which this workstream does not touch."*
That was a true statement of S batch 5's **scope choice** and a misleading statement of the
**constraint**: the standing prohibition on `packages/adoption-index/**` binds workstreams **M and T**,
not S. This remedy is inherently in that package — the projection *is* the served cohort's cap — and the
authorization covers it. §11's stale docblock is therefore now **corrected rather than inherited**: had
it been left, the next reader would have read a deliberate choice where the reason for it had expired.

## §3 What ADR 0074 bought, and what it did not

ADR 0074 raised `DEFAULT_MAX_ENTRIES` from 25 to 100 and left `S0_REQUIRED_RECORDS` at 25, dissolving
the coincidence that closing Gate S0's shortfall was the same action as deleting this project's own
trust page. That was correct and it was not sufficient:

```
cap    subject evicted at cohort
25     26
100    101
500    501
```

Measured through the real `projectSnapshot`, not a reimplementation. The slice stayed alphabetical,
upstream keys are reverse-DNS, and `io.github.calllint/calllint` is the **only** `io.*` name in the
cohort — so it sorts last and is the **first** entry any cap reaches. **The cap is a parameter of the
hazard, not a fix for it.** ADR 0074 said this itself; this batch acts on it.

The general shape: *when the failure boundary is a function of a constant, moving the constant relocates
the boundary and preserves the function.* Only changing the function removes it.

## §4 Why the key is the registry name and never the slug

`registryCanonicalName` lowercases and maps every `[^a-z0-9._-]` run to `-`. Measured collisions onto
the single slug `mcp-registry/io.github.calllint-calllint`:

```
io.github.calllint/calllint      ← the real name
io.github.calllint-calllint      ← already a slug-shaped name upstream could publish
IO.GITHUB.CALLLINT/CALLLINT
io.github.calllint/CALLLINT
```

`-` is 45 and `/` is 47, so the first impostor sorts **before** the real name. A reserved list keyed on
the slug would exempt whichever of the four arrived, and an attacker chooses which. Exact equality over
the original reverse-DNS name is the only unimpersonable form, and it is the same defence
`namespaceCovers` (`claim.ts:166-174`) already applies to claim scopes — reused rather than reinvented.
Its docblock states the identical reasoning for its own case: *"EXACT SEGMENT EQUALITY on the
reverse-DNS namespace — deliberately NOT a string prefix … a raw `startsWith` would let
`io.github.calllint` wrongly cover a foreign `io.github.calllint-evil/*`"* — a privilege escalation
through a lossy key, which is this section's hazard with the lossiness moved from the matcher to the
normalizer.

## §5 Why the list is a static constant, when an active claim exists

The obvious source for "names this project claims about itself" is the claim store, and an **active,
verified** claim for exactly this subject is in it (§7). It still cannot be the source.
`refreshFromMirror.ts:290-296` records the constraint: feeding any part of resolved identity into
`projectSnapshot`'s input — filtering `records` by resolved subject, say — breaks the byte gate, because
the projection must remain a function of `records` alone for a fresh render to reproduce committed
bytes. So the reserved set is an in-code constant, and its relationship to the claim store is asserted
in prose and tests rather than by a lookup.

This is a real limitation, stated rather than hidden: **the reserved list will not follow the claim
store.** A revoked claim leaves the name reserved. The mitigation is that the list is one entry, is
declared at the ingestion edge with its rationale, and is read by three guards.

## §6 Why the rule is duplicated rather than imported

`trust-index` depends on `adoption-index`; `adoption-index` has **zero** imports of `trust-index`, and
the import-boundary gate keeps it that way (recorded at `snapshotProjection.ts:27-32`, and restated for
this rule specifically at `:116-121`) because the shipped bundles must stay free of the native SQLite
driver. So there is no direction in which this rule can be shared, and it exists **twice, verbatim**.

Duplication is a drift surface, so the equivalence is asserted **behaviourally, not structurally**:
`packages/adoption-index/test/snapshot-projection.test.ts` drives one raw registry body through both
paths and byte-compares the results, now including a case where **the cap binds AND a reserved name
would have been evicted**. A shared type or a copied constant would not catch a different comparator, a
different cap order, or a `null` where the other writes `""`; byte equality does.

That case had to be written, and the reason is the finding in §9.2.

Byte-equivalence is necessary and **not sufficient**, and the controls measured exactly where it stops.
Reverting `selectCohortEntries` to a bare alphabetical slice in **one file at a time** gives different
answers per file:

| control | reverted in | `registry-cohort-retention` | `snapshot-projection` |
|---|---|---|---|
| #210 | `trust-index/src/fetchRegistry.ts` | **green** | red 2 |
| #211 | `adoption-index/src/projections/snapshotProjection.ts` | red 3 | red 1 |

`registry-cohort-retention.invariants.test.ts` imports `projectSnapshot` from `@calllint/adoption-index`.
It is the file whose *name* claims to guard cohort retention and it **cannot observe a regression in the
ingest edge at all** — the one path that actually runs in the scheduled workflow. What caught #210 was
the byte comparison, and it caught it as a *divergence between copies* rather than as "the ingest edge
lost the rule". That is a weaker diagnosis of a more serious fault, and it is the argument for keeping
both suites rather than treating either as the guard.

Control #213 is the complement and bounds the other side: adding a name to **one** list only left the
byte comparison **green** (the fixture body held no such name, so both sides behaved identically) and
red only the direct `expect(RESERVED_COHORT_NAMES).toEqual([...SHIPPED_RESERVED_COHORT_NAMES])`.
Divergence in *membership* is invisible to a byte comparison whose fixtures never contain the diverging
member — §9.2's vacuity, one level up. With a rule duplicated across a boundary, "is the rule tested?"
is the wrong question: **each copy needs a reader**, and equivalence between copies is orthogonal to
either copy being right. Two identical wrong copies agree perfectly.

## §7 Three censuses corrected, two of them this row's own

S0-OPEN-4 has carried, since it was filed, the sentence *"**No second copy exists.**
`claims/claim-store.json` has 2 keys, none matching; `snapshots/adoption-index.json` has 0 subjects.
The served snapshot is its only home."* **Every clause is false**, and both halves failed the same way
— the probe read a field name that does not exist:

| clause | measured at `packages/trust-index/` |
|---|---|
| claim store "2 keys, none matching" | the 2 keys are top-level `schema` + `records`; `records` holds **2 claim records, BOTH** for this subject — one `revoked` (`installationId` 147742681), one **`active`** (148693982, `verifiedAt` 2026-07-24T09:44:55.534Z) |
| adoption-index "0 subjects" | the field is `entries`, not `subjects` — **19** of them, one being this subject (`identityStatus: PROVISIONAL`) |
| "the served snapshot is its only home" | **refuted** — three copies exist |

The third correction runs the **other** direction, and is the more interesting one. S0-OPEN-4 recorded
**three** `presentation-lock.json` references; the guard's docblock recorded **two**. The row was right,
and both counts were built by searching **one key form**:

```
contentPlane.overriddenSlots[34]   overrides.resources.mcp-registry__io.github.calllint-calllint.displayName
contentPlane.overriddenSlots[35]   overrides.resources.mcp-registry__io.github.calllint-calllint.reason
semanticContract.resources[18]     canonicalSlug = "mcp-registry/io.github.calllint-calllint"
```

The first two key the subject as a **flat dotted path with `__` where the slug has `/`**; only the third
holds the slug verbatim. Exact-string search for the slug returns 1. Search for the `__` form returns 2.
**A census inherits the blind spots of its key form** — the same failure as
[[assert-which-source-answered]], and the third time in this workstream that a number was wrong while
its conclusion stood. The conclusion standing is precisely why nobody checked: `resources[18]` is also
the subject's own last index in the cohort, because the lock's resource list is in cohort order, so the
eviction boundary and the lock's tail were always the same boundary.

The served-index half was re-measured and **is correct**: exactly one row, `status: "baked"`,
`verdict: "SAFE"`, at **index 18 of the 19-row `mcp-registry` cohort** — last, which is the ordering
fact the entire row rests on.

## §8 Why S0-OPEN-4 stays OPEN, and why that is now a different kind of open

Its closing condition is a cohort at ≥26 **on `main`** with the served page still present. Today's
`main` carries 19. Reaching ≥26 needs an **ingest run** — a network action on the sole scanner, with its
own authorization, explicitly declined for this batch.

What changed is the *character* of the remaining gap. Before ADR 0074 the condition was
**unsatisfiable**: any cohort ≥26 evicted the page by construction. ADR 0074 made it **reachable**
within a 76-size window. This batch makes it **unconditional** — the outcome no longer depends on where
the cap sits relative to the cohort. Every remedy the row named has landed; what remains is an
observation, not a fix.

## §9 Three findings the edit produced

### 9.1 Survival is the wrong probe for "was exempted"

My first impostor test asserted that `IO.GITHUB.CALLLINT/CALLLINT` gets no exemption by checking that
it does **not** survive the cap. It survived, and the implementation was right — my probe was wrong.
Uppercase `I` is 73, lowercase `a` is 97, so that name sorts before the entire `ai.*`/`ac.*` filler
block and **enters the alphabetical prefix on its own merits**. Survival cannot distinguish "was
exempted" from "was already inside the prefix."

The fix was to probe `RESERVED_COHORT_NAMES.includes()` **directly** for all three impostors, and to
restrict the survival probe to the two that sort past the filler. Generalized:
[[probe-agrees-with-the-description-not-the-claim]] — **when an effect has two possible causes, an
assertion on the effect names neither.** Assert the mechanism.

### 9.2 A fixture corpus that avoids the real key space cannot exercise a rule keyed on it

Every fixture in the byte-equivalence suite is `io.example/*`. The reserved list holds one `io.github.*`
name. So the reserved branch **never executed on either side**, and the two duplicated implementations
would have agreed by never running the new code — nine byte-identical assertions, all vacuous with
respect to the change they were supposed to protect. The suite was green before the feature existed and
green after; it could not tell the difference.

Closed with a case whose payload includes the reserved name at `maxEntries: 2`, plus a direct
`toEqual([...SHIPPED_RESERVED_COHORT_NAMES])` — because a byte match at cap 2 would still pass if
**both** sides dropped a second reserved name that only one of them knew about.

### 9.3 An interval endpoint can be set by a mechanism that later disappears

The retention guard asserted that the sizes satisfying *both* "gate MET" and "self present" form the
interval `[required, cap]`. The **upper** endpoint was set **by eviction**. With retention, nothing
closes the interval at all — every size from `required` upward satisfies both — so the observed top is
now the scan bound's own last step (`25..102` as scanned).

Asserting `cap` would have pinned a **vanished mechanism** and re-red on the next cap change for no
reason. The endpoint is now derived from the scan bound, with a **contiguity** assertion
(`both.length === span`) so that "unbounded within the scan" is a claim rather than an artifact of where
the loop stopped, and a guard that the scan reaches past the cap. Related but distinct from
[[derived-bound-reports-where-the-interval-stopped]]: there the bound was accidentally correct; here it
was correct **for a reason that stopped being true.**

## §10 A fourth finding, from the artifact rather than the code

Appending the amendment to S0-OPEN-4 red `gate-s0-claims.invariants.test.ts` at **index 4** — the same
index S batch 3 red, for an entirely different reason. My amendment opened with its own `**Status:**`
marker, so the extractor found **six** markers across five rows and the sixth displaced the fifth row's
status. The positional literal named the row immediately; a `.filter(s => s === "OPEN").length` form
would have printed `expected 2 to be 3`.

`**Status:**` is a **per-row token**. An amendment that reuses it makes the artifact claim a row it does
not have. Fixed in the prose, not in the assertion — the assertion was right.

## §10.5 A fifth finding, from a negative control that stayed green

Control #214 deleted `Math.max(0, …)` from **both** copies of `selectCohortEntries` and **17 of 17
cases passed**. A green negative control is a finding, so the clamp's reachability was probed rather
than assumed:

```
max=-2  reserved.length=0  budget=-2  clamped=[]     unclamped=[a]     DIFFERS
max=-1  reserved.length=0  budget=-1  clamped=[]     unclamped=[a,b]   DIFFERS
max= 0  reserved.length=0  budget= 0  clamped=[]     unclamped=[]      SAME
max= 1  reserved.length=1  budget= 0  clamped=[d]    unclamped=[d]     SAME
max= 2  reserved.length=1  budget= 1  clamped=[a,d]  unclamped=[a,d]   SAME
```

Two things fell out, and the second one **corrected this batch's own prose**:

1. **No case fed a negative `max`**, so the clamp rested entirely on a comment — the shape §12's
   lesson applies to constants, applied here to a guard clause.
2. **Both comments named a precondition that cannot occur.** They said the risk was
   `max - reserved.length` going negative. It cannot for any `max >= 0`: `reserved` is itself
   `.slice(0, max)`, so `reserved.length <= max`, and at `max === 0` the budget is exactly 0. The
   clamp is reachable **only for a negative `max`**, and unclamped it fails *backwards* —
   `slice(0, -1)` means "all but the last", so the more negative the ceiling, the **more** the
   function admits. Measured on a 219-name cohort: unclamped `max === -1` emitted **217** entries.

Closed by asserting over `[-1, -2, -19, -1000]` at sizes where the cap **binds** (the early exit
`byName.length <= max` is unreachable for a negative max, so the partition is the code under test),
with `max === 0` as a separate clause — there the cap outranks the reservation and the claimed
subject is absent *even though it is reserved*, which is the one place §2's ceiling rule and this
document's retention rule point opposite ways. Re-running #214 then red with the leaked entry list
quoted. Both comments were rewritten to the measured precondition.

The generalizable half: a defensive clamp is the easiest thing in a codebase to justify in prose and
the hardest to reach from a fixture, so it accumulates confident, wrong explanations. **The wrong
explanation is worse than the missing test**, because the next reader reasons from it.

## §11 The pointer, retired rather than renumbered

`gate-s0-claims.invariants.test.ts` pinned `fetchRegistry.ts:124` containing `.slice(0, max)` — "the cap
applied after the sort", the last hop of the chain `map → filter → sort → slice`. That **chain** no
longer exists: the cap moved inside `selectCohortEntries` and the ingest edge now calls it. The anchor is
retired with a comment recording what it read, and replaced by three content anchors (the reserved list,
the selection function, its call site) plus one that merely drifted (`doFetch(endpoint)`, 115 → 177 → **183**).

That last arrow moved **twice inside this batch**, and the second move was self-inflicted: §10.5's
comment correction added six lines above the anchors, pushing `doFetch(endpoint)` 177 → 183 and the
call site 182 → 188. It surfaced from an unrelated control (#216 flipped a status line in
`open-items.md`) whose rollback was md5-verified — so the still-red assertion could not be residue,
and the only remaining explanation was a real drift I had introduced myself. **A pointer's most likely
mover is the batch currently editing the file, not a future one.**

The distinction matters, and I got it wrong once while writing this: `.slice(0, max)` **is still in the
file**, at `:90`, inside the new function. What changed is what it slices — `byName.filter(isReserved)`
rather than the whole sorted cohort. A pointer retired for "the string is gone" would have been a false
statement about a string that a `grep` still finds; retired for "the *claim* it anchored is no longer
what that line says" is the accurate reason, and it is the reason a **content**-matching pointer catches
this at all.

This is the **fifth consecutive batch** to move a pointer in that test, and every one was caught because
`assertPointer` matches line **content**: it failed with `but that line reads "      }"` rather than
passing on a line that still exists. A line-number-only pointer would have gone green on a closing
brace.

## §12 The general lesson

**A remedy that parameterizes a hazard reads like a fix and behaves like a delay.** Raising the cap
changed every number in the eviction table and none of its structure, because the boundary was
`cap + 1` — a function of the constant, not a property of the data. The table looked completely
different after ADR 0074 and described exactly the same defect.

The test for whether a remedy removes a hazard or moves it: **vary the parameter and re-measure.** Three
caps, three boundaries, same shape ⇒ the parameter was never the problem. That measurement cost one
`node -e` and is the only reason this batch exists rather than a fourth cap raise.

## §13 Scope: what this batch did not touch

Zero verdict movement · zero schema change · zero served bytes under `apps/web/public/**` · MCP stays
13 tools / 19 resources · `packages/calllint-mcp` runtime `dependencies` stays `{}` · `docs/` tracked
files stay 0 · `WiredCheck` shape unchanged · `scripts/gate-s0.ts` unchanged ·
`S0_REQUIRED_RECORDS` and `DEFAULT_MAX_ENTRIES` **both unchanged** · **PR #234 untouched** ·
S0-OPEN-1 and M-OPEN-1/3 untouched · **no ingest run, no network action**.

`packages/adoption-index/**` **is** touched, deliberately and for the first time in workstream S — §2
is the argument for why that is in scope rather than a violation.
