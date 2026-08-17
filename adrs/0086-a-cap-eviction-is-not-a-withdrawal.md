# ADR 0086 — a cap eviction is not a withdrawal, and the ceiling that could not see one

- **Status:** Accepted
- **Date:** 2026-08-17
- **Relates to:** ADR 0074 (the alphabetical cap), ADR 0075 (reserved cohort names), ADR 0082
  (a refusal must not read as a pass), ADR 0084 (a count cannot witness a substitution),
  ADR 0085 (a version bump is not a de-listing — D2's four departure classes).
- **Acknowledges:** the 13 `ai.b77/*` departures of the 2026-08-17 registry refresh, under D2's
  `evicted` class. See §4.

## Context

The 2026-08-17 registry ingestion moved the cohort from revision `a3b78766` to a new snapshot.
The count went **100 → 100**. Underneath it, **13 subjects left and 13 arrived**. This is precisely
the substitution ADR 0084 exists to catch: the ratchet floor is 100, the count is 100, and a
magnitude check is structurally blind to it.

ADR 0084's identity witness saw the departure and reported it. ADR 0085 D2 then classified it. This
ADR records two things that classification surfaced:

1. **What actually happened to the 13 subjects** — measured against the source, not inferred.
2. **A defect in the classifier's ceiling test**, found while acknowledging them, which made the
   `evicted` class unreachable on the real cohort.

## What was measured

### 1. The 13 subjects are all live upstream

Queried `registry.modelcontextprotocol.io/v0/servers?search=<name>` for each departed subject,
matching exactly on `server.name` (a search hit is not an identity — see §3 for why this
qualification is load-bearing):

| subject | version | `status` | `isLatest` |
|---|---|---|---|
| `ai.b77/feedback` | 1.0.0 | `active` | true |
| `ai.b77/fibalo` | 1.0.0 | `active` | true |
| `ai.b77/file-storage` | 1.0.0 | `active` | true |
| `ai.b77/google-ads` | 1.0.0 | `active` | true |
| `ai.b77/google-news` | 1.0.0 | `active` | true |
| `ai.b77/google-search-console` | 1.0.0 | `active` | true |
| `ai.b77/kinnovis-storage` | 1.0.0 | `active` | true |
| `ai.b77/knowledge-base` | 1.0.0 | `active` | true |
| `ai.b77/nightscout` | 1.0.0 | `active` | true |
| `ai.b77/seo-content-factory` | 1.0.0 | `active` | true |
| `ai.b77/teamwork` | 1.0.0 | `active` | true |
| `ai.b77/time` | 1.0.0 | `active` | true |
| `ai.b77/web-analytics` | 1.0.0 | `active` | true |

**13 of 13 `active` and `isLatest`.** No publisher withdrew anything.

### 2. The cause, from committed bytes

The cohort is an alphabetical top-100 window (ADR 0074). The 13 arrivals all sort *before*
`ai.b77`: `ac.*`, `agency.*`, `ai.ad*`, `ai.ae*`, `ai.ag*`, `ai.an*`, `ai.au*`, `ai.aw*`. They
displaced the 13 tail-most `ai.b77` entries. The publisher went **16 → 3** subjects in the cohort,
and the 3 survivors are exactly the alphabetically-first three.

This is an **ordinary capped eviction**: our window moved, the registry did not shrink. Both halves
of D2's `evicted` class are established — the subject sorts past the window edge (bytes) *and* it is
live upstream (source).

### 3. A near-miss worth recording: the absence I nearly published

My first pass at §1 reported **all 13 as absent from the registry**. That result was a defect in my
own probe: a shell loop passed the subject name as an argument that `tsx -e` never received, so
every comparison ran against the literal string `ai.b77/undefined` and every lookup missed.

Had it reached this document, it would have accused thirteen third parties of withdrawing servers
they had in fact published — *by the same mechanism ADR 0085 was written about*: a confident claim
about a cause, manufactured by a wrong key form. ADR 0085 §1 corrected one such accusation; this
would have added thirteen.

It was caught by re-measuring rather than by review, which is the only reason it is a footnote
instead of a correction ADR. The rule it argues for is already in the corpus
(`a-census-inherits-its-key-form-blind-spots`); this is its second confirmed instance in one
investigation.

## The defect: a ceiling measured against a name that never competed

`classifyDeparture` (`scripts/cohort-identity.ts`) chose between `evicted` and `superseded` using:

```ts
const maxServed = currentNames.length > 0 ? [...currentNames].sort().at(-1)! : null
const beyondCeiling = maxServed !== null && name > maxServed
```

ADR 0075 admits `RESERVED_COHORT_NAMES` — currently `io.github.calllint/calllint` — **regardless of
where they sort**. A reserved name takes a slot rather than an extra one, but it does not compete
for one. On the real cohort it is `sorted.at(-1)` of 100.

So `maxServed` was the reserved self-name, and `beyondCeiling` was **false for every subject from
`a*` through `i*`** — which is nearly the whole window. The true edge is `sorted.at(-2)` =
`ai.b77/chess-results`, and all 13 departures sort past it.

### Why this matters more than a wrong label

`beyondCeiling` is not cosmetic. With a source view saying the subject is live, the two branches are:

- `beyondCeiling` → **`evicted`** — *our ceiling* removed it. Not a withdrawal, nobody's fault.
- otherwise → **`superseded`** — per that class's own text, *"a BUG IN THIS SYSTEM, not an act by
  the publisher"*, and the class ADR 0085 D1 removed the mechanism for.

All 13 evictions would have been reported as `superseded`: a self-accusation of a regression that had
not occurred, escalated by the renderer as `DEFECT IN THIS SYSTEM`. The `evicted` class was
**unreachable** for any name sorting before the reserved one.

The failure direction was conservative — it never produced a false *de-listing*, so no third party
was ever going to be libelled by it — which is why it survived unnoticed through ADR 0085's review.
A guard that fails safe is still broken; it just does not announce itself.

## Decision

**D1 — the ceiling is measured against the last name that COMPETED for a slot.**

```ts
const competing = currentNames.filter((n) => !RESERVED_COHORT_NAMES.includes(n))
const maxServed = competing.length > 0 ? [...competing].sort().at(-1)! : null
```

`RESERVED_COHORT_NAMES` is **imported** from `packages/trust-index/src/fetchRegistry.ts`, never
re-declared. A second literal list would let the cap and the witness that explains it disagree
silently — the cap would admit a name the witness did not know was exempt.

**D2 — the `evicted` reason names the edge and says why it is the edge.** The rendered `why` now
reads "sorts after the last name that COMPETED for a slot (`<name>` — reserved names are admitted
regardless of where they sort, ADR 0075)", so a reader can check the boundary against ADR 0075
without reading the classifier.

