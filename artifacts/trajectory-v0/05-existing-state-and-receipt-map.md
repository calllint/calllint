# 05 — Existing state and receipt map

Answers T0 questions 3, 4 (state half), and 6.

**Status: Q3 `EXISTS` but only at the receipt layer · Q4 `CONTRADICTED` · Q6 all four `ABSENT`.**

## Q3 — is there a prior-decision reference?

**`EXISTS`, and its placement is the finding.** There is exactly one, and it is on the *receipt*,
not on the decision:

| Claim | Binding | Measured |
| --- | --- | --- |
| A receipt can reference a prior receipt | [packages/types/src/decisionReceipt.ts:82-83](../../packages/types/src/decisionReceipt.ts#L82-L83) | `/** receiptId of a prior receipt this supersedes, or null. */` · `supersedes: string \| null` |
| The builder threads it through | [packages/install-planner/src/decisionReceipt.ts:90](../../packages/install-planner/src/decisionReceipt.ts#L90) | `supersedes: ctx.supersedes ?? null` |
| `TrustDecision` has no equivalent | [packages/types/src/trustDecision.ts:37-59](../../packages/types/src/trustDecision.ts#L37-L59) | 12 fields, none referencing a prior decision |

**So: a decision cannot reference a decision. Only a receipt can reference a receipt.**

That asymmetry is coherent rather than accidental. A `TrustDecision` is a pure function of its three
digests plus policy — it is *re-derivable*, and a re-derived decision has no history to point at. A
receipt is an *event*: it records that a decision was accepted at a time, by someone, and events
form chains. `supersedes` belongs on the event.

The consequence for a trajectory design is concrete: **decision history is receipt history**. A
model wanting "what did we decide about this before" reads the receipt chain, and inherits the
receipt layer's properties — including the extension prohibition below and the fact that receipts
are written only where a receipt writer runs, not on every decision.

Adjacent fields on the same type, measured at [decisionReceipt.ts:78-86](../../packages/types/src/decisionReceipt.ts#L78-L86),
because they bound what a chain can express: `scannerVersion`, `exceptionReason: string | null`,
`expiration` (ISO-8601 UTC, *"inherited from the plan's expiresAt"*), `revocation:
ReceiptRevocation | null`, and `signature: ReceiptSignature | null` (*"null/absent ⇒ unsigned local
receipt"*). A chain therefore already carries expiry and revocation — two things a naive design
would be tempted to add.

## Q4 — does the Receipt support extension?

**`CONTRADICTED`.** Measured in full in [02](02-schema-and-type-map.md): `additionalProperties:
false` on **29 of 30** schemas (the exception is vendored upstream SARIF), plus a gate at
[tests/schema/schema-compatibility.test.ts:56-58](../../tests/schema/schema-compatibility.test.ts#L56-L58)
that asserts unknown keys are *rejected* rather than merely that the flag is present.

Restated here because it lands on this chapter's subject: **a trajectory design cannot attach state
to a receipt by adding a field.** The gate reds. The legal moves are a schema change with an ADR, or
carrying the state elsewhere.

## Q6 — session, task, principal, delegation types?

**All four `ABSENT`,** measured by concept and not only by name:

| Type sought | `export interface`/`type` matches under `packages/*/src` | Related store |
| --- | --: | --- |
| `Session` | **0** | none |
| `Task` | **0** | none |
| `Principal` | **0** | none |
| `Delegation` | **0** | none |

A second search for a session-state store (`sessionId` / `session_id` under any `src/`) returned
**0 files**. There is no session table, no session cache, no session file. This is not "the types
are missing but the plumbing exists" — neither exists.

### What is closest, and why it is not a substitute

Two free-form strings on an optional field, at
[packages/action-analyzer/src/types.ts:60-64](../../packages/action-analyzer/src/types.ts#L60-L64):

```ts
export interface ActionProvenance {
  agent_session?: string
  workflow_step?: string
  timestamp?: string
  [key: string]: unknown
}
```

Four properties make this provenance rather than state, and all four matter:

1. **Optional at every level.** `provenance?` is optional on `ActionDescriptor`
   ([types.ts:24](../../packages/action-analyzer/src/types.ts#L24)), and each field is optional
   within it. Absence is legal everywhere, so nothing can rely on presence.
2. **Unvalidated `string`.** No format, no issuer, no uniqueness, no lifetime. `agent_session` is a
   label someone wrote down, not an identifier the system minted or can verify.
3. **No store.** Nothing reads `agent_session` to look anything up. It is carried into a record and
   read back out; there is no index on it and no table keyed by it.
4. **`[key: string]: unknown`** — this one type is *open* where the schemas are closed. It is the
   only extension point measured in this audit, and it is unvalidated by construction, so anything
   placed there is outside every schema guarantee described in [02](02-schema-and-type-map.md).

**`workflow_step?: string` is the nearest thing to a trajectory primitive in the repository**, and
it is a single optional unvalidated string with no ordering, no predecessor link, and no store. A
design needing sequence would be building on nothing.

## Q7 — the Feature Flag system

**`ABSENT`.** Measured: **0** occurrences of `featureFlag` / `feature_flag` (case-insensitive) under
any `packages/*/src`. What exists instead is direct environment reads — `process.env` appears in
**8** source files. No registry, no defaults table, no typed accessor, no per-flag documentation, no
kill switch.

This is recorded here rather than in [06](06-privacy-retention-map.md) because it bears directly on
the state question: **there is no mechanism to ship trajectory collection dark.** A design that
assumed "we can land it behind a flag and enable it later" would first have to build the flag system,
or add a ninth bare `process.env` read.

The R-9 deployment work in this same batch is a worked example of the pattern the repo does use:
each window is a named environment variable with a validating parser (`resolveRetentionDays`,
`resolveStagingOrphanHours`, both refusing zero, negative, and non-integer inputs) and the chosen
value recorded in the systemd unit with a gate pinning it. That is a per-variable discipline, not a
flag framework — and it is what "no flag system" looks like in practice here.

## What this chapter does not claim

- Not that the four absent types *should* exist. It records that they do not, so a design cannot
  assume them.
- Not that `supersedes` chains are validated. Whether a cycle or a dangling `receiptId` is rejected
  was not measured; the field's existence and its type are what is recorded.
- No count of receipts in any live store. This audit reads committed bytes only.
