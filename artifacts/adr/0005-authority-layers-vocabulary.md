# ADR 0005 — Authority Model v2: the layer vocabulary, and `Entrypoint` over `Trigger`

- **Status:** Accepted
- **Date:** 2026-08-25
- **Supersedes in part:** [ADR 0004](0004-authority-v2-reality-mapping.md) — its Effect row is
  corrected below.
- **Source proposal:** `docs/new21.md` (`CALLLINT AUTHORITY MODEL v2 FREEZE PROPOSAL`).
  `docs/` is gitignored, so this file and ADR 0004 are the tracked record.
- **Plan:** [NEW21_SEQUENCING_PLAN.md](../architecture/NEW21_SEQUENCING_PLAN.md).

## Decision 1 — new21's Layer 2 is named `entrypoint`, not `trigger`

`packages/agent-triggers/src/taxonomy.ts` ships 10 `TRIGGER_IDS`, documented as part of the
contract and not renamable without an ADR, consumed by `calllint integrate`. They answer
*when should CallLint surface a preflight* (`grant-shell-exec`, `expose-secrets`). new21's
Layer 2 answers *what event started the agent* (a GitHub PR, a Slack message, cron).

Two legitimate concepts, one word. Letting both meanings coexist costs nothing up front and
produces no error — a reader who resolves `Trigger` to the wrong sense just carries a wrong
model. That is this repo's dominant fault class (a guard that cannot observe its subject)
in prose form, so it is the option to refuse.

Renaming the shipped ids would cost an ADR, a package rename, and every consumer, to free a
word. Renaming the *proposal's* layer costs one word. `entrypoint` it is, and
`packages/types/test/authority-layers.test.ts` asserts the two vocabularies stay disjoint —
so a later "helpful" wiring of the two fails a test rather than passing review.

## Decision 2 — the vocabulary is an enum, with no field and no record

ADR 0004 already refused `AuthorityObservation` as a parallel record: `AuthorityManifest`
has 14 non-test consumers, and a record they do not read is documentation wearing a type
signature. Its own in-place correction then refused the smaller move too — a derived `layer`
field on `AuthorityCapability` — because all five worked rows derive `tool`. The capability
**is** the Tool layer, so the field would be a constant.

What lands is therefore `AUTHORITY_LAYERS` + `AuthorityLayer` in
`packages/types/src/authority.ts`, plus `AUTHORITY_LAYER_STATES` /
`AuthorityLayerState` (`observed | unknown | unsupported`) and one pure function,
`authorityLayerVerdictFloor()`. No field, no record, no schema change.

`unsupported` is the only genuinely new state (0 prior hits in `packages/types/src`). It is
**not** a fifth verdict — `VERDICTS` stays `SAFE | REVIEW | BLOCK | UNKNOWN` — and **not**
`supportClass` (`NATIVE | CONFIG_SCAN | DISCOVERY_ONLY | DEFERRED`), which describes host
*distribution* support. Same English word, different subject.

`authorityLayerVerdictFloor()` exists so that new21 §6 (`UNKNOWN != SAFE`) has an executable
home rather than a prose one. It has no caller in the scan pipeline — no producer emits layer
states — so it changes no verdict today; it is the binding point for a future producer.

## Decision 3 — ADR 0004's Effect row is wrong: Effect ships, under another name

ADR 0004 recorded Effect as *"Absent, correctly — nothing normalizes 'different tools, same
consequence'"*, on a grep for `AuthorityEffect` / `EffectClass` / `normalizedEffect` that
returned zero hits.

The grep searched for names nothing uses. Measured against `HEAD`:

- `FP_EFFECTS` in `packages/types/src/fingerprint.ts` is a **closed 9-member normalized
  effect vocabulary** — `local_execution`, `network_egress`, `payment`, `messaging`, ….
- `deriveEffects()` in `packages/core/src/extract/fingerprint.ts:109` populates it by mapping
  `RiskSymbol` findings onto coarse consequences (`MONEY → payment`, `NETWORK →
  network_egress`), i.e. **different tools, same effect** — new21 §Layer 5's stated purpose.
- It is load-bearing: `effects` participates in the L1 `fingerprintHash()` (ADR 0019).