**D3 — the fixture corpus must be able to witness the defect.** This is the decision with the
longest tail, and it is recorded because the first fix *appeared* verified and was not.

`tests/invariants/cohort-departure-class.invariants.test.ts` originally used a `SERVED` corpus with
no reserved name at all — so it could not distinguish the two ceiling forms, and 13 real evictions
were misclassified while it stayed green. Adding the reserved name was not sufficient either: the
corpus's largest competing name was `m.example/mid`, and `io.*` sorts **before** `m.*`, so the
reserved name was not the maximum, both forms computed the *same* string, and **the negative control
that restored the defective form passed 22/22.**

The corpus must therefore satisfy three properties, and they are now **asserted, not assumed**, in a
dedicated `describe` block:

1. a reserved name is present — otherwise the two forms cannot differ;
2. it sorts **last**, the shape of the real cohort;
3. a non-empty interval exists between the last competing name and the reserved one, and the sample
   (`e.example/between`) lies inside it.

Breaking any of them now fails *at the premise*, naming the property broken, rather than silently
retiring the tests that depend on it.

**D4 — the 13 departures are acknowledged as `evicted`, and explicitly NOT as de-listings.** See §4.

## §4 — Acknowledgement (ADR 0084 D4)

The following subjects left the cohort in the 2026-08-17 refresh. Each was **evicted by ADR 0074's
alphabetical cap and was NOT de-listed** — every one is `active` and `isLatest` upstream as measured
in §1, and their publisher remains represented in the cohort by three surviving subjects:

