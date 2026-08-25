# new21 sequencing plan — Authority Model v2

- **Date:** 2026-08-25
- **Source:** `docs/new21.md` (`CALLLINT AUTHORITY MODEL v2 FREEZE PROPOSAL`, v2.0-draft).
  `docs/` is gitignored (`.gitignore:44`), so the proposal is not in version control; this
  file and [ADR 0004](../adr/0004-authority-v2-reality-mapping.md) are its tracked record.
- **Reality mapping:** [ADR 0004](../adr/0004-authority-v2-reality-mapping.md) — read it
  first. It measures which layers already ship.
- **Status: not started, and deliberately not urgent.** §10.A requires that existing scans
  produce identical verdicts, so nothing shipped is wrong today.

## Why this is a plan and not a phase

new21 §9 names three phases (A vocabulary, B mapping tests, C boundary regression). ADR 0004
measured them against the tree and the cost distribution is not what §9 implies: three of the
five layers already ship, so Phase A collapses to a single exported enum (Step 1 shows why the
field it seemed to need would be a constant), and the one genuinely new state (`UNSUPPORTED`)
sits in Phase C. Sequencing therefore matters more than scope.

One decision blocks the whole sequence, and it is the user's to make.

## The blocking decision: `Trigger` is taken

`packages/agent-triggers/src/taxonomy.ts` ships 10 `TRIGGER_IDS`, documented as "part of the
contract and must not be renamed without an ADR", consumed by `apps/cli/src/commands/integrate.ts`.
They answer *when should CallLint preflight* — `grant-shell-exec`, `expose-secrets`,
`financial-action`. new21's Layer 2 answers *what event started the agent* — GitHub PR, Slack
message, cron timer. Two legitimate concepts, one word.

| Option | Cost | Consequence |
|---|---|---|
| **Rename new21's layer to `Entrypoint`** (recommended) | one word in a doc | shipped ADR-protected vocabulary untouched |
| Rename the shipped `TRIGGER_IDS` | ADR + a package rename + every consumer | breaks a contract that is working, to free a word |
| Let both meanings coexist | zero up front | a reader resolving `Trigger` to the wrong sense gets **no error**, just a wrong model |

Option 3 is the one to refuse. This repo's dominant fault class is a guard that cannot
observe its subject; a term with two meanings is the same fault in prose — nothing fails, the
misreading just persists.

**Nothing below should start until this is settled.** Phase A writes the enum whose second
member is this name.

## Sequence

### Step 0 — settle the name

The table above, decided. No code.

### Step 1 — `AuthorityLayer` as vocabulary only, with no field to hang it on yet

new21 §5 correctly forbids `TriggerFinding` / `IdentityFinding` / etc. as premature detector
taxonomy. It then proposes `AuthorityObservation` as a new record. ADR 0004's measurement says
don't: `AuthorityManifest` has **14 non-test consumers**, and a parallel record they do not
read is documentation wearing a type signature — the `scan --config` defect, where a flag was
advertised on 8 surfaces while nothing read it.

The obvious smaller move — a derived `layer` field on `AuthorityCapability`, shaped like ADR
0041's `trustSource` — **was tried on paper and does not work.** Worked through concretely:

| capability | what layer is *the capability*? | where the other layers already live |
|---|---|---|
| `read × secret` | `tool` | provenance is Identity → `trustSource: sensitive.secret` |
| `execute × process` | `tool` | *where* it runs is Execution → `scope` |
| `delegate × agent` | `tool` | *who* it delegates to → `trustSource: untrusted.peer_agent` |
| `send × message` | `tool` | the consequence is Effect → nothing carries it (DEFERRED) |
| `spend × financial` | `tool` | consequence is Effect → DEFERRED |

The layer is **constant**. `AuthorityCapability` *is* the Tool layer — that is what ADR 0004
found when it mapped Tool onto `action × resource`. A field that is always `"tool"` carries no
information, and it is precisely the defect this plan warns about one paragraph up. The other
four layers are not properties *of a capability*; they are carried by neighbouring fields
(`trustSource`, `scope`) or not carried at all (Effect).

So Step 1 is smaller than §9 Phase A implies:

```
AUTHORITY_LAYERS = ["identity", "entrypoint", "execution", "tool", "effect"]   // name per Step 0
export type AuthorityLayer = (typeof AUTHORITY_LAYERS)[number]
```

The enum, exported, with a doc comment stating which shipped construct realizes each layer
(the ADR 0004 table) and that `effect` has no producer. **No field, no record, no schema
change.** It becomes the vocabulary that Step 3's `UNSUPPORTED` keys off, and the thing Step
2's test asserts against. That is the whole of Phase A that survives measurement.

Still ADR-gated: it lands in `packages/types/src/authority.ts`, whose sibling vocabularies
both document "extending it is an ADR-gated change", and it is the term future work will bind
to.

Acceptance: §10.A and §10.B — identical verdicts, no detector count increase. A type-only
export cannot change either, so this step is verified by `pnpm test` passing unchanged.

### Step 2 — the mapping test (new21 Phase B)