So **four of five layers ship**, not three. What is genuinely absent is not the Effect
*vocabulary* but the *binding* from an authority capability to an effect: `FP_EFFECTS` hangs
off findings in the fingerprint, not off `AuthorityCapability` in the manifest. That binding
stays deferred (§5 `RESERVED`/`DEFERRED`), and the mapping test asserts no `effect` field has
appeared on `AuthorityCapability`.

This is the same failure the sequencing plan warned about one section earlier: an instrument
that cannot see its subject reports absence. Recorded rather than quietly fixed, because a
correction a reader cannot find is not a correction.

## Consequence found while measuring, and deliberately NOT fixed here

`FP_EFFECTS` member `"messaging"` has **no producer**. `deriveEffects()` maps `ACTION →
external_mutation_unknown`, and nothing emits `messaging`; the string appears exactly once in
the tree, at its own declaration. A "send an email" tool fingerprints as
`external_mutation_unknown`, never `messaging`.

> **Corrected 2026-08-25: the sentence above is true of `deriveEffects()` but wrong about the
> system.** It reads as though nothing detects messaging at all. Something does:
> `packages/static-analyzer/src/detectors/messagingSend.ts` (ADR 0021 #8,
> `MESSAGING_OR_EMAIL_SEND`) emits finding `action.messaging-send` from 16 package-name hints
> (`slack`, `twilio`, `sendgrid`, `nodemailer`, …) and 5 send-verb patterns, with
> OBSERVED/INFERRED split on whether a tool descriptor or only the package name matched.
>
> So the real defect is a **lost distinction, not a missing capability.** That finding carries
> `symbol: "ACTION"`, and `deriveEffects()` keys *only* on `symbol` — so a Slack send tool and a
> generic "mutates something external" tool collapse into the same effect. The information exists
> one layer up and is discarded on the way down.
>
> That also changes what closing it costs. There is no `MESSAGING` member of `RISK_SYMBOLS` (9
> members: SECRETS, FILES, NETWORK, PROMPT, EXEC, ACTION, MONEY, SUPPLY, RUGPULL), so the fix is
> **not** "add a symbol" — it is to key on the finding `id`, which `deriveEffects()` already
> receives on every `Finding`. Still ADR-gated for the original reason: `effects` feeds
> `fingerprintHash()`, so it moves shipped L1 hashes and needs a fixture review.
>
> Pinned by a test that fails if either half stops being true — `a messaging server IS detected,
> and its effect collapses to external_mutation_unknown` in
> `packages/core/test/extract-fingerprint.test.ts`. Negative control: deleting the `"slack"` hint
> from the detector reds it at `expect(messaging).toBeDefined()`, so the assertion cannot pass
> vacuously by the detector quietly ceasing to fire — which is exactly how a `not.toContain`
> guard normally rots. Restored, md5-verified.

Adding the emitter is out of scope for a vocabulary ADR: `effects` feeds `fingerprintHash()`,
so emitting `messaging` would **change the L1 fingerprint of every messaging server**, which
is a reproducibility-contract change requiring its own ADR (and a fixture review). Left as a
measured, reported gap. `packages/core/test/extract-fingerprint.test.ts` (`FP_EFFECTS
reachability`) pins the reachable set at 8-of-9 with the gap named, so landing a producer
turns that test red and routes the author here instead of letting hashes drift silently.

## Acceptance (new21 §10)

| | criterion | how it is met |
|---|---|---|
| A | identical verdicts | type-only addition; full suite 4869 pass, no golden fixture moved |
| B | no detector count increase | no detector added; a layer taxonomy is not a rule |
| C | no runtime dependency | pure data + one pure function; no I/O, no clock |
| D | Cursor boundary represented | cloud wakeups ⇒ `entrypoint`/`unsupported`, floored to UNKNOWN |
| E | future platforms map in | asserted: no platform name in the vocabulary |
| F | positioning unchanged | still a static authority evidence analyzer; §2/§8 non-goals untouched |

## What this does not do

No runtime monitoring, no agent firewall, no cloud API, no platform-specific engine, no
LLM classification, no new detector, no verdict-semantics change — new21 §2 and §8, which
already match the shipped rules.
