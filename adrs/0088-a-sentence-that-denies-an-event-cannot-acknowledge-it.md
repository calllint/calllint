# ADR 0088 — a sentence that denies an event cannot acknowledge it

- **Status:** Accepted
- **Date:** 2026-08-17
- **Closes:** S0-OPEN-8 (opened by ADR 0086's Consequences).
- **Relates to:** ADR 0084 D4 (a departure must be acknowledged in an ADR), ADR 0085 D2 (the four
  departure classes), ADR 0086 (a cap eviction is not a withdrawal), ADR 0082 (a refusal must not
  read as a pass).
- **Corrects:** ADR 0086 §4's second bullet. See §5.

## Context

`gate-s0.ts --identity` fails when a subject leaves the committed cohort unacknowledged, and clears
that red by finding the subject's name in `adrs/` on a line that also contains the string
`de-listed`. Co-occurrence on one line. A regex has no notion of polarity, so:

```
- `ai.b77/feedback` — evicted by the cap, **not de-listed**: `active` + `isLatest` upstream.
```

harvested `ai.b77/feedback` as an **acknowledged de-listing**. The corpus says the publisher did not
withdraw this server; the gate read a human confirmation that they did.

ADR 0086 §4 wrote that sentence knowing the harvest would take it, said so in prose, and argued the
outcome was still correct. §5 below records why that argument was wrong.

## What was measured

### 1. The false-acknowledgement rate was 13 of 14

Every harvesting line in `adrs/`, 2026-08-17, before the fix:

| measured | value |
|---|---|
| harvesting lines | 15 |
| distinct names harvested | 14 |
| names supported **only** by a line that denies the de-listing | **13** |
| names with a genuine affirmative line | **1** — `agency.goji/goji` (ADR 0084:132) |

The 13 are ADR 0086 §4's list. Each is `active` + `isLatest` upstream (ADR 0086 §1), so all 13
acknowledgements the gate believed it had were claims about third parties that this repo's own
measurements contradict.

`agency.goji/goji` is the case that fixes the shape of the remedy: it carries an affirmative line
(0084:132, the event) **and** a negated one (0084:26, ADR 0085's correction — "was **never
de-listed**"). A document-level rule would have to choose between dropping a real acknowledgement and
honouring a denial. A line-level rule needs no such choice, because each line is a claim in itself.

### 2. Fixing the harvest exposed a red that was true

With the polarity filter in place the harvest went **14 → 1** (exactly goji), and `--identity` went
**EXIT 2 — "13 subject(s) left the cohort UNACKNOWLEDGED"**. That red is correct and was being
silenced: the 13 really did leave, and the corpus contained no sentence that cleared them without
lying. Three ways out, and only the third is honest:

| option | why not / why |
|---|---|
| write an affirmative "de-listed" line for each | **False.** All 13 are `active` + `isLatest`. This is what the bug was doing on our behalf, and refusing it is the whole point of ADR 0085/0086. |
| refuse to clear `unknown` as well | Wedges every network-free leg. `source` defaults to `null`, so there every departure is `unknown` and no green is reachable while the printed remedy (write an ADR) cannot work. |
| **teach the gate to read the acknowledgement the corpus already wrote** | ADR 0086 §4 states the true cause for each of the 13 in the form "evicted by the cap". `grep`: 13 such lines. The gate simply could not see them. |

Making a mechanism able to read a record a human already wrote is not widening what may be cleared.

### 3. The emphasis-stripping claim in my own first draft was false

The filter normalises a line (strip `*_~\``, collapse whitespace) before matching cues. The first
draft of its docblock said all 13 corpus lines bold the negation, so **without** the stripping the
filter would match none of them. Measured over all of `adrs/`: **21 denial lines, 0 of which require
the stripping.** `**not de-listed**` brackets the *whole phrase*, so the raw line still contains
`not de-listed`; the same is true of `_not de-listed_`.

The negative control caught it — twice, on two successive fixtures — which is the only reason it is
recorded here as a measurement rather than shipped as a justification. What the stripping actually
buys is emphasis *inside* the phrase (`not **de-listed**`, `**not** de-listed`, ``not `de-listed` ``),
ordinary markdown nobody would think twice about writing. That is cheap insurance, and it is now
described as insurance rather than as load-bearing.

### 4. A mutant survived, and it was the tests' fault, not the code's

The first implementation kept a shared early return:

```ts
if (d.class === "superseded" || d.class === "evicted") return false   // ran before either channel
if (acknowledged.has(d.name)) return true
return d.class === "unknown" && acknowledgedEvictions.has(d.name)
```

Widening that last line to a bare `acknowledgedEvictions.has(d.name)` — letting a cap-eviction
sentence clear **any** class, `superseded` included — left **42 of 42 tests green**. The early return
answered first, so the new channel's own restriction was unobservable, and the two tests written to
witness it were witnessing the early return instead.

This repo's dominant fault class is a guard that cannot observe its subject. Here it had reached the
tests *for* a guard that could not observe its subject. D3 is the structural answer.

## Decision

**D1 — the de-listing harvest is line-level and polarity-aware.** `lineDeniesDelisting` skips a line
whose normalised form carries any of 13 denial cues. It is a cue list, not a parser, and it cannot be
right in general — so it is built to fail toward **refusal**: an unrecognised denial leaves the name
harvested and the red cleared, which is the S0-OPEN-8 direction, so D3's per-class allowlists are what
bound the damage. An unrecognised *affirmative* merely leaves the gate red asking a human. The costs
are asymmetric and the tie is broken toward the cheaper failure. The known gap is pinned by a test
that asserts the gap exists rather than pretending the list is total.

**D2 — a second, separate acknowledgement channel: "our cap evicted this subject."**
`harvestAcknowledgedEvictions` reads the same corpus for a narrow cue naming ADR 0074's cap, and
clears **only** `unknown`. It is never merged with the de-listing set, never rendered as a withdrawal,
and the gate prints it on its own line: *"ACKNOWLEDGED in adrs/ as EVICTED BY OUR CAP (ADR 0074, NOT a
withdrawal)"*. The two channels assert different things about a third party, so neither may substitute
for the other.

It cannot clear an `evicted` departure even though that is the class its sentence describes: an
`evicted` classification required a source view proving the subject live upstream, so it is
established by measurement, and prose must not outrank an observation.

**D3 — each channel carries its own class allowlist; there is no shared early return.**
`DELISTING_CLEARS = ["de-listed", "unknown"]`, `EVICTION_CLEARS = ["unknown"]`. The refusals become
properties of the channel rather than of the order the branches happen to run in, which is what makes
them measurable — see §4 above and the control table below.

**D4 — the cause still prints as unestablished.** Clearing via either channel on a network-free leg
leaves the departure `unknown`, and both the renderer's UNCLASSIFIED block and the gate's `NOT
ESTABLISHED` line survive, now labelled with **which channel** cleared it. ADR 0082 requires a refusal
be visible, not inconsolable. A pass that names its own missing evidence is the shape that satisfies
both.

**D5 — the harvests live in `cohort-identity.ts`, not in the gate.** The gate is a script with
top-level effects; a rule observable only by running the whole gate is a rule whose branches go
unmeasured. These take text and return names, so a test can feed them a sentence.

## §5 — the correction to ADR 0086 §4

ADR 0086 §4's second bullet argued the gate's semantics were already correct for the 13, independently
of the harvest:

> `acknowledgementClears` clears an `unknown` departure … and **refuses** to clear an `evicted` one.
> So this acknowledgement does not, and cannot, silence a future eviction that presents with a source
> view. It records the event.

Both sentences are true. The conclusion does not follow, and the gap is the word *future*. On a
network-free leg — which is every CI leg, because `source` defaults to `null` — those 13 departures are
classified `unknown`, **not** `evicted`. And `unknown` **is** clearable. So the refusal the bullet
relied on was never reached: the 13 were being cleared, at the time of writing, by lines that deny the
event. The bullet reasoned about the class the subjects would carry *with* a source view and drew a
conclusion about the leg that has none.

Per ADR 0061 §5 the sentence is not rewritten; ADR 0086 §4 gains a note pointing here.

This is the same defect one layer up, and worth naming plainly: the bullet asserted a mechanism's
behaviour from reading its code rather than from running it against the corpus. The 13 mis-harvested
names were measurable the day that ADR was written.

## Consequences

- The gate's green on the 2026-08-17 refresh is unchanged in outcome and different in kind: it now
  rests on 13 sentences that state the true cause, read through a channel that cannot render them as
  withdrawals.
- **A denial can no longer clear a red.** The corpus can say "not de-listed" without the gate hearing
  "de-listed".
- The de-listing acknowledgement channel got **narrower**, not wider: 14 names → 1. D2's channel is
  additive but is restricted to a class D1's channel already cleared, so no departure is clearable now
  that was not clearable before this change. The set of *reasons* grew; the set of clearable states did
  not.
- Two mis-statements of my own are recorded rather than quietly fixed: the emphasis-stripping claim
  (§3) and the surviving mutant (§4). Both were caught by negative controls, which is the argument for
  writing controls that must red before trusting the ones that go green.
- The cue lists are prose-shaped and will need extending when someone phrases a denial a new way. That
  is a known, bounded maintenance cost with a red-gate failure mode, and it is preferable to the
  alternative the measurement rules out: trusting co-occurrence.

## Controls run

| control | result |
|---|---|
| harvest over `adrs/` before the fix | 14 names, 13 supported only by denial lines |
| harvest over `adrs/` after D1 | **1** — `agency.goji/goji`, the sole genuine acknowledgement |
| `--identity` after D1, before D2 | **EXIT 2** — 13 unacknowledged. The true red D2 answers |
| `--identity` after D1+D2+D3 | **EXIT 0**, 13 printed as cap-evictions, cause still `NOT ESTABLISHED` |
| `acknowledgement-polarity.invariants.test.ts` | 18 tests pass |
| **mutant:** polarity filter removed | **killed** — 4 tests red |
| **mutant:** eviction allowlist → every class | **killed** — 3 tests red (survived 42/42 before D3) |
| **mutant:** de-listing allowlist → every class | **killed** — 4 tests red |
| **mutant:** eviction harvest reads names from the stripped line | **killed** — 1 test red |
| full suite + typecheck | see the checkpoint below |

The mutants are the load-bearing controls. Three of the four target restrictions that a passing suite
cannot distinguish from their absence, and the second one **survived** on the first implementation —
which is how D3 came to exist.