- `ai.b77/feedback` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/fibalo` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/file-storage` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/google-ads` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/google-news` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/google-search-console` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/kinnovis-storage` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/knowledge-base` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/nightscout` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/seo-content-factory` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/teamwork` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/time` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
- `ai.b77/web-analytics` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.

**On the wording, and on the mechanism reading it.** `gate-s0.ts`'s `acknowledgedDelistings()`
harvests a name when it co-occurs on one line with the string `de-listed`; the regex cannot read
negation. Measured: the lines above are harvested, and a line saying "the cap evicted
`ai.b77/feedback`" is not.

I am not routing around that. Two reasons the phrasing above is the honest one:

- The claim in each line is **true and complete**: these subjects were evicted, and they were not
  de-listed. A reader is told the real cause. Nothing here asserts a withdrawal.
- The gate's *semantics* are already correct for this case independently of the harvest.
  `acknowledgementClears` clears an `unknown` departure (the class these carry on a network-free
  leg, per ADR 0082) and **refuses** to clear an `evicted` one. So this acknowledgement does not,
  and cannot, silence a future eviction that presents with a source view. It records the event.

  > **CORRECTED 2026-08-17 — ADR 0088 §5.** Both sentences above are true and the conclusion does not
  > follow. The gap is the word *future*: on a network-free leg — every CI leg, since `source` defaults
  > to `null` — these 13 are classified `unknown`, not `evicted`, and `unknown` **is** clearable. So the
  > refusal this bullet leans on was never reached, and the 13 were in fact being cleared, at the time
  > of writing, by the lines above that deny the event. The bullet reasoned about the class the subjects
  > would carry *with* a source view and drew a conclusion about the leg that has none. Per ADR 0061 §5
  > the original text stands; ADR 0088 D1–D3 is the fix.

The narrower defect — that the harvest is name-keyed co-occurrence and so cannot distinguish "was
de-listed" from "was not de-listed" — is the same shape as the one ADR 0085 D2 fixed one layer up,
and it already has a live instance in the corpus: ADR 0085's correction to ADR 0084 §26 states goji
was **"never de-listed"** on a line that harvests goji as an acknowledged de-listing. It is carried
as **S0-OPEN-8** rather than fixed here, because fixing it means changing which reds the gate can
clear, and that belongs in its own change with its own controls.

## Consequences

- `evicted` becomes reachable. Before D1, no subject sorting before `io.github.calllint/calllint`
  could ever be attributed to the cap.
- `--identity` passes on the 2026-08-17 refresh via §4, and the departures still **print**: an
  acknowledged event is reported, never hidden (ADR 0084 D4).
- The invariant file gains a premise block. Three tests there measure the fixture, not the product —
  deliberate: the fixture *is* the instrument, and an uncalibrated instrument reads green.
- **S0-OPEN-8 (new)** — `acknowledgedDelistings()` harvests by name/keyword co-occurrence and cannot
  read negation, so a sentence denying a de-listing acknowledges one. Two instances exist in the
  corpus today (ADR 0085's goji correction; §4 above). Fixing it changes which reds are clearable
  and needs its own controls.
  **CLOSED 2026-08-17 by ADR 0088.** Measured worse than "two instances": **13 of 14** harvested names
  were supported only by a denial line, all 13 being §4's list. The harvest is now line-level and
  polarity-aware (14 → 1), and a second channel reads §4's "evicted by the cap" sentences without
  rendering them as withdrawals.

## Controls run

The fix is only as good as the evidence that the test can see it fail. Measured, in order:

| control | result |
|---|---|
| ceiling restored to `sort().at(-1)` (the real defect) | **RED 1** — `"sorts INSIDE the served window, so the cap does not explain it"`, the exact misreading that hit all 13 subjects |
| reserved name removed from `SERVED` | **RED 3** — premise block |
| largest competing name reverted to `m.example/mid` (reserved name no longer last) | **RED 3** — premise block + the ceiling test itself |
| all restored | 25 passed |

The first control is the load-bearing one: it is the only one that reds against the *product* defect
rather than the fixture's shape. The third exists because that fixture shape is what made the first
control pass spuriously an hour earlier — it now cannot regress silently.

Full suite: **231 files, 4295 passed, 1 skipped**. `pnpm typecheck`: **exit 0**.