Pin ADR 0004's mapping table so it cannot drift silently. This is the highest-value part of
the proposal and the cheapest: it is a pure unit test over closed vocabularies that already
ship.

The test asserts **layer → realizing construct**, not capability → layer. That direction is
the one with content: each layer names a shipped vocabulary (or names its own absence), and
the failure mode worth catching is a layer whose realizing construct is renamed, emptied, or
quietly gains a second meaning.

| assertion | negative control |
|---|---|
| `AUTHORITY_LAYERS` has exactly 5 members, in ADR 0004's order | adding or reordering a member fails |
| `identity` ⇒ `TRUST_SOURCES` is non-empty and contains `unknown` | dropping the fail-safe member fails |
| `execution` ⇒ `AUTHORITY_RESOURCES` ⊇ `{process, filesystem, configuration}` | renaming `process` fails |
| `tool` ⇒ `AUTHORITY_ACTIONS` × `AUTHORITY_RESOURCES` is 9 × 10 | a silent vocabulary extension fails |
| `entrypoint` has **no** realizing construct, and is not `TRIGGER_IDS` | asserting the collision explicitly, so a later "helpful" wiring of the two fails here |
| `effect` has no producer | wiring one without an ADR fails |
| adding the enum changes no verdict | diff a golden report against `HEAD` — byte-identical |

The `entrypoint` row is the one that earns the test: it is the only place in the tree that
will state, executably, that new21's Layer 2 and `packages/agent-triggers`' `TRIGGER_IDS` are
different subjects. The last row is the one a "mapping test" most easily omits.

Every row above was checked for writability against `HEAD` before being listed here, so Step 2
is a transcription job rather than a discovery one: `TRUST_SOURCES` contains `unknown` (12
members), `AUTHORITY_RESOURCES` contains all three execution resources (10 members), the grid
is 9 × 10 = 90, and the five layer names are disjoint from all 10 `TRIGGER_IDS` — so the
`entrypoint` row asserts something true today rather than something aspirational.

One methodological note, because it nearly produced a wrong table: the throwaway script that
measured this first reported `INSTRUCTION_PATTERNS` = 23 and `TRIGGER_IDS` = 0. Both were the
instrument, not the tree — it counted quoted tokens inside `// "run as root", "sudo"` trailing
comments and required a line-final comma that `taxonomy.ts` does not use. The other counts
looked right only because those declarations happen to have comment-free entries. After
stripping comments outside string regions, all five counts matched their documented values, and
a negative control (injecting a fake `"smuggled"` resource into a *copy* of `authority.ts`)
turned the grid assertion red as it should. A vocabulary count that agrees with the doc is not
evidence the counter works.

### Step 3 — `UNSUPPORTED`, the only new state (new21 Phase C)

`UNSUPPORTED` appears **0 times** in `packages/types/src` (measured). It is genuinely new,
and it is the part of new21 worth having: Cursor's cloud triggers, GitHub-event wakeups, cron
execution and Slack events are real authority this product cannot statically observe, and
naming that is more honest than the current silence.

Two things this must not become:

- **Not a fifth verdict.** `VERDICTS` stays `SAFE | REVIEW | BLOCK | UNKNOWN`. `UNSUPPORTED`
  describes *observability of a layer*, not the outcome of a scan. Touching `VERDICTS`
  requires an ADR and is not in scope here.
- **Not confused with `supportClass`.** `NATIVE | CONFIG_SCAN | DISCOVERY_ONLY | DEFERRED` in
  `distribution-surfaces.schema.json` describes **host distribution support** — whether we
  can scan a host's config — not whether an authority layer is observable. Same English word,
  different subject.

Regression shape, per §6: an unsupported runtime authority must not read as SAFE. The
existing `VERDICT_SEVERITY` already puts `UNKNOWN` (2) above `REVIEW` (1) for exactly this
reason, so the test asserts the composition, not the constant.

### Step 4 — Effect stays deferred

The one layer where the proposal and the tree already agree: §5 marks Effect `RESERVED` and
its inference `DEFERRED`, and nothing in the repo normalizes "different tools, same
consequence" (0 hits for `AuthorityEffect` / `EffectClass` / `normalizedEffect`). No work.
Recorded so a later reader does not mistake the absence for an oversight.

## What this plan refuses to do

new21 §2 and §8 already forbid runtime monitoring, agent firewalls, cloud execution
inspection, platform-specific engines, and LLM classification. Those match the shipped rules
and need no restatement. The addition measured here:

- **No parallel record type.** See Step 1.
- **No second meaning for a shipped term.** See Step 0.
- **No new detector.** §10.B, and CLAUDE.md already requires a positive *and* negative
  fixture per rule — a layer taxonomy is not a rule and must not smuggle one in.

## Where this sits against current work

Not on the critical path of anything open. PR #333 (`feat/distribution-discovery-closure`) is
distribution work; folding an authority-model change into it would mix a semantic-model
evolution with a shelf-manifest batch. This lands as its own branch and its own ADR, after
Step 0.
